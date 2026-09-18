import * as v from 'vitest';
import { Config } from '@solidtv/solid';
import {
  useFocusManager,
  type KeyEventLike,
  type KeyEventTarget,
} from '@solidtv/solid/primitives';
import { renderer, waitForUpdate } from './setup.js';

type Listener = (event: KeyEventLike) => void;

// A host's event target whose events carry preventDefault, so a test can see
// whether the focus manager called it.
class FakeTarget implements KeyEventTarget {
  listeners: Record<'keydown' | 'keyup', Listener[]> = {
    keydown: [],
    keyup: [],
  };

  addEventListener(type: 'keydown' | 'keyup', listener: Listener) {
    this.listeners[type].push(listener);
  }

  removeEventListener(type: 'keydown' | 'keyup', listener: Listener) {
    const list = this.listeners[type];
    const idx = list.indexOf(listener);
    if (idx !== -1) list.splice(idx, 1);
  }

  press(type: 'keydown' | 'keyup', key: string) {
    const preventDefault = v.vi.fn();
    const event: KeyEventLike = {
      key,
      keyCode: 0,
      repeat: false,
      preventDefault,
    };
    for (const listener of this.listeners[type].slice()) listener(event);
    return preventDefault;
  }
}

interface Handlers {
  onEnter?: () => boolean | undefined;
  onEnterRelease?: () => boolean | undefined;
  onRight?: () => boolean | undefined;
}

async function setup(target: FakeTarget, handlers: Handlers) {
  const dispose = renderer.render(() => {
    useFocusManager(undefined, target);
    return (
      <view
        autofocus
        onEnter={handlers.onEnter}
        onEnterRelease={handlers.onEnterRelease}
        onRight={handlers.onRight}
      />
    );
  }) as unknown as () => void;
  await waitForUpdate();
  return dispose;
}

v.describe('Config.preventDefaultOnHandledKeys', () => {
  v.afterEach(() => {
    Config.preventDefaultOnHandledKeys = false;
    Config.throttleInput = undefined;
  });

  v.test('calls preventDefault on a press a handler consumed', async () => {
    Config.preventDefaultOnHandledKeys = true;
    const target = new FakeTarget();
    const dispose = await setup(target, { onEnter: () => true });

    const preventDefault = target.press('keydown', 'Enter');
    v.assert.equal(preventDefault.mock.calls.length, 1);

    dispose();
  });

  v.test('leaves a press no handler took alone', async () => {
    Config.preventDefaultOnHandledKeys = true;
    const target = new FakeTarget();
    const dispose = await setup(target, { onEnter: () => undefined });

    const preventDefault = target.press('keydown', 'Enter');
    v.assert.equal(preventDefault.mock.calls.length, 0);

    dispose();
  });

  v.test('does nothing while the flag is off', async () => {
    const target = new FakeTarget();
    const dispose = await setup(target, { onEnter: () => true });

    const preventDefault = target.press('keydown', 'Enter');
    v.assert.equal(preventDefault.mock.calls.length, 0);

    dispose();
  });

  v.test('covers a release a handler consumed', async () => {
    Config.preventDefaultOnHandledKeys = true;
    const target = new FakeTarget();
    const dispose = await setup(target, { onEnterRelease: () => true });

    target.press('keydown', 'Enter');
    const preventDefault = target.press('keyup', 'Enter');
    v.assert.equal(preventDefault.mock.calls.length, 1);

    dispose();
  });

  v.test('treats a press the global throttle dropped as consumed', async () => {
    const onRight = v.vi.fn(() => true);
    const target = new FakeTarget();
    const dispose = await setup(target, { onRight });
    // The throttle compares against the previous key, whatever an earlier
    // test left there: make it a different one before turning it on.
    target.press('keydown', 'Enter');
    Config.preventDefaultOnHandledKeys = true;
    Config.throttleInput = 10000;

    target.press('keydown', 'ArrowRight');
    const preventDefault = target.press('keydown', 'ArrowRight');
    v.assert.equal(onRight.mock.calls.length, 1);
    v.assert.equal(preventDefault.mock.calls.length, 1);

    dispose();
  });
});
