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

// Each tile's share of its row's width (2026-11-18, Hriday: grids looked
// "too symmetrical"): one wide tile per row, and its place moves from row to
// row (left, right, middle). Five or more across stay equal.
const PATTERNS: Record<number, number[]> = {
  1: [1],
  2: [0.58, 0.42],
  3: [0.42, 0.29, 0.29],
  4: [0.31, 0.23, 0.23, 0.23],
};

export function rowShares(length: number, row: number): number[] {
  const base = PATTERNS[length];
  if (!base) return Array(length).fill(1 / length);
  if (length === 1) return base;
  const wideAt = length === 2 ? row % 2 : [0, length - 1, 1][row % 3];
  const rest = base.slice(1);
  return [...rest.slice(0, wideAt), base[0], ...rest.slice(wideAt)];
}

// Lays out a grid of cards (app.css: .tile-grid, a wrapping flex row). Rows
// are filled as pickColumns says, each row's widths from rowShares; a share
// that would make a card much narrower than minTile falls back to equal
// widths for that row. Every row is as tall as its tallest card. Also gives
// each card its place in the row as --col, which staggers the scroll entry.
export function useBalancedGrid<T extends HTMLElement>(count: number, minTile: number, pairOnPhones = true) {
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
      const min = pairOnPhones && width < 480 ? Math.min(minTile, Math.max(120, (width - gap) / 2)) : minTile;
      const max = Math.max(1, Math.floor((width + gap) / (min + gap)));
      const tiles = Array.from(grid.children) as HTMLElement[];
      const { cols, spanLast } = pickColumns(tiles.length, max);
      const rows: HTMLElement[][] = [];
      tiles.forEach((tile, i) => {
        if (spanLast && i === tiles.length - 1) rows.push([tile]);
        else if (i % cols === 0) rows.push([tile]);
        else rows[rows.length - 1].push(tile);
      });
      rows.forEach((row, r) => {
        const inner = width - (row.length - 1) * gap;
        let shares = rowShares(row.length, r);
        if (Math.min(...shares) * inner < min * 0.85) shares = shares.map(() => 1 / row.length);
        row.forEach((tile, i) => {
          tile.style.setProperty("--col", String(i));
          tile.style.flex = `0 0 calc((100% - ${(row.length - 1) * gap}px) * ${shares[i]} - 0.5px)`;
        });
      });
    };
    layout();
    const observer = new ResizeObserver(layout);
    observer.observe(grid);
    return () => observer.disconnect();
  }, [count, minTile, pairOnPhones]);

  return ref;
}
