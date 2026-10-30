import { describe, expect, it } from 'vitest';
import { createBoss } from '../game/boss';
import { LAUNCH_WARNING_SECONDS, bayGlowName, bossPartNames, corePulse, launchWarning } from './bossparts';

describe('bossPartNames', () => {
  it('maps the Brood Mother layout onto the model nodes', () => {
    let id = 1;
    const boss = createBoss('broodMother', () => id++);
    expect(bossPartNames(boss.parts)).toEqual(['plate_0', 'plate_1', 'plate_2', 'plate_3', 'core', 'bay_L', 'bay_R']);
  });

  it('finds the light strip under each bay', () => {
    expect(bayGlowName('bay_L')).toBe('bay_glow_L');
    expect(bayGlowName('bay_R')).toBe('bay_glow_R');
  });
});

describe('launchWarning', () => {
  it('is 0 until the last stretch before a launch, then climbs to 1', () => {
    expect(launchWarning(5, true)).toBe(0);
    expect(launchWarning(LAUNCH_WARNING_SECONDS, true)).toBe(0);
    expect(launchWarning(LAUNCH_WARNING_SECONDS / 2, true)).toBeCloseTo(0.5);
    expect(launchWarning(0, true)).toBe(1);
    expect(launchWarning(-0.1, true)).toBe(1);
  });

  it('stays 0 while the boss is entering, stunned or dead', () => {
    expect(launchWarning(0.2, false)).toBe(0);
  });
});

describe('corePulse', () => {
  it('throbs gently in phase 1 and harder in phase 2', () => {
    let low1 = 9;
    let high1 = 0;
    let low2 = 9;
    let high2 = 0;
    for (let t = 0; t < 10; t += 0.01) {
      const a = corePulse(1, t);
      const b = corePulse(2, t);
      low1 = Math.min(low1, a);
      high1 = Math.max(high1, a);
      low2 = Math.min(low2, b);
      high2 = Math.max(high2, b);
    }
    expect(high1 - low1).toBeLessThan(high2 - low2);
    expect(low1).toBeGreaterThan(0.9);
    expect(low2).toBeGreaterThan(0.7);
  });
});
