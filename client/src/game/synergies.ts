import type { Rng } from './rng';
import type { PlayerState, ShotKind, SynergyDef, SynergyId, UpgradeId } from './types';

// Synergies: holding one of each of a pair of upgrades unlocks a stronger form. This file lists
// them, finds the ones a player has completed, and answers the questions the rest of the sim asks
// about each (the effects themselves live where they act: player.ts, shots.ts and the run).

export const SYNERGIES: readonly SynergyDef[] = [
  { id: 'lance', name: 'Lance', description: 'Every volley adds a bolt that pierces everything.', needs: ['twinShot', 'piercing'] },
  { id: 'afterburner', name: 'Afterburner', description: 'Fire 30% faster while you are moving fast.', needs: ['rapidFire', 'thrusters'] },
  { id: 'bulwark', name: 'Bulwark', description: 'Once a wave, a spent shield comes back after 8 seconds.', needs: ['shieldPulse', 'extraLife'] },
  { id: 'seekers', name: 'Seekers', description: 'A shot that bounces homes twice as hard and gets one more bounce.', needs: ['homing', 'ricochet'] },
  { id: 'chainReaction', name: 'Chain reaction', description: 'Overcharge and lance kills always burst.', needs: ['bombOnKill', 'overcharge'] },
];

/** The Lance bolt: how many aliens it passes through and its base damage. */
export const LANCE_PIERCE = 99;
export const LANCE_DAMAGE = 2;
/** Afterburner works above this fraction of top speed, and multiplies the fire interval. */
export const AFTERBURNER_SPEED_FRACTION = 0.6;
export const AFTERBURNER_INTERVAL_FACTOR = 0.7;
/** Bulwark brings a used shield back after this many seconds. */
export const BULWARK_REGEN_SECONDS = 8;
/** Seekers: homing is multiplied and a bounce added the first time a shot bounces, up to a cap. */
export const SEEKERS_HOMING_FACTOR = 2;
export const SEEKERS_EXTRA_BOUNCES = 1;
export const SEEKERS_HOMING_CAP = 12;
/** A kill's burst: aliens within this radius (art pixels) take this much damage. */
export const BURST_RADIUS = 28;
export const BURST_DAMAGE = 1;

export function synergyDef(id: SynergyId): SynergyDef {
  const def = SYNERGIES.find((s) => s.id === id);
  if (!def) throw new Error(`Unknown synergy '${id}'`);
  return def;
}

/** True if the player has unlocked this synergy. */
export function hasSynergy(player: PlayerState, id: SynergyId): boolean {
  return player.synergies.includes(id);
}

function holds(player: PlayerState, id: UpgradeId): boolean {
  return player.upgrades.includes(id);
}

/**
 * Records any synergies the player's upgrades now complete and returns the newly unlocked ones.
 * Call it after `applyUpgrade`.
 */
export function unlockSynergies(player: PlayerState): SynergyId[] {
  const unlocked: SynergyId[] = [];
  for (const s of SYNERGIES) {
    if (hasSynergy(player, s.id)) continue;
    if (holds(player, s.needs[0]) && holds(player, s.needs[1])) {
      player.synergies.push(s.id);
      unlocked.push(s.id);
    }
  }
  return unlocked;
}

/**
 * The synergy that taking `upgrade` would complete for this player (not already unlocked), or
 * null. For the pick card's "completes LANCE" hint.
 */
export function completesSynergy(player: PlayerState, upgrade: UpgradeId): SynergyId | null {
  for (const s of SYNERGIES) {
    if (hasSynergy(player, s.id) || !s.needs.includes(upgrade)) continue;
    const other = s.needs[0] === upgrade ? s.needs[1] : s.needs[0];
    if (holds(player, other)) return s.id;
  }
  return null;
}

/**
 * Whether a kill bursts: a roll against the player's bomb-on-kill chance, or always for an
 * overcharge or lance kill once Chain reaction is unlocked. `kind` is the kind of shot that made
 * the kill, or null for kills with no shot (laser, Pulse Bomb, bursts). A burst's own kills never
 * burst again, so the run should not call this for them. The burst itself (BURST_DAMAGE to every
 * alien within BURST_RADIUS) is done by the run. Only rolls when it has to, so a ship without the
 * upgrade doesn't disturb the run's random numbers.
 */
export function killBursts(player: PlayerState, kind: ShotKind | null, rng: Rng): boolean {
  if (hasSynergy(player, 'chainReaction') && (kind === 'overcharge' || kind === 'lance')) return true;
  const chance = player.stats.bombOnKill;
  return chance > 0 && rng.next() < chance;
}
