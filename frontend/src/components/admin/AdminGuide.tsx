import { useEffect, useState } from "react";
import { type AdminGuide as AdminGuideState, ApiError, fetchAdminGuide, type GuideMode, setAdminGuideMode } from "../../lib/api";

// Phase 12: the AI guide's switch (decision 9: off by default; "Teachers and
// admins" for a trial; "Everyone allowed" means adults plus under-18s whose
// parent ticked the guide box). It works only when ENABLE_GUIDE is set on
// the server. Admin-only wording.
const MODES: { key: GuideMode; label: string }[] = [
  { key: "off", label: "Off" },
  { key: "staff", label: "Teachers and admins" },
  { key: "on", label: "Everyone allowed" },
];

export default function AdminGuide() {
  const [state, setState] = useState<AdminGuideState | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    fetchAdminGuide()
      .then(setState)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Couldn't load the guide's switch."));
  }, []);
  const choose = (mode: GuideMode) =>
    setAdminGuideMode(mode)
      .then(setState)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Couldn't save."));
  return (
    <section className="admin-section" aria-labelledby="guide-admin-title">
      <h3 id="guide-admin-title">AI guide</h3>
      {error && <div className="form-error">{error}</div>}
      {state && (
        <>
          <div className="segmented" role="radiogroup" aria-label="Who can use the guide">
            {MODES.map((m) => (
              <button
                key={m.key}
                type="button"
                role="radio"
                aria-checked={state.mode === m.key}
                className={state.mode === m.key ? "active" : ""}
                onClick={() => choose(m.key)}
              >
                {m.label}
              </button>
            ))}
          </div>
          <p className="section-text">
            {state.env_enabled ? "Switched on for this deployment (ENABLE_GUIDE)." : "Off for this deployment: ENABLE_GUIDE isn't set, so this switch has no effect."}{" "}
            {state.fake ? "Fake mode: canned replies, no AI calls." : state.key_set ? `Model: ${state.model}.` : "No API key is set, so real replies are refused."}
          </p>
          <p className="section-text">
            Today: {state.today_calls} replies, ${state.today_usd.toFixed(2)} of ${state.spend_cap_usd.toFixed(2)}.
          </p>
        </>
      )}
    </section>
  );
}
