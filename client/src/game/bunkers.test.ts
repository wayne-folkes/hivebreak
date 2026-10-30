import { describe, expect, it } from 'vitest';
import {
  BUNKER_BOTTOM_Y,
  BUNKER_COUNT,
  BUNKER_HEIGHT,
  BUNKER_WIDTH,
  beamStopY,
  bunkerPixelSolid,
  bunkerSolidAt,
  bunkerSolidCount,
  createBunkers,
  erodeByBox,
  erodeColumn,
  hitBunker,
} from './bunkers';
import { FIELD_WIDTH } from './playfield';
import { SHIP_TOP } from './player';
import type { Box, Bunker } from './types';

const fresh = (): Bunker[] => {
  let id = 1;
  return createBunkers(() => id++);
};

/** A shot-sized box (2 wide, 6 tall like a real shot) centred on field point (x, y). */
const shot = (x: number, y: number): Box => ({ x, y, halfWidth: 1, halfHeight: 3 });

/** Field centre x of a bunker's column. */
const colX = (b: Bunker, col: number) => b.x + col + 0.5;

describe('createBunkers', () => {
  it('makes four distinct bunkers with full-size masks', () => {
    const bunkers = fresh();
    expect(bunkers).toHaveLength(BUNKER_COUNT);
    expect(new Set(bunkers.map((b) => b.id)).size).toBe(BUNKER_COUNT);
    for (const b of bunkers) {
      expect(b.width).toBe(BUNKER_WIDTH);
      expect(b.height).toBe(BUNKER_HEIGHT);
      expect(b.mask).toHaveLength(BUNKER_WIDTH * BUNKER_HEIGHT);
      expect(b.version).toBe(0);
    }
  });

  it('gives each bunker its own mask', () => {
    const [a, b] = fresh();
    a.mask[0] = 9;
    expect(b.mask[0]).not.toBe(9);
  });

  it('is an arch: solid legs, an opening at the bottom middle and rounded top corners', () => {
    const b = fresh()[0];
    const solid = (col: number, row: number) => bunkerPixelSolid(b, col, row);
    // Row 0 is the bottom: legs on both sides, a hole in the middle.
    expect(solid(0, 0) && solid(5, 0)).toBe(true);
    expect(solid(14, 0) && solid(19, 0)).toBe(true);
    for (let col = 6; col <= 13; col++) expect(solid(col, 0)).toBe(false);
    expect(solid(10, 2)).toBe(false);
    // The opening narrows at its top, then the arch closes over it.
    expect(solid(6, 3)).toBe(true);
    expect(solid(10, 3)).toBe(false);
    expect(solid(10, 4)).toBe(true);
    // Rounded top corners, full width lower down.
    expect(solid(0, 9)).toBe(false);
    expect(solid(19, 9)).toBe(false);
    expect(solid(3, 9)).toBe(true);
    expect(solid(0, 8)).toBe(false);
    expect(solid(0, 5)).toBe(true);
    // It is mirror symmetric.
    for (let row = 0; row < BUNKER_HEIGHT; row++) {
      for (let col = 0; col < BUNKER_WIDTH; col++) expect(solid(col, row)).toBe(solid(BUNKER_WIDTH - 1 - col, row));
    }
  });

  it('sits above the ship with room under it, inside the field, evenly spread', () => {
    const bunkers = fresh();
    for (const b of bunkers) {
      expect(b.y).toBe(BUNKER_BOTTOM_Y);
      expect(b.y).toBeGreaterThan(SHIP_TOP);
      expect(b.x).toBeGreaterThanOrEqual(-FIELD_WIDTH / 2);
      expect(b.x + b.width).toBeLessThanOrEqual(FIELD_WIDTH / 2);
    }
    const gaps = bunkers.slice(1).map((b, i) => b.x - (bunkers[i].x + bunkers[i].width));
    expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThanOrEqual(1);
    // Mirrored about the middle.
    expect(bunkers[0].x + bunkers[3].x + BUNKER_WIDTH).toBe(0);
    expect(bunkers[1].x + bunkers[2].x + BUNKER_WIDTH).toBe(0);
  });
});

describe('bunkerSolidAt', () => {
  it('reads the mask in field coordinates', () => {
    const b = fresh()[0];
    expect(bunkerSolidAt(b, b.x + 0.5, b.y + 0.5)).toBe(true); // bottom left leg
    expect(bunkerSolidAt(b, b.x + 10, b.y + 0.5)).toBe(false); // the opening
    expect(bunkerSolidAt(b, b.x - 1, b.y + 0.5)).toBe(false); // outside
    expect(bunkerSolidAt(b, b.x + 5, b.y + BUNKER_HEIGHT + 1)).toBe(false);
  });
});

describe('hitBunker', () => {
  it('misses a shot that is nowhere near', () => {
    const bunkers = fresh();
    expect(hitBunker(bunkers, shot(0, 0), 'below')).toBeNull();
    expect(hitBunker(bunkers, shot(0, 100), 'above')).toBeNull();
    expect(bunkers.every((b) => b.version === 0)).toBe(true);
  });

  it('lets a player shot bite the bottom of a leg', () => {
    const b = fresh()[1];
    const before = bunkerSolidCount(b);
    // Rising into the left leg from below.
    const hit = hitBunker([b], shot(colX(b, 2), b.y - 2), 'below');
    expect(hit).not.toBeNull();
    expect(hit!.bunker).toBe(b);
    expect(hit!.y).toBeCloseTo(b.y + 0.5);
    expect(bunkerSolidAt(b, hit!.x, hit!.y)).toBe(false);
    expect(before - bunkerSolidCount(b)).toBe(5);
    // The bite goes up into the bunker, not down out of it.
    expect(bunkerSolidAt(b, hit!.x, b.y + 2.5)).toBe(false);
    expect(bunkerSolidAt(b, hit!.x, b.y + 3.5)).toBe(true);
    expect(b.version).toBe(1);
  });

  it('lets an enemy shot bite the top, and bigger than a player shot', () => {
    const [p, e] = fresh();
    const px = hitBunker([p], shot(colX(p, 3), p.y - 2), 'below')!;
    const ex = hitBunker([e], shot(colX(e, 3), e.y + BUNKER_HEIGHT + 2), 'above')!;
    expect(ex.y).toBeCloseTo(e.y + BUNKER_HEIGHT - 0.5);
    expect(px).not.toBeNull();
    const playerLoss = bunkerSolidCount(fresh()[0]) - bunkerSolidCount(p);
    const enemyLoss = bunkerSolidCount(fresh()[1]) - bunkerSolidCount(e);
    expect(playerLoss).toBe(5);
    expect(enemyLoss).toBeGreaterThan(playerLoss);
    // It chewed down from the top.
    expect(bunkerSolidAt(e, ex.x, e.y + BUNKER_HEIGHT - 0.5)).toBe(false);
    expect(bunkerSolidAt(e, ex.x, e.y + BUNKER_HEIGHT - 3.5)).toBe(false);
    expect(bunkerSolidAt(e, ex.x, e.y + BUNKER_HEIGHT - 5.5)).toBe(true);
  });

  it('bumps version only when the mask changes', () => {
    const b = fresh()[0];
    expect(hitBunker([b], shot(colX(b, 10), b.y + 1), 'below')).toBeNull(); // through the opening, row 4 is 3 above
    expect(b.version).toBe(0);
    hitBunker([b], shot(colX(b, 2), b.y - 2), 'below');
    expect(b.version).toBe(1);
    expect(erodeByBox([b], { x: b.x - 50, y: b.y, halfWidth: 2, halfHeight: 2 })).toBe(false);
    expect(b.version).toBe(1);
  });

  it('lets a shot pass through a hole it has already cleared', () => {
    const b = fresh()[0];
    // Clear a column through the right leg.
    erodeByBox([b], { x: colX(b, 16), y: b.y + BUNKER_HEIGHT / 2, halfWidth: 1, halfHeight: BUNKER_HEIGHT / 2 });
    expect(hitBunker([b], shot(colX(b, 16), b.y + BUNKER_HEIGHT / 2), 'above')).toBeNull();
    expect(hitBunker([b], shot(colX(b, 16), b.y + BUNKER_HEIGHT / 2), 'below')).toBeNull();
  });

  it('hits the solid pixel nearest the middle of the box', () => {
    const b = fresh()[0];
    const hit = hitBunker([b], shot(colX(b, 14) + 0.2, b.y + 0.5), 'below')!;
    expect(hit.x).toBeCloseTo(colX(b, 14));
  });

  it('digs a narrow tunnel when the shot pierces, and the shot can hit again further in', () => {
    const [a, c] = fresh();
    const x = colX(a, 2);
    hitBunker([a], shot(x, a.y - 2), 'below', true);
    expect(a.version).toBe(1);
    expect(BUNKER_WIDTH * BUNKER_HEIGHT - bunkerSolidCount(a)).toBeGreaterThan(0);
    // Four deep in the middle column, and not as wide as an enemy splash.
    for (let row = 0; row < 4; row++) expect(bunkerPixelSolid(a, 2, row)).toBe(false);
    expect(bunkerPixelSolid(a, 2, 4)).toBe(true);
    expect(bunkerPixelSolid(a, 0, 0)).toBe(true);
    // The next step it is level with the tunnel and bores further in.
    expect(hitBunker([a], shot(x, a.y + 4), 'below', true)).not.toBeNull();
    expect(a.version).toBe(2);
    expect(bunkerPixelSolid(a, 1, 4)).toBe(false);
    // A non-piercing player shot leaves a smaller footprint than the tunnel plus the same hit.
    hitBunker([c], shot(x, c.y - 2), 'below', false);
    expect(bunkerSolidCount(c)).toBeGreaterThan(bunkerSolidCount(a));
  });

  it('is deterministic', () => {
    const run = () => {
      const bunkers = fresh();
      for (let i = 0; i < 40; i++) {
        hitBunker(bunkers, shot(-80 + i * 4, BUNKER_BOTTOM_Y + 12), 'above');
        hitBunker(bunkers, shot(-78 + i * 3.7, BUNKER_BOTTOM_Y - 2), 'below');
      }
      return bunkers.map((b) => [b.version, Array.from(b.mask).join('')]);
    };
    expect(run()).toEqual(run());
  });

  it('is cheap: thousands of misses take a few milliseconds', () => {
    const bunkers = fresh();
    const box = shot(0, 0);
    const start = performance.now();
    let hits = 0;
    for (let i = 0; i < 20000; i++) {
      box.x = (i % 180) - 90;
      box.y = i % 2 === 0 ? 40 : -60;
      if (hitBunker(bunkers, box, 'above')) hits++;
    }
    expect(hits).toBe(0);
    expect(performance.now() - start).toBeLessThan(50);
  });
});

describe('erodeByBox', () => {
  it('clears the pixels an alien-sized box overlaps and reports it', () => {
    const b = fresh()[0];
    const box: Box = { x: colX(b, 3), y: b.y + 5, halfWidth: 3, halfHeight: 2 };
    const before = bunkerSolidCount(b);
    expect(erodeByBox([b], box)).toBe(true);
    expect(b.version).toBe(1);
    expect(bunkerSolidAt(b, box.x, box.y)).toBe(false);
    expect(bunkerSolidAt(b, box.x - 2.5, box.y)).toBe(false);
    expect(bunkerSolidAt(b, box.x + 4.5, box.y)).toBe(true);
    // 7 columns by 4 rows, less the one trimmed corner pixel.
    expect(before - bunkerSolidCount(b)).toBe(27);
    // A second pass over the same spot changes nothing.
    expect(erodeByBox([b], box)).toBe(false);
    expect(b.version).toBe(1);
  });

  it('only counts as a change when something solid was there', () => {
    const b = fresh()[0];
    expect(erodeByBox([b], { x: colX(b, 10), y: b.y + 1, halfWidth: 2, halfHeight: 1 })).toBe(false);
    expect(b.version).toBe(0);
  });
});

describe('beams', () => {
  it('finds where a beam going up meets the underside of a leg', () => {
    const bunkers = fresh();
    const b = bunkers[0];
    expect(beamStopY(bunkers, colX(b, 2), b.y - 30, 'up')).toBeCloseTo(b.y);
    // Through the opening it meets the arch's roof at row 4.
    expect(beamStopY(bunkers, colX(b, 10), b.y - 30, 'up')).toBeCloseTo(b.y + 4);
  });

  it('finds where a beam going down meets the top', () => {
    const bunkers = fresh();
    const b = bunkers[2];
    expect(beamStopY(bunkers, colX(b, 10), b.y + 80, 'down')).toBeCloseTo(b.y + BUNKER_HEIGHT);
    // The rounded corner: the top solid pixel of the outer column is lower.
    expect(beamStopY(bunkers, colX(b, 0), b.y + 80, 'down')).toBeCloseTo(b.y + 6);
  });

  it('returns null when nothing is in the way, or the beam starts past the bunker', () => {
    const bunkers = fresh();
    const b = bunkers[0];
    expect(beamStopY(bunkers, 0, 0, 'up')).toBeNull(); // between bunkers
    expect(beamStopY(bunkers, colX(b, 2), b.y + 50, 'up')).toBeNull();
    expect(beamStopY(bunkers, colX(b, 2), b.y - 50, 'down')).toBeNull();
  });

  it('stops where it starts if it starts inside solid', () => {
    const b = fresh()[0];
    expect(beamStopY([b], colX(b, 2), b.y + 3.5, 'up')).toBeCloseTo(b.y + 3.5);
    expect(beamStopY([b], colX(b, 2), b.y + 3.5, 'down')).toBeCloseTo(b.y + 3.5);
  });

  it('burns a notch at the stop point, then stops lower down next time', () => {
    const bunkers = fresh();
    const b = bunkers[0];
    const x = colX(b, 2);
    const stop = beamStopY(bunkers, x, b.y + 60, 'down')!;
    expect(stop).toBeCloseTo(b.y + 9); // column 2 starts one row below the trimmed top
    expect(erodeColumn(bunkers, x, stop, 2)).toBe(true);
    expect(b.version).toBe(1);
    const again = beamStopY(bunkers, x, b.y + 60, 'down')!;
    expect(again).toBeLessThan(stop);
    expect(erodeColumn(bunkers, 0, 0, 2)).toBe(false);
  });

  it('only clears around the beam, not the whole bunker', () => {
    const bunkers = fresh();
    const b = bunkers[0];
    const x = colX(b, 10);
    const stop = beamStopY(bunkers, x, b.y - 30, 'up')!;
    erodeColumn(bunkers, x, stop, 2);
    expect(bunkerPixelSolid(b, 9, 4) && bunkerPixelSolid(b, 10, 4)).toBe(false);
    expect(bunkerPixelSolid(b, 12, 4)).toBe(true);
    expect(bunkerPixelSolid(b, 9, 5)).toBe(true);
  });
});
