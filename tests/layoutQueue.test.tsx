/**
 * The layout queue and the post-mutation scheduler (design 3.4.4, 3.5).
 *
 * Within one post-mutation run, flex containers are laid out deepest first,
 * each at most once unless a child's size changed after its pass; a
 * container queues its parent only when its own size changed. The run is
 * scheduled as a microtask; only a `loaded` handler (an autosize node's, or
 * a text's while its font loads: Solid measures text itself from 1.7) also
 * asks the renderer to run it inside the frame, between its walks.
 *
 * The `loaded` cases use an autosize view: until stream T a text's size
 * reached flex through `loaded` too (tests/contract-text.test.tsx has the
 * text cases now).
 *
 * DOM renderer (jsdom) with the text measurement mocked as in
 * contract-text.test.tsx: 10px per character, 20px per line.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import * as s from 'solid-js';
import * as lng from '@solidtv/solid';
import { renderer } from './setup.js';

const CHAR_W = 10;
const LINE_H = 20;

function mockTextMeasure() {
  return vi
    .spyOn(Element.prototype, 'getBoundingClientRect')
    .mockImplementation(function (this: Element) {
      const text = (
        this as unknown as { _node?: { props?: { text?: unknown } } }
      )._node?.props?.text;
      const isText = typeof text === 'string';
      const width = isText ? text.length * CHAR_W : 0;
      const height = isText ? LINE_H : 0;
      return {
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: width,
        bottom: height,
        width,
        height,
        toJSON() {},
      } as DOMRect;
    });
}

type Stage = { reprocessUpdates?: (cb?: () => void) => void };
const stage = () => lng.getRenderer().stage as unknown as Stage;
const emitter = (el: lng.ElementNode) => el.lng as unknown as lng.IEventEmitter;

afterEach(() => {
  vi.restoreAllMocks();
});

/** After every microtask: the text re-measure, `loaded` and the layout pass. */
const settle = () => new Promise<void>((r) => setTimeout(r, 0));

describe('layout queue', () => {
  it('a press that changes texts in three nested flex containers lays each container out once, deepest first', async () => {
    mockTextMeasure();
    const [title, setTitle] = s.createSignal('Title');
    const [a, setA] = s.createSignal('A');
    const [b, setB] = s.createSignal('B');
    const [c, setC] = s.createSignal('C');
    const passes: string[] = [];
    let outer!: lng.ElementNode;
    let middle!: lng.ElementNode;
    let inner!: lng.ElementNode;
    let tA!: lng.ElementNode;
    let tB!: lng.ElementNode;
    let tC!: lng.ElementNode;
    const dispose = renderer.render(() => (
      <view
        ref={outer}
        display="flex"
        flexDirection="column"
        gap={10}
        onLayout={() => void passes.push('outer')}
      >
        <text>{title()}</text>
        <view
          ref={middle}
          display="flex"
          gap={10}
          onLayout={() => void passes.push('middle')}
        >
          <text ref={tA}>{a()}</text>
          <view
            ref={inner}
            display="flex"
            gap={10}
            onLayout={() => void passes.push('inner')}
          >
            <text ref={tB}>{b()}</text>
            <text ref={tC}>{c()}</text>
          </view>
        </view>
      </view>
    ));
    await settle();
    passes.length = 0;

    s.batch(() => {
      setTitle('A longer title');
      setA('AAAA');
      setB('BBBBBB');
      setC('CC');
    });
    await settle();

    expect(passes).toEqual(['inner', 'middle', 'outer']);
    // inner: 60 + 10 + 20
    expect(tC.x).toBe(70);
    expect(inner.width).toBe(90);
    // middle: 40 + 10 + 90
    expect(tA.width).toBe(40);
    expect(inner.x).toBe(50);
    expect(middle.width).toBe(140);
    // outer (column): 20 + 10 + 20
    expect(middle.y).toBe(30);
    expect(outer.height).toBe(50);
    void tB;
    dispose();
  });

  it('a deep and a shallow container changed in one batch: the deep one first, each once', async () => {
    const [deep, setDeep] = s.createSignal(false);
    const [shallow, setShallow] = s.createSignal(false);
    const passes: string[] = [];
    let outer!: lng.ElementNode;
    let inner!: lng.ElementNode;
    let last!: lng.ElementNode;
    const dispose = renderer.render(() => (
      <view
        ref={outer}
        display="flex"
        gap={10}
        onLayout={() => void passes.push('outer')}
      >
        <view
          display="flex"
          gap={10}
          onLayout={() => void passes.push('middle')}
        >
          <view
            ref={inner}
            display="flex"
            onLayout={() => void passes.push('inner')}
          >
            <view width={50} height={50} />
            <s.Show when={deep()}>
              <view width={30} height={50} />
            </s.Show>
          </view>
        </view>
        <s.Show when={shallow()}>
          <view width={20} height={20} />
        </s.Show>
        <view ref={last} width={40} height={40} />
      </view>
    ));
    await settle();
    expect(last.x).toBe(60);
    passes.length = 0;

    s.batch(() => {
      setDeep(true);
      setShallow(true);
    });
    await settle();

    expect(passes).toEqual(['inner', 'middle', 'outer']);
    expect(inner.width).toBe(80);
    // 80 + 10 + 20 + 10
    expect(last.x).toBe(120);
    expect(outer.width).toBe(160);
    dispose();
  });

  it('a loaded event that reports an unchanged size does not lay the container out again', async () => {
    let count = 0;
    let t!: lng.ElementNode;
    let last!: lng.ElementNode;
    const dispose = renderer.render(() => (
      <view display="flex" gap={10} onLayout={() => void count++}>
        <view ref={t} autosize width={50} height={20} />
        <view ref={last} width={50} height={50} />
      </view>
    ));
    await settle();
    expect(last.x).toBe(60);
    count = 0;

    emitter(t).emit('loaded', {
      type: 'texture',
      dimensions: { w: 50, h: 20 },
    });
    await settle();
    expect(count).toBe(0);
    dispose();
  });

  it('a loaded event that reports a new size lays the container out in the post-mutation pass', async () => {
    let count = 0;
    let t!: lng.ElementNode;
    let last!: lng.ElementNode;
    const dispose = renderer.render(() => (
      <view display="flex" gap={10} onLayout={() => void count++}>
        <view ref={t} autosize width={50} height={20} />
        <view ref={last} width={50} height={50} />
      </view>
    ));
    await settle();
    count = 0;

    t.lng.w = 80;
    emitter(t).emit('loaded', {
      type: 'texture',
      dimensions: { w: 80, h: 20 },
    });
    expect(count).toBe(0); // not synchronously
    await settle();
    expect(count).toBe(1);
    expect(last.x).toBe(90);
    dispose();
  });
});

describe('layout queue: more cases', () => {
  /** Holds the post-mutation runs so a test can run them one at a time. */
  function holdMicrotasks() {
    const held: Array<() => void> = [];
    const saved = globalThis.queueMicrotask;
    globalThis.queueMicrotask = (fn: () => void) => void held.push(fn);
    return {
      held,
      restore() {
        globalThis.queueMicrotask = saved;
      },
    };
  }

  it('a deeper container queued while a shallower one runs is laid out in the same run (another sweep)', async () => {
    const [extra, setExtra] = s.createSignal(false);
    const passes: string[] = [];
    let shown = false;
    let inner!: lng.ElementNode;
    let last!: lng.ElementNode;
    const hold = holdMicrotasks();
    let dispose = () => {};
    try {
      dispose = renderer.render(() => (
        <view
          display="flex"
          gap={10}
          onLayout={() => {
            passes.push('outer');
            if (!shown) {
              shown = true;
              setExtra(true); // inserts into `inner`, which is deeper
            }
          }}
        >
          <view
            ref={inner}
            display="flex"
            onLayout={() => void passes.push('inner')}
          >
            <view width={50} height={50} />
            <s.Show when={extra()}>
              <view width={30} height={50} />
            </s.Show>
          </view>
          <view ref={last} width={40} height={40} />
        </view>
      ));
      // One post-mutation run.
      hold.held.shift()!();
      expect(passes).toEqual(['inner', 'outer', 'inner', 'outer']);
      expect(inner.width).toBe(80);
      expect(last.x).toBe(90);
    } finally {
      hold.restore();
      for (const fn of hold.held) fn();
    }
    await settle();
    dispose();
  });

  it('a loaded event on an autosize node removed from its container does not throw, and the container stays laid out', async () => {
    const [show, setShow] = s.createSignal(true);
    let t!: lng.ElementNode;
    let last!: lng.ElementNode;
    const dispose = renderer.render(() => (
      <view display="flex" gap={10}>
        <s.Show when={show()}>
          <view ref={t} autosize width={50} height={20} />
        </s.Show>
        <view ref={last} width={50} height={50} />
      </view>
    ));
    await settle();
    expect(last.x).toBe(60);
    setShow(false);
    await settle();
    expect(last.x).toBe(0);

    t.lng.w = 90;
    expect(() =>
      emitter(t).emit('loaded', {
        type: 'texture',
        dimensions: { w: 90, h: 20 },
      }),
    ).not.toThrow();
    await settle();
    expect(last.x).toBe(0);
    dispose();
  });

  it('an onDestroy that throws does not stop later post-mutation runs', async () => {
    const [show, setShow] = s.createSignal(true);
    const [more, setMore] = s.createSignal(false);
    let added!: lng.ElementNode;
    let last!: lng.ElementNode;
    const dispose = renderer.render(() => (
      <view display="flex">
        <s.Show when={show()}>
          <view
            width={50}
            height={50}
            onDestroy={() => {
              throw new Error('onDestroy failed');
            }}
          />
        </s.Show>
        <s.Show when={more()}>
          <view ref={added} width={30} height={50} />
        </s.Show>
        <view ref={last} width={50} height={50} />
      </view>
    ));
    await settle();
    expect(last.x).toBe(50);

    const errors: unknown[] = [];
    const saved = globalThis.queueMicrotask;
    globalThis.queueMicrotask = (fn: () => void) =>
      saved(() => {
        try {
          fn();
        } catch (e) {
          errors.push(e);
        }
      });
    try {
      setShow(false); // its run throws in the delete flush
      await settle();
      expect(errors).toHaveLength(1);

      setMore(true); // a later run lays out
      await settle();
      expect(errors).toHaveLength(1);
      expect(added.x).toBe(0);
      expect(last.x).toBe(30);
    } finally {
      globalThis.queueMicrotask = saved;
    }
    dispose();
  });
});

describe('post-mutation scheduling', () => {
  it('a mutation runs the post-mutation pass as a microtask, not in the renderer frame; a loaded handler asks for the frame', async () => {
    mockTextMeasure();
    const st = stage();
    const saved = st.reprocessUpdates;
    const reprocess = vi.fn();
    st.reprocessUpdates = reprocess;
    try {
      let t!: lng.ElementNode;
      let last!: lng.ElementNode;
      const dispose = renderer.render(() => (
        <view display="flex" gap={10}>
          <text>Hi</text>
          <view ref={t} autosize width={50} height={20} />
          <view ref={last} width={50} height={50} />
        </view>
      ));
      await settle();
      expect(last.x).toBe(90); // 20 + 10 + 50 + 10
      // A text measured by Solid needs no frame either (1.7, stream T).
      expect(reprocess).not.toHaveBeenCalled();

      t.lng.w = 80;
      emitter(t).emit('loaded', {
        type: 'texture',
        dimensions: { w: 80, h: 20 },
      });
      expect(reprocess).toHaveBeenCalledTimes(1);
      expect(typeof reprocess.mock.calls[0]![0]).toBe('function');
      // The renderer runs the callback between its walks: the layout lands
      // in the same frame.
      reprocess.mock.calls[0]![0]();
      expect(last.x).toBe(120); // 20 + 10 + 80 + 10
      dispose();
    } finally {
      if (saved === undefined) {
        delete st.reprocessUpdates;
      } else {
        st.reprocessUpdates = saved;
      }
    }
  });
});

describe('text measurement in the layout phase', () => {
  it('stops re-measuring after 16 sweeps of texts that never settle, warns once, and leaves later runs working', async () => {
    mockTextMeasure();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let passes = 0;
    let t!: lng.ElementNode;
    let toggle = false;
    let last!: lng.ElementNode;
    const dispose = renderer.render(() => (
      <view
        display="flex"
        gap={10}
        onLayout={() => {
          passes++;
          // A layout that changes the size of a text it lays out: never settles.
          toggle = !toggle;
          t.text = toggle ? 'Hello world' : 'Hi';
        }}
      >
        <text ref={t}>Hello</text>
        <view ref={last} width={50} height={50} />
      </view>
    ));
    // One post-mutation run (microtasks only: the DOM renderer's own
    // re-measure, on a timer, would start the loop again, as in 1.6).
    for (let i = 0; i < 5; i++) await Promise.resolve();
    // The first pass, then one per sweep: 16 more; then it stops.
    expect(passes).toBe(17);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain('did not settle');
    dispose();
    void last;

    // Later runs lay out.
    let next!: lng.ElementNode;
    const dispose2 = renderer.render(() => (
      <view display="flex" gap={10}>
        <text>Hello</text>
        <view ref={next} width={50} height={50} />
      </view>
    ));
    await settle();
    expect(next.x).toBe(60);
    dispose2();
  });

  it('a measure that throws does not stop later post-mutation runs', async () => {
    mockTextMeasure();
    const [label, setLabel] = s.createSignal('Hello');
    let t!: lng.ElementNode;
    let last!: lng.ElementNode;
    const dispose = renderer.render(() => (
      <view display="flex" gap={10}>
        <text ref={t}>{label()}</text>
        <view ref={last} width={50} height={50} />
      </view>
    ));
    await settle();
    expect(last.x).toBe(60);

    const proto = Object.getPrototypeOf(t.lng) as { measure(): boolean };
    const measure = proto.measure;
    let throws = true;
    const spy = vi.spyOn(proto, 'measure').mockImplementation(function (
      this: unknown,
    ) {
      if (throws) {
        throws = false;
        throw new Error('measure failed');
      }
      return measure.call(this);
    });
    const errors: unknown[] = [];
    const saved = globalThis.queueMicrotask;
    globalThis.queueMicrotask = (fn: () => void) =>
      saved(() => {
        try {
          fn();
        } catch (e) {
          errors.push(e);
        }
      });
    try {
      setLabel('Hello world'); // its run throws in the measure
      await settle();
      expect(errors).toHaveLength(1);

      setLabel('Hi'); // a later run measures and lays out
      await settle();
      expect(errors).toHaveLength(1);
      expect(last.x).toBe(30);
    } finally {
      globalThis.queueMicrotask = saved;
      spy.mockRestore();
    }
    dispose();
  });
});
