import type { Scenario } from '../scenario.js';
import smoke from './smoke.js';
import { navScenarios } from './nav/index.js';
import { textScenarios } from './text/index.js';

/** Every scenario, in report order. `smoke` is for checking the harness only. */
export const scenarios: Scenario[] = [smoke, ...navScenarios, ...textScenarios];
