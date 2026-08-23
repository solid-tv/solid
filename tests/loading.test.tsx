import * as v from 'vitest';
import * as s from 'solid-js';
import * as lng from '@solidtv/solid';
import { Loading } from '@solidtv/solid/primitives';
import { renderer, waitForUpdate } from './setup.js';

// The 1.x version of this component called Solid's `Suspense` as a plain
// function and invoked its return value as a memo accessor. Solid 2.0's
// `Loading` returns an Element, so the component was rebuilt on `isPending`.
// Nothing else covers it, and the failure mode (children never mounting, or
// mounting twice) is silent.
v.describe('Loading', () => {
  v.test('shows fallback while pending, then the children', async () => {
    let resolveIt!: (value: string) => void;
    const p = new Promise<string>((r) => {
      resolveIt = r;
    });
    const data = s.createMemo(() => p);

    let root!: lng.ElementNode;
    const dispose = renderer.render(() => (
      <view ref={root}>
        <Loading fallback={<text>loading</text>}>
          <text>{s.latest(data) ?? ''}</text>
        </Loading>
      </view>
    )) as unknown as () => void;

    await waitForUpdate();
    const textOf = (n: lng.ElementNode): string =>
      (n.children as lng.ElementNode[])
        .map((c) => (typeof c.text === 'string' ? c.text : textOf(c)))
        .join('');

    v.assert.include(textOf(root), 'loading', 'fallback renders while pending');

    resolveIt('done');
    await waitForUpdate();
    s.flush();
    await waitForUpdate();

    v.assert.include(textOf(root), 'done', 'children render once resolved');

    dispose();
  });

  v.test('renders children directly when nothing is pending', async () => {
    let root!: lng.ElementNode;
    const dispose = renderer.render(() => (
      <view ref={root}>
        <Loading fallback={<text>loading</text>}>
          <text>ready</text>
        </Loading>
      </view>
    )) as unknown as () => void;

    await waitForUpdate();
    const textOf = (n: lng.ElementNode): string =>
      (n.children as lng.ElementNode[])
        .map((c) => (typeof c.text === 'string' ? c.text : textOf(c)))
        .join('');

    const out = textOf(root);
    v.assert.include(out, 'ready');
    v.assert.notInclude(out, 'loading');

    dispose();
  });
});
