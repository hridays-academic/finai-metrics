import type { ReactNode } from "react";

// Source lines and notes under a panel, folded away (Hriday, 2026-11-18:
// no captions under charts and pictures). The text is unchanged and one
// click away, so every figure still carries its source.
export default function FinePrint({ children }: { children: ReactNode }) {
  return (
    <details className="fine-print">
      <summary>Sources and notes</summary>
      <p>{children}</p>
    </details>
  );
}
