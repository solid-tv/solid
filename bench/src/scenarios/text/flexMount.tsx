// Brief scenario: a Row of 20 flex tiles, each a flex column with a title and
// a subtitle, at mount.
import { Row } from '@solidtv/solid/primitives';
import { createSignal, For, Show } from 'solid-js';
import type { Scenario } from '../../scenario.js';
import { tileText, type TileText } from './data.js';
import { TextTile } from './TextTile.js';

const TILES_PER_ROW = 20;

/**
 * One op replaces the row: a keyed Show disposes the 20 tiles on screen and
 * mounts 20 new ones, so every op does the same work (an unmount and a mount)
 * rather than alternating between the two.
 *
 * Tiles are 200px wide with a 24px gap, from x=60: tiles 0 to 9 start inside
 * the renderers' 200px bounds margin, tiles 10 to 19 do not, and on both
 * renderers text under an out-of-bounds parent is not laid out, so those
 * tiles' columns stay unlaid-out (as in an app, until the row scrolls). An op
 * therefore creates 80 nodes and lays out 20 texts (10 tiles).
 *
 * `sets` is the number of distinct string sets the ops cycle through. With 1,
 * every mount lays out the same 20 strings, which after the first op are
 * layout-cache hits on both renderers. With 20, an op's strings were last laid
 * out 19 ops earlier, 380 layouts ago (more than the 250-entry layout cache
 * holds on either renderer), so every layout is a miss.
 */
function flexMount(variant: 'same' | 'new', sets: number): Scenario {
  const strings: TileText[][] = Array.from({ length: sets }, (_, s) =>
    Array.from({ length: TILES_PER_ROW }, (_, k) =>
      tileText(s * TILES_PER_ROW + k),
    ),
  );
  // Ops so far: the Show's key, so each op mounts a fresh row.
  const [ops, setOps] = createSignal(0);

  return {
    id: `text-flex-mount-${variant}`,
    title:
      variant === 'same'
        ? 'Remount a Row of 20 flex-column text tiles (title + subtitle), same 40 strings every op (layout cache hits)'
        : 'Remount a Row of 20 flex-column text tiles (title + subtitle), new strings every op (20 sets cycled, layout cache misses)',
    text: true,
    App: () => (
      <Show when={ops() + 1} keyed>
        {(key) => (
          <Row x={60} y={120} gap={24} scroll="none">
            <For each={strings[(key - 1) % sets]}>
              {(item) => <TextTile item={item} />}
            </For>
          </Row>
        )}
      </Show>
    ),
    step: (i) => {
      setOps(i + 1);
      return null;
    },
    // Multiples of `sets`, so measuring starts and ends on string set 0.
    warmup: variant === 'same' ? 30 : 40,
    measured: 60,
  };
}

export const flexMountSame = flexMount('same', 1);
export const flexMountNew = flexMount('new', 20);
