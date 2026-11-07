import { useLayoutEffect, useRef } from "react";

// Column count for `n` tiles when at most `max` fit across: as few rows as
// possible, never a single tile left alone on the last row, and the last
// row as full as it can be (5 tiles: 5 across, else 3 + 2). If only two fit
// and the count is odd, the last tile spans the row instead.
export function pickColumns(n: number, max: number): { cols: number; spanLast: boolean } {
  if (max <= 1 || n <= 1) return { cols: 1, spanLast: false };
  if (n <= max) return { cols: n, spanLast: false };
  let best = 0;
  for (let c = max; c >= 2; c--) {
    if (n % c === 1) continue;
    if (!best || Math.ceil(n / c) <= Math.ceil(n / best)) best = c;
  }
  return best ? { cols: best, spanLast: false } : { cols: 2, spanLast: true };
}

// Lays out a grid of equal tiles (app.css: .tile-grid). Each tile spans two
// half-columns, so a short last row can be centred by starting it half a
// column in per missing tile; every row is the height of the tallest tile.
// Also gives each tile its column as --col, which staggers the scroll entry.
export function useBalancedGrid<T extends HTMLElement>(count: number, minTile: number) {
  const ref = useRef<T>(null);

  useLayoutEffect(() => {
    const grid = ref.current;
    if (!grid) return;
    let lastWidth = -1;
    const layout = () => {
      const width = grid.clientWidth;
      if (width === lastWidth) return;
      lastWidth = width;
      const gap = parseFloat(getComputedStyle(grid).columnGap) || 0;
      // Narrow containers (phones) still get two columns while each tile
      // can stay at least 120px wide; one column of tiles reads as a list.
      const min = width < 480 ? Math.min(minTile, Math.max(120, (width - gap) / 2)) : minTile;
      const max = Math.max(1, Math.floor((width + gap) / (min + gap)));
      const tiles = Array.from(grid.children) as HTMLElement[];
      const { cols, spanLast } = pickColumns(tiles.length, max);
      const rest = tiles.length % cols;
      grid.style.setProperty("--half-cols", String(cols * 2));
      tiles.forEach((tile, i) => {
        tile.style.setProperty("--col", String(i % cols));
        const firstOfShortRow = rest > 0 && i === tiles.length - rest;
        tile.style.gridColumn = spanLast && i === tiles.length - 1
          ? "1 / -1"
          : firstOfShortRow
            ? `${cols - rest + 1} / span 2`
            : "";
      });
    };
    layout();
    const observer = new ResizeObserver(layout);
    observer.observe(grid);
    return () => observer.disconnect();
  }, [count, minTile]);

  return ref;
}
