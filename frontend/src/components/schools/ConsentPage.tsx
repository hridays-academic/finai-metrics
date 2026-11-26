import { FormEvent, useEffect, useState } from "react";
import { answerConsent, ApiError, fetchConsentPage } from "../../lib/api";
import { consentParagraphs } from "./ConsentText";

// #/consent/<token> (phase 8, SC3): the plain page a parent reaches from the
// email. Approve needs their name; the record keeps who, how (email) and when.
// Buttons approved (decisions item 8); other lines DRAFT.
export default function ConsentPage({ token }: { token: string }) {
  const [handle, setHandle] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [done, setDone] = useState<"approved" | "declined" | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetchConsentPage(token)
      .then((p) => setHandle(p.handle))
      .catch((e) => setError(e instanceof ApiError ? e.message : "We couldn't open this link."));
  }, [token]);

  async function decide(approve: boolean, e?: FormEvent) {
    e?.preventDefault();
    if (approve && !name.trim()) return setError("Please type your name to approve.");
    setBusy(true);
    setError(null);
    try {
      await answerConsent(token, approve, name.trim());
      setDone(approve ? "approved" : "declined");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page consent-page">
      <section className="glass panel">
        <h1 className="page-title">Parent or guardian approval</h1>
        {done === "approved" && <p className="section-text">Thank you. Your child's account is approved.</p>}
        {done === "declined" && <p className="section-text">Thank you. We haven't approved the account, and we've deleted your email address.</p>}
        {!done && handle && (
          <form onSubmit={(e) => decide(true, e)} className="consent-form">
            {consentParagraphs(handle).map((p) => (
              <p key={p} className="section-text">
                {p}
              </p>
            ))}
            <label className="field">
              <span className="field-label">Your name</span>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={120} />
            </label>
            <div className="admin-inline-actions">
              <button type="submit" className="btn btn-primary" disabled={busy}>
                Approve
              </button>
              <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => decide(false)}>
                I don't approve
              </button>
            </div>
          </form>
        )}
        {error && <p className="form-error">{error}</p>}
      </section>
    </div>
  );
}
