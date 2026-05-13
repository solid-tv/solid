import * as v from 'vitest';
import * as s from 'solid-js';
import * as lng from '@solidtv/solid';
import {
  LazyRow,
  LazyColumn,
  Column,
  useFocusManager,
} from '@solidtv/solid/primitives';
import { renderer } from './setup.js';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

const dispatchKey = (key: string) =>
  document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));

const items = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: i, label: `Item ${i}` }));

// Simple card factory used across tests
const Card = (item: s.Accessor<{ id: number; label: string }>) => (
  <view width={200} height={150} color={0xff0000ff} data={{ id: item().id }} />
);

// Note: Lazy's render-effect grows offset to max(initial, selected + buffer).
// Pass explicit buffer={1} so tests can predict exact rendered counts.

v.describe('LazyRow — initial render', () => {
  v.test('sync=true mounts upCount items synchronously', async () => {
    let row!: lng.ElementNode;
    const dispose = renderer.render(() => (
      <view width={1920} height={1080}>
        <LazyRow
          ref={row}
          each={items(20)}
          upCount={5}
          buffer={1}
          sync
          width={1920}
          height={200}
        >
          {Card}
        </LazyRow>
      </view>
    ));
    await wait(30);
    v.assert.equal(row.children.length, 5);
    dispose();
  });

  v.test('!sync ramps up to upCount over time', async () => {
    let row!: lng.ElementNode;
    const dispose = renderer.render(() => (
      <view width={1920} height={1080}>
        <LazyRow
          ref={row}
          each={items(20)}
          upCount={5}
          buffer={1}
          width={1920}
          height={200}
        >
          {Card}
        </LazyRow>
      </view>
    ));
    await wait(10);
    const earlyCount = row.children.length;
    v.assert.ok(earlyCount < 5, `expected partial ramp, got ${earlyCount}`);

    // 5 items × 16ms = ~80ms; allow generous slack
    await wait(250);
    v.assert.equal(row.children.length, 5);
    dispose();
  });

  v.test('caps at each.length when each is shorter than upCount', async () => {
    let row!: lng.ElementNode;
    const dispose = renderer.render(() => (
      <view width={1920} height={1080}>
        <LazyRow
          ref={row}
          each={items(3)}
          upCount={10}
          buffer={1}
          sync
          width={1920}
          height={200}
        >
          {Card}
        </LazyRow>
      </view>
    ));
    await wait(30);
    v.assert.equal(row.children.length, 3);
    dispose();
  });

  v.test('renders nothing when each is falsy', async () => {
    let row!: lng.ElementNode;
    const dispose = renderer.render(() => (
      <view width={1920} height={1080}>
        <LazyRow
          ref={row}
          each={null}
          upCount={5}
          sync
          width={1920}
          height={200}
        >
          {Card}
        </LazyRow>
      </view>
    ));
    await wait(30);
    v.assert.equal(row.children.length, 0);
    dispose();
  });
});

v.describe('LazyRow — navigation-driven loading', () => {
  v.test('pressing ArrowRight at the edge mounts the next item', async () => {
    let row!: lng.ElementNode;
    const dispose = renderer.render(() => {
      useFocusManager();
      return (
        <view width={1920} height={1080}>
          <LazyRow
            ref={row}
            each={items(20)}
            upCount={3}
            buffer={1}
            sync
            autofocus
            width={1920}
            height={200}
          >
            {Card}
          </LazyRow>
        </view>
      );
    });
    await wait(30);
    v.assert.equal(row.children.length, 3, 'initial 3');

    // updateOffset triggers when selected >= rendered - buffer = 3 - 1 = 2.
    // updateOffset runs BEFORE handleNavigation (chained), so the press that
    // advances selected from 2 → 3 mounts a new item first.
    // Press 1: selected 0 → 1, no mount.
    // Press 2: selected 1 → 2, no mount (1 < 2 in the check).
    // Press 3: 2 < 2 is false → mount, then selected 2 → 3.
    dispatchKey('ArrowRight');
    await wait(20);
    dispatchKey('ArrowRight');
    await wait(20);
    dispatchKey('ArrowRight');
    await wait(30);
    v.assert.ok(
      row.children.length >= 4,
      `expected mount after 3 presses, got ${row.children.length}`,
    );
    dispose();
  });

  v.test('stops mounting when offset reaches each.length', async () => {
    let row!: lng.ElementNode;
    const dispose = renderer.render(() => {
      useFocusManager();
      return (
        <view width={1920} height={1080}>
          <LazyRow
            ref={row}
            each={items(5)}
            upCount={3}
            buffer={1}
            sync
            autofocus
            width={1920}
            height={200}
          >
            {Card}
          </LazyRow>
        </view>
      );
    });
    await wait(30);

    for (let i = 0; i < 20; i++) {
      dispatchKey('ArrowRight');
      await wait(10);
    }
    v.assert.equal(row.children.length, 5, 'never exceeds each.length');
    dispose();
  });

  v.test('does not mount more while selection stays inside the buffer', async () => {
    let row!: lng.ElementNode;
    const dispose = renderer.render(() => {
      useFocusManager();
      return (
        <view width={1920} height={1080}>
          <LazyRow
            ref={row}
            each={items(20)}
            upCount={10}
            buffer={5}
            sync
            autofocus
            width={1920}
            height={200}
          >
            {Card}
          </LazyRow>
        </view>
      );
    });
    await wait(30);
    v.assert.equal(row.children.length, 10);

    // Move right to selected=4 → check 4 < 10 - 5 = 5 holds, no mount.
    for (let i = 0; i < 4; i++) {
      dispatchKey('ArrowRight');
      await wait(10);
    }
    v.assert.equal(row.children.length, 10, 'no mount inside buffer');
    dispose();
  });
});

v.describe('Column of LazyRows — TV layout', () => {
  v.test('each row renders its upCount independently', async () => {
    const rows: lng.ElementNode[] = [];
    const dispose = renderer.render(() => (
      <view width={1920} height={1080}>
        <Column width={1920} height={1080}>
          <LazyRow
            ref={(el) => (rows[0] = el)}
            each={items(30)}
            upCount={4}
            buffer={1}
            sync
            width={1920}
            height={200}
          >
            {Card}
          </LazyRow>
          <LazyRow
            ref={(el) => (rows[1] = el)}
            each={items(15)}
            upCount={6}
            buffer={1}
            sync
            width={1920}
            height={200}
          >
            {Card}
          </LazyRow>
          <LazyRow
            ref={(el) => (rows[2] = el)}
            each={items(50)}
            upCount={3}
            buffer={1}
            sync
            width={1920}
            height={200}
          >
            {Card}
          </LazyRow>
        </Column>
      </view>
    ));
    await wait(30);
    v.assert.equal(rows[0]!.children.length, 4);
    v.assert.equal(rows[1]!.children.length, 6);
    v.assert.equal(rows[2]!.children.length, 3);
    dispose();
  });

  v.test('navigating right in row 0 does not affect row 1', async () => {
    const rows: lng.ElementNode[] = [];
    const dispose = renderer.render(() => {
      useFocusManager();
      return (
        <view width={1920} height={1080}>
          <Column width={1920} height={1080} autofocus>
            <LazyRow
              ref={(el) => (rows[0] = el)}
              each={items(20)}
              upCount={3}
              buffer={1}
              sync
              width={1920}
              height={200}
            >
              {Card}
            </LazyRow>
            <LazyRow
              ref={(el) => (rows[1] = el)}
              each={items(20)}
              upCount={3}
              buffer={1}
              sync
              width={1920}
              height={200}
            >
              {Card}
            </LazyRow>
          </Column>
        </view>
      );
    });
    await wait(30);
    v.assert.equal(rows[0]!.children.length, 3);
    v.assert.equal(rows[1]!.children.length, 3);

    // Burn through row 0
    for (let i = 0; i < 6; i++) {
      dispatchKey('ArrowRight');
      await wait(10);
    }
    v.assert.ok(
      rows[0]!.children.length > 3,
      `row 0 should have loaded more, got ${rows[0]!.children.length}`,
    );
    v.assert.equal(rows[1]!.children.length, 3, 'row 1 untouched');
    dispose();
  });

  v.test('navigating down between rows preserves loaded counts', async () => {
    const rows: lng.ElementNode[] = [];
    const dispose = renderer.render(() => {
      useFocusManager();
      return (
        <view width={1920} height={1080}>
          <Column width={1920} height={1080} autofocus>
            <LazyRow
              ref={(el) => (rows[0] = el)}
              each={items(20)}
              upCount={3}
              buffer={1}
              sync
              width={1920}
              height={200}
            >
              {Card}
            </LazyRow>
            <LazyRow
              ref={(el) => (rows[1] = el)}
              each={items(20)}
              upCount={3}
              buffer={1}
              sync
              width={1920}
              height={200}
            >
              {Card}
            </LazyRow>
          </Column>
        </view>
      );
    });
    await wait(30);

    // Load extra items in row 0
    for (let i = 0; i < 6; i++) {
      dispatchKey('ArrowRight');
      await wait(10);
    }
    const row0After = rows[0]!.children.length;
    v.assert.ok(row0After > 3, `row 0 grew, got ${row0After}`);

    // Move down to row 1, then back up
    dispatchKey('ArrowDown');
    await wait(20);
    dispatchKey('ArrowUp');
    await wait(20);
    v.assert.equal(rows[0]!.children.length, row0After, 'row 0 retains its load');
    dispose();
  });
});

v.describe('LazyColumn — vertical loading', () => {
  v.test('pressing ArrowDown at the edge mounts the next item', async () => {
    let col!: lng.ElementNode;
    const dispose = renderer.render(() => {
      useFocusManager();
      return (
        <view width={1920} height={1080}>
          <LazyColumn
            ref={col}
            each={items(20)}
            upCount={3}
            buffer={1}
            sync
            autofocus
            width={400}
            height={1080}
          >
            {Card}
          </LazyColumn>
        </view>
      );
    });
    await wait(30);
    v.assert.equal(col.children.length, 3);

    dispatchKey('ArrowDown');
    await wait(20);
    dispatchKey('ArrowDown');
    await wait(20);
    dispatchKey('ArrowDown');
    await wait(30);
    v.assert.ok(
      col.children.length >= 4,
      `expected mount via ArrowDown, got ${col.children.length}`,
    );
    dispose();
  });
});

v.describe('Reactive each', () => {
  v.test('each shrinking past selected clamps selected to len-1', async () => {
    let row!: lng.ElementNode;
    const [data, setData] = s.createSignal(items(10));

    const dispose = renderer.render(() => {
      useFocusManager();
      return (
        <view width={1920} height={1080}>
          <LazyRow
            ref={row}
            each={data()}
            upCount={10}
            buffer={1}
            sync
            autofocus
            width={1920}
            height={200}
          >
            {Card}
          </LazyRow>
        </view>
      );
    });
    await wait(30);
    v.assert.equal(row.children.length, 10);

    // Move selection forward to index 7
    for (let i = 0; i < 7; i++) {
      dispatchKey('ArrowRight');
      await wait(10);
    }
    v.assert.equal(row.selected, 7, `selected=7 before shrink, got ${row.selected}`);

    // Shrink the list to 3 items — selected (7) is past new len (3)
    setData(items(3));
    await wait(50);

    v.assert.equal(row.children.length, 3, 'children shrunk');
    v.assert.ok(
      (row.selected ?? 0) <= 2,
      `selected clamped to ≤2, got ${row.selected}`,
    );
    dispose();
  });

  v.test('each growing keeps offset where it was (no auto-mount past offset)', async () => {
    let row!: lng.ElementNode;
    const [data, setData] = s.createSignal(items(5));

    const dispose = renderer.render(() => (
      <view width={1920} height={1080}>
        <LazyRow
          ref={row}
          each={data()}
          upCount={5}
          buffer={1}
          sync
          width={1920}
          height={200}
        >
          {Card}
        </LazyRow>
      </view>
    ));
    await wait(30);
    const before = row.children.length;
    v.assert.equal(before, 5);

    setData(items(20));
    await wait(30);
    // each grew but offset hasn't advanced — items stay sliced to current offset
    v.assert.equal(
      row.children.length,
      before,
      'new each.length does not auto-mount beyond offset',
    );
    dispose();
  });
});

v.describe('Cleanup', () => {
  v.test('unmounting during preload ramp does not throw', async () => {
    const errors: unknown[] = [];
    const orig = console.error;
    console.error = (...args: unknown[]) => errors.push(args);

    const dispose = renderer.render(() => (
      <view width={1920} height={1080}>
        <LazyRow each={items(50)} upCount={20} buffer={1} width={1920} height={200}>
          {Card}
        </LazyRow>
      </view>
    ));
    // Unmount mid-ramp
    await wait(50);
    dispose();
    // Wait past where the next preload tick would have fired
    await wait(200);

    console.error = orig;
    v.assert.equal(errors.length, 0, `expected no errors, got ${errors.length}`);
  });
});
