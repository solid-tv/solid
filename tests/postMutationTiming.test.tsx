import * as v from 'vitest';
import * as lng from '@solidtv/solid';
import { renderer } from './setup.js';

const wait = (ms = 10) => new Promise((r) => setTimeout(r, ms));

// setFocus() on a rendered node is the cheapest way to schedule a real
// post-mutation flush from the public API: it parks the node in
// nextActiveElement and queues the scheduler, so all three phases run.
const flushPostMutation = async (node: lng.ElementNode) => {
  node.setFocus();
  await wait();
};

const renderFlexView = () => {
  let node!: lng.ElementNode;
  const dispose = renderer.render(() => (
    <view ref={node} width={400} height={100} display="flex" gap={10}>
      <view width={50} height={50} />
      <view width={50} height={50} />
    </view>
  ));
  return { node, dispose };
};

v.describe('post-mutation timing', () => {
  v.afterEach(() => {
    lng.Config.postMutationDebug = false;
    lng.resetPostMutationTiming();
  });

  v.test('records nothing while Config.postMutationDebug is off', async () => {
    const { node, dispose } = renderFlexView();
    await wait();

    lng.resetPostMutationTiming();
    await flushPostMutation(node);

    v.assert.equal(lng.postMutationTiming.calls, 0, 'calls');
    v.assert.equal(lng.postMutationTiming.total, 0, 'total');
    v.assert.equal(lng.postMutationTiming.layoutTotal, 0, 'layoutTotal');

    dispose();
  });

  v.test('accumulates per-phase timings and a call count', async () => {
    const { node, dispose } = renderFlexView();
    await wait();

    lng.Config.postMutationDebug = true;
    lng.resetPostMutationTiming();
    await flushPostMutation(node);

    const t = lng.postMutationTiming;
    v.assert.isAbove(t.calls, 0, 'the flush ran and was counted');
    v.assert.isAtLeast(t.deleteTotal, 0, 'deleteTotal');
    v.assert.isAtLeast(t.layoutTotal, 0, 'layoutTotal');
    v.assert.isAtLeast(t.focusTotal, 0, 'focusTotal');

    // Every phase is contained in the same start/end window, so no phase max
    // can exceed the wall time attributed to the whole flush.
    v.assert.isAtMost(t.max, t.total, 'max within total');
    v.assert.isAtMost(t.deleteMax, t.max, 'deleteMax within max');
    v.assert.isAtMost(t.layoutMax, t.max, 'layoutMax within max');
    v.assert.isAtMost(t.focusMax, t.max, 'focusMax within max');

    dispose();
  });

  v.test('keeps accumulating across flushes', async () => {
    const { node, dispose } = renderFlexView();
    await wait();

    lng.Config.postMutationDebug = true;
    lng.resetPostMutationTiming();
    await flushPostMutation(node);
    const firstPass = lng.postMutationTiming.calls;

    await flushPostMutation(node);

    v.assert.isAbove(
      lng.postMutationTiming.calls,
      firstPass,
      'counts add up rather than replacing the previous sample',
    );

    dispose();
  });

  v.test('reset zeroes every counter', async () => {
    const { node, dispose } = renderFlexView();
    await wait();

    lng.Config.postMutationDebug = true;
    lng.resetPostMutationTiming();
    await flushPostMutation(node);
    v.assert.isAbove(lng.postMutationTiming.calls, 0, 'sampled something');

    lng.resetPostMutationTiming();

    const t = lng.postMutationTiming;
    v.assert.equal(t.calls, 0, 'calls');
    v.assert.equal(t.total, 0, 'total');
    v.assert.equal(t.max, 0, 'max');
    v.assert.equal(t.deleteTotal, 0, 'deleteTotal');
    v.assert.equal(t.deleteMax, 0, 'deleteMax');
    v.assert.equal(t.layoutTotal, 0, 'layoutTotal');
    v.assert.equal(t.layoutMax, 0, 'layoutMax');
    v.assert.equal(t.focusTotal, 0, 'focusTotal');
    v.assert.equal(t.focusMax, 0, 'focusMax');

    dispose();
  });
});
