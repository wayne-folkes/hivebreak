import '@fontsource/silkscreen/400.css';
import '@fontsource/silkscreen/700.css';

// The menus and HUD, all plain DOM. Markup is in client/index.html, styles in src/style.css.

export { Banner } from './banner';
export { byId, MenuCard } from './card';
export { bossDownHeading, waveClearHeading } from './format';
export { GameOverCard, type GameOverActions, type RunResult } from './gameover';
export { Hud } from './hud';
export { HowToCard } from './howto';
export { PauseCard, type PauseActions } from './pause';
export { RecordsCard } from './records';
export { ShipCard } from './ship';
export { SpecialCard } from './special';
export { SettingsCard, type SettingsOptions } from './settings';
export { TitleCard, type TitleActions } from './title';
export { UnlockedCard, UNLOCKED_GUARD_SECONDS } from './unlocked';
export { UnlocksCard } from './unlocks';
export { UpgradeCard, type UpgradeShowOptions } from './upgrade';
