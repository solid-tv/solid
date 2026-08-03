import * as v from 'vitest';
import * as lng from '@solidtv/solid';
import {
  useFocusManager,
  suppressKeyUntilRelease,
  releaseKeySuppression,
  useHold,
} from '@solidtv/solid/primitives';
import { renderer, waitForUpdate } from './setup.js';

const keydown = (repeat = false) =>
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', repeat }));
const keyup = () =>
  document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter' }));

async function setup(props: Record<string, unknown> = {}) {
  const onEnter = v.vi.fn();
  let dispose!: () => void;
  dispose = renderer.render(() => {
    useFocusManager();
    return <view autofocus onEnter={onEnter} {...props} />;
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

// webOS reports Back's key-down and key-up under different `key` names, sharing
// only the keyCode. Verbatim from a device log:
//   captureBack        { key: 'GoBack',       keyCode: 461, repeat: false }
//   captureBackRelease { key: 'Unidentified', keyCode: 461 }
const backDown = (repeat = false) =>
  document.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'GoBack', keyCode: 461, repeat }),
  );
const backUp = () =>
  document.dispatchEvent(
    new KeyboardEvent('keyup', { key: 'Unidentified', keyCode: 461 }),
  );

v.describe('key identity across key-down and key-up', () => {
  v.test('a key-up naming the key differently still lifts suppression', async () => {
    const { dispose } = await setup();
    const onRelease = v.vi.fn();

    backDown();
    suppressKeyUntilRelease(
      new KeyboardEvent('keydown', { key: 'GoBack', keyCode: 461 }),
      onRelease,
    );

    // Matched on keyCode 461, since 'Unidentified' names no key.
    backUp();
    v.assert.equal(onRelease.mock.calls.length, 1);

    dispose();
  });

  v.test('suppression is not left latched after such a key-up', async () => {
    const seen: string[] = [];
    const { dispose } = await setup({
      onCaptureKey: (e: KeyboardEvent) => {
        seen.push(`${String(e.key)}${e.repeat ? ':repeat' : ''}`);
        return false;
      },
    });

    backDown();
    suppressKeyUntilRelease(
      new KeyboardEvent('keydown', { key: 'GoBack', keyCode: 461 }),
    );
    backDown(true); // repeat → dropped, never reaches the capture phase
    backUp(); // lifts, despite the different `key`

    // The next press must get through rather than staying wedged.
    backDown();
    backDown(true);

    v.assert.deepEqual(seen, ['GoBack', 'GoBack', 'GoBack:repeat']);

    dispose();
  });

  v.test('useHold drives a Back hold end to end on webOS', async () => {
    const onHold = v.vi.fn();
    const onEnter = v.vi.fn();
    const onRelease = v.vi.fn();
    const reached: string[] = [];

    const dispose = renderer.render(() => {
      // Back reaches the app as GoBack/461 on key-down and Unidentified/461 on
      // key-up, so it has to be mapped by keyCode.
      useFocusManager({ Back: [461, 'GoBack'] });
      const [startHold, releaseHold] = useHold({
        onHold,
        onEnter,
        onRelease,
        holdThreshold: 1000,
        holdRequiresRepeat: false, // webOS emits no auto-repeat for Back
      });
      return (
        <view
          autofocus
          onCaptureKey={(e: KeyboardEvent) => {
            reached.push(e.repeat ? 'repeat' : 'press');
            return false;
          }}
          onBack={startHold}
          onCaptureBackRelease={releaseHold}
        />
      );
    }) as unknown as () => void;
    await waitForUpdate();
    // Let autofocus settle on real timers — switching to fake ones with focus
    // still pending would strand it and leave the focus path empty.
    await new Promise((resolve) => setTimeout(resolve, 10));

    v.vi.useFakeTimers();
    try {
      // Tap: released well before the threshold.
      backDown();
      backUp();
      v.assert.equal(onEnter.mock.calls.length, 1);
      v.vi.advanceTimersByTime(1000);
      v.assert.equal(onHold.mock.calls.length, 0);

      // Hold: no key-up, no auto-repeat — only the timer can resolve it.
      backDown();
      v.vi.advanceTimersByTime(1000);
      v.assert.equal(onHold.mock.calls.length, 1);
      v.assert.equal(onEnter.mock.calls.length, 1);

      // The key is still down. Anything it emits now must be swallowed, so a
      // hold that moved focus could not fire whatever it just focused.
      reached.length = 0;
      backDown(true);
      v.assert.deepEqual(reached, []);

      // Release. The key-up names the key differently, and must still land.
      v.assert.equal(onRelease.mock.calls.length, 0);
      backUp();
      v.assert.equal(onRelease.mock.calls.length, 1);

      // ...and the key must not be left latched.
      backDown(true);
      v.assert.deepEqual(reached, ['repeat']);
    } finally {
      v.vi.useRealTimers();
      dispose();
    }
  });

  v.test('does not conflate two keys that both report Unidentified', async () => {
    const { dispose } = await setup();
    const backRelease = v.vi.fn();

    suppressKeyUntilRelease(
      new KeyboardEvent('keydown', { key: 'GoBack', keyCode: 461 }),
      backRelease,
    );

    // A different physical key, also anonymised on key-up.
    document.dispatchEvent(
      new KeyboardEvent('keyup', { key: 'Unidentified', keyCode: 462 }),
    );
    v.assert.equal(backRelease.mock.calls.length, 0);

    backUp();
    v.assert.equal(backRelease.mock.calls.length, 1);

    dispose();
  });
});
