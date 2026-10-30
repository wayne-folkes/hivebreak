import { describe, expect, it } from 'vitest';
import { emptyProgress } from '../game/progress';
import { createRun } from '../game/run';
import type { RunEvent } from '../game/types';
import { RunLog } from './runlog';

const run = createRun(1);
const waves = (n: number): RunEvent[] =>
  Array.from({ length: n }, (_, i): RunEvent => ({ type: 'waveClear', wave: i }));

describe('RunLog', () => {
  it('has nothing to end until a run starts', () => {
    const log = new RunLog();
    expect(log.active).toBe(false);
    expect(log.end(emptyProgress())).toBeNull();
  });

  it('ends a run once: a second end finds nothing', () => {
    const log = new RunLog();
    log.start('breaker', 'pulseBomb');
    log.record([...waves(3), { type: 'lost', reason: 'lives' }], run);
    const first = log.end(emptyProgress());
    expect(first?.progress.totals.runs).toBe(1);
    expect(first?.met.map((m) => m.id)).toContain('firstSteps');
    expect(log.active).toBe(false);
    expect(log.end(first!.progress)).toBeNull();
  });

  it('counts a quit as a run that did not finish, with its kills and Specials', () => {
    const log = new RunLog();
    log.start('breaker', 'pulseBomb');
    log.record([{ type: 'specialFired', playerId: 0, special: 'pulseBomb', x: 0, y: 0 }], run);
    const ended = log.end(emptyProgress());
    expect(ended?.progress.totals.runs).toBe(0);
    expect(ended?.progress.totals.specials).toBe(1);
  });

  it('ignores events when no run is recorded, and a new start begins from nothing', () => {
    const log = new RunLog();
    log.record(waves(5), run);
    log.start('breaker', 'pulseBomb');
    expect(log.end(emptyProgress())?.met).toEqual([]);
  });
});
