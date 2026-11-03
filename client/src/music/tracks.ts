import type { Song, Stinger, StingerId, TrackId } from './song';
import { boss } from './tracks/boss';
import { sector1 } from './tracks/sector1';
import { sector2 } from './tracks/sector2';
import { sector3 } from './tracks/sector3';
import { STINGERS as stingers } from './tracks/stingers';
import { title } from './tracks/title';

// The soundtrack: five songs and four stingers, written as data in tracks/. See song.ts for the
// format and pattern.ts for the pattern grammar; open /music.html in dev to audition them.

// TODO(4b composer): the Hive Heart's own track; until then it borrows the boss theme.
export const TRACKS: Record<TrackId, Song> = { title, sector1, sector2, sector3, boss, heart: boss };

export const STINGERS: Record<StingerId, Stinger> = stingers;
