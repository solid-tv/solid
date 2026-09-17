import * as v from 'vitest';
import {
  useFocusManager,
  type KeyEventLike,
  type KeyEventTarget,
} from '@solidtv/solid/primitives';
import { renderer, waitForUpdate } from './setup.js';

type Listener = (event: KeyEventLike) => void;

// A host without a document: records the listeners it is handed so the test
// can fire them and check they are gone after cleanup.
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
    const event: KeyEventLike = { key, keyCode: 0, repeat: false };
    for (const listener of this.listeners[type].slice()) listener(event);
  }
}

async function setup(target: FakeTarget) {
  const onEnter = v.vi.fn();
  const onEnterRelease = v.vi.fn();
  const dispose = renderer.render(() => {
    useFocusManager(undefined, target);
    return <view autofocus onEnter={onEnter} onEnterRelease={onEnterRelease} />;
  }) as unknown as () => void;
  await waitForUpdate();
  return { onEnter, onEnterRelease, dispose };
}

v.describe('useFocusManager event target', () => {
  v.test('binds keydown and keyup on the given target', async () => {
    const target = new FakeTarget();
    const { onEnter, onEnterRelease, dispose } = await setup(target);

    v.assert.equal(target.listeners.keydown.length, 1);
    v.assert.equal(target.listeners.keyup.length, 1);

    target.press('keydown', 'Enter');
    v.assert.equal(onEnter.mock.calls.length, 1);
    target.press('keyup', 'Enter');
    v.assert.equal(onEnterRelease.mock.calls.length, 1);

    dispose();
  });

  v.test('leaves document alone when a target is given', async () => {
    // Test files share this worker's module state (`isolate: false`), and
    // other files bind the focus manager to document, so a key dispatched on
    // document is not a clean signal here. Check the registration itself.
    const addEventListener = v.vi.spyOn(document, 'addEventListener');
    const target = new FakeTarget();
    const { dispose } = await setup(target);

    const keyRegistrations = addEventListener.mock.calls.filter(
      ([type]) => type === 'keydown' || type === 'keyup',
    );
    v.assert.equal(keyRegistrations.length, 0);
    v.assert.equal(target.listeners.keydown.length, 1);
    v.assert.equal(target.listeners.keyup.length, 1);

    addEventListener.mockRestore();
    dispose();
  });

  v.test('removes its listeners from the target on cleanup', async () => {
    const target = new FakeTarget();
    const { onEnter, dispose } = await setup(target);

    dispose();
    v.assert.equal(target.listeners.keydown.length, 0);
    v.assert.equal(target.listeners.keyup.length, 0);

    target.press('keydown', 'Enter');
    v.assert.equal(onEnter.mock.calls.length, 0);
  });
});
