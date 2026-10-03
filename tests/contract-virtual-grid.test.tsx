// Contract tests: VirtualGrid (mounted rows per press, window shift,
// selected -> data index mapping, final y, onSelectedChanged, selected,
// onEndReached, buffer/rows/columns).
//
// Pins today's behaviour (1.6.4) through the public surface: keys go through
// the focus manager's real keydown listener; assertions read the focused
// element, `selected`, `cursor` (documented as the data index), the data
// items of the mounted children, callback arguments and final y.
// Animations are off so positions are final.
//
// Note: VirtualGrid has no `upCount` prop. `upCount` belongs to LazyRow /
// LazyColumn (contract-lazy.test.tsx) and to Row/Column scroll="bounded"
// (contract-row-column.test.tsx).
import * as v from 'vitest';
import * as s from 'solid-js';
import * as lng from '@solidtv/solid';
import {
  VirtualGrid,
  useFocusManager,
  type KeyEventTarget,
} from '@solidtv/solid/primitives';
import { renderer } from './setup.js';

// Real KeyboardEvents on the target the focus manager listens to. A private
// target (instead of `document`) keeps listeners other files leave on
// `document` (vitest isolate: false) from handling a press twice.
const keys = new EventTarget();
const flush = () => new Promise<void>((r) => setTimeout(r, 0));

async function press(...names: string[]) {
  for (const key of names) {
    keys.dispatchEvent(new KeyboardEvent('keydown', { key }));
    await flush();
  }
}

async function mount(ui: () => s.JSX.Element) {
  const dispose = renderer.render(() => {
    useFocusManager(undefined, keys as unknown as KeyEventTarget);
    return ui();
  }) as unknown as () => void;
  await flush();
  return dispose;
}

const focusedId = () => lng.activeElement()?.id;

/** Data items of the mounted children, as "first-last" (they are contiguous). */
const mounted = (el: lng.ElementNode) => {
  const items = el.children.map((c) => (c as lng.ElementNode).item as number);
  return `${items[0]}-${items[items.length - 1]}`;
};

// Each child carries its data item as `item`; VirtualGrid finds the selected
// child by it. 200x100 cells; the grid is 700 wide so 3 fit per line.
const Cell = (props: { item: number }) => (
  <view id={`g${props.item}`} item={props.item} width={200} height={100} />
);

const range = (n: number) => Array.from({ length: n }, (_, i) => i);

let dispose: (() => void) | undefined;
const animationsEnabled = lng.Config.animationsEnabled;

v.beforeAll(() => {
  lng.Config.animationsEnabled = false;
});
v.afterAll(() => {
  lng.Config.animationsEnabled = animationsEnabled;
});
v.afterEach(() => {
  dispose?.();
  dispose = undefined;
});

v.describe('VirtualGrid', () => {
  v.it(
    'mounts (row + buffer) * columns + columns * rows items and lays them out with flex wrap',
    async () => {
      let grid!: lng.ElementNode;
      dispose = await mount(() => (
        <view width={1920} height={1080}>
          <VirtualGrid
            ref={grid}
            autofocus
            y={40}
            width={700}
            columns={3}
            rows={2}
            buffer={1}
            each={range(20)}
          >
            {(item) => <Cell item={item()} />}
          </VirtualGrid>
        </view>
      ));
      v.expect([focusedId(), grid.selected, grid.cursor, grid.y]).toEqual([
        'g0',
        0,
        0,
        40,
      ]);
      // Row 0, buffer 1: items 0 .. (0 + 1) * 3 + 3 * 2 - 1.
      v.expect(mounted(grid)).toBe('0-8');
      v.expect(grid.children.map((c) => [c.x, c.y])).toEqual([
        [0, 0],
        [200, 0],
        [400, 0],
        [0, 100],
        [200, 100],
        [400, 100],
        [0, 200],
        [200, 200],
        [400, 200],
      ]);
    },
  );

  v.it(
    'navigation: mounted items, selected, cursor, y and onEndReached after each press',
    async () => {
      let grid!: lng.ElementNode;
      const onEndReached = v.vi.fn();
      const parent = v.vi.fn(() => true);
      dispose = await mount(() => (
        <view
          width={1920}
          height={1080}
          onUp={parent}
          onDown={parent}
          onLeft={parent}
          onRight={parent}
        >
          <VirtualGrid
            ref={grid}
            autofocus
            y={40}
            width={700}
            columns={3}
            rows={2}
            buffer={1}
            each={range(20)}
            onEndReached={onEndReached}
            onEndReachedThreshold={4}
          >
            {(item) => <Cell item={item()} />}
          </VirtualGrid>
        </view>
      ));
      const seen: unknown[] = [];
      for (const key of [
        'ArrowRight',
        'ArrowRight',
        // Left/Right walk the mounted children in order, so Right at the end
        // of a line moves to the start of the next one.
        'ArrowRight',
        'ArrowDown',
        'ArrowDown',
        'ArrowDown',
        'ArrowDown',
        'ArrowDown',
        'ArrowLeft',
        'ArrowUp',
        'ArrowUp',
        'ArrowUp',
        'ArrowUp',
        'ArrowUp',
        'ArrowUp', // top row: bubbles
      ]) {
        await press(key);
        seen.push([
          key,
          focusedId(),
          grid.selected,
          grid.cursor,
          grid.y,
          mounted(grid),
          onEndReached.mock.calls.length,
          parent.mock.calls.length,
        ]);
      }
      v.expect(seen).toEqual([
        ['ArrowRight', 'g1', 1, 1, 40, '0-8', 0, 0],
        ['ArrowRight', 'g2', 2, 2, 40, '0-8', 0, 0],
        ['ArrowRight', 'g3', 3, 3, -60, '0-11', 0, 0],
        ['ArrowDown', 'g6', 3, 6, -60, '3-14', 0, 0],
        ['ArrowDown', 'g9', 3, 9, -60, '6-17', 0, 0],
        ['ArrowDown', 'g12', 3, 12, -60, '9-19', 0, 0],
        ['ArrowDown', 'g15', 3, 15, -60, '12-19', 0, 0],
        // 18 >= 20 - 4: onEndReached fires (only on a row change).
        ['ArrowDown', 'g18', 3, 18, -60, '15-19', 1, 0],
        ['ArrowLeft', 'g17', 5, 17, -60, '12-19', 2, 0],
        ['ArrowUp', 'g14', 5, 14, -60, '9-19', 2, 0],
        ['ArrowUp', 'g11', 5, 11, -60, '6-17', 2, 0],
        ['ArrowUp', 'g8', 5, 8, -60, '3-14', 2, 0],
        ['ArrowUp', 'g5', 5, 5, -60, '0-11', 2, 0],
        ['ArrowUp', 'g2', 2, 2, 40, '0-8', 2, 0],
        ['ArrowUp', 'g2', 2, 2, 40, '0-8', 2, 1],
      ]);
    },
  );

  v.it(
    'a row change lays the grid out once, a move within a row not at all (1.7)',
    async () => {
      let grid!: lng.ElementNode;
      dispose = await mount(() => (
        <view width={1920} height={1080}>
          <VirtualGrid
            ref={grid}
            autofocus
            y={40}
            width={700}
            columns={3}
            rows={2}
            buffer={1}
            each={range(20)}
          >
            {(item) => <Cell item={item()} />}
          </VirtualGrid>
        </view>
      ));
      // The grid's flex passes: updateLayout calls, from the post-mutation
      // layout phase and from VirtualGrid itself.
      let n = 0;
      const updateLayout = grid.updateLayout;
      grid.updateLayout = function (this: lng.ElementNode) {
        n++;
        return updateLayout.call(this);
      };
      const passes: number[] = [];
      for (const key of [
        'ArrowRight',
        'ArrowDown',
        'ArrowDown',
        'ArrowDown',
        'ArrowLeft',
        'ArrowUp',
        'ArrowUp',
      ]) {
        n = 0;
        await press(key);
        passes.push(n);
      }
      // It was two per row change and none within a row.
      v.expect(passes).toEqual([0, 1, 1, 1, 0, 1, 1]);
    },
  );

  v.it(
    'a press re-runs only the props that depend on the cursor: an unrelated prop getter is not read again (1.7)',
    async () => {
      let grid!: lng.ElementNode;
      let reads = 0;
      const probe = () => {
        reads++;
        return 1;
      };
      dispose = await mount(() => (
        <view width={1920} height={1080}>
          <VirtualGrid
            ref={grid}
            autofocus
            y={40}
            width={700}
            columns={3}
            rows={2}
            buffer={1}
            each={range(20)}
            probe={probe()}
          >
            {(item) => <Cell item={item()} />}
          </VirtualGrid>
        </view>
      ));
      const before = reads;
      await press('ArrowRight', 'ArrowDown', 'ArrowDown', 'ArrowUp');
      v.expect(grid.cursor).toBe(4);
      // It was read again on every press: the cursor was in the spread.
      v.expect(reads).toBe(before);
    },
  );

  v.it('defaults: rows 1, buffer 2, scroll "always"', async () => {
    let grid!: lng.ElementNode;
    dispose = await mount(() => (
      <view width={1920} height={1080}>
        <VirtualGrid
          ref={grid}
          autofocus
          y={40}
          width={700}
          columns={3}
          each={range(20)}
        >
          {(item) => <Cell item={item()} />}
        </VirtualGrid>
      </view>
    ));
    const seen: unknown[] = [
      [focusedId(), grid.selected, grid.cursor, grid.y, mounted(grid)],
    ];
    for (let i = 0; i < 4; i++) {
      await press('ArrowDown');
      seen.push([
        focusedId(),
        grid.selected,
        grid.cursor,
        grid.y,
        mounted(grid),
      ]);
    }
    v.expect(seen).toEqual([
      ['g0', 0, 0, 40, '0-8'],
      ['g3', 3, 3, -60, '0-11'],
      ['g6', 6, 6, -160, '0-14'],
      ['g9', 6, 9, -160, '3-17'],
      ['g12', 6, 12, -160, '6-19'],
    ]);
  });

  v.it(
    'onSelectedChanged is called as (idx, grid, active, lastIdx), this = grid; idx is the child index before the window shift; twice on autofocus mount',
    async () => {
      let grid!: lng.ElementNode;
      const calls: unknown[][] = [];
      dispose = await mount(() => (
        <view width={1920} height={1080}>
          <VirtualGrid
            ref={grid}
            autofocus
            y={40}
            width={700}
            columns={3}
            rows={2}
            buffer={1}
            each={range(20)}
            onSelectedChanged={function (this: unknown, ...args) {
              calls.push([
                this === grid,
                args.length,
                args[0],
                args[1] === grid,
                args[2]?.id,
                args[3],
              ]);
            }}
          >
            {(item) => <Cell item={item()} />}
          </VirtualGrid>
        </view>
      ));
      // VirtualGrid's callback is sometimes described as (idx, col, elm); it
      // gets four arguments like Row/Column.
      // Fires twice on mount: from the selected effect and from forwardFocus.
      v.expect(calls).toEqual([
        [true, 4, 0, true, 'g0', 0],
        [true, 4, 0, true, 'g0', 0],
      ]);
      calls.length = 0;
      await press('ArrowRight', 'ArrowRight', 'ArrowDown', 'ArrowDown');
      v.expect(calls).toEqual([
        [true, 4, 1, true, 'g1', 0],
        [true, 4, 2, true, 'g2', 1],
        [true, 4, 5, true, 'g5', 2],
        // g8 is child 8 of 0-11 when the callback runs; the window then moves
        // to 3-14 and selected becomes 5.
        [true, 4, 8, true, 'g8', 5],
      ]);
      v.expect([grid.selected, grid.cursor, mounted(grid)]).toEqual([
        5,
        8,
        '3-14',
      ]);
    },
  );

  v.it(
    'selected (reactive) is a data index; past the end it calls onEndReached and is applied once the items arrive',
    async () => {
      let grid!: lng.ElementNode;
      const calls: unknown[][] = [];
      const onEndReached = v.vi.fn();
      const [sel, setSel] = s.createSignal<number | undefined>(undefined);
      const [items, setItems] = s.createSignal(range(20));
      dispose = await mount(() => (
        <view width={1920} height={1080}>
          <VirtualGrid
            ref={grid}
            autofocus
            y={40}
            width={700}
            columns={3}
            rows={2}
            buffer={1}
            each={items()}
            selected={sel()}
            onEndReached={onEndReached}
            onSelectedChanged={(idx, _g, active, lastIdx) =>
              calls.push([idx, active?.id, lastIdx])
            }
          >
            {(item) => <Cell item={item()} />}
          </VirtualGrid>
        </view>
      ));
      calls.length = 0;
      const state = () => [
        focusedId(),
        grid.selected,
        grid.cursor,
        grid.y,
        mounted(grid),
        onEndReached.mock.calls.length,
      ];

      setSel(10);
      await flush();
      v.expect(state()).toEqual(['g10', 4, 10, -60, '6-17', 0]);
      // B15 (1.7): lastIdx is the previous child index, in the previous
      // window (g0 was child 0 of 0-8). It was the new data index (10): the
      // `selected` prop wrote it to the node before updateSelected read it,
      // the cause of the B15 test below where the grid stays scrolled.
      v.expect(calls).toEqual([[4, 'g10', 0]]);
      calls.length = 0;

      // Past the end: onEndReached (no threshold needed), focus stays.
      setSel(25);
      await flush();
      v.expect([
        focusedId(),
        grid.cursor,
        onEndReached.mock.calls.length,
      ]).toEqual(['g10', 10, 1]);
      v.expect(calls).toEqual([]);

      setItems(range(30));
      await flush();
      v.expect(state()).toEqual(['g25', 4, 25, -60, '21-29', 1]);
      // B15 (1.7): lastIdx is the previous child index, in the previous
      // window (g10 was child 4 of 6-17), not the data index (25) the
      // `selected` prop wrote to the node.
      v.expect(calls).toEqual([
        [4, 'g25', 4],
        [4, 'g25', 4],
      ]);

      await press('ArrowRight');
      v.expect(state()).toEqual(['g26', 5, 26, -60, '21-29', 1]);
    },
  );

  // B15 (fixed in 1.7): with autofocus and selected={10}, the first
  // forwardFocus runs before the selected effect and treated 10 as a child
  // index of the initial window (items 6-17), i.e. item 16: the grid ended on
  // g16 with cursor 16. `selected={props.selected || 0}` passed the data
  // index straight to the node; it now gets the child index (10 - 6 = 4).
  v.it(
    'B15: autofocus with an initial selected past the first window focuses that item',
    async () => {
      let grid!: lng.ElementNode;
      dispose = await mount(() => (
        <view width={1920} height={1080}>
          <VirtualGrid
            ref={grid}
            autofocus
            y={40}
            width={700}
            columns={3}
            rows={2}
            buffer={1}
            each={range(20)}
            selected={10}
          >
            {(item) => <Cell item={item()} />}
          </VirtualGrid>
        </view>
      ));
      // y: g10's row (row 1 of the window 6-17, 100 high) at the grid's
      // start, the same y as reaching g10 by Down then Up.
      v.expect([focusedId(), grid.cursor, grid.selected, grid.y]).toEqual([
        'g10',
        10,
        4,
        -60,
      ]);
      await press('ArrowDown', 'ArrowUp');
      v.expect([focusedId(), grid.cursor, grid.y]).toEqual(['g10', 10, -60]);
    },
  );

  v.it(
    'B15: an initial selected without autofocus: focusing the grid later focuses that item, scrolled to its row',
    async () => {
      let grid!: lng.ElementNode;
      dispose = await mount(() => (
        <view width={1920} height={1080}>
          <VirtualGrid
            ref={grid}
            y={40}
            width={700}
            columns={3}
            rows={2}
            buffer={1}
            each={range(20)}
            selected={10}
          >
            {(item) => <Cell item={item()} />}
          </VirtualGrid>
        </view>
      ));
      grid.setFocus();
      await flush();
      v.expect([focusedId(), grid.cursor, grid.selected, grid.y]).toEqual([
        'g10',
        10,
        4,
        -60,
      ]);
    },
  );

  // B15 (fixed in 1.7): after selected 10 -> 1, g1 was focused with y still
  // -60, so the top row was drawn 60px above the grid's start. updateSelected
  // read lastSelected from the node after the reactive `selected` prop had
  // overwritten it with the new value, so the row-change check in
  // onSelectedChanged saw no change and skipped the scroll. The prop no
  // longer writes the node's `selected` after mount.
  v.it(
    'B15: reactive selected back to the first row scrolls the grid back',
    async () => {
      let grid!: lng.ElementNode;
      const [sel, setSel] = s.createSignal<number | undefined>(undefined);
      dispose = await mount(() => (
        <view width={1920} height={1080}>
          <VirtualGrid
            ref={grid}
            autofocus
            y={40}
            width={700}
            columns={3}
            rows={2}
            buffer={1}
            each={range(20)}
            selected={sel()}
          >
            {(item) => <Cell item={item()} />}
          </VirtualGrid>
        </view>
      ));
      setSel(10);
      await flush();
      setSel(1);
      await flush();
      v.expect([focusedId(), grid.cursor, grid.y]).toEqual(['g1', 1, 40]);
    },
  );

  // B15 (fixed in 1.7): Down from g17 (no item below it) bubbled but left
  // `selected` at 8, past the 8 mounted children; the next Up computed
  // 8 - 3 = 5, landed on g17 again and the press was lost. onVerticalNav
  // wrote this.selected before checking that the child exists. Its last-row
  // guard (maxRows = floor(length / columns)) was also one row late when the
  // length is a multiple of columns.
  v.it(
    'B15: a Down with nothing below leaves selected alone, so the next Up moves up',
    async () => {
      let grid!: lng.ElementNode;
      dispose = await mount(() => (
        <view width={1920} height={1080}>
          <VirtualGrid
            ref={grid}
            autofocus
            y={40}
            width={700}
            columns={3}
            rows={2}
            buffer={1}
            each={range(20)}
          >
            {(item) => <Cell item={item()} />}
          </VirtualGrid>
        </view>
      ));
      await press('ArrowRight', 'ArrowRight');
      await press(...Array.from({ length: 5 }, () => 'ArrowDown'));
      v.expect(focusedId()).toBe('g17');
      const selectedBefore = grid.selected;
      await press('ArrowDown'); // nothing below g17
      v.expect([focusedId(), grid.selected]).toEqual(['g17', selectedBefore]);
      await press('ArrowUp');
      v.expect(focusedId()).toBe('g14');
    },
  );
});
