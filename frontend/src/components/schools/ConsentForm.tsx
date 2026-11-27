import { useEffect, useState } from "react";
import { fetchConsentOptions } from "../../lib/api";
import { consentParagraphs, GUIDE_PARAGRAPH } from "./ConsentText";

// #/consent-form (phase 8, SC4): the printable version for schools that
// prefer paper. The teacher marks it received; an admin confirms it.
export default function ConsentForm() {
  // Phase 12: the AI guide's paragraph and tick box, only while it's offered.
  const [guide, setGuide] = useState(false);
  useEffect(() => {
    fetchConsentOptions()
      .then((o) => setGuide(Boolean(o.guide)))
      .catch(() => setGuide(false));
  }, []);
  return (
    <div className="page consent-print">
      <section className="glass panel">
        <h1 className="page-title">Stackly: parent or guardian approval</h1>
        {consentParagraphs("[the student's handle]").map((p) => (
          <p key={p} className="section-text">
            {p}
          </p>
        ))}
        {guide && (
          <>
            <p className="section-text">5. {GUIDE_PARAGRAPH}</p>
            <p className="section-text consent-tick">
              <span className="consent-box" aria-hidden="true" /> I agree to the AI guide.
            </p>
          </>
        )}
        <dl className="consent-fields">
          <div>
            <dt>Student's handle</dt>
            <dd />
          </div>
          <div>
            <dt>Parent or guardian's name</dt>
            <dd />
          </div>
          <div>
            <dt>Signature</dt>
            <dd />
          </div>
          <div>
            <dt>Date</dt>
            <dd />
          </div>
        </dl>
        <p className="section-text">Please return this form to your child's teacher.</p>
        <button type="button" className="btn btn-primary no-print" onClick={() => window.print()}>
          Print
        </button>
      </section>
    </div>
  );
}
