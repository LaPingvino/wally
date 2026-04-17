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
}

export interface PackerResult {
  rects: TileRect[];
  /** Total letterbox area as a fraction of container area (0..1). Lower = better fit. */
  score: number;
  rows: number;
  cols: number;
}

/**
 * Pack N tiles into `opts.width × opts.height` by trying every (rows, cols)
 * split that covers N tiles, scoring each by total letterbox area (container
 * area - sum of on-screen source areas), and picking the lowest.
 *
 * Complexity is O(N²) worst case — fine for call sizes. For very short
 * containers, cells with non-positive dimensions are skipped.
 */
export function packTiles(tiles: PackerTile[], opts: PackerOptions): PackerResult {
  const N = tiles.length;
  if (N === 0) {
    return { rects: [], score: 0, rows: 0, cols: 0 };
  }
  const { width: W, height: H, gap } = opts;
  if (W <= 0 || H <= 0) {
    return { rects: [], score: Infinity, rows: 0, cols: 0 };
  }

  let best: PackerResult | null = null;

  for (let rows = 1; rows <= N; rows++) {
    const cols = Math.ceil(N / rows);
    const cellW = (W - gap * (cols - 1)) / cols;
    const cellH = (H - gap * (rows - 1)) / rows;
    if (cellW <= 0 || cellH <= 0) continue;

    const cellAR = cellW / cellH;
    let totalWaste = 0;
    const rects: TileRect[] = [];

    for (let i = 0; i < N; i++) {
      const row = Math.floor(i / cols);
      const col = i % cols;
      const tile = tiles[i];
      const srcAR = tile.sourceAspect > 0 ? tile.sourceAspect : 16 / 9;
      // Shared factor: fraction of cell area filled by the source when contained.
      const fill = Math.min(cellAR, srcAR) / Math.max(cellAR, srcAR);
      const wasted = cellW * cellH * (1 - fill);
      totalWaste += wasted;

      rects.push({
        sid: tile.sid,
        left: col * (cellW + gap),
        top: row * (cellH + gap),
        width: cellW,
        height: cellH,
      });
    }

    const score = totalWaste / (W * H);
    if (!best || score < best.score) {
      best = { rects, score, rows, cols };
    }
  }

  // The `rows <= N` loop guarantees at least one valid layout as long as the
  // container has positive area, so best is non-null here.
  return best ?? { rects: [], score: Infinity, rows: 0, cols: 0 };
}
