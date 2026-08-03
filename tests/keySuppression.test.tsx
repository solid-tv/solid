import * as v from 'vitest';
import * as lng from '@solidtv/solid';
import {
  useFocusManager,
  suppressKeyUntilRelease,
  releaseKeySuppression,
} from '@solidtv/solid/primitives';
import { renderer, waitForUpdate } from './setup.js';

const keydown = (repeat = false) =>
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', repeat }));
const keyup = () =>
  document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter' }));

async function setup() {
  const onEnter = v.vi.fn();
  let dispose!: () => void;
  dispose = renderer.render(() => {
    useFocusManager();
    return <view autofocus onEnter={onEnter} />;
  }) as unknown as () => void;
  await waitForUpdate();
  return { onEnter, dispose };
}

v.describe('key suppression', () => {
  v.afterEach(() => releaseKeySuppression('Enter'));

  v.test('drops auto-repeat key-downs while a key is suppressed', async () => {
    const { onEnter, dispose } = await setup();

    keydown();
    v.assert.equal(onEnter.mock.calls.length, 1);

    // A hold fired and latched the key — the repeats that follow must not
    // propagate, even though this element is still focused.
    suppressKeyUntilRelease('Enter');
    keydown(true);
    keydown(true);
    v.assert.equal(onEnter.mock.calls.length, 1);

    dispose();
  });

  v.test('key-up lifts suppression and runs the release callback', async () => {
    const { onEnter, dispose } = await setup();
    const onRelease = v.vi.fn();

    keydown();
    suppressKeyUntilRelease('Enter', onRelease);
    keydown(true);
    v.assert.equal(onRelease.mock.calls.length, 0);

    keyup();
    v.assert.equal(onRelease.mock.calls.length, 1);

    // Suppression is gone, so repeats propagate again.
    keydown(true);
    v.assert.equal(onEnter.mock.calls.length, 2);

    dispose();
  });

  v.test('a fresh key-down lifts suppression when key-up never arrives', async () => {
    const { onEnter, dispose } = await setup();
    const onRelease = v.vi.fn();

    keydown();
    suppressKeyUntilRelease('Enter', onRelease);
    keydown(true);
    v.assert.equal(onEnter.mock.calls.length, 1);

    // webOS: no key-up is ever delivered. The next real press must not be
    // swallowed, and must settle the abandoned one.
    keydown();
    v.assert.equal(onRelease.mock.calls.length, 1);
    v.assert.equal(onEnter.mock.calls.length, 2);

    dispose();
  });

  v.test('never suppresses non-repeat key-downs', async () => {
    const { onEnter, dispose } = await setup();

    suppressKeyUntilRelease('Enter');
    keydown();
    v.assert.equal(onEnter.mock.calls.length, 1);

    dispose();
  });
});
