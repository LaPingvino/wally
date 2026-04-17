export interface LayoutDef {
  name: string;
  /** CSS grid-template-columns */
  cols: string;
  /** CSS grid-template-rows */
  rows: string;
  /** grid-column / grid-row for the "large" tile (index 0), if any */
  largeSpan?: { col: string; row: string };
}

export const MAX_TILES_PER_PAGE = 9;

/**
 * Pick the best predefined layout for the given tile count.
 * When `isNarrow` is true (container taller than wide-ish), small counts
 * stack vertically instead of squishing into side-by-side columns.
 */
export function pickLayout(count: number, isNarrow = false): LayoutDef {
  if (isNarrow) {
    switch (count) {
      case 0:
      case 1:
        return { name: '1', cols: '1fr', rows: '1fr' };
      case 2:
        return { name: '2↕', cols: '1fr', rows: '1fr 1fr' };
      case 3:
        return { name: '3↕', cols: '1fr', rows: '1fr 1fr 1fr' };
      case 4:
        return { name: '2x2', cols: '1fr 1fr', rows: '1fr 1fr' };
    }
  }
  switch (count) {
    case 0:
    case 1:
      return { name: '1', cols: '1fr', rows: '1fr' };
    case 2:
      return { name: '1x2', cols: '1fr 1fr', rows: '1fr' };
    case 3:
      return {
        name: '1+2',
        cols: '1fr 1fr',
        rows: '2fr 1fr',
        largeSpan: { col: '1 / -1', row: '1' },
      };
    case 4:
      return { name: '2x2', cols: '1fr 1fr', rows: '1fr 1fr' };
    case 5:
      return {
        name: '1+4',
        cols: '1fr 1fr',
        rows: '3fr 2fr 2fr',
        largeSpan: { col: '1 / -1', row: '1' },
      };
    case 6:
      return { name: '2x3', cols: '1fr 1fr 1fr', rows: '1fr 1fr' };
    case 7:
      return {
        name: '1+6',
        cols: '1fr 1fr 1fr',
        rows: '2fr 1fr 1fr',
        largeSpan: { col: '1 / -1', row: '1' },
      };
    case 8:
      return { name: '2x4', cols: '1fr 1fr 1fr 1fr', rows: '1fr 1fr' };
    default:
      return { name: '3x3', cols: '1fr 1fr 1fr', rows: '1fr 1fr 1fr' };
  }
}
