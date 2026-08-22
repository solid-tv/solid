import * as v from 'vitest';
import * as lng from '@solidtv/solid';
import {
  useFocusManager,
  spatialForwardFocus,
  spatialHandleNavigation,
} from '@solidtv/solid/primitives';
import { renderer, waitForUpdate } from './setup.js';

const key = (k: string) =>
  document.dispatchEvent(new KeyboardEvent('keydown', { key: k }));

// 3x2 wrapped grid:
//   0 1 2
//   3 4
let grid!: lng.ElementNode;

v.beforeAll(async () => {
  renderer.render(() => {
    useFocusManager();
    return (
      <view
        ref={grid}
        autofocus
        display="flex"
        flexWrap="wrap"
        width={300}
        height={200}
        selected={0}
        forwardFocus={spatialForwardFocus}
        onUp={spatialHandleNavigation}
        onDown={spatialHandleNavigation}
        onLeft={spatialHandleNavigation}
        onRight={spatialHandleNavigation}
      >
        {Array.from({ length: 5 }, () => (
          <view width={100} height={100} />
        ))}
      </view>
    );
  });
  await waitForUpdate();
});

// Each test starts from an explicit child so it doesn't inherit the previous
// test's selection.
function focusChild(index: number) {
  grid.selected = index;
  (grid.children[index] as lng.ElementNode).setFocus();
}

v.describe('spatialHandleNavigation', () => {
  v.test('lays out the fixture as a wrapped 3x2 grid', () => {
    v.assert.deepEqual(
      grid.children.map((c) => [
        (c as lng.ElementNode).x,
        (c as lng.ElementNode).y,
      ]),
      [
        [0, 0],
        [100, 0],
        [200, 0],
        [0, 100],
        [100, 100],
      ],
    );
  });

  v.test('keeps the selection when there is no row below', () => {
    focusChild(0);

    key('ArrowDown'); // 0 -> 3
    v.assert.equal(grid.selected, 3);

    key('ArrowDown'); // no row below - selection must stay put
    v.assert.equal(grid.selected, 3);

    key('ArrowDown'); // still 3, not reset to the first child
    v.assert.equal(grid.selected, 3);

    key('ArrowUp'); // back up to 0
    v.assert.equal(grid.selected, 0);
  });

  v.test('keeps the selection when there is no row above', () => {
    focusChild(1);

    key('ArrowUp'); // no row above - selection must stay put
    v.assert.equal(grid.selected, 1);

    key('ArrowUp'); // still 1, not reset to the first child
    v.assert.equal(grid.selected, 1);

    key('ArrowDown'); // 1 -> 4
    v.assert.equal(grid.selected, 4);
  });

  v.test('keeps the selection at the row edges', () => {
    focusChild(0);

    key('ArrowLeft'); // already leftmost
    v.assert.equal(grid.selected, 0);

    focusChild(2);

    key('ArrowRight'); // end of the row, must not wrap or reset
    v.assert.equal(grid.selected, 2);

    key('ArrowLeft'); // 2 -> 1
    v.assert.equal(grid.selected, 1);
  });
});
