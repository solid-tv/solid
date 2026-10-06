// Scenario: a VirtualRow of text tiles where presses move the window,
// so new text comes in on every press.
import { VirtualRow } from '@solidtv/solid/primitives';
import type { Scenario } from '../../scenario.js';
import { tileText } from './data.js';
import { TextTile } from './TextTile.js';

const ITEMS = Array.from({ length: 40 }, (_, n) => tileText(n));

/** Right x15 then Left x15: a cycle of 30 returns to item 0 and the start offset. */
const PRESSES = 15;

/**
 * scroll 'auto' with displaySize 7 and bufferSize 2 keeps 9 tiles mounted.
 * The cycle's first Right only scrolls the row by one tile and its last Left
 * scrolls it back; each of the other 28 presses shifts the window by one: the
 * VirtualRow's List reuses the tile that leaves the window for the item that
 * enters, rewriting its title and subtitle, and the row's flex pass moves
 * every tile by one slot. Only items 0 to 22 are ever in the window, so after
 * the first pass every layout is a layout-cache hit on both renderers.
 */
export const virtualTextRow: Scenario = {
  id: 'text-virtual-row',
  title:
    'VirtualRow of 40 flex-column text tiles (displaySize 7, bufferSize 2, scroll=auto): Right x15 then Left x15, each press brings in a tile with new text',
  text: true,
  App: () => (
    <VirtualRow
      autofocus
      x={60}
      y={160}
      gap={24}
      displaySize={7}
      bufferSize={2}
      scroll="auto"
      each={ITEMS}
    >
      {(item) => <TextTile item={item()} />}
    </VirtualRow>
  ),
  step: (i) => (i % (2 * PRESSES) < PRESSES ? 'ArrowRight' : 'ArrowLeft'),
  warmup: 2 * PRESSES,
  measured: 4 * PRESSES,
};
