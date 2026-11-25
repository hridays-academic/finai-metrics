import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { installErrorReporting } from "./lib/reports";
import "./styles/theme.css";
// TEMPORARY (redesign step 2): old rules for pages not yet redesigned.
import "./styles/legacy.css";
import "./styles/app.css";

// S13: browser errors are reported first-party (lib/reports.ts).
installErrorReporting();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
