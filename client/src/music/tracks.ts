import type { Song, Stinger, StingerId, TrackId } from './song';
import { boss } from './tracks/boss';
import { sector1 } from './tracks/sector1';
import { sector2 } from './tracks/sector2';
import { STINGERS as stingers } from './tracks/stingers';
import { title } from './tracks/title';

// The soundtrack: four songs and four stingers, written as data in tracks/. See song.ts for the
// format and pattern.ts for the pattern grammar; open /music.html in dev to audition them.

export const TRACKS: Record<TrackId, Song> = { title, sector1, sector2, boss };

export const STINGERS: Record<StingerId, Stinger> = stingers;
