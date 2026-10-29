import '@fontsource/silkscreen/400.css';
import '@fontsource/silkscreen/700.css';

// The menus and HUD, all plain DOM. Markup is in client/index.html, styles in src/style.css.

export { Banner } from './banner';
export { byId, MenuCard } from './card';
export { GameOverCard, type GameOverActions, type RunResult } from './gameover';
export { Hud } from './hud';
export { HowToCard } from './howto';
export { PauseCard, type PauseActions } from './pause';
export { RecordsCard } from './records';
export { SettingsCard, type SettingsOptions } from './settings';
export { TitleCard, type TitleActions } from './title';
export { UpgradeCard } from './upgrade';
