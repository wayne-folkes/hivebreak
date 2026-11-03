import type { BossHit, BossStep, BossStepContext, PartSpec } from './boss';
import type { BossPart, BossState, Box } from './types';

// The Hive Heart, the final boss (wave 15): a huge heart in the hive's core fed by four veins.
// boss.ts dispatches to this module for the 'hiveHeart' kind, as it does to hivemind.ts for the
// Hive Mind, so the run uses the same API for every boss.
//
// Phase 1: the veins shield the heart; every beat it fires a ring of shots with a gap in it.
// Phase 2 (all four veins cut): the heart is exposed, launches free aliens, the rings come faster.
// Phase 3 (below 1/3 health): double rings, and the heart sinks lower.
//
// TODO(4b worker): implement. Keep these exports' signatures.

/** Seconds between beats in phase 1, matched to the heart track's tempo (the composer uses it). */
export const HEART_BEAT_SECONDS = 1;

/** The heart's layout: the four veins, then the heart itself (its 'core'). Placeholder. */
export const HEART_PARTS: readonly PartSpec[] = [{ kind: 'core', dx: 0, dy: 0, halfWidth: 14, halfHeight: 12, hp: 220 }];

/** Sets the heart's own state up when it is created. */
export function initHeart(boss: BossState): void {
  boss.beatTimer = HEART_BEAT_SECONDS;
  boss.beats = 0;
}

/** True while it is still descending into view. */
export function heartEntering(boss: BossState): boolean {
  return boss.y > 100;
}

/** What is left of the fight, 0 to 1 (the heart's own hit points; its phases follow this). */
export function heartHealth(boss: BossState): number {
  const core = boss.parts.find((p) => p.kind === 'core');
  return core ? Math.max(0, core.hp) / core.maxHp : 0;
}

/** A shot against the heart: like hitBoss. A shot reaching the heart while veins stand is blocked. */
export function hitHeart(_boss: BossState, _shotBox: Box, _damage: number): BossHit | null {
  return null;
}

/** A vertical beam against the heart: like beamHitBoss. */
export function beamHitHeart(_boss: BossState, _x: number, _bottomY: number): { part: BossPart; blocked: boolean; y: number } | null {
  return null;
}

/** One step of the fight: descent, phases, beats and rings, launches. Like stepHive. */
export function stepHeart(boss: BossState, _ctx: BossStepContext, _out: BossStep): void {
  if (boss.y > 100) boss.y = Math.max(100, boss.y - 45 * _ctx.dt);
}
