import { type FormEvent, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useSheet } from "../hooks/useSheet";
import { sendFeedback } from "../lib/reports";

// Y3 (master plan): "Something wrong? Tell us". Wording approved 2026-11-24
// (decisions 2.14). Portalled to <body> so the inert page behind can't
// swallow it. The email is optional and only kept if given (Privacy Policy).
export default function FeedbackSheet({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useSheet(ref, onClose);
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setState("sending");
    try {
      await sendFeedback(message.trim(), email);
      setState("sent");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't send. Please try again.");
      setState("idle");
    }
  }

  return createPortal(
    <>
      <div className="settings-backdrop" onClick={onClose} aria-hidden="true" />
      <div className="settings-panel sheet" role="dialog" aria-modal="true" aria-label="Something wrong? Tell us" ref={ref} tabIndex={-1}>
        <div className="settings-panel-header">
          <h2>Something wrong? Tell us</h2>
          <button type="button" className="icon-button" aria-label="Close" onClick={onClose}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        {state === "sent" ? (
          <p className="section-text" role="status">
            Thanks. We'll look at it.
          </p>
        ) : (
          <form className="feedback-form" onSubmit={submit}>
            <label className="field">
              <span className="field-label">What's wrong?</span>
              <textarea
                className="input"
                rows={5}
                maxLength={1000}
                required
                minLength={3}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
              />
            </label>
            <label className="field">
              <span className="field-label">Your email (optional, if you'd like a reply)</span>
              <input className="input" type="email" inputMode="email" maxLength={200} value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>
            {error && <div className="form-error">{error}</div>}
            <button type="submit" className="btn btn-primary btn-block" disabled={state === "sending"} aria-busy={state === "sending"}>
              Send
            </button>
          </form>
        )}
      </div>
    </>,
    document.body
  );
}
