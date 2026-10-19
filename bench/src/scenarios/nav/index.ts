import type { Scenario } from '../../scenario.js';
import navDrawerToggle from './navDrawer.js';
import { pageScenarios } from './page.js';
import portalFocusText from './portal.js';
import { posterScenarios } from './poster.js';
import { rowsScenarios } from './rows.js';
import thumbnailFocus from './thumbnail.js';
import { virtualScenarios } from './virtual.js';

/** Key-press, state-change and node-creation scenarios. */
export const navScenarios: Scenario[] = [
  ...rowsScenarios,
  thumbnailFocus,
  ...virtualScenarios,
  navDrawerToggle,
  portalFocusText,
  ...posterScenarios,
  ...pageScenarios,
];
