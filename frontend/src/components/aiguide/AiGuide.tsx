import { type Dispatch, type FormEvent, type Ref, type SetStateAction, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  ApiError,
  askGuide,
  fetchGuideStatus,
  type GuidePage,
  type GuideStatus,
  type GuideTurn,
} from "../../lib/api";
import type { UserPublic } from "../../lib/types";
import { useSheet } from "../../hooks/useSheet";
import { prefersReducedMotion } from "../../hooks/useOnceVisible";
import { BallSkin } from "../FreeBall";

// The AI guide (phase 12; vault: Areas/AI guide plan, direction A). Home's
// real ball on a small slab, no face: it moves only to answer an action
// (rolls into the panel when opened, rolls while a reply is written, one
// small bounce when it arrives, a wobble for a fixed reply) and never when
// idle; under reduced motion it stays still. Shown only when the server
// says the guide is available to this person (signed in, switched on,
// consent in place). The conversation lives in this tab only. All wording
// is DRAFT (decisions note).

const INTRO = "Hello. I'm Stackly's AI guide, not a person. I can explain how Stackly works and the terms and figures on this page.";
const ROUND_INTRO = " I won't give the answer or a range; that part is yours.";
const CHIPS: Record<GuidePage["kind"], string[]> = {
  home: ["How do I play?", "What is a range?", "Why do narrow ranges score more?"],
  learn: ["How do I play?", "What is a range?", "Why do narrow ranges score more?"],
  practice: ["What do the colours mean?", "How is Practice different from the league?"],
  round: ["What does this number measure?", "Where do I start?"],
  practice_case: ["What does this number measure?", "Where do I start?"],
  results: ["Why did it come out like this?", "What is the lazy guess?"],
  research: ["What is operating margin?", "Why compare with a year earlier?"],
};
const FIXED = new Set(["advice", "price", "answer", "mystery", "safety", "personal", "offtopic", "error"]);
const HALF = (kind: GuidePage["kind"]) => kind === "round" || kind === "practice_case";

interface Line {
  role: "user" | "assistant";
  text: string;
  pending?: boolean;
}

function GuideMark({ markRef }: { markRef?: Ref<HTMLSpanElement> }) {
  return (
    <span className="ai-guide-mark" aria-hidden="true" ref={markRef}>
      <span className="ai-guide-slab" />
      <span className="ai-guide-ball ball-skin">
        <BallSkin />
      </span>
    </span>
  );
}

function pageKey(p: GuidePage): string {
  return [p.kind, p.card_id ?? "", p.code ?? "", p.event_id ?? "", p.symbol ?? ""].join("|");
}

// On a phone in a round, the sheet opens at half height: scroll the card's
// bar (`data-guide-keep`) just above where the sheet will sit.
function keepCardInView(): void {
  const keep =
    document.querySelector<HTMLElement>("[data-guide-keep] .range-slab") ?? document.querySelector<HTMLElement>("[data-guide-keep]");
  const scroller = document.querySelector<HTMLElement>(".app-shell-content");
  if (!keep || !scroller) return;
  const sheetTop = window.innerHeight * 0.56;
  const over = keep.getBoundingClientRect().bottom - (sheetTop - 8);
  if (over > 0) scroller.scrollBy({ top: over, behavior: "auto" });
}

export default function AiGuide({ user, page }: { user: UserPublic; page: GuidePage }) {
  const [status, setStatus] = useState<GuideStatus | null>(null);
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);
  const [left, setLeft] = useState<number | null>(null);
  const [from, setFrom] = useState<DOMRect | null>(null);
  const launchBall = useRef<HTMLSpanElement>(null);
  const launcher = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  // Closing gives focus back to the launcher, even where a click didn't focus
  // it (Safari), after the panel's own focus return has run.
  useEffect(() => {
    if (wasOpen.current && !open) launcher.current?.focus({ preventScroll: true });
    wasOpen.current = open;
  }, [open]);
  const key = pageKey(page);
  const [linesFor, setLinesFor] = useState(key);
  if (linesFor !== key) {
    // A new page (or card) starts a new conversation.
    setLinesFor(key);
    setLines([]);
  }

  useEffect(() => {
    let live = true;
    fetchGuideStatus()
      .then((s) => {
        if (!live) return;
        setStatus(s);
        setLeft(s.left);
      })
      .catch(() => live && setStatus(null));
    return () => {
      live = false;
    };
  }, [user.id]);

  if (!status?.available) return null;
  const phone = typeof window !== "undefined" && window.matchMedia?.("(max-width: 640px)").matches;
  const half = Boolean(phone && HALF(page.kind));

  function openPanel() {
    setFrom(launchBall.current?.getBoundingClientRect() ?? null);
    if (half) {
      document.documentElement.classList.add("ai-guide-half-open");
      keepCardInView();
    }
    setOpen(true);
  }

  function closePanel() {
    document.documentElement.classList.remove("ai-guide-half-open");
    setOpen(false);
  }

  return (
    <>
      {/* Stays mounted while the panel is open (hidden), so closing gives focus back to it. */}
      <button
        ref={launcher}
        type="button"
        className="ai-guide-launch"
        onClick={openPanel}
        aria-label="Open the guide, an AI, not a person"
        hidden={open}
      >
        <GuideMark markRef={launchBall} />
        <span>Guide</span>
      </button>
      {open && (
        <GuidePanel
          page={page}
          half={half}
          from={from}
          lines={lines}
          setLines={setLines}
          left={left}
          setLeft={setLeft}
          onClose={closePanel}
        />
      )}
    </>
  );
}

function GuidePanel({
  page,
  half,
  from,
  lines,
  setLines,
  left,
  setLeft,
  onClose,
}: {
  page: GuidePage;
  half: boolean;
  from: DOMRect | null;
  lines: Line[];
  setLines: Dispatch<SetStateAction<Line[]>>;
  left: number | null;
  setLeft: (n: number | null) => void;
  onClose: () => void;
}) {
  const panel = useRef<HTMLElement>(null);
  const mark = useRef<HTMLSpanElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const log = useRef<HTMLDivElement>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [announce, setAnnounce] = useState("");
  const [pose, setPose] = useState<"" | "is-thinking" | "is-bounce" | "is-wobble">("");
  useSheet(panel, onClose);

  // Keyboard users land in the question box; on touch screens the keyboard
  // isn't forced open (useSheet has already focused the panel's first control).
  useEffect(() => {
    if (window.matchMedia?.("(pointer: fine)").matches) input.current?.focus({ preventScroll: true });
  }, []);

  // The one roll: from the launcher into the header, under 400 ms.
  useLayoutEffect(() => {
    const ball = mark.current?.querySelector<HTMLElement>(".ai-guide-ball");
    if (!ball || !from || prefersReducedMotion() || typeof ball.animate !== "function") return;
    const to = ball.getBoundingClientRect();
    const dx = from.left - to.left;
    const dy = from.top - to.top;
    const turn = Math.hypot(dx, dy) / Math.max(1, to.width / 2); // radians rolled
    ball.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "translate(0, 0)" }], {
      duration: 360,
      easing: "cubic-bezier(0.2, 0.7, 0.2, 1)",
    });
    ball.querySelector<HTMLElement>(".ball-texture")?.animate(
      [{ transform: `rotate(${dx > 0 ? turn : -turn}rad)` }, { transform: "rotate(0rad)" }],
      { duration: 360, easing: "cubic-bezier(0.2, 0.7, 0.2, 1)" },
    );
  }, [from]);

  useEffect(() => {
    if (log.current) log.current.scrollTop = log.current.scrollHeight;
  }, [lines]);

  // A new conversation (a new page) clears the last announcement too.
  useEffect(() => {
    if (lines.length === 0) setAnnounce("");
  }, [lines.length]);

  async function ask(question: string) {
    const q = question.trim();
    if (!q || busy) return;
    setError(null);
    setText("");
    setBusy(true);
    setPose("is-thinking");
    const history: GuideTurn[] = lines
      .filter((l) => !l.pending && l.text)
      .slice(-6)
      .map((l) => ({ role: l.role, content: l.text.slice(0, 1500) }));
    setLines((ls) => [...ls, { role: "user", text: q }, { role: "assistant", text: "", pending: true }]);
    let reply = "";
    let outcome = "answered";
    try {
      await askGuide(page, q, history, (e) => {
        if (e.type === "text") reply += e.text;
        else if (e.type === "replace") reply = e.text;
        else {
          outcome = e.outcome;
          setLeft(e.left);
        }
        setLines((ls) => [...ls.slice(0, -1), { role: "assistant", text: reply, pending: e.type !== "done" }]);
      });
      setAnnounce(reply);
      setPose(FIXED.has(outcome) ? "is-wobble" : "is-bounce");
    } catch (e) {
      setLines((ls) => ls.slice(0, -2));
      setError(e instanceof ApiError ? e.message : "The guide couldn't answer just now. Please try again.");
      setPose("");
    } finally {
      setBusy(false);
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    void ask(text);
  }

  const still = prefersReducedMotion();
  return (
    <>
      <div className="ai-guide-backdrop" onClick={onClose} aria-hidden="true" />
      <section
        ref={panel}
        className={`ai-guide-panel${half ? " is-half" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-guide-title"
        tabIndex={-1}
      >
        <header className="ai-guide-head">
          <span
            className={`ai-guide-pose ${still ? "" : pose || (text && !busy ? "is-listening" : "")}`}
            onAnimationEnd={() => pose !== "is-thinking" && setPose("")}
          >
            <GuideMark markRef={mark} />
          </span>
          <div className="ai-guide-title">
            <h2 id="ai-guide-title">Guide</h2>
            <p>An AI guide, not a person</p>
          </div>
          <button type="button" className="icon-button ai-guide-close" onClick={onClose} aria-label="Close the guide">
            ×
          </button>
        </header>
        <div className="ai-guide-log" ref={log}>
          <p className="ai-guide-says">
            {INTRO}
            {HALF(page.kind) ? ROUND_INTRO : ""}
          </p>
          {lines.map((l, i) =>
            l.role === "user" ? (
              <p key={i} className="ai-guide-you">
                {l.text}
              </p>
            ) : (
              <p key={i} className="ai-guide-says" aria-busy={l.pending ? "true" : undefined}>
                {l.text || (l.pending ? "…" : "")}
              </p>
            ),
          )}
          {lines.length === 0 && (
            <div className="ai-guide-chips">
              {CHIPS[page.kind].map((c) => (
                <button key={c} type="button" className="ai-guide-chip" onClick={() => void ask(c)}>
                  {c}
                </button>
              ))}
            </div>
          )}
        </div>
        {error && (
          <p className="ai-guide-error" role="status">
            {error}
          </p>
        )}
        <form className="ai-guide-ask" onSubmit={submit}>
          <label htmlFor="ai-guide-input" className="visually-hidden">
            Ask the guide
          </label>
          <input
            id="ai-guide-input"
            ref={input}
            className="input"
            value={text}
            maxLength={500}
            placeholder="Ask about this page"
            autoComplete="off"
            onChange={(e) => setText(e.target.value)}
            disabled={busy}
          />
          <button type="submit" className="btn btn-primary" disabled={busy || !text.trim()} aria-busy={busy}>
            Send
          </button>
        </form>
        <p className="ai-guide-foot">
          Explains terms and figures. Never gives buy or sell advice.
          {left !== null && ` ${left === 1 ? "1 question" : `${left} questions`} left today.`}
        </p>
        <div className="visually-hidden" aria-live="polite">
          {announce}
        </div>
      </section>
    </>
  );
}
