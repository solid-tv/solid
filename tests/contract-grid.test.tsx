// Contract tests: Grid (navigation, looping, selected, scroll,
// onSelectedChanged).
//
// Pins today's behaviour (1.7) through the public surface: keys go through
// the focus manager's real keydown listener; assertions read the focused
// element, callback arguments and final x/y. Animations are off so y is final.
import * as v from 'vitest';
import * as s from 'solid-js';
import * as lng from '@solidtv/solid';
import {
  Grid,
  useFocusManager,
  type GridItemProps,
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

const Cell = (p: GridItemProps<number>) => (
  <view id={`g${p.index}`} x={p.x} y={p.y} width={p.width} height={p.height} />
);

// 10 items in 3 columns, 100x50 cells with itemOffset 10:
//   g0 g1 g2
//   g3 g4 g5
//   g6 g7 g8
//   g9
const tenItems = Array.from({ length: 10 }, (_, i) => i);

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

async function walk(sequence: string[], read: () => unknown) {
  const seen: unknown[] = [];
  for (const key of sequence) {
    await press(key);
    seen.push(read());
  }
  return seen;
}

v.describe('Grid', () => {
  v.it(
    'lays out cells from columns/itemWidth/itemHeight/itemOffset',
    async () => {
      let grid!: lng.ElementNode;
      dispose = await mount(() => (
        <view width={1920} height={1080}>
          <Grid
            ref={grid}
            autofocus
            y={20}
            items={tenItems}
            columns={3}
            itemWidth={100}
            itemHeight={50}
            itemOffset={10}
          >
            {Cell}
          </Grid>
        </view>
      ));
      v.expect(grid.children.map((c) => [c.x, c.y])).toEqual([
        [0, 0],
        [110, 0],
        [220, 0],
        [0, 60],
        [110, 60],
        [220, 60],
        [0, 120],
        [110, 120],
        [220, 120],
        [0, 180],
      ]);
      // 4 rows * (50 + 10)
      v.expect(grid.height).toBe(240);
      v.expect([grid.y, focusedId()]).toEqual([20, 'g0']);
    },
  );

  v.it(
    'navigation: Left/Right stay in the row, Up/Down move by a row; at an edge the key bubbles; y scrolls by row',
    async () => {
      let grid!: lng.ElementNode;
      const parent = v.vi.fn(() => true);
      dispose = await mount(() => (
        <view
          width={1920}
          height={1080}
          onRight={parent}
          onLeft={parent}
          onUp={parent}
          onDown={parent}
        >
          <Grid
            ref={grid}
            autofocus
            y={20}
            items={tenItems}
            columns={3}
            itemWidth={100}
            itemHeight={50}
            itemOffset={10}
          >
            {Cell}
          </Grid>
        </view>
      ));
      const seen = await walk(
        [
          'ArrowRight',
          'ArrowRight',
          'ArrowRight', // end of row: bubbles
          'ArrowLeft',
          'ArrowDown',
          'ArrowDown',
          'ArrowDown', // g7 + 3 = 10 is past the end: bubbles (does not go to g9)
          'ArrowRight',
          'ArrowUp',
          'ArrowUp',
          'ArrowUp', // top row: bubbles
        ],
        () => [focusedId(), grid.y, parent.mock.calls.length],
      );
      v.expect(seen).toEqual([
        ['g1', 20, 0],
        ['g2', 20, 0],
        ['g2', 20, 1],
        ['g1', 20, 1],
        ['g4', -40, 1],
        ['g7', -100, 1],
        ['g7', -100, 2],
        ['g8', -100, 2],
        ['g5', -40, 2],
        ['g2', 20, 2],
        ['g2', 20, 3],
      ]);
    },
  );

  v.it(
    'looping: Left/Right wrap within the row, Up/Down wrap to the same column',
    async () => {
      let grid!: lng.ElementNode;
      const parent = v.vi.fn(() => true);
      dispose = await mount(() => (
        <view
          width={1920}
          height={1080}
          onRight={parent}
          onLeft={parent}
          onUp={parent}
          onDown={parent}
        >
          <Grid
            ref={grid}
            autofocus
            looping
            y={20}
            items={tenItems}
            columns={3}
            itemWidth={100}
            itemHeight={50}
            itemOffset={10}
          >
            {Cell}
          </Grid>
        </view>
      ));
      const seen = await walk(
        [
          'ArrowRight',
          'ArrowRight',
          'ArrowRight', // g2 -> g0
          'ArrowLeft', // g0 -> g2
          'ArrowDown',
          'ArrowDown',
          'ArrowDown', // g8 -> g2
          'ArrowDown',
          'ArrowRight', // g5 -> g3
          'ArrowUp',
          'ArrowUp', // g0 -> g9 (last row, same column)
          'ArrowUp',
          'ArrowUp',
          'ArrowLeft', // g3 -> g5
        ],
        () => [focusedId(), grid.y],
      );
      v.expect(seen).toEqual([
        ['g1', 20],
        ['g2', 20],
        ['g0', 20],
        ['g2', 20],
        ['g5', -40],
        ['g8', -100],
        ['g2', 20],
        ['g5', -40],
        ['g3', -40],
        ['g0', 20],
        ['g9', -160],
        ['g6', -100],
        ['g3', -40],
        ['g5', -40],
      ]);
      v.expect(parent).not.toHaveBeenCalled();
    },
  );

  v.it(
    'the key and focus handlers are created once, not again on every vertical move (1.7); a reactive user handler still runs first',
    async () => {
      let grid!: lng.ElementNode;
      const calls: string[] = [];
      const [onDown, setOnDown] = s.createSignal<() => boolean>(() => {
        calls.push('first');
        return false;
      });
      dispose = await mount(() => (
        <view width={1920} height={1080}>
          <Grid
            ref={grid}
            autofocus
            items={tenItems}
            columns={3}
            itemWidth={100}
            itemHeight={50}
            onDown={onDown()}
          >
            {Cell}
          </Grid>
        </view>
      ));
      const names = ['onUp', 'onDown', 'onLeft', 'onRight', 'onFocus'];
      const handlers = names.map((n) => grid[n]);
      await press('ArrowDown', 'ArrowDown', 'ArrowUp');
      v.expect(names.map((n, i) => grid[n] === handlers[i])).toEqual([
        true,
        true,
        true,
        true,
        true,
      ]);
      v.expect([focusedId(), grid.y]).toEqual(['g3', -50]);
      v.expect(calls).toEqual(['first', 'first']);

      // A new user handler replaces the old one; returning true stops the
      // Grid's own move.
      setOnDown(() => () => {
        calls.push('second');
        return true;
      });
      await flush();
      await press('ArrowDown');
      v.expect(calls).toEqual(['first', 'first', 'second']);
      v.expect(focusedId()).toBe('g3');
    },
  );

  v.it(
    'a vertical move re-runs only the props that depend on it: an unrelated prop getter is not read again (1.7)',
    async () => {
      let grid!: lng.ElementNode;
      let reads = 0;
      const probe = () => {
        reads++;
        return 1;
      };
      dispose = await mount(() => (
        <view width={1920} height={1080}>
          <Grid
            ref={grid}
            autofocus
            y={20}
            items={tenItems}
            columns={3}
            itemWidth={100}
            itemHeight={50}
            itemOffset={10}
            probe={probe()}
          >
            {Cell}
          </Grid>
        </view>
      ));
      const before = reads;
      await press('ArrowDown', 'ArrowDown', 'ArrowUp');
      v.expect([focusedId(), grid.y]).toEqual(['g3', -40]);
      // It was read again on every vertical move: `y` was in the spread.
      v.expect(reads).toBe(before);
    },
  );

  v.it('scroll="none": y does not follow the focused row', async () => {
    let grid!: lng.ElementNode;
    dispose = await mount(() => (
      <view width={1920} height={1080}>
        <Grid
          ref={grid}
          autofocus
          scroll="none"
          y={20}
          items={tenItems}
          columns={3}
          itemWidth={100}
          itemHeight={50}
        >
          {Cell}
        </Grid>
      </view>
    ));
    await press('ArrowDown', 'ArrowDown');
    v.expect([focusedId(), grid.y]).toEqual(['g6', 20]);
  });

  v.it(
    'onSelectedChanged is called as (idx, grid, elm) with this = grid; once on mount',
    async () => {
      let grid!: lng.ElementNode;
      const calls: unknown[][] = [];
      dispose = await mount(() => (
        <view width={1920} height={1080}>
          <Grid
            ref={grid}
            autofocus
            items={tenItems}
            columns={3}
            itemWidth={100}
            itemHeight={50}
            onSelectedChanged={function (this: unknown, ...args) {
              calls.push([
                this === grid,
                args.length,
                args[0],
                args[1] === grid,
                args[2]?.id,
              ]);
            }}
          >
            {Cell}
          </Grid>
        </view>
      ));
      v.expect(calls).toEqual([[true, 3, 0, true, 'g0']]);
      calls.length = 0;
      await press('ArrowRight', 'ArrowDown', 'ArrowRight', 'ArrowRight');
      // The last Right is at the row end: no call.
      v.expect(calls).toEqual([
        [true, 3, 1, true, 'g1'],
        [true, 3, 4, true, 'g4'],
        [true, 3, 5, true, 'g5'],
      ]);
    },
  );

  v.it(
    'selected: initial and reactive values move focus and scroll; onSelectedChanged fires twice on mount with selected',
    async () => {
      let grid!: lng.ElementNode;
      const [sel, setSel] = s.createSignal(4);
      const calls: unknown[][] = [];
      dispose = await mount(() => (
        <view width={1920} height={1080}>
          <Grid
            ref={grid}
            autofocus
            selected={sel()}
            items={tenItems}
            columns={3}
            itemWidth={100}
            itemHeight={50}
            onSelectedChanged={(idx, _grid, elm) => calls.push([idx, elm?.id])}
          >
            {Cell}
          </Grid>
        </view>
      ));
      // Row 1, 50 high, no itemOffset.
      v.expect([focusedId(), grid.y]).toEqual(['g4', -50]);
      // Current behaviour: the selected effect and the Grid's onFocus each
      // report the same cell.
      v.expect(calls).toEqual([
        [4, 'g4'],
        [4, 'g4'],
      ]);
      calls.length = 0;

      setSel(8);
      await flush();
      v.expect([focusedId(), grid.y]).toEqual(['g8', -100]);
      v.expect(calls).toEqual([[8, 'g8']]);

      await press('ArrowLeft');
      v.expect(focusedId()).toBe('g7');
    },
  );
});
