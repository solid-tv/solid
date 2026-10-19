// Contract tests: nodes (props, store records, animate, events, child order).
//
// Behavioural, through the public API: JSX props and the ElementNode members
// apps use. 1.x also read the raw renderer node (`lng`); in 2.0 the
// ElementNode is the renderer's handle and its props live in the store, so
// those reads are store reads (`rec` below). These run on a headless
// RendererCore (tests/setup.ts): frames are driven with `tick()`.
import * as v from 'vitest';
import {
  F_ALPHA,
  F_HEIGHT,
  F_STRIDE,
  F_WIDTH,
  F_X,
  F_Y,
  I_COLOR_TL,
  I_PARENT,
  I_STRIDE,
  NULL,
  type TextState,
} from '@solidtv/renderer';
import * as s from 'solid-js';
import * as lng from '@solidtv/solid';
import {
  useFocusManager,
  type KeyEventLike,
  type KeyEventTarget,
} from '@solidtv/solid/primitives';
import { core, renderer, tick } from './setup.js';

/** Lets every queued microtask and the post-mutation pass run, then a frame. */
const settle = () => new Promise<void>((r) => setTimeout(r, 0)).then(tick);

const ANIMATION_WAIT = { timeout: 3000 };

/** Drive frames until `check` passes. */
const frames = (check: () => void) =>
  v.vi.waitFor(() => {
    tick();
    check();
  }, ANIMATION_WAIT);

/** Drive frames until `promise` settles (an animation's waitUntilStopped). */
async function drive<T>(promise: Promise<T>): Promise<T> {
  let done = false;
  void promise.then(
    () => (done = true),
    () => (done = true),
  );
  while (!done) {
    tick();
    await new Promise<void>((r) => setTimeout(r, 0));
  }
  return promise;
}

/**
 * The store record of an element (what the 1.x renderer node, `lng`, held in
 * 1.x): read through the store's arrays at the node's slot.
 */
const rec = (el: lng.ElementNode, slot = el.slot) => {
  const nodes = core.nodes;
  const f = slot * F_STRIDE;
  return {
    x: nodes.f64[f + F_X]!,
    y: nodes.f64[f + F_Y]!,
    width: nodes.f64[f + F_WIDTH]!,
    height: nodes.f64[f + F_HEIGHT]!,
    alpha: nodes.f64[f + F_ALPHA]!,
    color: nodes.u32[slot * I_STRIDE + I_COLOR_TL]!,
    parent: nodes.i32[slot * I_STRIDE + I_PARENT]!,
    src: nodes.srcs[slot],
  };
};

// The destroy cases spy on the shared core: each spy goes after its test.
v.afterEach(() => {
  v.vi.restoreAllMocks();
});

/** How many times `core.destroySlot` destroyed `slot`. */
const destroyedTimes = (
  spy: v.MockInstance<typeof core.destroySlot>,
  slot: number,
) => spy.mock.calls.filter((call) => call[0] === slot).length;

// Child ids, with the empty text nodes Solid uses as placeholders shown as
// '#text' (they are children too: code walking children must skip them).
const ids = (el: lng.ElementNode) =>
  el.children.map((c) => (c instanceof lng.ElementNode ? c.id : '#text'));

/** x of every element child, in children order. */
const xs = (el: lng.ElementNode) =>
  el.children.filter((c) => c instanceof lng.ElementNode).map((c) => c.x);

// A key source the focus manager can listen to, so a test can drive real key
// handlers without binding listeners on the shared document (vitest runs with
// isolate: false).
type Listener = (event: KeyEventLike) => void;
class FakeKeys implements KeyEventTarget {
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
  press(key: string, keyCode: number) {
    const event: KeyEventLike = { key, keyCode, repeat: false };
    for (const l of this.listeners.keydown.slice()) l(event);
    for (const l of this.listeners.keyup.slice()) l(event);
  }
}

/** Renders `view` with a focus manager on a FakeKeys source, then settles. */
async function renderWithKeys(view: () => s.JSX.Element) {
  const keys = new FakeKeys();
  const dispose = renderer.render(() => {
    useFocusManager(undefined, keys);
    return view();
  });
  await settle();
  return { keys, dispose };
}

v.describe(
  'Nodes: arbitrary data props are stored on the node and read back',
  () => {
    v.test(
      'elm.item.href reads back, follows a reactive update, and is readable from a parent handler',
      async () => {
        const [item, setItem] = s.createSignal({ href: '/a' });
        let row!: lng.ElementNode;
        let tile!: lng.ElementNode;
        let txt!: lng.ElementNode;
        let readInHandler: unknown;
        const { keys, dispose } = await renderWithKeys(() => (
          <view
            ref={row}
            autofocus
            onEnter={function (this: lng.ElementNode) {
              // demo app Browse.tsx: entity.item.href from a child, via `this`.
              const entity = this.children[0] as lng.ElementNode;
              readInHandler = (entity.item as { href: string }).href;
              return true;
            }}
          >
            <view
              ref={tile}
              item={item()}
              entityInfo={{ id: 7 }}
              heroContent
              backdrop="bg.png"
            />
            <text ref={txt} item={{ href: '/text' }}>
              label
            </text>
          </view>
        ));

        v.expect((tile.item as { href: string }).href).toBe('/a');
        v.expect(tile.entityInfo).toEqual({ id: 7 });
        v.expect(tile.heroContent).toBe(true);
        v.expect(tile.backdrop).toBe('bg.png');
        v.expect((txt.item as { href: string }).href).toBe('/text');

        setItem({ href: '/b' });
        s.flush();
        v.expect((tile.item as { href: string }).href).toBe('/b');

        keys.press('Enter', 13);
        v.expect(readInHandler).toBe('/b');
        v.expect(row.children[0]).toBe(tile);

        // Today data props stay on the ElementNode, as fields of its own:
        // they are not renderer state (2.0: the node is the renderer's handle).
        v.expect(Object.prototype.hasOwnProperty.call(tile, 'item')).toBe(true);
        dispose();
      },
    );
  },
);

v.describe('Nodes: the store record of a node, with props applied', () => {
  v.test(
    'a rendered view and text are the renderer handles of their store records (1.x: their renderer node)',
    () => {
      let parent!: lng.ElementNode;
      let el!: lng.ElementNode;
      let txt!: lng.ElementNode;
      const dispose = renderer.render(() => (
        <view ref={parent} x={5} width={500} height={500}>
          <view
            ref={el}
            x={10}
            y={20}
            width={100}
            height={50}
            color={0xff0000ff}
            alpha={0.5}
          />
          <text ref={txt} fontSize={30}>
            Hello
          </text>
        </view>
      ));

      v.expect(core.nodes.handles[el.slot]).toBe(el);
      const node = rec(el);
      v.expect(node.x).toBe(10);
      v.expect(node.y).toBe(20);
      v.expect(node.width).toBe(100);
      v.expect(node.height).toBe(50);
      v.expect(node.color).toBe(0xff0000ff);
      v.expect(node.alpha).toBe(0.5);
      // The renderer tree mirrors the element tree.
      v.expect(node.parent).toBe(parent.slot);

      v.expect(core.nodes.handles[txt.slot]).toBe(txt);
      // The store keeps a TextState for every text slot.
      const textNode = core.nodes.texts[txt.slot] as TextState;
      v.expect(textNode.text).toBe('Hello');
      v.expect(textNode.fontSize).toBe(30);
      dispose();
    },
  );

  v.test(
    'a write straight to the store (setNow; 1.x: to the renderer node) reads back through the element (KeepAlive.tsx pattern)',
    () => {
      let el!: lng.ElementNode;
      const dispose = renderer.render(() => <view ref={el} x={10} y={20} />);

      el.setNow('x', 42);
      el.setNow('y', 43);
      v.expect(el.x).toBe(42);
      v.expect(el.y).toBe(43);
      dispose();
    },
  );
});

v.describe('Nodes: .animate(...).start().waitUntilStopped()', () => {
  v.test(
    'resolves once the animation stops, and the final values land on the renderer node',
    async () => {
      let el!: lng.ElementNode;
      const dispose = renderer.render(() => (
        <view ref={el} x={0} alpha={1} width={10} height={10} />
      ));

      const done = el
        .animate({ x: 100, alpha: 0.5 }, { duration: 30 })
        .start()
        .waitUntilStopped();
      v.expect(done).toBeInstanceOf(Promise);
      await drive(done);

      v.expect(rec(el).x).toBe(100);
      v.expect(rec(el).alpha).toBe(0.5);
      v.expect(el.x).toBe(100);
      v.expect(el.alpha).toBe(0.5);
      dispose();
    },
  );
});

v.describe('Nodes: direct writes from handlers reach the renderer node', () => {
  v.test('this.x, this.y, this.alpha and this.color', async () => {
    let el!: lng.ElementNode;
    let self: unknown;
    const { keys, dispose } = await renderWithKeys(() => (
      <view
        ref={el}
        autofocus
        x={1}
        y={2}
        width={10}
        height={10}
        color={0xff0000ff}
        onEnter={function (this: lng.ElementNode) {
          self = this;
          this.x = 50;
          this.y = 60;
          this.alpha = 0.25;
          this.color = 0x00ff00ff;
          return true;
        }}
      />
    ));

    keys.press('Enter', 13);
    v.expect(self).toBe(el);
    v.expect(rec(el).x).toBe(50);
    v.expect(rec(el).y).toBe(60);
    v.expect(rec(el).alpha).toBe(0.25);
    v.expect(rec(el).color).toBe(0x00ff00ff);
    dispose();
  });

  v.test(
    'this.src lands on the renderer node; a view with no color turns white so the image shows',
    async () => {
      let plain!: lng.ElementNode;
      let tinted!: lng.ElementNode;
      const { keys, dispose } = await renderWithKeys(() => (
        <view>
          <view
            ref={plain}
            autofocus
            width={10}
            height={10}
            onEnter={function (this: lng.ElementNode) {
              this.src = 'poster.png';
              // Background.tsx writes through refs from handlers too.
              tinted.src = 'tinted.png';
              return true;
            }}
          />
          <view ref={tinted} width={10} height={10} color={0x336699ff} />
        </view>
      ));

      // A view with neither color nor src renders transparent.
      v.expect(rec(plain).color).toBe(0x00000000);

      keys.press('Enter', 13);
      v.expect(rec(plain).src).toBe('poster.png');
      v.expect(plain.src).toBe('poster.png');
      v.expect(rec(plain).color).toBe(0xffffffff);
      v.expect(rec(tinted).src).toBe('tinted.png');
      v.expect(rec(tinted).color).toBe(0x336699ff);
      dispose();
    },
  );

  v.test(
    'this.selected is stored on the node and picks selectedNode (NavDrawer.tsx pattern)',
    async () => {
      let el!: lng.ElementNode;
      const { keys, dispose } = await renderWithKeys(() => (
        <view
          ref={el}
          autofocus
          onEnter={function (this: lng.ElementNode) {
            this.selected = 1;
            return true;
          }}
        >
          <view id="zero" />
          <view id="one" />
        </view>
      ));

      v.expect(el.selected).toBe(undefined);
      keys.press('Enter', 13);
      v.expect(el.selected).toBe(1);
      v.expect(el.selectedNode).toBe(el.children[1]);
      dispose();
    },
  );

  v.test(
    'this.display = "flex" turns flex on for the next layout pass (Browse.tsx pattern)',
    async () => {
      let el!: lng.ElementNode;
      const { keys, dispose } = await renderWithKeys(() => (
        <view
          ref={el}
          autofocus
          onEnter={function (this: lng.ElementNode) {
            this.display = 'flex';
            return true;
          }}
        >
          <view width={10} height={10} />
          <view width={10} height={10} />
        </view>
      ));

      keys.press('Enter', 13);
      v.expect(el.display).toBe('flex');
      v.expect(el.requiresLayout()).toBe(true);

      // Today the write alone schedules no layout pass: the children keep
      // their positions until something lays the container out.
      await settle();
      v.expect(el.children.map((c) => c.x)).toEqual([0, 0]);

      el.updateLayout();
      v.expect(el.children.map((c) => c.x)).toEqual([0, 10]);
      v.expect(el.children.map((c) => rec(c).x)).toEqual([0, 10]);
      dispose();
    },
  );
});

v.describe('Nodes: getChildById', () => {
  v.test('finds a direct child by id, and only a direct child', () => {
    let parent!: lng.ElementNode;
    let b!: lng.ElementNode;
    let t!: lng.ElementNode;
    const dispose = renderer.render(() => (
      <view ref={parent}>
        <view id="a">
          <view id="deep" />
        </view>
        <view ref={b} id="b" />
        <text ref={t} id="t">
          x
        </text>
      </view>
    ));

    v.expect(parent.getChildById('b')).toBe(b);
    v.expect(parent.getChildById('t')).toBe(t);
    // Grandchildren are not searched (searchChildrenById does that).
    v.expect(parent.getChildById('deep')).toBe(undefined);
    v.expect(parent.getChildById('missing')).toBe(undefined);
    dispose();
  });
});

v.describe('Nodes: .rendered', () => {
  v.test(
    'false until the renderer node exists; onCreate runs outside-in, before children render',
    async () => {
      const [show, setShow] = s.createSignal(true);
      let parent!: lng.ElementNode;
      let child!: lng.ElementNode;
      const log: string[] = [];
      const dispose = renderer.render(() => (
        <s.Show when={show()}>
          <view
            ref={(e) => {
              parent = e;
              log.push(`ref parent rendered=${e.rendered}`);
            }}
            onCreate={() => {
              log.push(
                `create parent rendered=${parent.rendered} child=${child.rendered}`,
              );
            }}
          >
            <view
              ref={(e) => {
                child = e;
                log.push(`ref child rendered=${e.rendered}`);
              }}
              onCreate={() =>
                log.push(`create child rendered=${child.rendered}`)
              }
            />
          </view>
        </s.Show>
      ));

      // Refs run before render (their order is Solid's); onCreate runs once the
      // renderer node exists, parent first, before its children render.
      v.expect(log.slice(0, 2).sort()).toEqual([
        'ref child rendered=false',
        'ref parent rendered=false',
      ]);
      v.expect(log.slice(2)).toEqual([
        'create parent rendered=true child=false',
        'create child rendered=true',
      ]);
      v.expect(new lng.ElementNode(core, lng.NodeType.Element).rendered).toBe(
        false,
      );

      // Today `rendered` is not reset when the node is removed and destroyed.
      setShow(false);
      await settle();
      v.expect(parent.rendered).toBe(true);
      dispose();
    },
  );
});

v.describe('Nodes: destroy()', () => {
  v.test(
    'removal calls onDestroy in the post-mutation pass, then destroys the renderer node',
    async () => {
      const [show, setShow] = s.createSignal(true);
      let parent!: lng.ElementNode;
      let el!: lng.ElementNode;
      const onDestroy = v.vi.fn();
      const dispose = renderer.render(() => (
        <view ref={parent}>
          <s.Show when={show()}>
            <view ref={el} onDestroy={onDestroy} />
          </s.Show>
        </view>
      ));
      const destroySpy = v.vi.spyOn(core, 'destroySlot');
      const slot = el.slot;

      setShow(false);
      s.flush();
      // Out of the element tree at once; destroyed in the post-mutation pass.
      v.expect(parent.children).not.toContain(el);
      v.expect(onDestroy).not.toHaveBeenCalled();
      v.expect(destroyedTimes(destroySpy, slot)).toBe(0);

      await settle();
      v.expect(onDestroy).toHaveBeenCalledTimes(1);
      v.expect(onDestroy.mock.contexts[0]).toBe(el);
      v.expect(onDestroy.mock.calls[0]).toEqual([el]);
      v.expect(destroyedTimes(destroySpy, slot)).toBe(1);
      dispose();
    },
  );

  v.test(
    'onDestroy fires on the removed top-level node only, not on its children (docs/flow/ondestroy.md)',
    async () => {
      const [show, setShow] = s.createSignal(true);
      const destroyed: string[] = [];
      const onDestroy = function (this: lng.ElementNode) {
        destroyed.push(this.id!);
      };
      const dispose = renderer.render(() => (
        <s.Show when={show()}>
          <view id="top" onDestroy={onDestroy}>
            <view id="child" onDestroy={onDestroy}>
              <view id="grandchild" onDestroy={onDestroy} />
            </view>
          </view>
        </s.Show>
      ));

      setShow(false);
      await settle();
      v.expect(destroyed).toEqual(['top']);
      dispose();
    },
  );

  v.test(
    'calling el.destroy() runs onDestroy and destroys the renderer node, leaving the element tree alone',
    () => {
      let parent!: lng.ElementNode;
      let el!: lng.ElementNode;
      let bare!: lng.ElementNode;
      const onDestroy = v.vi.fn();
      const dispose = renderer.render(() => (
        <view ref={parent}>
          <view ref={el} onDestroy={onDestroy} />
          <view ref={bare} />
        </view>
      ));
      const destroySpy = v.vi.spyOn(core, 'destroySlot');
      const slot = el.slot;
      const bareSlot = bare.slot;

      el.destroy();
      v.expect(onDestroy).toHaveBeenCalledTimes(1);
      v.expect(onDestroy.mock.contexts[0]).toBe(el);
      // onDestroy returned no promise, so the renderer node goes at once.
      v.expect(destroyedTimes(destroySpy, slot)).toBe(1);

      bare.destroy();
      v.expect(destroyedTimes(destroySpy, bareSlot)).toBe(1);

      // Today destroy() tears down the renderer node only: the ElementNode
      // stays in its parent's children until Solid removes it.
      v.expect(parent.children).toContain(el);

      // A node that never rendered has no renderer node to destroy.
      v.expect(() =>
        new lng.ElementNode(core, lng.NodeType.Element).destroy(),
      ).not.toThrow();
      dispose();
    },
  );
});

v.describe('Nodes: onCreate and onDestroy returning a promise', () => {
  v.test('render does not wait for a promise from onCreate', () => {
    let el!: lng.ElementNode;
    let child!: lng.ElementNode;
    const onCreate = v.vi.fn(() => new Promise<void>(() => {}));
    const dispose = renderer.render(() => (
      <view ref={el} onCreate={onCreate}>
        <view ref={child} />
      </view>
    ));

    v.expect(onCreate).toHaveBeenCalledTimes(1);
    v.expect(onCreate.mock.contexts[0]).toBe(el);
    v.expect(onCreate.mock.calls[0]).toEqual([el]);
    v.expect(el.rendered).toBe(true);
    v.expect(child.rendered).toBe(true);
    dispose();
  });

  v.test(
    'onCreate can write props and animate in (Destroy.tsx animateIn)',
    async () => {
      let el!: lng.ElementNode;
      let animatedIn!: Promise<void>;
      const animateIn = (node: lng.ElementNode) => {
        node.alpha = 0;
        node.y = -100;
        return node
          .animate({ y: 0, alpha: 1 }, { duration: 30 })
          .start()
          .waitUntilStopped();
      };
      const dispose = renderer.render(() => (
        <view
          ref={el}
          width={10}
          height={10}
          onCreate={(node) => {
            animatedIn = animateIn(node);
          }}
        />
      ));

      v.expect(rec(el).y).toBe(-100);
      v.expect(rec(el).alpha).toBe(0);
      await drive(animatedIn);
      v.expect(rec(el).y).toBe(0);
      v.expect(rec(el).alpha).toBe(1);
      dispose();
    },
  );

  v.test(
    'destroy waits for the promise onDestroy returns before destroying the renderer node',
    async () => {
      const [show, setShow] = s.createSignal(true);
      let el!: lng.ElementNode;
      let finishExit!: () => void;
      const onDestroy = v.vi.fn(
        () => new Promise<void>((resolve) => (finishExit = resolve)),
      );
      const dispose = renderer.render(() => (
        <s.Show when={show()}>
          <view ref={el} onDestroy={onDestroy} />
        </s.Show>
      ));
      const destroySpy = v.vi.spyOn(core, 'destroySlot');
      const slot = el.slot;

      setShow(false);
      await settle();
      v.expect(onDestroy).toHaveBeenCalledTimes(1);
      v.expect(destroyedTimes(destroySpy, slot)).toBe(0);

      finishExit();
      await settle();
      v.expect(destroyedTimes(destroySpy, slot)).toBe(1);
      dispose();
    },
  );

  v.test(
    'an exit animation finishes before the renderer node is destroyed (Destroy.tsx animateOut)',
    async () => {
      const [show, setShow] = s.createSignal(true);
      let el!: lng.ElementNode;
      const animateOut = (node: lng.ElementNode) =>
        node
          .animate({ y: 200, alpha: 0 }, { duration: 30 })
          .start()
          .waitUntilStopped();
      const dispose = renderer.render(() => (
        <s.Show when={show()}>
          <view ref={el} width={10} height={10} onDestroy={animateOut} />
        </s.Show>
      ));
      const slot = el.slot;
      // Where it is drawn at destroy: still linked under its parent (the
      // root), so the exit animation is seen.
      let atDestroy: { y: number; alpha: number; parent: number } | undefined;
      const destroySlot = core.destroySlot.bind(core);
      v.vi.spyOn(core, 'destroySlot').mockImplementation((id) => {
        if (id === slot) {
          const node = rec(el, slot);
          atDestroy = { y: node.y, alpha: node.alpha, parent: node.parent };
        }
        destroySlot(id);
      });

      setShow(false);
      await frames(() => v.expect(atDestroy).toBeDefined());
      v.expect(atDestroy).toEqual({
        y: 200,
        alpha: 0,
        parent: renderer.rootNode.slot,
      });
      dispose();
    },
  );
});

v.describe('Nodes: onEvent={{ loaded }}', () => {
  v.test(
    'a text fires loaded with (node, payload) once the core lays it out',
    async () => {
      let el!: lng.ElementNode;
      const loaded = v.vi.fn();
      const dispose = renderer.render(() => (
        <text ref={el} onEvent={{ loaded }}>
          Hello
        </text>
      ));

      await frames(() => v.expect(loaded).toHaveBeenCalled());
      v.expect(loaded.mock.contexts[0]).toBe(el);
      const [target, payload] = loaded.mock.calls[0]!;
      v.expect(target).toBe(el);
      // renderer 2.1: the dimensions are width and height (1.x: w and h).
      v.expect(payload).toMatchObject({
        type: 'text',
        dimensions: {
          width: v.expect.any(Number),
          height: v.expect.any(Number),
        },
      });
      dispose();
    },
  );

  v.test('an image view fires loaded and failed from its texture', () => {
    let el!: lng.ElementNode;
    let broken!: lng.ElementNode;
    const loaded = v.vi.fn();
    const failed = v.vi.fn();
    const dispose = renderer.render(() => (
      <view>
        <view
          ref={el}
          src="contract-loads.png"
          width={10}
          height={10}
          onEvent={{ loaded, failed }}
        />
        <view
          ref={broken}
          src="contract-fails.png"
          width={10}
          height={10}
          onEvent={{ loaded, failed }}
        />
      </view>
    ));

    // The headless core's loader and uploader are the test: one image
    // loads and uploads, the other fails for good (headless: no retry).
    tick();
    const textures = core.textures;
    for (let r = textures.nextQueued(); r !== NULL; r = textures.nextQueued()) {
      if (String(textures.keys[r]).indexOf('contract-fails') !== -1) {
        textures.failed(r, new Error('404'));
      } else {
        textures.decoded(r, {}, 10, 10, false);
        textures.nextDecoded();
        textures.uploaded(r, 400);
      }
    }
    core.events.flush();
    core.events.flush();
    tick();

    v.expect(loaded).toHaveBeenCalledTimes(1);
    v.expect(loaded.mock.contexts[0]).toBe(el);
    v.expect(loaded.mock.calls[0]![0]).toBe(el);
    v.expect(loaded.mock.calls[0]![1]).toMatchObject({ type: 'texture' });

    v.expect(failed).toHaveBeenCalledTimes(1);
    v.expect(failed.mock.calls[0]![0]).toBe(broken);
    v.expect(failed.mock.calls[0]![1]).toMatchObject({ type: 'texture' });
    dispose();
  });

  v.test('every onEvent entry listens on the renderer node', () => {
    let el!: lng.ElementNode;
    const inViewport = v.vi.fn();
    const dispose = renderer.render(() => (
      <view ref={el} onEvent={{ inViewport }} />
    ));

    const payload = { previous: 0, current: 8 };
    // The core delivers its events to the node's listeners.
    core.events.queue(el, 'inViewport', payload);
    core.events.flush();
    v.expect(inViewport).toHaveBeenCalledTimes(1);
    v.expect(inViewport.mock.contexts[0]).toBe(el);
    v.expect(inViewport.mock.calls[0]).toEqual([el, payload]);
    dispose();
  });
});

v.describe('Nodes: onAnimation={{ animating, stopped }}', () => {
  v.test(
    'a transition calls animating at once and stopped after its duration',
    async () => {
      const [x, setX] = s.createSignal(0);
      let el!: lng.ElementNode;
      const animating = v.vi.fn();
      const stopped = v.vi.fn();
      const dispose = renderer.render(() => (
        <view
          ref={el}
          x={x()}
          width={10}
          height={10}
          transition={{ x: { duration: 30 } }}
          onAnimation={{ animating, stopped }}
        />
      ));

      // The first value is set before render: no transition, no callbacks.
      v.expect(animating).not.toHaveBeenCalled();

      setX(100);
      s.flush();
      v.expect(animating).toHaveBeenCalledTimes(1);
      v.expect(animating.mock.contexts[0]).toBe(el);
      v.expect(animating.mock.calls[0]).toEqual(['x', 100]);
      v.expect(stopped).not.toHaveBeenCalled();

      // `stopped` is a timer for duration + delay, not the animation's own end.
      await frames(() => v.expect(stopped).toHaveBeenCalledTimes(1));
      v.expect(stopped.mock.contexts[0]).toBe(el);
      v.expect(stopped.mock.calls[0]).toEqual(['x', 100]);

      await frames(() => v.expect(rec(el).x).toBe(100));
      dispose();
    },
  );

  v.test(
    'el.animate() does not call onAnimation (demo app Transitions.tsx)',
    async () => {
      let el!: lng.ElementNode;
      const animating = v.vi.fn();
      const stopped = v.vi.fn();
      const dispose = renderer.render(() => (
        <view ref={el} x={0} onAnimation={{ animating, stopped }} />
      ));

      await drive(
        el.animate({ x: 50 }, { duration: 10 }).start().waitUntilStopped(),
      );
      await settle();
      v.expect(rec(el).x).toBe(50);
      v.expect(animating).not.toHaveBeenCalled();
      v.expect(stopped).not.toHaveBeenCalled();
      dispose();
    },
  );
});

v.describe('Nodes: insertChild ordering with a before anchor', () => {
  v.test('<Show> in the middle inserts before its next sibling', async () => {
    const [show, setShow] = s.createSignal(false);
    let parent!: lng.ElementNode;
    const dispose = renderer.render(() => (
      <view ref={parent} display="flex" width={1000} height={10}>
        <view id="first" width={10} height={10} />
        <s.Show when={show()}>
          <view id="middle" width={10} height={10} />
        </s.Show>
        <view id="last" width={10} height={10} />
      </view>
    ));
    await settle();
    // A falsy <Show> between siblings leaves an empty text placeholder.
    v.expect(ids(parent)).toEqual(['first', '#text', 'last']);
    v.expect(xs(parent)).toEqual([0, 10]);

    setShow(true);
    await settle();
    v.expect(ids(parent)).toEqual(['first', 'middle', 'last']);
    v.expect(xs(parent)).toEqual([0, 10, 20]);

    setShow(false);
    await settle();
    v.expect(ids(parent)).toEqual(['first', '#text', 'last']);
    v.expect(xs(parent)).toEqual([0, 10]);
    dispose();
  });

  v.test(
    '<For> between siblings: insert in the middle, reorder, remove',
    async () => {
      const [items, setItems] = s.createSignal(['a', 'c']);
      let parent!: lng.ElementNode;
      const destroyed: string[] = [];
      const onDestroy = function (this: lng.ElementNode) {
        destroyed.push(this.id!);
      };
      const dispose = renderer.render(() => (
        <view ref={parent} display="flex" width={1000} height={10}>
          <view id="head" width={10} height={10} />
          <s.For each={items()}>
            {(id) => (
              <view id={id} width={10} height={10} onDestroy={onDestroy} />
            )}
          </s.For>
          <view id="tail" width={10} height={10} />
        </view>
      ));
      await settle();
      v.expect(ids(parent)).toEqual(['head', 'a', 'c', 'tail']);
      const a = parent.getChildById('a')!;
      const c = parent.getChildById('c')!;

      setItems(['a', 'b', 'c']);
      await settle();
      v.expect(ids(parent)).toEqual(['head', 'a', 'b', 'c', 'tail']);
      v.expect(xs(parent)).toEqual([0, 10, 20, 30, 40]);

      setItems(['c', 'b', 'a']);
      await settle();
      v.expect(ids(parent)).toEqual(['head', 'c', 'b', 'a', 'tail']);
      v.expect(xs(parent)).toEqual([0, 10, 20, 30, 40]);
      // Moved, not re-created: same elements, nothing destroyed.
      v.expect(parent.getChildById('a')).toBe(a);
      v.expect(parent.getChildById('c')).toBe(c);
      v.expect(destroyed).toEqual([]);

      setItems(['b']);
      await settle();
      v.expect(ids(parent)).toEqual(['head', 'b', 'tail']);
      v.expect(xs(parent)).toEqual([0, 10, 20]);
      v.expect(destroyed.sort()).toEqual(['a', 'c']);
      dispose();
    },
  );

  v.test('insertChild(node, before) called directly', () => {
    const parent = new lng.ElementNode(core, lng.NodeType.Element);
    const [a, b, c, d] = ['a', 'b', 'c', 'd'].map((id) => {
      const n = new lng.ElementNode(core, lng.NodeType.Element);
      n.id = id;
      return n;
    }) as [lng.ElementNode, lng.ElementNode, lng.ElementNode, lng.ElementNode];

    parent.insertChild(a);
    parent.insertChild(c);
    parent.insertChild(b, c);
    v.expect(ids(parent)).toEqual(['a', 'b', 'c']);
    v.expect(b.parent).toBe(parent);

    // Moving a child before another one (DOM insertBefore semantics).
    parent.insertChild(a, c);
    v.expect(ids(parent)).toEqual(['b', 'a', 'c']);

    // An anchor that is not a child appends.
    parent.insertChild(d, new lng.ElementNode(core, lng.NodeType.Element));
    v.expect(ids(parent)).toEqual(['b', 'a', 'c', 'd']);
  });
});
