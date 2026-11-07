import { Children, type ReactNode } from "react";
import { useBalancedGrid } from "../hooks/useBalancedGrid";

// A balanced grid of equal-height tiles; see useBalancedGrid.
export default function TileGrid({ className = "", minTile = 140, children }: { className?: string; minTile?: number; children: ReactNode }) {
  const ref = useBalancedGrid<HTMLDivElement>(Children.count(children), minTile);
  return (
    <div ref={ref} className={`tile-grid ${className}`}>
      {children}
    </div>
  );
}
