import * as v from 'vitest';
import * as s from 'solid-js';
import * as lng from '@solidtv/solid';
import { renderer } from './setup.js';

// Focus changes and delete-flushes both settle in the post-mutation
// scheduler (microtask); a short macrotask wait covers chained passes.
const wait = (ms = 10) => new Promise((r) => setTimeout(r, ms));

v.describe('focus-loss recovery', () => {
  v.test('refocuses the parent when the focused element is removed', async () => {
    let app!: lng.ElementNode;
    let btn!: lng.ElementNode;
    const [visible, setVisible] = s.createSignal(true);
    const warn = v.vi.spyOn(console, 'warn').mockImplementation(() => {});

    const dispose = renderer.render(() => (
      <view ref={app} id="app" width={1920} height={1080}>
        <lng.Show when={visible()}>
          <view ref={btn} id="btn" width={300} height={150} />
        </lng.Show>
      </view>
    ));

    await wait();
    btn.setFocus();
    await wait();
    v.assert.equal(lng.activeElement(), btn, 'btn is focused before removal');

    setVisible(false);
    await wait();
    v.assert.equal(lng.activeElement(), app, 'focus recovered to parent');
    v.assert.isTrue(
      warn.mock.calls.some((args) => String(args[0]).includes('Focus lost')),
      'dev warning was logged',
    );

    warn.mockRestore();
    dispose();
  });

  v.test('recovers to the nearest attached ancestor on deep removal', async () => {
    let app!: lng.ElementNode;
    let leaf!: lng.ElementNode;
    const [visible, setVisible] = s.createSignal(true);

    const dispose = renderer.render(() => (
      <view ref={app} id="app" width={1920} height={1080}>
        <lng.Show when={visible()}>
          <view id="section" width={1920} height={400}>
            <view id="inner" width={1920} height={400}>
              <view ref={leaf} id="leaf" width={300} height={150} />
            </view>
          </view>
        </lng.Show>
      </view>
    ));

    await wait();
    leaf.setFocus();
    await wait();
    v.assert.equal(lng.activeElement(), leaf);

    // Removes the whole section subtree; every ancestor of leaf below app is
    // detached, so recovery must walk past them up to app.
    setVisible(false);
    await wait();
    v.assert.equal(lng.activeElement(), app, 'focus recovered to app root');

    dispose();
  });

  v.test('recovery re-runs forwardFocus so a sibling gets focus', async () => {
    let row!: lng.ElementNode;
    let second!: lng.ElementNode;
    const [items, setItems] = s.createSignal(['a', 'b']);

    const dispose = renderer.render(() => (
      <view id="app" width={1920} height={1080}>
        <view ref={row} id="row" forwardFocus={0} width={1920} height={200}>
          <lng.For each={items()}>
            {(item) => (
              <view
                ref={(el: lng.ElementNode) => {
                  if (item === 'b') second = el;
                }}
                id={item}
                width={300}
                height={150}
              />
            )}
          </lng.For>
        </view>
      </view>
    ));

    await wait();
    row.setFocus();
    await wait();
    v.assert.equal(lng.activeElement()?.id, 'a', 'forwardFocus focused first child');

    setItems(['b']);
    await wait();
    v.assert.equal(
      lng.activeElement(),
      second,
      'recovery via row forwardFocus landed on the remaining child',
    );

    dispose();
  });

  v.test('removing a non-focused element does not move focus', async () => {
    let btn!: lng.ElementNode;
    const [visible, setVisible] = s.createSignal(true);

    const dispose = renderer.render(() => (
      <view id="app" width={1920} height={1080}>
        <view ref={btn} id="btn" width={300} height={150} />
        <lng.Show when={visible()}>
          <view id="other" width={300} height={150} />
        </lng.Show>
      </view>
    ));

    await wait();
    btn.setFocus();
    await wait();
    v.assert.equal(lng.activeElement(), btn);

    setVisible(false);
    await wait();
    v.assert.equal(lng.activeElement(), btn, 'focus did not move');

    dispose();
  });

  v.test('Config.focusLossRecovery = false leaves focus untouched', async () => {
    let btn!: lng.ElementNode;
    const [visible, setVisible] = s.createSignal(true);
    lng.Config.focusLossRecovery = false;

    try {
      const dispose = renderer.render(() => (
        <view id="app" width={1920} height={1080}>
          <lng.Show when={visible()}>
            <view ref={btn} id="btn" width={300} height={150} />
          </lng.Show>
        </view>
      ));

      await wait();
      btn.setFocus();
      await wait();
      v.assert.equal(lng.activeElement(), btn);

      setVisible(false);
      await wait();
      v.assert.equal(
        lng.activeElement(),
        btn,
        'stale focus is preserved when recovery is disabled',
      );

      dispose();
    } finally {
      lng.Config.focusLossRecovery = true;
    }
  });
});
