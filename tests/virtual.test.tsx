import * as v from 'vitest';
import * as s from 'solid-js';
import * as lng from '@solidtv/solid';
import { VirtualRow } from '../src/primitives/Virtual.jsx';
import { moveSelection } from '../src/primitives/utils/handleNavigation.js';
import type { NavigableElement } from '../src/primitives/types.js';

import { renderer, waitForUpdate } from './setup.js';

const ITEM_W = 300;
const ITEM_H = 400;
const GAP = 30; // Virtual hardcodes this in its style
const STRIDE = ITEM_W + GAP;
const CONTAINER_W = 1820;

const Poster = (props: { item: number; index: number }) => (
  <view width={ITEM_W} height={ITEM_H} color={0xff0000ff} />
);

/**
 * Returns the underlying ElementNode that VirtualRow renders as its container.
 * That container's children are the rendered slice items.
 */
function getRailContainer(ref: lng.ElementNode | undefined): lng.ElementNode {
  if (!ref) throw new Error('ref not assigned');
  return ref;
}

v.describe('VirtualRow', () => {
  v.test('renders nothing when each is undefined', async () => {
    let virtualRef!: lng.ElementNode;

    const dispose = renderer.render(() => (
      <VirtualRow
        ref={virtualRef}
        each={undefined}
        width={CONTAINER_W}
        height={ITEM_H}
      >
        {(item, i) => <Poster item={item() as number} index={i()} />}
      </VirtualRow>
    ));

    await waitForUpdate();

    v.assert.equal(virtualRef.children.length, 0);
    dispose();
  });

  v.test('renders nothing when each is an empty array', async () => {
    let virtualRef!: lng.ElementNode;

    const dispose = renderer.render(() => (
      <VirtualRow
        ref={virtualRef}
        each={[]}
        width={CONTAINER_W}
        height={ITEM_H}
      >
        {(item, i) => <Poster item={item() as number} index={i()} />}
      </VirtualRow>
    ));

    await waitForUpdate();

    v.assert.equal(virtualRef.children.length, 0);
    dispose();
  });

  v.test('probe phase renders a single item until measurement completes', async () => {
    let virtualRef!: lng.ElementNode;
    const items = Array.from({ length: 30 }, (_, i) => i);

    const dispose = renderer.render(() => (
      <VirtualRow
        ref={virtualRef}
        each={items}
        width={CONTAINER_W}
        height={ITEM_H}
      >
        {(item, i) => <Poster item={item() as number} index={i()} />}
      </VirtualRow>
    ));

    // Before microtasks run, the probe-render path is active.
    v.assert.isAtLeast(virtualRef.children.length, 1);

    await waitForUpdate();

    // After measurement, the slice expands to visibleCount + bufferSize.
    // visibleCount = floor(1820 / 330) = 5
    // bufferSize   = max(2, ceil(5 * 0.3)) = 2
    // slice length = visibleCount + bufferSize = 7
    v.assert.equal(virtualRef.children.length, 7);

    dispose();
  });

  v.test('initial cursor reflects the `selected` prop', async () => {
    let virtualRef!: NavigableElement;
    const items = Array.from({ length: 30 }, (_, i) => i);

    const dispose = renderer.render(() => (
      <VirtualRow
        ref={virtualRef as unknown as lng.ElementNode}
        each={items}
        selected={5}
        width={CONTAINER_W}
        height={ITEM_H}
      >
        {(item, i) => <Poster item={item() as number} index={i()} />}
      </VirtualRow>
    ));

    await waitForUpdate();

    v.assert.equal(virtualRef.cursor, 5);
    dispose();
  });

  v.test('updating `each` from undefined to populated expands the slice', async () => {
    let virtualRef!: lng.ElementNode;
    const [data, setData] = s.createSignal<number[] | undefined>(undefined);

    const dispose = renderer.render(() => (
      <VirtualRow
        ref={virtualRef}
        each={data()}
        width={CONTAINER_W}
        height={ITEM_H}
      >
        {(item, i) => <Poster item={item() as number} index={i()} />}
      </VirtualRow>
    ));

    await waitForUpdate();
    v.assert.equal(virtualRef.children.length, 0);

    setData(Array.from({ length: 30 }, (_, i) => i));
    await waitForUpdate();

    v.assert.equal(virtualRef.children.length, 7);
    dispose();
  });

  v.test('updating `each` to a longer array does not exceed the window', async () => {
    let virtualRef!: lng.ElementNode;
    const [data, setData] = s.createSignal<number[]>(
      Array.from({ length: 30 }, (_, i) => i),
    );

    const dispose = renderer.render(() => (
      <VirtualRow
        ref={virtualRef}
        each={data()}
        width={CONTAINER_W}
        height={ITEM_H}
      >
        {(item, i) => <Poster item={item() as number} index={i()} />}
      </VirtualRow>
    ));

    await waitForUpdate();
    v.assert.equal(virtualRef.children.length, 7);

    setData(Array.from({ length: 200 }, (_, i) => i));
    await waitForUpdate();

    // Still a windowed slice — not the full 200.
    v.assert.equal(virtualRef.children.length, 7);
    dispose();
  });

  v.test('updating `each` to fewer items than the window renders them all', async () => {
    let virtualRef!: lng.ElementNode;
    const [data, setData] = s.createSignal<number[]>(
      Array.from({ length: 30 }, (_, i) => i),
    );

    const dispose = renderer.render(() => (
      <VirtualRow
        ref={virtualRef}
        each={data()}
        width={CONTAINER_W}
        height={ITEM_H}
      >
        {(item, i) => <Poster item={item() as number} index={i()} />}
      </VirtualRow>
    ));

    await waitForUpdate();
    v.assert.equal(virtualRef.children.length, 7);

    setData([0, 1, 2]);
    await waitForUpdate();

    v.assert.equal(virtualRef.children.length, 3);
    dispose();
  });

  v.test('onSelectedChanged fires when moveSelection advances the cursor', async () => {
    let virtualRef!: NavigableElement;
    const items = Array.from({ length: 30 }, (_, i) => i);
    const onSelectedChanged = v.vi.fn();

    const dispose = renderer.render(() => (
      <VirtualRow
        ref={virtualRef as unknown as lng.ElementNode}
        each={items}
        selected={0}
        width={CONTAINER_W}
        height={ITEM_H}
        onSelectedChanged={onSelectedChanged}
        autofocus
      >
        {(item, i) => <Poster item={item() as number} index={i()} />}
      </VirtualRow>
    ));

    await waitForUpdate();

    onSelectedChanged.mockClear();

    // Simulate a right arrow keypress by directly invoking the navigation helper.
    moveSelection(virtualRef, 1);
    await waitForUpdate();

    v.assert.equal(onSelectedChanged.mock.calls.length >= 1, true);
    v.assert.equal(virtualRef.cursor, 1);

    dispose();
  });

  v.test('cursor advances repeatedly under successive moveSelection calls', async () => {
    let virtualRef!: NavigableElement;
    const items = Array.from({ length: 30 }, (_, i) => i);

    const dispose = renderer.render(() => (
      <VirtualRow
        ref={virtualRef as unknown as lng.ElementNode}
        each={items}
        selected={0}
        width={CONTAINER_W}
        height={ITEM_H}
        autofocus
      >
        {(item, i) => <Poster item={item() as number} index={i()} />}
      </VirtualRow>
    ));

    await waitForUpdate();

    for (let step = 0; step < 8; step++) {
      moveSelection(virtualRef, 1);
      await waitForUpdate();
    }

    v.assert.equal(virtualRef.cursor, 8);
    // Slice should still be windowed, not the whole list.
    v.assert.isAtMost(virtualRef.children.length, 7);
    dispose();
  });

  v.test('onEndReached fires when cursor crosses the threshold', async () => {
    let virtualRef!: NavigableElement;
    const items = Array.from({ length: 10 }, (_, i) => i);
    const onEndReached = v.vi.fn();

    const dispose = renderer.render(() => (
      <VirtualRow
        ref={virtualRef as unknown as lng.ElementNode}
        each={items}
        selected={0}
        width={CONTAINER_W}
        height={ITEM_H}
        onEndReached={onEndReached}
        onEndReachedThreshold={2}
        autofocus
      >
        {(item, i) => <Poster item={item() as number} index={i()} />}
      </VirtualRow>
    ));

    await waitForUpdate();
    onEndReached.mockClear();

    // total=10, threshold=2 → fires when cursor >= 8
    for (let step = 0; step < 8; step++) {
      moveSelection(virtualRef, 1);
      await waitForUpdate();
    }

    // Latched: should have fired exactly once when the cursor first crossed
    // the threshold, then stayed silent for the remaining in-zone keypresses.
    v.assert.equal(onEndReached.mock.calls.length, 1);

    // Moving back out of the zone and back in should re-arm and fire again.
    onEndReached.mockClear();
    moveSelection(virtualRef, -1);
    await waitForUpdate();
    moveSelection(virtualRef, 1);
    await waitForUpdate();
    v.assert.equal(onEndReached.mock.calls.length, 1);

    dispose();
  });

  v.test('scrollToIndex jumps the cursor to the target', async () => {
    let virtualRef!: NavigableElement;
    const items = Array.from({ length: 30 }, (_, i) => i);

    const dispose = renderer.render(() => (
      <VirtualRow
        ref={virtualRef as unknown as lng.ElementNode}
        each={items}
        selected={0}
        width={CONTAINER_W}
        height={ITEM_H}
        autofocus
      >
        {(item, i) => <Poster item={item() as number} index={i()} />}
      </VirtualRow>
    ));

    await waitForUpdate();

    virtualRef.scrollToIndex(15);
    await waitForUpdate();

    v.assert.equal(virtualRef.cursor, 15);
    dispose();
  });

  v.test('scrollToIndex clamps out-of-range targets', async () => {
    let virtualRef!: NavigableElement;
    const items = Array.from({ length: 10 }, (_, i) => i);

    const dispose = renderer.render(() => (
      <VirtualRow
        ref={virtualRef as unknown as lng.ElementNode}
        each={items}
        selected={0}
        width={CONTAINER_W}
        height={ITEM_H}
        autofocus
      >
        {(item, i) => <Poster item={item() as number} index={i()} />}
      </VirtualRow>
    ));

    await waitForUpdate();

    virtualRef.scrollToIndex(999);
    await waitForUpdate();

    v.assert.equal(virtualRef.cursor, 9);

    virtualRef.scrollToIndex(-5);
    await waitForUpdate();

    v.assert.equal(virtualRef.cursor, 0);
    dispose();
  });

  v.test('updating `selected` prop externally moves the cursor', async () => {
    let virtualRef!: NavigableElement;
    const items = Array.from({ length: 30 }, (_, i) => i);
    const [sel, setSel] = s.createSignal(0);

    const dispose = renderer.render(() => (
      <VirtualRow
        ref={virtualRef as unknown as lng.ElementNode}
        each={items}
        selected={sel()}
        width={CONTAINER_W}
        height={ITEM_H}
        autofocus
      >
        {(item, i) => <Poster item={item() as number} index={i()} />}
      </VirtualRow>
    ));

    await waitForUpdate();

    setSel(7);
    await waitForUpdate();

    v.assert.equal(virtualRef.cursor, 7);
    dispose();
  });

  v.test('wrap mode produces a window when scrolling past the end', async () => {
    let virtualRef!: NavigableElement;
    const items = Array.from({ length: 10 }, (_, i) => i);

    const dispose = renderer.render(() => (
      <VirtualRow
        ref={virtualRef as unknown as lng.ElementNode}
        each={items}
        selected={0}
        width={CONTAINER_W}
        height={ITEM_H}
        wrap
        autofocus
      >
        {(item, i) => <Poster item={item() as number} index={i()} />}
      </VirtualRow>
    ));

    await waitForUpdate();

    // Advance past the last item — cursor should wrap around to the start.
    for (let step = 0; step < 12; step++) {
      moveSelection(virtualRef, 1);
      await waitForUpdate();
    }

    // 12 forward steps in a 10-item wrapped list → cursor = (0 + 12) % 10 = 2
    v.assert.equal(virtualRef.cursor, 2);
    dispose();
  });

  v.test('total <= window size renders every item with no slicing', async () => {
    let virtualRef!: lng.ElementNode;
    const items = [0, 1, 2, 3];

    const dispose = renderer.render(() => (
      <VirtualRow
        ref={virtualRef}
        each={items}
        width={CONTAINER_W}
        height={ITEM_H}
      >
        {(item, i) => <Poster item={item() as number} index={i()} />}
      </VirtualRow>
    ));

    await waitForUpdate();

    v.assert.equal(virtualRef.children.length, 4);
    dispose();
  });
});
