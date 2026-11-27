import { FormEvent, useEffect, useState } from "react";
import {
  ApiError, type Board, type ClassInfo, type ClassStudent, createClass, fetchClassBoard, fetchClasses, fetchClassStudents,
  fetchConsentOptions, fetchCurrentSession, joinClass, markGuideForm, markPaperForm, requestConsent, startSession,
} from "../../lib/api";
import { n } from "../../lib/scoring";
import type { UserPublic } from "../../lib/types";
import ErrorState from "../ErrorState";
import SiteFooter from "../SiteFooter";

// #/classes and #/classes/<id> (phase 8: SC1, SC2, SC3, SC9). Join and the
// parent request are approved (2.41, with "6-character code"); the rest is
// DRAFT wording. Handles only unless the school opted in to names.

const CONSENT: Record<ClassStudent["consent"], string> = {
  not_needed: "18 or over",
  granted: "Approved",
  pending: "Waiting for a parent",
  paper_received: "Form received, waiting for Stackly",
};

// Phase 12: the separate parent tick for the AI guide. DRAFT wording.
const GUIDE: Record<NonNullable<ClassStudent["guide"]>, string> = {
  not_needed: "18 or over",
  granted: "Approved",
  form_received: "Form received, waiting for Stackly",
  not_yet: "Not yet",
};

// A11 (Stop 3): for the January pilot the paper form, collected by the
// school, is the main route; the email link shows only once email is on.
// DRAFT wording.
function ParentRequest() {
  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [emailOn, setEmailOn] = useState(false);
  useEffect(() => {
    fetchConsentOptions()
      .then((o) => setEmailOn(o.email))
      .catch(() => setEmailOn(false));
  }, []);
  async function send(e: FormEvent) {
    e.preventDefault();
    setMsg(null);
    try {
      await requestConsent(email.trim());
      setMsg("Sent. Ask your parent to check their email.");
    } catch (err) {
      setMsg(err instanceof ApiError ? err.message : "Couldn't send. Please try again.");
    }
  }
  return (
    <section className="glass panel" aria-labelledby="parent-title">
      <h2 className="section-title" id="parent-title">
        Ask a parent to approve
      </h2>
      <p className="section-text">You're under 18, so nothing you play is saved until a parent or guardian approves.</p>
      <p className="section-text">
        Print the <a href="#/consent-form">parent approval form</a>, ask a parent to sign it, and give it to your teacher.
      </p>
      {emailOn && (
        <>
          <p className="section-text">Or we can email your parent a link:</p>
          <form className="join-row" onSubmit={send}>
            <input className="input" type="email" required placeholder="Your parent's email" value={email} onChange={(e) => setEmail(e.target.value)} aria-label="Your parent's email" />
            <button type="submit" className="btn btn-primary" disabled={!email.trim()}>
              Send
            </button>
          </form>
        </>
      )}
      {msg && (
        <p className="section-text" role="status">
          {msg}
        </p>
      )}
    </section>
  );
}

function TeacherView({ cls }: { cls: ClassInfo }) {
  const [rows, setRows] = useState<ClassStudent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Phase 12: the guide column shows only while the guide is offered to students.
  const [guideOffered, setGuideOffered] = useState(false);
  useEffect(() => {
    fetchConsentOptions()
      .then((o) => setGuideOffered(Boolean(o.guide)))
      .catch(() => setGuideOffered(false));
  }, []);
  const load = () =>
    fetchClassStudents(cls.id)
      .then((v) => setRows(v.students))
      .catch((e) => setError(e instanceof ApiError ? e.message : "Couldn't load your class."));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => void load(), [cls.id]);
  async function live() {
    try {
      const s = await startSession(cls.id);
      window.location.hash = `#/live/${s.id}`;
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't start classroom mode.");
    }
  }
  const notStarted = rows?.filter((r) => !r.started) ?? [];
  return (
    <>
      <section className="glass panel" aria-labelledby="class-title">
        <h1 className="page-title" id="class-title">
          {cls.name}
        </h1>
        <p className="section-text">
          Class code: <strong className="class-code">{cls.code}</strong> · {cls.members} {cls.members === 1 ? "student" : "students"}
        </p>
        <div className="quick-end-actions">
          <button type="button" className="btn btn-primary" onClick={live}>
            Start classroom mode
          </button>
          <a className="btn btn-secondary" href="#/consent-form">
            Parent approval form
          </a>
        </div>
      </section>
      {error && <ErrorState message={error} onRetry={load} />}
      {rows && (
        <section className="glass panel" aria-label="Students">
          {rows.length === 0 ? (
            <p className="section-text">No one has joined yet. Share the class code.</p>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col">Student</th>
                    <th scope="col">Rounds</th>
                    <th scope="col">Average per card</th>
                    <th scope="col">Inside their range</th>
                    <th scope="col">Companies forecast</th>
                    <th scope="col">Parent approval</th>
                    {guideOffered && <th scope="col">AI guide</th>}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.user_id}>
                      <th scope="row">{r.display}</th>
                      <td>{r.rounds}</td>
                      <td>{r.average === null ? "N/A" : n(r.average)}</td>
                      <td>{r.caught === null ? "N/A" : `${Math.round(r.caught * 100)}%`}</td>
                      <td>{r.companies.length ? r.companies.join(", ") : "None yet"}</td>
                      <td>
                        {CONSENT[r.consent]}
                        {r.consent === "pending" && (
                          <button type="button" className="link-button" onClick={() => markPaperForm(cls.id, r.user_id).then(load)}>
                            {" "}
                            Mark form received
                          </button>
                        )}
                      </td>
                      {guideOffered && (
                        <td>
                          {GUIDE[r.guide ?? "not_needed"]}
                          {r.guide === "not_yet" && (
                            <button type="button" className="link-button" onClick={() => markGuideForm(cls.id, r.user_id).then(load)}>
                              {" "}
                              Mark guide box ticked
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {notStarted.length > 0 && (
            <p className="section-text">Not started yet: {notStarted.map((r) => r.display).join(", ")}.</p>
          )}
        </section>
      )}
    </>
  );
}

function MemberView({ cls }: { cls: ClassInfo }) {
  const [board, setBoard] = useState<Board | null>(null);
  const [session, setSession] = useState<number | null>(null);
  useEffect(() => {
    fetchClassBoard(cls.id, "week").then(setBoard).catch(() => setBoard(null));
    fetchCurrentSession(cls.id).then((s) => setSession(s.session_id)).catch(() => setSession(null));
  }, [cls.id]);
  return (
    <section className="glass panel" aria-labelledby="class-title">
      <h1 className="page-title" id="class-title">
        {cls.name}
      </h1>
      {session && (
        <a className="btn btn-primary" href={`#/live/${session}`}>
          Join the class round
        </a>
      )}
      <h2 className="section-title">Class board: this week</h2>
      {board && board.rows.length > 0 ? (
        <ol className="class-board">
          {board.rows.map((r) => (
            <li key={r.handle} className={r.you ? "is-you" : ""}>
              {r.handle}: {n(r.value)} ({r.count} cards)
            </li>
          ))}
        </ol>
      ) : (
        <p className="section-text">No one in the class has played {board?.minimum ?? 20} cards this week yet.</p>
      )}
    </section>
  );
}

export default function ClassesPage({ user, id, onOpenAuth }: { user: UserPublic | null; id?: number; onOpenAuth: () => void }) {
  const [classes, setClasses] = useState<ClassInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const load = () =>
    fetchClasses()
      .then(setClasses)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Couldn't load your classes."));
  useEffect(() => {
    if (user) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  async function join(e: FormEvent) {
    e.preventDefault();
    try {
      const c = await joinClass(code.trim());
      setCode("");
      window.location.hash = `#/classes/${c.id}`;
      void load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't join.");
    }
  }
  async function create(e: FormEvent) {
    e.preventDefault();
    try {
      const c = await createClass(name.trim());
      setName("");
      window.location.hash = `#/classes/${c.id}`;
      void load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't create the class.");
    }
  }

  if (!user)
    return (
      <div className="page">
        <section className="glass panel">
          <h1 className="page-title">Classes</h1>
          <p className="section-text">Sign in to join your class.</p>
          <button type="button" className="btn btn-primary" onClick={onOpenAuth}>
            Sign in
          </button>
        </section>
        <SiteFooter />
      </div>
    );
  const open = id ? classes?.find((c) => c.id === id) : undefined;
  const needsParent = user.age_band === "under_18" && user.guardian_consent_status !== "granted";
  return (
    <div className="page classes-page">
      {error && <p className="form-error">{error}</p>}
      {open ? (
        open.teaching ? <TeacherView cls={open} /> : <MemberView cls={open} />
      ) : (
        <>
          <section className="glass panel" aria-labelledby="classes-title">
            <h1 className="page-title" id="classes-title">
              Classes
            </h1>
            {/* A3 (Stop 3): proper rows: name, code, students. DRAFT. */}
            {classes && classes.length > 0 && (
              <ul className="class-rows">
                {classes.map((c) => (
                  <li key={c.id}>
                    <a className="class-row" href={`#/classes/${c.id}`}>
                      <strong>{c.name}</strong>
                      <span className="class-code">{c.code}</span>
                      <span>
                        {c.members} {c.members === 1 ? "student" : "students"}
                        {c.teaching ? " · your class" : ""}
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            )}
            <form className="join-form" onSubmit={join}>
              <label className="field" htmlFor="class-code">
                <span className="field-label">Join a class: enter your teacher's 6-character code.</span>
              </label>
              <div className="join-row">
                <input
                  id="class-code"
                  className="input class-code-input"
                  value={code}
                  maxLength={6}
                  placeholder="e.g. KX7Q2M"
                  autoCapitalize="characters"
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6))}
                />
                <button type="submit" className="btn btn-primary" disabled={code.length !== 6} aria-disabled={code.length !== 6}>
                  Join
                </button>
              </div>
            </form>
            {user.is_teacher && (
              <form className="search-form" onSubmit={create}>
                <label className="field">
                  <span className="field-label">New class name</span>
                  <input className="input" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="e.g. 9B Economics" />
                </label>
                <button type="submit" className="btn btn-secondary" disabled={!name.trim()}>
                  Create class
                </button>
              </form>
            )}
          </section>
          {needsParent && <ParentRequest />}
        </>
      )}
      <SiteFooter />
    </div>
  );
}
