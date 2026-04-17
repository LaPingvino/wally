/**
 * Layout packer — picks tile cell shapes to minimize the visual waste
 * (letterbox area) incurred when fitting each tile's source aspect into its
 * cell. Tiles render with `object-fit: contain`, so wasted area = black bars;
 * the packer tries to pick row/column counts that keep those bars small.
 *
 * Not a general bin-packer: all cells in a chosen (rows, cols) share the same
 * dimensions. That keeps the output feeling like a grid (symmetric, predictable)
 * rather than a mosaic, while still responding to source aspects and container
 * shape.
 */

export interface PackerTile {
  /** Stable key — participant.sid for LK participants. */
  sid: string;
  /** width / height of the source video. Defaults vary by caller. */
  sourceAspect: number;
}

export interface TileRect {
  sid: string;
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface PackerOptions {
  width: number;
  height: number;
  /** Gap between cells in px. */
  gap: number;
  /**
   * Maximum number of columns. Used on mobile / very small panels to force
   * a single-column vertical stack even when a multi-column layout would
   * theoretically score better — tiny tiles are worse than scrolling.
   */
  maxCols?: number;
}

export interface PackerResult {
  rects: TileRect[];
  /** Total letterbox area as a fraction of container area (0..1). Lower = better fit. */
  score: number;
  rows: number;
  cols: number;
}

/**
 * Score and emit rects for a fixed (rows, cols). Returns null if the cells
 * would be non-positive in either dimension.
 */
function computeLayoutAt(
  tiles: PackerTile[],
  opts: PackerOptions,
  rows: number,
  cols: number,
): PackerResult | null {
  const { width: W, height: H, gap } = opts;
  const cellW = (W - gap * (cols - 1)) / cols;
  const cellH = (H - gap * (rows - 1)) / rows;
  if (cellW <= 0 || cellH <= 0) return null;

  const cellAR = cellW / cellH;
  let totalWaste = 0;
  const rects: TileRect[] = [];

  for (let i = 0; i < tiles.length; i++) {
    const row = Math.floor(i / cols);
    const col = i % cols;
    const srcAR = tiles[i].sourceAspect > 0 ? tiles[i].sourceAspect : 16 / 9;
    const fill = Math.min(cellAR, srcAR) / Math.max(cellAR, srcAR);
    totalWaste += cellW * cellH * (1 - fill);
    rects.push({
      sid: tiles[i].sid,
      left: col * (cellW + gap),
      top: row * (cellH + gap),
      width: cellW,
      height: cellH,
    });
  }

  return { rects, score: totalWaste / (W * H), rows, cols };
}

/** Hysteresis threshold — stick with the previous shape unless a new best
 *  beats it by at least this fraction. Tuned to prevent flicker when a
 *  user drags the chat/call divider across an aspect boundary.
 */
const HYSTERESIS = 0.05;

/**
 * Pack N tiles into `opts.width × opts.height` by trying every (rows, cols)
 * split that covers N tiles, scoring each by total letterbox area (container
 * area - sum of on-screen source areas), and picking the lowest.
 *
 * When `preferredShape` is given, sticks with that (rows, cols) unless a new
 * best is materially better (>5% lower score) — prevents flicker while
 * resizing. Callers should pass the previously-rendered (rows, cols).
 *
 * Complexity O(N²) worst case — fine for call sizes.
 */
export function packTiles(
  tiles: PackerTile[],
  opts: PackerOptions,
  preferredShape?: { rows: number; cols: number },
): PackerResult {
  const N = tiles.length;
  if (N === 0) {
    return { rects: [], score: 0, rows: 0, cols: 0 };
  }
  const { width: W, height: H } = opts;
  if (W <= 0 || H <= 0) {
    return { rects: [], score: Infinity, rows: 0, cols: 0 };
  }

  const maxCols = opts.maxCols && opts.maxCols > 0 ? opts.maxCols : N;
  let best: PackerResult | null = null;
  for (let rows = 1; rows <= N; rows++) {
    const cols = Math.ceil(N / rows);
    if (cols > maxCols) continue;
    const candidate = computeLayoutAt(tiles, opts, rows, cols);
    if (!candidate) continue;
    if (!best || candidate.score < best.score) best = candidate;
  }

  if (!best) return { rects: [], score: Infinity, rows: 0, cols: 0 };

  if (
    preferredShape
    && (preferredShape.rows !== best.rows || preferredShape.cols !== best.cols)
    && preferredShape.rows > 0 && preferredShape.cols > 0
    && preferredShape.rows * preferredShape.cols >= N
  ) {
    const preferred = computeLayoutAt(tiles, opts, preferredShape.rows, preferredShape.cols);
    if (preferred && preferred.score <= best.score * (1 + HYSTERESIS)) {
      return preferred;
    }
  }

  return best;
}
