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
});
