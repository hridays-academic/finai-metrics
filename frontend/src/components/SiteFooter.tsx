import { useState } from "react";
import FeedbackSheet from "./FeedbackSheet";

// The notice at the bottom of every page (2026-10), with the legal links
// (2026-11) and "Something wrong? Tell us" (Y3, 2026-11-25).
export default function SiteFooter() {
  const [open, setOpen] = useState(false);
  return (
    <footer className="site-footer">
      <p>Educational forecasting game. Not investment advice. Company data may be delayed or incomplete.</p>
      <p className="site-footer-links">
        <button type="button" className="link-button" onClick={() => setOpen(true)}>
          Something wrong? Tell us
        </button>
        <a href="#/schools">For schools</a>
        <a href="#/terms">Terms of Use</a>
        <a href="#/privacy">Privacy Policy</a>
      </p>
      {open && <FeedbackSheet onClose={() => setOpen(false)} />}
    </footer>
  );
}
