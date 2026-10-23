import * as v from 'vitest';
import {
  useFocusManager,
  suppressKeyUntilRelease,
  releaseKeySuppression,
  useHold,
} from '@solidtv/solid/primitives';
import { Config } from '@solidtv/solid';
import { renderer, waitForUpdate } from './setup.js';

const keydown = (repeat = false) =>
  document.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Enter', repeat }),
  );
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

  v.test(
    'a fresh key-down lifts suppression when key-up never arrives',
    async () => {
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
    },
  );

  v.test('never suppresses non-repeat key-downs', async () => {
    const { onEnter, dispose } = await setup();

    suppressKeyUntilRelease('Enter');
    keydown();
    v.assert.equal(onEnter.mock.calls.length, 1);

    dispose();
  });

  v.test('releaseKeySuppression lifts by name or by event, once', async () => {
    const { onEnter, dispose } = await setup();
    const onRelease = v.vi.fn();

    keydown();
    suppressKeyUntilRelease('Enter', onRelease);
    releaseKeySuppression('Enter');
    v.assert.equal(onRelease.mock.calls.length, 1);
    keydown(true);
    v.assert.equal(onEnter.mock.calls.length, 2);

    // An event finds the suppression under its keyCode, and every alias goes.
    suppressKeyUntilRelease(
      new KeyboardEvent('keydown', { key: 'GoBack', keyCode: 461 }),
      onRelease,
    );
    releaseKeySuppression(
      new KeyboardEvent('keyup', { key: 'Unidentified', keyCode: 461 }),
    );
    v.assert.equal(onRelease.mock.calls.length, 2);
    releaseKeySuppression('GoBack');
    releaseKeySuppression(461);
    v.assert.equal(onRelease.mock.calls.length, 2);

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
  v.test(
    'a key-up naming the key differently still lifts suppression',
    async () => {
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
    },
  );

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

  v.test(
    'does not conflate two keys that both report Unidentified',
    async () => {
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
    },
  );
});

// Some devices never set `repeat`: holding a key sends a stream of
// `repeat=false` key-downs and a single key-up on release. Verbatim pattern from
// a device log:
//   keydown Enter 13 repeat=false   (×N while held)
//   keyup   Enter 13 repeat=false   (once, on release)
const enterDown = () =>
  document.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13 }),
  );
const enterUp = () =>
  document.dispatchEvent(
    new KeyboardEvent('keyup', { key: 'Enter', keyCode: 13 }),
  );

// Renders a focused view that records whether each key-down it sees is a
// repeat, then switches to fake timers so tests control the repeat window.
async function setupRecorder() {
  const seen: string[] = [];
  const { dispose } = await setup({
    onCaptureKey: (e: KeyboardEvent) => {
      seen.push(`${String(e.key)}${e.repeat ? ':repeat' : ''}`);
      return false;
    },
  });
  v.vi.useFakeTimers();
  return {
    seen,
    dispose: () => {
      v.vi.useRealTimers();
      dispose();
    },
  };
}

v.describe('inferred key repeat (Config.inferKeyRepeat)', () => {
  v.afterEach(() => {
    Config.inferKeyRepeat = undefined;
    releaseKeySuppression('Enter');
  });

  v.test('is off by default: every key-down is a fresh press', async () => {
    const { seen, dispose } = await setupRecorder();

    enterDown();
    v.vi.advanceTimersByTime(50);
    enterDown();

    v.assert.deepEqual(seen, ['Enter', 'Enter']);
    dispose();
  });

  v.test(
    'marks a key-down of a held key within the window as a repeat',
    async () => {
      Config.inferKeyRepeat = 700;
      const { seen, dispose } = await setupRecorder();

      enterDown();
      v.vi.advanceTimersByTime(500); // the device's initial repeat delay
      enterDown();
      v.vi.advanceTimersByTime(50);
      enterDown();

      v.assert.deepEqual(seen, ['Enter', 'Enter:repeat', 'Enter:repeat']);
      dispose();
    },
  );

  v.test('a key-up ends the press, so the next key-down is fresh', async () => {
    Config.inferKeyRepeat = 700;
    const { seen, dispose } = await setupRecorder();

    enterDown();
    enterUp();
    v.vi.advanceTimersByTime(50);
    enterDown();

    v.assert.deepEqual(seen, ['Enter', 'Enter']);
    dispose();
  });

  v.test('a missed key-up cannot wedge the key past the window', async () => {
    Config.inferKeyRepeat = 700;
    const { seen, dispose } = await setupRecorder();

    enterDown(); // key-up never arrives
    v.vi.advanceTimersByTime(700);
    enterDown();

    v.assert.deepEqual(seen, ['Enter', 'Enter']);
    dispose();
  });

  v.test(
    'the window runs from the previous key-down, not the first',
    async () => {
      Config.inferKeyRepeat = 700;
      const { seen, dispose } = await setupRecorder();

      enterDown();
      for (let i = 0; i < 20; i++) {
        v.vi.advanceTimersByTime(100);
        enterDown();
      }

      v.assert.equal(seen.length, 21);
      v.assert.equal(seen.filter((s) => s === 'Enter').length, 1);
      dispose();
    },
  );

  v.test('does not conflate different keys', async () => {
    Config.inferKeyRepeat = 700;
    const { seen, dispose } = await setupRecorder();

    enterDown();
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', keyCode: 40 }),
    );

    v.assert.deepEqual(seen, ['Enter', 'ArrowDown']);
    dispose();
  });

  v.test(
    'a key-up naming the key differently still ends the press',
    async () => {
      Config.inferKeyRepeat = 700;
      const { seen, dispose } = await setupRecorder();

      backDown();
      backUp(); // Unidentified/461
      backDown();

      v.assert.deepEqual(seen, ['GoBack', 'GoBack']);
      dispose();
    },
  );

  v.test('useHold resolves a hold on such a device end to end', async () => {
    Config.inferKeyRepeat = 700;
    const onHold = v.vi.fn();
    const onEnter = v.vi.fn();
    const onRelease = v.vi.fn();
    const reached: string[] = [];

    const dispose = renderer.render(() => {
      useFocusManager();
      const [startHold, releaseHold] = useHold({
        onHold,
        onEnter,
        onRelease,
        holdThreshold: 500,
      });
      return (
        <view
          autofocus
          onCaptureKey={(e: KeyboardEvent) => {
            reached.push(e.repeat ? 'repeat' : 'press');
            return false;
          }}
          onEnter={startHold}
          onEnterRelease={releaseHold}
        />
      );
    }) as unknown as () => void;
    await waitForUpdate();
    await new Promise((resolve) => setTimeout(resolve, 10));

    v.vi.useFakeTimers();
    try {
      // Tap.
      enterDown();
      enterUp();
      v.assert.equal(onEnter.mock.calls.length, 1);

      // Hold: repeat=false key-downs every 50ms, no key-up until release.
      enterDown();
      for (let i = 0; i < 12; i++) {
        v.vi.advanceTimersByTime(50);
        enterDown();
      }
      v.assert.equal(onHold.mock.calls.length, 1);
      v.assert.equal(onEnter.mock.calls.length, 1);

      // Still held: the latch must keep swallowing what the device sends.
      reached.length = 0;
      v.vi.advanceTimersByTime(50);
      enterDown();
      v.assert.deepEqual(reached, []);

      enterUp();
      v.assert.equal(onRelease.mock.calls.length, 1);

      // The next press is fresh and gets through.
      enterDown();
      v.assert.deepEqual(reached, ['press']);
    } finally {
      v.vi.useRealTimers();
      dispose();
    }
  });
});
