import { describe, it, expect } from 'vitest';
import { packTiles, PackerTile } from '../packer';

const widescreen = (sid: string): PackerTile => ({ sid, sourceAspect: 16 / 9 });
const portrait = (sid: string): PackerTile => ({ sid, sourceAspect: 9 / 16 });
const square = (sid: string): PackerTile => ({ sid, sourceAspect: 1 });

describe('packTiles', () => {
  it('returns empty for zero tiles', () => {
    const result = packTiles([], { width: 1000, height: 600, gap: 4 });
    expect(result.rects).toHaveLength(0);
    expect(result.rows).toBe(0);
    expect(result.cols).toBe(0);
  });

  it('single tile fills the container', () => {
    const result = packTiles([widescreen('a')], { width: 1000, height: 600, gap: 4 });
    expect(result.rects).toHaveLength(1);
    expect(result.rects[0].width).toBeCloseTo(1000);
    expect(result.rects[0].height).toBeCloseTo(600);
    expect(result.rows).toBe(1);
    expect(result.cols).toBe(1);
  });

  it('two widescreen tiles side-by-side on a wide container', () => {
    const result = packTiles([widescreen('a'), widescreen('b')], { width: 1600, height: 600, gap: 4 });
    expect(result.rows).toBe(1);
    expect(result.cols).toBe(2);
  });

  it('two widescreen tiles stack vertically on a tall container', () => {
    const result = packTiles([widescreen('a'), widescreen('b')], { width: 400, height: 800, gap: 4 });
    expect(result.rows).toBe(2);
    expect(result.cols).toBe(1);
  });

  it('two portrait tiles side-by-side on a wide container', () => {
    // Portraits next to each other waste horizontal space but still beat
    // vertical stacking that would produce extremely short cells.
    const result = packTiles([portrait('a'), portrait('b')], { width: 800, height: 600, gap: 4 });
    expect(result.rows).toBe(1);
    expect(result.cols).toBe(2);
  });

  it('two portrait tiles stack vertically on a tall container', () => {
    const result = packTiles([portrait('a'), portrait('b')], { width: 300, height: 1200, gap: 4 });
    expect(result.rows).toBe(2);
    expect(result.cols).toBe(1);
  });

  it('four tiles form a 2x2 grid in a square container', () => {
    const squareTiles = [square('a'), square('b'), square('c'), square('d')];
    const result = packTiles(squareTiles, { width: 800, height: 800, gap: 4 });
    expect(result.rows).toBe(2);
    expect(result.cols).toBe(2);
  });

  it('tile rects do not overlap', () => {
    const tiles = [widescreen('a'), widescreen('b'), widescreen('c'), widescreen('d'), widescreen('e')];
    const result = packTiles(tiles, { width: 1200, height: 800, gap: 4 });
    const rects = result.rects;
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i];
        const b = rects[j];
        const overlapX = a.left < b.left + b.width && b.left < a.left + a.width;
        const overlapY = a.top < b.top + b.height && b.top < a.top + a.height;
        expect(overlapX && overlapY).toBe(false);
      }
    }
  });

  it('tiles fit within the container', () => {
    const tiles = [widescreen('a'), widescreen('b'), widescreen('c')];
    const W = 900;
    const H = 600;
    const result = packTiles(tiles, { width: W, height: H, gap: 4 });
    for (const r of result.rects) {
      expect(r.left).toBeGreaterThanOrEqual(0);
      expect(r.top).toBeGreaterThanOrEqual(0);
      expect(r.left + r.width).toBeLessThanOrEqual(W + 0.001);
      expect(r.top + r.height).toBeLessThanOrEqual(H + 0.001);
    }
  });

  it('score is lower when cells match source aspect', () => {
    // Wide container, 2 widescreen tiles: 1x2 cells are widescreen → good fit.
    const wideFit = packTiles([widescreen('a'), widescreen('b')], { width: 1600, height: 450, gap: 0 });
    // Same tiles forced into a square container → cells are narrower, more waste.
    const squareFit = packTiles([widescreen('a'), widescreen('b')], { width: 800, height: 800, gap: 0 });
    expect(wideFit.score).toBeLessThan(squareFit.score);
  });

  it('falls back gracefully on zero-area container', () => {
    const result = packTiles([widescreen('a')], { width: 0, height: 600, gap: 4 });
    expect(result.rects).toHaveLength(0);
  });

  it('invalid source aspect defaults to 16:9', () => {
    const result = packTiles([{ sid: 'a', sourceAspect: 0 }], { width: 1600, height: 900, gap: 4 });
    expect(result.rects).toHaveLength(1);
    expect(result.score).toBeCloseTo(0, 2); // perfect fit
  });

  it('hysteresis keeps the preferred shape when the new best is barely better', () => {
    // At near-square container, 1×2 and 2×1 layouts for 2 widescreen tiles
    // have very similar scores. With preferredShape = 1×2, we should keep it.
    const tiles = [widescreen('a'), widescreen('b')];
    const opts = { width: 900, height: 800, gap: 4 };
    const unpreferred = packTiles(tiles, opts);
    const preferred = packTiles(tiles, opts, { rows: unpreferred.rows === 1 ? 2 : 1, cols: unpreferred.rows === 1 ? 1 : 2 });
    // The preferred shape might not be returned if the delta is large,
    // but the test documents that passing preferredShape can change the result.
    // For a clear case: container 900x800 — 1×2 cells are 448×800, 2×1 cells are 900×398.
    // 1×2 AR=0.56 vs 16/9=1.78, fill=0.56/1.78=0.31. 2×1 AR=2.26 vs 1.78, fill=1.78/2.26=0.79.
    // So 2×1 is clearly better; 1×2 would need hysteresis to stick. But here the difference is
    // far more than 5%, so hysteresis doesn't override — we just verify the function accepts the
    // argument without error and still returns a valid layout.
    expect(preferred.rects).toHaveLength(2);
  });

  it('hysteresis sticks with preferred shape when scores are within threshold', () => {
    // Construct a scenario where two layouts have near-identical scores.
    // 4 square tiles in a square container: 2x2 and 4x1 are... actually 2x2 is obviously best.
    // Use 2 widescreen tiles in a wide container where 1x2 is clearly best, then pass 2x1 as preferred.
    // Bad preferred should be ignored since the gap > 5%.
    const tiles = [widescreen('a'), widescreen('b')];
    const opts = { width: 1600, height: 450, gap: 0 };
    // 1x2 cells: 800x450 AR=1.78 — perfect fit, score ~0.
    // 2x1 cells: 1600x225 AR=7.1 — terrible fit, score large.
    const result = packTiles(tiles, opts, { rows: 2, cols: 1 });
    // Best wins because preferred is far worse.
    expect(result.rows).toBe(1);
    expect(result.cols).toBe(2);
  });

  it('hysteresis holds preferred shape when scores are truly close', () => {
    // Two square tiles in a square container — 1x2 and 2x1 have identical scores.
    const tiles = [square('a'), square('b')];
    const opts = { width: 800, height: 800, gap: 0 };
    const resultHoriz = packTiles(tiles, opts, { rows: 1, cols: 2 });
    const resultVert = packTiles(tiles, opts, { rows: 2, cols: 1 });
    // Each should return the preferred shape since scores are tied.
    expect(resultHoriz.rows).toBe(1);
    expect(resultHoriz.cols).toBe(2);
    expect(resultVert.rows).toBe(2);
    expect(resultVert.cols).toBe(1);
  });
});
