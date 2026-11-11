import { Children, type ReactNode } from "react";
import { useBalancedGrid } from "../hooks/useBalancedGrid";

// A balanced grid of equal-height tiles; see useBalancedGrid.
// pairOnPhones=false keeps wide cards (news, videos) one per row on phones.
export default function TileGrid({
  className = "",
  minTile = 140,
  pairOnPhones = true,
  children,
}: {
  className?: string;
  minTile?: number;
  pairOnPhones?: boolean;
  children: ReactNode;
}) {
  const ref = useBalancedGrid<HTMLDivElement>(Children.count(children), minTile, pairOnPhones);
  return (
    <div ref={ref} className={`tile-grid ${className}`}>
      {children}
    </div>
  );
}
