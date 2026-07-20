import * as v from 'vitest';
import * as lng from '@solidtv/solid';
import { useMouse } from '../src/primitives/useMouse.js';
import { useFocusManager } from '../src/core/focusManager.js';
import { renderer } from './setup.js';

const dispatchClick = (x: number, y: number) =>
  window.dispatchEvent(
    new MouseEvent('click', { clientX: x, clientY: y, bubbles: true }),
  );

const dispatchMouseDown = (x: number, y: number) =>
  window.dispatchEvent(
    new MouseEvent('mousedown', { clientX: x, clientY: y, bubbles: true }),
  );

const dispatchMouseMove = (x: number, y: number) =>
  window.dispatchEvent(
    new MouseEvent('mousemove', { clientX: x, clientY: y, bubbles: true }),
  );

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

v.describe('useMouse', () => {
  v.test('click invokes onMouseClick on the focused element', async () => {
    let app!: lng.ElementNode;
    let btn!: lng.ElementNode;
    const onClick = v.vi.fn();

    const dispose = renderer.render(() => {
      const root = (
        <view ref={app} width={1920} height={1080}>
          <view
            ref={btn}
            x={100}
            y={200}
            width={300}
            height={150}
            onMouseClick={onClick}
          />
        </view>
      );
      useMouse(app, 5);
      return root;
    });

    await wait(20);
    btn.setFocus();
    await wait(20); // setFocus defers via post-mutation scheduler
    v.assert.equal(lng.activeElement(), btn, 'btn is the active element');

    dispatchClick(150, 250);

    v.assert.equal(onClick.mock.calls.length, 1);
    dispose();
  });

  v.test('click walks up to ancestor with onMouseClick when active is a child', async () => {
    let app!: lng.ElementNode;
    let parent!: lng.ElementNode;
    let child!: lng.ElementNode;
    const onClickParent = v.vi.fn();

    const dispose = renderer.render(() => {
      const root = (
        <view ref={app} width={1920} height={1080}>
          <view
            ref={parent}
            x={50}
            y={50}
            width={400}
            height={400}
            onMouseClick={onClickParent}
          >
            <view ref={child} x={100} y={100} width={50} height={50} />
          </view>
        </view>
      );
      useMouse(app, 5);
      return root;
    });

    await wait(20);
    child.setFocus();
    await wait(20);
    v.assert.equal(lng.activeElement(), child);

    // (75, 75) is inside parent (50–450, 50–450) but outside child (150–200, 150–200)
    dispatchClick(75, 75);

    v.assert.equal(onClickParent.mock.calls.length, 1);
    dispose();
  });

  v.test('mousemove focuses the deepest matching child', async () => {
    let app!: lng.ElementNode;
    let outer!: lng.ElementNode;
    let inner!: lng.ElementNode;

    const dispose = renderer.render(() => {
      const root = (
        <view ref={app} width={1920} height={1080}>
          <view
            ref={outer}
            x={0}
            y={0}
            width={500}
            height={500}
            onFocus={() => {}}
          >
            <view
              ref={inner}
              x={50}
              y={50}
              width={100}
              height={100}
              onFocus={() => {}}
            />
          </view>
        </view>
      );
      useMouse(app, 5);
      return root;
    });

    await wait(20);
    dispatchMouseMove(75, 75);
    await wait(80);

    v.assert.equal(lng.activeElement(), inner, 'inner is focused');
    dispose();
  });

  v.test('z-index decides which overlapping sibling wins', async () => {
    let app!: lng.ElementNode;
    let low!: lng.ElementNode;
    let high!: lng.ElementNode;

    const dispose = renderer.render(() => {
      const root = (
        <view ref={app} width={1920} height={1080}>
          <view
            ref={low}
            x={50}
            y={50}
            width={300}
            height={300}
            zIndex={1}
            onFocus={() => {}}
          />
          <view
            ref={high}
            x={50}
            y={50}
            width={300}
            height={300}
            zIndex={5}
            onFocus={() => {}}
          />
        </view>
      );
      useMouse(app, 5);
      return root;
    });

    await wait(20);
    dispatchMouseMove(100, 100);
    await wait(80);

    v.assert.equal(lng.activeElement(), high, 'higher z-index wins');
    dispose();
  });

  v.test('skipFocus and alpha:0 elements are excluded from hit testing', async () => {
    let app!: lng.ElementNode;
    let btn!: lng.ElementNode;

    const dispose = renderer.render(() => {
      const root = (
        <view ref={app} width={1920} height={1080}>
          <view
            ref={btn}
            x={50}
            y={50}
            width={200}
            height={200}
            onFocus={() => {}}
          />
          <view
            x={50}
            y={50}
            width={200}
            height={200}
            zIndex={10}
            skipFocus={true}
            onFocus={() => {}}
          />
          <view
            x={50}
            y={50}
            width={200}
            height={200}
            zIndex={20}
            alpha={0}
            onFocus={() => {}}
          />
        </view>
      );
      useMouse(app, 5);
      return root;
    });

    await wait(20);
    dispatchMouseMove(100, 100);
    await wait(80);

    v.assert.equal(
      lng.activeElement(),
      btn,
      'btn is focused; skipFocus/alpha:0 ignored despite higher z',
    );
    dispose();
  });

  v.test('mousemove applies hoverState when customStates option is set', async () => {
    let app!: lng.ElementNode;
    let btn!: lng.ElementNode;

    const dispose = renderer.render(() => {
      const root = (
        <view ref={app} width={1920} height={1080}>
          <view
            ref={btn}
            x={50}
            y={50}
            width={200}
            height={200}
            $hover={{ color: 0x00ff00ff }}
          />
        </view>
      );
      useMouse(app, 5, {
        customStates: { hoverState: '$hover', pressedState: '$pressed' },
      });
      return root;
    });

    await wait(20);
    dispatchMouseMove(100, 100);
    await wait(80);

    v.assert.ok(btn.states.has('$hover'));
    dispose();
  });

  v.test('moving from element A to element B transfers hoverState', async () => {
    let app!: lng.ElementNode;
    let a!: lng.ElementNode;
    let b!: lng.ElementNode;

    const dispose = renderer.render(() => {
      const root = (
        <view ref={app} width={1920} height={1080}>
          <view
            ref={a}
            x={0}
            y={0}
            width={200}
            height={200}
            $hover={{ color: 0xff0000ff }}
          />
          <view
            ref={b}
            x={500}
            y={500}
            width={200}
            height={200}
            $hover={{ color: 0x00ff00ff }}
          />
        </view>
      );
      useMouse(app, 5, {
        customStates: { hoverState: '$hover', pressedState: '$pressed' },
      });
      return root;
    });

    await wait(20);
    dispatchMouseMove(100, 100);
    await wait(80);
    v.assert.ok(a.states.has('$hover'), 'A receives hover');

    dispatchMouseMove(600, 600);
    await wait(80);
    v.assert.notOk(a.states.has('$hover'), 'A loses hover');
    v.assert.ok(b.states.has('$hover'), 'B receives hover');
    dispose();
  });

  v.test('forwardStates: hoverState propagates to ancestor with forwardStates', async () => {
    let app!: lng.ElementNode;
    let parent!: lng.ElementNode;
    let child!: lng.ElementNode;

    const dispose = renderer.render(() => {
      const root = (
        <view ref={app} width={1920} height={1080}>
          <view
            ref={parent}
            x={0}
            y={0}
            width={500}
            height={500}
            forwardStates={true}
            $hover={{ color: 0x00ff00ff }}
          >
            <view
              ref={child}
              x={50}
              y={50}
              width={100}
              height={100}
              $hover={{ color: 0xff0000ff }}
            />
          </view>
        </view>
      );
      useMouse(app, 5, {
        customStates: { hoverState: '$hover', pressedState: '$pressed' },
      });
      return root;
    });

    await wait(20);
    dispatchMouseMove(75, 75);
    await wait(80);

    v.assert.ok(parent.states.has('$hover'), 'parent receives forwarded hover');
    dispose();
  });

  v.test('precision (deviceLogicalPixelRatio): event coords are scaled to logical bounds', async () => {
    let app!: lng.ElementNode;
    let btn!: lng.ElementNode;

    const originalRO = lng.Config.rendererOptions;
    lng.Config.rendererOptions = {
      ...(originalRO as any),
      deviceLogicalPixelRatio: 2,
    } as any;

    const dispose = renderer.render(() => {
      const root = (
        <view ref={app} width={1920} height={1080}>
          <view
            ref={btn}
            x={100}
            y={100}
            width={50}
            height={50}
            onFocus={() => {}}
          />
        </view>
      );
      useMouse(app, 5);
      return root;
    });

    await wait(20);
    // Logical (125, 125) is inside btn. At device-pixel-ratio 2, mouse reports (250, 250).
    dispatchMouseMove(250, 250);
    await wait(80);

    v.assert.equal(lng.activeElement(), btn);

    lng.Config.rendererOptions = originalRO;
    dispose();
  });

  v.test('mousedown applies pressedState; click clears it', async () => {
    let app!: lng.ElementNode;
    let btn!: lng.ElementNode;

    const dispose = renderer.render(() => {
      const root = (
        <view ref={app} width={1920} height={1080}>
          <view
            ref={btn}
            x={50}
            y={50}
            width={200}
            height={200}
            $hover={{ color: 0x00ff00ff }}
            $pressed={{ color: 0x0000ffff }}
          />
        </view>
      );
      useMouse(app, 5, {
        customStates: { hoverState: '$hover', pressedState: '$pressed' },
      });
      return root;
    });

    await wait(20);
    // mousedown finds elements via hoverState — apply hover first by moving
    dispatchMouseMove(100, 100);
    await wait(80);
    v.assert.ok(btn.states.has('$hover'), 'hover applied first');

    dispatchMouseDown(100, 100);
    v.assert.ok(btn.states.has('$pressed'), 'pressed applied on mousedown');

    dispatchClick(100, 100);
    v.assert.notOk(btn.states.has('$pressed'), 'pressed cleared on click');
    dispose();
  });
});

v.describe('synthetic keyboard events (legacy KeyboardEvent constructors)', () => {
  // Simulates Chrome < 51 (LG webOS 3.x), where the KeyboardEvent constructor
  // exists but silently drops the key/keyCode/which members of the init dict.
  class LegacyKeyboardEvent extends KeyboardEvent {
    constructor(type: string, init?: KeyboardEventInit) {
      super(type, { bubbles: init?.bubbles, cancelable: init?.cancelable });
    }
  }

  const captureKeydown = () => {
    const events: KeyboardEvent[] = [];
    const listener = (e: Event) => events.push(e as KeyboardEvent);
    document.addEventListener('keydown', listener);
    return {
      events,
      stop: () => document.removeEventListener('keydown', listener),
    };
  };

  v.afterEach(() => {
    v.vi.unstubAllGlobals();
  });

  v.test('modern engine: click dispatches Enter via the constructor path (no defineProperty)', async () => {
    let app!: lng.ElementNode;
    let btn!: lng.ElementNode;

    const dispose = renderer.render(() => {
      const root = (
        <view ref={app} width={1920} height={1080}>
          <view
            ref={btn}
            x={100}
            y={200}
            width={300}
            height={150}
            onEnter={() => {}}
          />
        </view>
      );
      useMouse(app, 5);
      return root;
    });

    await wait(20);
    btn.setFocus();
    await wait(20);
    v.assert.equal(lng.activeElement(), btn);

    // attach after the waits so stray delayed dispatches from prior tests
    // have flushed
    const capture = captureKeydown();
    dispatchClick(150, 250);
    await wait(20); // synthetic Enter is dispatched on a 1ms timeout

    v.assert.equal(capture.events.length, 1, 'one Enter keydown dispatched');
    const evt = capture.events[0]!;
    v.assert.equal(evt.key, 'Enter');
    v.assert.equal(evt.keyCode, 13);
    v.assert.equal(evt.which, 13);
    v.assert.isUndefined(
      Object.getOwnPropertyDescriptor(evt, 'key'),
      'constructor honored init members, so no own-property override',
    );
    v.assert.isUndefined(Object.getOwnPropertyDescriptor(evt, 'keyCode'));

    capture.stop();
    dispose();
  });

  v.test('legacy constructor: click still reports Enter/13 and reaches onEnter via the focus manager', async () => {
    v.vi.stubGlobal('KeyboardEvent', LegacyKeyboardEvent);

    let app!: lng.ElementNode;
    let btn!: lng.ElementNode;
    const onEnter = v.vi.fn();

    const dispose = renderer.render(() => {
      const root = (
        <view ref={app} width={1920} height={1080}>
          <view
            ref={btn}
            x={100}
            y={200}
            width={300}
            height={150}
            onEnter={onEnter}
          />
        </view>
      );
      useFocusManager();
      useMouse(app, 5);
      return root;
    });

    await wait(20);
    btn.setFocus();
    await wait(20);
    v.assert.equal(lng.activeElement(), btn);

    const capture = captureKeydown();
    dispatchClick(150, 250);
    await wait(20);

    v.assert.equal(capture.events.length, 1, 'one Enter keydown dispatched');
    const evt = capture.events[0]!;
    v.assert.equal(evt.key, 'Enter', 'key forced onto instance');
    v.assert.equal(evt.keyCode, 13, 'keyCode forced onto instance');
    v.assert.equal(evt.which, 13, 'which forced onto instance');
    v.assert.equal(
      onEnter.mock.calls.length,
      1,
      'focus manager mapped the synthetic Enter to onEnter',
    );

    capture.stop();
    dispose();
  });

  v.test('legacy constructor: wheel scroll still reports ArrowUp/38 and ArrowDown/40', async () => {
    v.vi.stubGlobal('KeyboardEvent', LegacyKeyboardEvent);

    let app!: lng.ElementNode;

    const dispose = renderer.render(() => {
      const root = (
        <view ref={app} width={1920} height={1080}>
          <view x={0} y={0} width={500} height={500} onFocus={() => {}} />
        </view>
      );
      useMouse(app, 5);
      return root;
    });

    await wait(20);
    const capture = captureKeydown();
    window.dispatchEvent(new WheelEvent('wheel', { deltaY: 100 }));
    await wait(300); // module-level scroll handler is throttled at 250ms

    v.assert.equal(capture.events.length, 1);
    v.assert.equal(capture.events[0]!.key, 'ArrowDown');
    v.assert.equal(capture.events[0]!.keyCode, 40);
    v.assert.equal(capture.events[0]!.which, 40);

    window.dispatchEvent(new WheelEvent('wheel', { deltaY: -100 }));
    await wait(300);

    v.assert.equal(capture.events.length, 2);
    v.assert.equal(capture.events[1]!.key, 'ArrowUp');
    v.assert.equal(capture.events[1]!.keyCode, 38);
    v.assert.equal(capture.events[1]!.which, 38);

    // let the trailing keyup timeout flush before other tests run
    await wait(300);
    capture.stop();
    dispose();
  });
});
