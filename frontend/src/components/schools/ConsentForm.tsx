import { consentParagraphs } from "./ConsentText";

// #/consent-form (phase 8, SC4): the printable version for schools that
// prefer paper. The teacher marks it received; an admin confirms it.
export default function ConsentForm() {
  return (
    <div className="page consent-print">
      <section className="glass panel">
        <h1 className="page-title">Stackly: parent or guardian approval</h1>
        {consentParagraphs("[the student's handle]").map((p) => (
          <p key={p} className="section-text">
            {p}
          </p>
        ))}
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
