// Phase 1 contract: focus. Pins the behaviour of arm B (solid 1.6.4 + renderer
// v2 lockstep) that apps depend on: activeElement, focusPath, setFocus(),
// forwardFocus, skipFocus, autofocus, the focus state, and the order in which
// onFocus / onBlur / onFocusChanged fire. Behavioural only: handler call
// order, return values and public props/state, never underscore fields.
import * as v from 'vitest';
import { createEffect, createRoot, createSignal, on } from 'solid-js';
import {
  Config,
  type ElementNode,
  activeElement as coreActiveElement,
  setActiveElement,
  setActiveElementCore,
} from '@solidtv/solid';
import { activeElement, focusPath, Row } from '@solidtv/solid/primitives';
import { flush, mount, recorder } from './contract-focus-helpers.js';
import { renderer } from './setup.js';

// useFocusManager rebinds Config.setActiveElement on every mount; put back
// whatever the worker had before this file ran.
const savedSetActiveElement = Config.setActiveElement;
v.afterAll(() => {
  Config.setActiveElement = savedSetActiveElement;
});

type TreeIds = 'G' | 'P1' | 'A' | 'B' | 'P2' | 'C';

/** Records onFocus / onBlur / onFocusChanged(hasFocus) per node id. */
function focusLog() {
  const r = recorder();
  const spies = (owner: TreeIds) => ({
    onFocus: r.handler('onFocus', undefined, owner),
    onBlur: r.handler('onBlur', undefined, owner),
    onFocusChanged: r.handler('onFocusChanged', undefined, owner),
  });
  const order = () =>
    r.calls.map((c) =>
      c.handler === 'onFocusChanged'
        ? `${c.node}.onFocusChanged(${String(c.args[0])})`
        : `${c.node}.${c.handler}`,
    );
  return { ...r, spies, order };
}

//        G
//      /   \
//     P1    P2
//    /  \    \
//   A    B    C       (A autofocused)
async function mountTree() {
  const log = focusLog();
  const n = {} as Record<TreeIds, ElementNode>;
  const { target, dispose } = await mount(() => (
    <view id="G" ref={n.G} {...log.spies('G')}>
      <view id="P1" ref={n.P1} {...log.spies('P1')}>
        <view id="A" ref={n.A} autofocus {...log.spies('A')} />
        <view id="B" ref={n.B} {...log.spies('B')} />
      </view>
      <view id="P2" ref={n.P2} {...log.spies('P2')}>
        <view id="C" ref={n.C} {...log.spies('C')} />
      </view>
    </view>
  ));
  return { log, n, target, dispose };
}

// states.has() is typed to take `$`-prefixed names only, but app code (and
// the contract) also calls it without the `$`: has('focus') matches '$focus'.
const hasFocusState = (el: ElementNode) =>
  el.states.has('focus' as `$${string}`);

async function focus(elm: ElementNode) {
  elm.setFocus();
  await flush();
}

v.describe('contract: onFocus / onBlur / onFocusChanged order', () => {
  // Contract: "Keep the order in which onFocus, onBlur and onFocusChanged fire."
  v.it(
    'initial focus fires onFocus then onFocusChanged(true), leaf to root',
    async () => {
      const { log, n, dispose } = await mountTree();
      v.expect(activeElement()).toBe(n.A);
      v.expect(log.order()).toEqual([
        'A.onFocus',
        'A.onFocusChanged(true)',
        'P1.onFocus',
        'P1.onFocusChanged(true)',
        'G.onFocus',
        'G.onFocusChanged(true)',
      ]);
      dispose();
    },
  );

  v.it(
    'siblings: new leaf gains focus first, then the old leaf blurs; shared parent gets nothing',
    async () => {
      const { log, n, dispose } = await mountTree();
      log.clear();
      await focus(n.B);
      // Current behaviour: every gain fires before any loss.
      v.expect(log.order()).toEqual([
        'B.onFocus',
        'B.onFocusChanged(true)',
        'A.onBlur',
        'A.onFocusChanged(false)',
      ]);
      dispose();
    },
  );

  v.it(
    'cousins: gains leaf→root up to the common ancestor, then losses old-leaf→root; common ancestor gets nothing',
    async () => {
      const { log, n, dispose } = await mountTree();
      await focus(n.B);
      log.clear();
      await focus(n.C);
      v.expect(log.order()).toEqual([
        'C.onFocus',
        'C.onFocusChanged(true)',
        'P2.onFocus',
        'P2.onFocusChanged(true)',
        'B.onBlur',
        'B.onFocusChanged(false)',
        'P1.onBlur',
        'P1.onFocusChanged(false)',
      ]);
      dispose();
    },
  );

  v.it(
    'parent → child: only the child fires (onFocus, onFocusChanged(true)); the parent keeps focus-within silently',
    async () => {
      const { log, n, dispose } = await mountTree();
      await focus(n.P2);
      log.clear();
      await focus(n.C);
      v.expect(log.order()).toEqual(['C.onFocus', 'C.onFocusChanged(true)']);
      dispose();
    },
  );

  v.it(
    'child → parent: the parent fires onFocus + onFocusChanged(true) again although it already had focus-within, then the child blurs',
    async () => {
      const { log, n, dispose } = await mountTree();
      await focus(n.C);
      log.clear();
      await focus(n.P2);
      // Current behaviour: the new leaf always gets onFocus/onFocusChanged(true),
      // even when its focus-within state did not change.
      v.expect(log.order()).toEqual([
        'P2.onFocus',
        'P2.onFocusChanged(true)',
        'C.onBlur',
        'C.onFocusChanged(false)',
      ]);
      dispose();
    },
  );

  v.it(
    'descendant → ancestor two levels up: ancestor re-fires as the leaf, then the old path blurs old-leaf→root',
    async () => {
      const { log, n, dispose } = await mountTree();
      log.clear();
      await focus(n.G);
      v.expect(log.order()).toEqual([
        'G.onFocus',
        'G.onFocusChanged(true)',
        'A.onBlur',
        'A.onFocusChanged(false)',
        'P1.onBlur',
        'P1.onFocusChanged(false)',
      ]);
      dispose();
    },
  );

  v.it(
    'passes (currentFocusedElm, prevFocusedElm, node) with this = node; onFocusChanged gets hasFocus first',
    async () => {
      const { log, n, dispose } = await mountTree();
      await focus(n.B);
      log.clear();
      await focus(n.C);
      const byKey = new Map(
        log.calls.map((c) => [`${c.node}.${c.handler}`, c] as const),
      );
      v.expect(byKey.get('C.onFocus')!.args).toEqual([n.C, n.B, n.C]);
      v.expect(byKey.get('P2.onFocus')!.args).toEqual([n.C, n.B, n.P2]);
      v.expect(byKey.get('P2.onFocusChanged')!.args).toEqual([
        true,
        n.C,
        n.B,
        n.P2,
      ]);
      v.expect(byKey.get('B.onBlur')!.args).toEqual([n.C, n.B, n.B]);
      v.expect(byKey.get('P1.onBlur')!.args).toEqual([n.C, n.B, n.P1]);
      v.expect(byKey.get('P1.onFocusChanged')!.args).toEqual([
        false,
        n.C,
        n.B,
        n.P1,
      ]);
      // this = the node the callback is set on, for every call.
      v.expect(log.calls.length).toBe(8);
      for (const c of log.calls) v.expect(c.self).toBe(n[c.owner as TreeIds]);
      dispose();
    },
  );

  v.it(
    'callbacks run before activeElement / focusPath publish the change (current behaviour)',
    async () => {
      const { n, dispose } = await mountTree();
      const seen: unknown[] = [];
      n.B.onFocus = function () {
        seen.push([
          'B.onFocus',
          activeElement() === n.A,
          focusPath()[0] === n.A,
        ]);
      };
      n.A.onBlur = function () {
        seen.push([
          'A.onBlur',
          activeElement() === n.A,
          focusPath()[0] === n.A,
        ]);
      };
      const publish = Config.setActiveElement;
      Config.setActiveElement = (elm) => {
        seen.push(['Config.setActiveElement', elm === n.B]);
        publish(elm);
      };
      await focus(n.B);
      Config.setActiveElement = publish;
      // Inside onFocus/onBlur, activeElement() and focusPath() still describe
      // the previous focus; Config.setActiveElement is called last.
      v.expect(seen).toEqual([
        ['B.onFocus', true, true],
        ['A.onBlur', true, true],
        ['Config.setActiveElement', true],
      ]);
      v.expect(activeElement()).toBe(n.B);
      dispose();
    },
  );

  // Changed in 1.7 (decision 5.1, MIGRATION 2.1): the focus phase runs in one
  // batch. Before, each signal write in a focus callback flushed on its own,
  // so this effect ran twice, in between the callbacks.
  v.it(
    'signals written in onFocus and onFocusChanged drive one effect run per focus change, after the last callback',
    async () => {
      const [a, setA] = createSignal(0);
      const [b, setB] = createSignal(0);
      const log: string[] = [];
      const n = {} as Record<'A' | 'B', ElementNode>;
      const { dispose } = await mount(() => {
        createEffect(
          on([a, b], ([x, y]) => log.push(`effect ${x},${y}`), {
            defer: true,
          }),
        );
        return (
          <view id="P">
            <view
              id="A"
              ref={n.A}
              autofocus
              onBlur={() => log.push('A.onBlur')}
            />
            <view
              id="B"
              ref={n.B}
              onFocus={() => {
                log.push('B.onFocus');
                setA(a() + 1);
              }}
              onFocusChanged={() => {
                log.push('B.onFocusChanged');
                setB(b() + 1);
              }}
            />
          </view>
        );
      });
      log.length = 0;
      await focus(n.B);
      v.expect(log).toEqual([
        'B.onFocus',
        'B.onFocusChanged',
        'A.onBlur',
        'effect 1,1',
      ]);
      dispose();
    },
  );

  v.it(
    "setActiveElementCore called from an ancestor's onFocus: the inner change runs whole, then the outer one finishes and wins (current behaviour)",
    async () => {
      const { log, n, dispose } = await mountTree();
      await focus(n.C);
      log.clear();
      let nested = false;
      n.P1.onFocus = function () {
        log.calls.push({
          node: 'P1',
          owner: 'P1',
          handler: 'onFocus',
          self: this,
          args: [],
        });
        if (!nested) {
          nested = true;
          setActiveElementCore(n.A);
        }
      };
      await focus(n.B);
      v.expect(log.order()).toEqual([
        'B.onFocus',
        'B.onFocusChanged(true)',
        'P1.onFocus',
        'A.onFocus',
        'A.onFocusChanged(true)',
        'C.onBlur',
        'C.onFocusChanged(false)',
        'P2.onBlur',
        'P2.onFocusChanged(false)',
        'P1.onFocusChanged(true)',
        'A.onBlur',
        'A.onFocusChanged(false)',
      ]);
      v.expect(activeElement()).toBe(n.B);
      v.expect(focusPath()).toEqual([n.B, n.P1, n.G, renderer.rootNode]);
      for (const id of ['B', 'P1', 'G'] as const) {
        v.expect(hasFocusState(n[id]), id).toBe(true);
      }
      for (const id of ['A', 'C', 'P2'] as const) {
        v.expect(hasFocusState(n[id]), id).toBe(false);
      }
      dispose();
    },
  );
});

v.describe('contract: focus state', () => {
  // Contract: the focused node (and its ancestors) carry the focus state;
  // states.has('focus') matches '$focus'.
  v.it(
    'the focused node and every ancestor have the focus state; nodes off the path do not',
    async () => {
      const { n, dispose } = await mountTree();
      for (const id of ['A', 'P1', 'G'] as const) {
        v.expect(hasFocusState(n[id]), id).toBe(true);
        v.expect(n[id].states.has('$focus'), id).toBe(true);
      }
      for (const id of ['B', 'P2', 'C'] as const) {
        v.expect(hasFocusState(n[id]), id).toBe(false);
      }
      v.expect(Config.focusStateKey).toBe('$focus');
      dispose();
    },
  );

  v.it(
    'moving focus removes the state from nodes that left the path and keeps it on the common ancestor',
    async () => {
      const { n, dispose } = await mountTree();
      await focus(n.C);
      v.expect(hasFocusState(n.C)).toBe(true);
      v.expect(hasFocusState(n.P2)).toBe(true);
      v.expect(hasFocusState(n.G)).toBe(true);
      v.expect(hasFocusState(n.A)).toBe(false);
      v.expect(hasFocusState(n.P1)).toBe(false);
      dispose();
    },
  );

  v.it(
    'the state is added before onFocus runs and removed before onBlur runs',
    async () => {
      const { n, dispose } = await mountTree();
      const seen: unknown[] = [];
      n.B.onFocus = function () {
        seen.push(['B.onFocus', hasFocusState(this)]);
      };
      n.A.onBlur = function () {
        seen.push(['A.onBlur', hasFocusState(this)]);
      };
      await focus(n.B);
      v.expect(seen).toEqual([
        ['B.onFocus', true],
        ['A.onBlur', false],
      ]);
      dispose();
    },
  );
});

v.describe('contract: activeElement', () => {
  // Contract: "activeElement works both as a signal and as a function call."
  v.it('a plain call returns the focused node', async () => {
    const { n, dispose } = await mountTree();
    v.expect(activeElement()).toBe(n.A);
    await focus(n.C);
    v.expect(activeElement()).toBe(n.C);
    dispose();
  });

  v.it(
    'it is a Solid signal: effects tracking it (createEffect, on()) re-run on each change',
    async () => {
      const { n, dispose } = await mountTree();
      const viaOn: unknown[] = [];
      const viaEffect: unknown[] = [];
      const disposeRoot = createRoot((d) => {
        createEffect(
          on(activeElement, (elm) => viaOn.push(elm), { defer: true }),
        );
        createEffect(() => viaEffect.push(activeElement()));
        return d;
      });
      await flush();
      await focus(n.B);
      await focus(n.C);
      v.expect(viaOn).toEqual([n.B, n.C]);
      v.expect(viaEffect).toEqual([n.A, n.B, n.C]);
      disposeRoot();
      dispose();
    },
  );

  v.it(
    '@solidtv/solid and @solidtv/solid/primitives export the same accessor',
    () => {
      v.expect(coreActiveElement).toBe(activeElement);
    },
  );

  v.it(
    'setFocus() on the active element does nothing (no callbacks)',
    async () => {
      const { log, n, dispose } = await mountTree();
      log.clear();
      await focus(n.A);
      v.expect(log.order()).toEqual([]);
      v.expect(activeElement()).toBe(n.A);
      dispose();
    },
  );

  v.it(
    'the exported setActiveElement is the raw signal setter: it does not move focus state, fire callbacks or change focusPath (current behaviour)',
    async () => {
      const { log, n, dispose } = await mountTree();
      const before = focusPath();
      log.clear();
      setActiveElement(n.C);
      await flush();
      v.expect(activeElement()).toBe(n.C);
      v.expect(hasFocusState(n.C)).toBe(false);
      v.expect(hasFocusState(n.A)).toBe(true);
      v.expect(focusPath()).toBe(before);
      v.expect(log.order()).toEqual([]);
      setActiveElement(n.A);
      dispose();
    },
  );
});

v.describe('contract: focusPath', () => {
  v.it(
    'focusPath() lists the focused leaf first, then each ancestor, ending at the root node',
    async () => {
      const { n, dispose } = await mountTree();
      v.expect(focusPath()).toEqual([n.A, n.P1, n.G, renderer.rootNode]);
      await focus(n.C);
      v.expect(focusPath()).toEqual([n.C, n.P2, n.G, renderer.rootNode]);
      dispose();
    },
  );

  v.it('focusPath is a signal: effects re-run with the new path', async () => {
    const { n, dispose } = await mountTree();
    const leaves: unknown[] = [];
    const disposeRoot = createRoot((d) => {
      createEffect(on(focusPath, (fp) => leaves.push(fp[0]), { defer: true }));
      return d;
    });
    await focus(n.B);
    await focus(n.P2);
    v.expect(leaves).toEqual([n.B, n.P2]);
    disposeRoot();
    dispose();
  });
});

v.describe('contract: setFocus()', () => {
  v.it(
    'applies focus asynchronously: activeElement changes after a microtask, not during the call (current behaviour)',
    async () => {
      const { log, n, dispose } = await mountTree();
      log.clear();
      n.B.setFocus();
      v.expect(activeElement()).toBe(n.A);
      v.expect(log.order()).toEqual([]);
      await flush();
      v.expect(activeElement()).toBe(n.B);
      dispose();
    },
  );

  v.it(
    'several setFocus() calls in one tick: only the last one takes effect',
    async () => {
      const { log, n, dispose } = await mountTree();
      log.clear();
      n.B.setFocus();
      n.C.setFocus();
      await flush();
      v.expect(activeElement()).toBe(n.C);
      v.expect(log.order()).not.toContain('B.onFocus');
      v.expect(log.order()).toContain('C.onFocus');
      dispose();
    },
  );
});

v.describe('contract: forwardFocus', () => {
  v.it(
    'a number forwards focus to that child index; the forwarding node stays on the path',
    async () => {
      let p!: ElementNode,
        a!: ElementNode,
        b!: ElementNode,
        other!: ElementNode;
      const { dispose } = await mount(() => (
        <view>
          <view ref={other} autofocus />
          <view ref={p} forwardFocus={1}>
            <view ref={a} />
            <view ref={b} />
          </view>
        </view>
      ));
      v.expect(activeElement()).toBe(other);
      await focus(p);
      v.expect(activeElement()).toBe(b);
      v.expect(focusPath()[1]).toBe(p);
      v.expect(hasFocusState(p)).toBe(true);
      v.expect(hasFocusState(a)).toBe(false);
      dispose();
    },
  );

  v.it('forwardFocus={0} works (0 is not treated as unset)', async () => {
    let p!: ElementNode, a!: ElementNode;
    const { dispose } = await mount(() => (
      <view ref={p} autofocus forwardFocus={0}>
        <view ref={a} />
        <view />
      </view>
    ));
    v.expect(activeElement()).toBe(a);
    v.expect(hasFocusState(p)).toBe(true);
    dispose();
  });

  v.it('chains through children that forward focus themselves', async () => {
    let leaf!: ElementNode;
    const { dispose } = await mount(() => (
      <view autofocus forwardFocus={1}>
        <view />
        <view forwardFocus={0}>
          <view ref={leaf} />
        </view>
      </view>
    ));
    v.expect(activeElement()).toBe(leaf);
    dispose();
  });

  v.it(
    'an index past the last child focuses the node itself (current behaviour)',
    async () => {
      let p!: ElementNode;
      const { dispose } = await mount(() => (
        <view ref={p} autofocus forwardFocus={5}>
          <view />
        </view>
      ));
      v.expect(activeElement()).toBe(p);
      dispose();
    },
  );

  v.it(
    'autofocus + forwardFocus reaches a child that renders with the parent',
    async () => {
      let b!: ElementNode;
      const { dispose } = await mount(() => (
        <view autofocus forwardFocus={1}>
          <view />
          <view ref={b} />
        </view>
      ));
      v.expect(activeElement()).toBe(b);
      dispose();
    },
  );

  v.it(
    'a function is called with this = node and the node as argument; it can focus another node',
    async () => {
      let p!: ElementNode, b!: ElementNode;
      const fn = v.vi.fn(function (this: ElementNode, _elm: ElementNode) {
        b.setFocus();
        return true;
      });
      const { dispose } = await mount(() => (
        <view ref={p} autofocus forwardFocus={fn}>
          <view />
          <view ref={b} />
        </view>
      ));
      v.expect(activeElement()).toBe(b);
      v.expect(fn).toHaveBeenCalled();
      v.expect(fn.mock.contexts[0]).toBe(p);
      v.expect(fn.mock.calls[0]).toEqual([p]);
      dispose();
    },
  );

  v.it(
    'a function returning false lets the node itself take focus',
    async () => {
      let p!: ElementNode;
      const { dispose } = await mount(() => (
        <view ref={p} autofocus forwardFocus={() => false}>
          <view />
        </view>
      ));
      v.expect(activeElement()).toBe(p);
      dispose();
    },
  );

  v.it(
    'a function returning anything but false (here undefined) blocks focus on the node: focus stays put (current behaviour)',
    async () => {
      let p!: ElementNode, other!: ElementNode;
      const fn = v.vi.fn(() => undefined);
      const { dispose } = await mount(() => (
        <view>
          <view ref={other} autofocus />
          <view ref={p} forwardFocus={fn}>
            <view />
          </view>
        </view>
      ));
      await focus(p);
      v.expect(fn).toHaveBeenCalled();
      v.expect(activeElement()).toBe(other);
      dispose();
    },
  );
});

v.describe('contract: skipFocus', () => {
  v.it(
    'Row navigation skips a skipFocus child in both directions',
    async () => {
      let a!: ElementNode, b!: ElementNode, c!: ElementNode;
      const { target, dispose } = await mount(() => (
        <Row autofocus>
          <view ref={a} width={100} height={100} />
          <view ref={b} skipFocus width={100} height={100} />
          <view ref={c} width={100} height={100} />
        </Row>
      ));
      v.expect(activeElement()).toBe(a);
      target.down('ArrowRight');
      await flush();
      v.expect(activeElement()).toBe(c);
      v.expect(hasFocusState(b)).toBe(false);
      target.down('ArrowLeft');
      await flush();
      v.expect(activeElement()).toBe(a);
      dispose();
    },
  );

  v.it(
    'a Row forwards initial focus past a leading skipFocus child',
    async () => {
      let second!: ElementNode;
      const { dispose } = await mount(() => (
        <Row autofocus>
          <view skipFocus width={100} height={100} />
          <view ref={second} width={100} height={100} />
        </Row>
      ));
      v.expect(activeElement()).toBe(second);
      dispose();
    },
  );

  v.it(
    'setFocus() on a skipFocus node still focuses it: skipFocus is only read by navigation (current behaviour)',
    async () => {
      let skipped!: ElementNode;
      const { dispose } = await mount(() => (
        <view>
          <view autofocus />
          <view ref={skipped} skipFocus />
        </view>
      ));
      await focus(skipped);
      v.expect(activeElement()).toBe(skipped);
      dispose();
    },
  );
});

v.describe('contract: autofocus', () => {
  v.it('bare autofocus focuses the node once it renders', async () => {
    let a!: ElementNode;
    const { dispose } = await mount(() => (
      <view>
        <view />
        <view ref={a} autofocus />
      </view>
    ));
    v.expect(activeElement()).toBe(a);
    v.expect(hasFocusState(a)).toBe(true);
    dispose();
  });

  v.it(
    'a node added later with autofocus takes focus when it renders',
    async () => {
      const [show, setShow] = createSignal(false);
      let first!: ElementNode, late!: ElementNode;
      const { dispose } = await mount(() => (
        <view>
          <view ref={first} autofocus />
          {show() && <view ref={late} autofocus />}
        </view>
      ));
      v.expect(activeElement()).toBe(first);
      setShow(true);
      await flush();
      v.expect(activeElement()).toBe(late);
      dispose();
    },
  );

  v.it(
    'a reactive value re-focuses the node each time it changes to a new truthy value; falsy values do nothing',
    async () => {
      const [token, setToken] = createSignal<number | undefined>(undefined);
      let x!: ElementNode, y!: ElementNode;
      const { dispose } = await mount(() => (
        <view>
          <view ref={x} autofocus={token()} />
          <view ref={y} autofocus />
        </view>
      ));
      // Falsy at mount: x does not take focus.
      v.expect(activeElement()).toBe(y);

      setToken(1);
      await flush();
      v.expect(activeElement()).toBe(x);

      await focus(y);
      setToken(2);
      await flush();
      v.expect(activeElement()).toBe(x);

      await focus(y);
      setToken(0);
      await flush();
      v.expect(activeElement()).toBe(y);
      dispose();
    },
  );
});
