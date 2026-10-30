import { completeRun, newSummary, recordEvents } from '../game/progress';
import type { MilestoneDef, Progress, RunSummary } from '../game/progress';
import type { RunEvent, RunState, ShipId, SpecialId } from '../game/types';

// The record of the real run in progress, for the unlocks. main.ts starts it when a run's Special
// is chosen, feeds it every frame's events, and ends it when the run does: won, lost, or quit to
// the title. Ending hands the summary over and forgets it, so however many paths lead out of a
// run (the result card, a quit from the pause menu, Play again, a quit during the moment before
// the result card) it counts exactly once. The demo behind the title never starts one.

export class RunLog {
  private summary: RunSummary | null = null;

  /** Whether a run is being recorded. */
  get active(): boolean {
    return this.summary !== null;
  }

  /** Starts recording a new run. A run still being recorded is dropped, uncounted. */
  start(ship: ShipId, special: SpecialId): void {
    this.summary = newSummary(ship, special);
  }

  /** Folds one step's events in; `run` is the run after the step. Does nothing when no run is recorded. */
  record(events: readonly RunEvent[], run: RunState): void {
    if (this.summary) recordEvents(this.summary, events, run);
  }

  /**
   * Ends the run: adds it to the progress and returns the new progress with the milestones it met,
   * or null if there was no run to end (it already ended). A run that never reached its win or
   * loss counts as a quit (not a finished run).
   */
  end(progress: Progress): { progress: Progress; met: MilestoneDef[] } | null {
    const summary = this.summary;
    if (!summary) return null;
    this.summary = null;
    return completeRun(progress, { ...summary });
  }
}
