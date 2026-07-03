import * as v from 'vitest';
import * as lng from '@solidtv/solid';
import { LazyColumn } from '../src/primitives/Lazy.jsx';
import { renderer } from './setup.js';

const wait = (ms = 10) => new Promise((r) => setTimeout(r, ms));

// updateOffset runs before moveSelection in the chained onDown handler, the
// same order propagateKeyPress invokes it with (handler.call(elm, e, elm)).
const pressDown = (col: lng.ElementNode) =>
  (col as any).onDown.call(col, { key: 'ArrowDown' } as KeyboardEvent, col);

v.describe('Lazy components with empty content', () => {
  v.test('keeps mounting past items that render empty (#26)', async () => {
    let col!: lng.ElementNode;
    // Odd items render nothing: 10 data items, 5 rendered children total.
    const each = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

    const dispose = renderer.render(() => (
      <view width={1920} height={1080}>
        <LazyColumn ref={col} each={each} upCount={3} sync y={0}>
          {(item) => (
            <lng.Show when={item() % 2 === 0}>
              <view width={300} height={80} />
            </lng.Show>
          )}
        </LazyColumn>
      </view>
    ));
    await wait();

    col.setFocus();
    await wait();

    // Walk to the end of the list. 10 data items and one mount per press —
    // a dozen presses is more than enough when the guard terminates
    // correctly, and few enough to finish fast if it doesn't.
    for (let i = 0; i < 12; i++) {
      pressDown(col);
      await wait(1);
    }

    v.assert.equal(
      col.children.length,
      5,
      'all non-empty items mounted despite empty siblings',
    );
    v.assert.equal(col.selected, 4, 'selection reached the last child');

    dispose();
  });

  v.test('multi-node item templates do not stall mounting early', async () => {
    let col!: lng.ElementNode;
    // Each item renders two top-level nodes, so children.length runs at
    // twice the item count and reaches each.length before all items mount.
    const each = [0, 1, 2, 3, 4, 5];

    const dispose = renderer.render(() => (
      <view width={1920} height={1080}>
        <LazyColumn ref={col} each={each} upCount={2} sync y={0}>
          {() => (
            <>
              <view width={300} height={80} />
              <view width={300} height={20} skipFocus />
            </>
          )}
        </LazyColumn>
      </view>
    ));
    await wait();

    col.setFocus();
    await wait();

    for (let i = 0; i < 16; i++) {
      pressDown(col);
      await wait(1);
    }

    v.assert.equal(
      col.children.length,
      12,
      'every item mounted even though children outnumber data items',
    );

    dispose();
  });
});
