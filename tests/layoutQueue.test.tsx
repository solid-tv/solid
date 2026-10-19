/**
 * The layout queue and the post-mutation scheduler (1.8's design 3.4.4, 3.5;
 * spec 5.7 item 2).
 *
 * Within one post-mutation run, flex containers are laid out deepest first,
 * each at most once unless a child's size changed after its pass; a
 * container queues its parent only when its own size changed. The run is
 * scheduled as a microtask; only a `loaded` handler (an autosize node's, or
 * a text's while its font loads: Solid measures text itself) also asks the
 * renderer to run it inside the frame, between its walks
 * (`core.reprocessUpdates`).
 *
 * The `loaded` cases use an autosize view (tests/contract-text.test.tsx has
 * the text cases): the core delivers `loaded` to the node's listeners
 * (`core.events`), after the test resized the node as the renderer would.
 *
 * Headless RendererCore (tests/setup.ts) with the Box font: at fontSize 12.5
 * every letter advances 10 and lineHeight 20 gives 20 px lines (`MOCK`), the
 * numbers of 1.8's DOM measure mock (10 px per character, 20 px per line).
 * 1.8 wrapped writes in `batch`; Solid 2.0 batches every write until
 * `flush()`.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import * as s from 'solid-js';
import * as lng from '@solidtv/solid';
import { core, renderer } from './setup.js';

/** Box at 10 px per letter and 20 px lines. */
const MOCK = { fontSize: 12.5, lineHeight: 20 };

afterEach(() => {
  vi.restoreAllMocks();
});

/** After every microtask: the text measure and the layout pass. */
const settle = () => new Promise<void>((r) => setTimeout(r, 0));

/** The core delivers `loaded` to `el`'s listeners (between frames). */
function loaded(el: lng.ElementNode, width: number, height: number) {
  core.events.queue(el, 'loaded', {
    type: 'texture',
    dimensions: { width, height },
  });
  core.events.flush();
}

describe('layout queue', () => {
  it('a press that changes texts in three nested flex containers lays each container out once, deepest first', async () => {
    const [title, setTitle] = s.createSignal('Title');
    const [a, setA] = s.createSignal('A');
    const [b, setB] = s.createSignal('B');
    const [c, setC] = s.createSignal('C');
    const passes: string[] = [];
    let outer!: lng.ElementNode;
    let middle!: lng.ElementNode;
    let inner!: lng.ElementNode;
    let tA!: lng.ElementNode;
    let tC!: lng.ElementNode;
    const dispose = renderer.render(() => (
      <view
        ref={outer}
        display="flex"
        flexDirection="column"
        gap={10}
        onLayout={() => void passes.push('outer')}
      >
        <text {...MOCK}>{title()}</text>
        <view
          ref={middle}
          display="flex"
          gap={10}
          onLayout={() => void passes.push('middle')}
        >
          <text ref={tA} {...MOCK}>
            {a()}
          </text>
          <view
            ref={inner}
            display="flex"
            gap={10}
            onLayout={() => void passes.push('inner')}
          >
            <text {...MOCK}>{b()}</text>
            <text ref={tC} {...MOCK}>
              {c()}
            </text>
          </view>
        </view>
      </view>
    ));
    await settle();
    passes.length = 0;

    setTitle('A longer title');
    setA('AAAA');
    setB('BBBBBB');
    setC('CC');
    s.flush();
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

    setDeep(true);
    setShallow(true);
    s.flush();
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

    loaded(t, 50, 20);
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

    t.setNow('width', 80);
    loaded(t, 80, 20);
    expect(count).toBe(0); // not synchronously
    await settle();
    expect(count).toBe(1);
    expect(last.x).toBe(90);
    dispose();
  });
});

describe('layout queue: more cases', () => {
  /** Holds the queued microtasks (the pass's, Solid's) so a test runs them. */
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
              s.flush();
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
      // One post-mutation run: what the render queued (the pass, and
      // whatever Solid queued), not what that run queues.
      const queued = hold.held.splice(0);
      for (const fn of queued) fn();
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
    t.preserve = true; // kept after removal, so its listeners still hear
    setShow(false);
    s.flush();
    await settle();
    expect(last.x).toBe(0);

    t.setNow('width', 90);
    expect(() => loaded(t, 90, 20)).not.toThrow();
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
      s.flush();
      await settle();
      expect(errors).toHaveLength(1);

      setMore(true); // a later run lays out
      s.flush();
      await settle();
      expect(errors).toHaveLength(1);
      expect(added.x).toBe(0);
      expect(last.x).toBe(30);
    } finally {
      globalThis.queueMicrotask = saved;
    }
    dispose();
  });

  it('an onLayout that throws leaves the containers queued after it to a later run that queues no layout', async () => {
    const [more, setMore] = s.createSignal(false);
    let throwOnce = false;
    let added!: lng.ElementNode;
    let last!: lng.ElementNode;
    const dispose = renderer.render(() => (
      <view display="flex">
        <view
          display="flex"
          flexBoundary="fixed"
          width={100}
          height={50}
          onLayout={() => {
            if (throwOnce) {
              throwOnce = false;
              throw new Error('onLayout failed');
            }
          }}
        >
          <view width={10} height={10} />
          <s.Show when={more()}>
            <view width={10} height={10} />
          </s.Show>
        </view>
        <s.Show when={more()}>
          <view ref={added} width={30} height={50} />
        </s.Show>
        <view ref={last} width={50} height={50} />
      </view>
    ));
    await settle();
    expect(last.x).toBe(100);

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
      // Both containers queued: the inner one runs first and throws.
      throwOnce = true;
      setMore(true);
      s.flush();
      await settle();
      expect(errors).toHaveLength(1);
      expect(last.x).toBe(100);

      // A run for focus alone lays out what the first one left.
      last.setFocus();
      await settle();
      expect(errors).toHaveLength(1);
      expect(added.x).toBe(100);
      expect(last.x).toBe(130);
    } finally {
      globalThis.queueMicrotask = saved;
    }
    dispose();
  });
});

describe('post-mutation scheduling', () => {
  it('a mutation runs the post-mutation pass as a microtask, not in the renderer frame; a loaded handler asks for the frame', async () => {
    const reprocess = vi
      .spyOn(core, 'reprocessUpdates')
      .mockImplementation(() => {});
    let t!: lng.ElementNode;
    let last!: lng.ElementNode;
    const dispose = renderer.render(() => (
      <view display="flex" gap={10}>
        <text {...MOCK}>Hi</text>
        <view ref={t} autosize width={50} height={20} />
        <view ref={last} width={50} height={50} />
      </view>
    ));
    await settle();
    expect(last.x).toBe(90); // 20 + 10 + 50 + 10
    // A text measured by Solid needs no frame either.
    expect(reprocess).not.toHaveBeenCalled();

    t.setNow('width', 80);
    loaded(t, 80, 20);
    expect(reprocess).toHaveBeenCalledTimes(1);
    const cb = reprocess.mock.calls[0]![0];
    expect(typeof cb).toBe('function');
    // The renderer runs the callback between its walks: the layout lands
    // in the same frame.
    cb!();
    expect(last.x).toBe(120); // 20 + 10 + 80 + 10
    dispose();
  });
});

describe('text measurement in the layout phase', () => {
  it('stops re-measuring after 16 sweeps of texts that never settle, warns once, and leaves later runs working', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let passes = 0;
    let t!: lng.ElementNode;
    let toggle = false;
    let looping = true;
    const dispose = renderer.render(() => (
      <view
        display="flex"
        gap={10}
        onLayout={() => {
          passes++;
          if (!looping) return;
          // A layout that changes the size of a text it lays out: never settles.
          toggle = !toggle;
          t.text = toggle ? 'Hello world' : 'Hi';
        }}
      >
        <text ref={t} {...MOCK}>
          Hello
        </text>
        <view width={50} height={50} />
      </view>
    ));
    // One post-mutation run.
    for (let i = 0; i < 5; i++) await Promise.resolve();
    // The first pass, then one per sweep: 16 more; then it stops.
    expect(passes).toBe(17);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain('did not settle');
    looping = false;
    await settle();
    dispose();
    await settle();

    // Later runs lay out.
    let next!: lng.ElementNode;
    const dispose2 = renderer.render(() => (
      <view display="flex" gap={10}>
        <text {...MOCK}>Hello</text>
        <view ref={next} width={50} height={50} />
      </view>
    ));
    await settle();
    expect(next.x).toBe(60);
    dispose2();
  });

  it('a measure that throws does not stop later post-mutation runs', async () => {
    const [label, setLabel] = s.createSignal('Hello');
    let last!: lng.ElementNode;
    const dispose = renderer.render(() => (
      <view display="flex" gap={10}>
        <text {...MOCK}>{label()}</text>
        <view ref={last} width={50} height={50} />
      </view>
    ));
    await settle();
    expect(last.x).toBe(60);

    const textNodes = core.textNodes;
    const measure = textNodes.measure;
    let throws = true;
    const spy = vi.spyOn(textNodes, 'measure').mockImplementation((id) => {
      if (throws) {
        throws = false;
        throw new Error('measure failed');
      }
      return measure.call(textNodes, id);
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
      s.flush();
      await settle();
      expect(errors).toHaveLength(1);

      setLabel('Hi'); // a later run measures and lays out
      s.flush();
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
