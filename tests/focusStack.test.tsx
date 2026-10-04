import * as v from 'vitest';
import * as lng from '@solidtv/solid';
import { createSignal, Show } from 'solid-js';
import { FocusStackProvider, useFocusStack } from '@solidtv/solid/primitives';
import { renderer } from './setup.js';

const wait = (ms = 10) => new Promise((r) => setTimeout(r, ms));

// Renders `kept` plus a page under <Show>; hiding the page destroys it and
// its child `inner`.
const setup = () => {
  const [showPage, setShowPage] = createSignal(true);
  let stack!: ReturnType<typeof useFocusStack>;
  let kept!: lng.ElementNode;
  let page!: lng.ElementNode;
  let inner!: lng.ElementNode;

  const Capture = () => {
    stack = useFocusStack(false);
    return null;
  };

  const dispose = renderer.render(() => (
    <FocusStackProvider>
      <Capture />
      <view ref={kept} width={100} height={100} />
      <Show when={showPage()}>
        <view ref={page} width={100} height={100}>
          <view ref={inner} width={50} height={50} />
        </view>
      </Show>
    </FocusStackProvider>
  ));

  return { stack, kept, page, inner, setShowPage, dispose };
};

v.describe('useFocusStack restoreFocus', () => {
  v.test('skips destroyed elements and focuses the next one', async () => {
    const { stack, kept, page, inner, setShowPage, dispose } = setup();
    await wait();

    stack.storeFocus(kept);
    stack.storeFocus(page);
    stack.storeFocus(inner);

    setShowPage(false);
    await wait();
    v.expect(page.destroyed).toBe(true);
    v.expect(inner.destroyed).toBe(true);

    v.expect(stack.restoreFocus()).toBe(true);
    await wait();
    v.expect(lng.activeElement()).toBe(kept);

    // destroyed entries were removed along with the restored one
    v.expect(stack.restoreFocus()).toBe(false);

    dispose();
  });

  v.test('returns false when every stored element is destroyed', async () => {
    const { stack, kept, page, setShowPage, dispose } = setup();
    await wait();

    kept.setFocus();
    await wait();
    stack.storeFocus(page);

    setShowPage(false);
    await wait();

    v.expect(stack.restoreFocus()).toBe(false);
    await wait();
    v.expect(lng.activeElement()).toBe(kept);

    dispose();
  });
});
