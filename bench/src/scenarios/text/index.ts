import type { Scenario } from '../../scenario.js';
import { detailsPanel } from './detailsPanel.js';
import { flexMountNew, flexMountSame } from './flexMount.js';
import { virtualTextRow } from './virtualRow.js';

/** Text-in-flex scenarios (the runner records text metrics for these). */
export const textScenarios: Scenario[] = [
  flexMountSame,
  flexMountNew,
  detailsPanel,
  virtualTextRow,
];
