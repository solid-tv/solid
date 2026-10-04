// Contract tests: Styles (`style`, combineStyles, transitions).
//
// These pin today's behaviour (1.6.4) through public node props, the public
// `combineStyles` helper and, for transitions, calls to the public
// `ElementNode.prototype.animate`. Where today's behaviour is odd it is pinned
// anyway and the comment says so.
//
// vitest runs with `isolate: false`: Config is shared across files in a
// worker, so every test disposes its render and restores Config and spies.
import * as v from 'vitest';
import * as s from 'solid-js';
import * as lng from '@solidtv/solid';
import { renderer } from './setup.js';

const RED = 0xff0000ff;
const BLUE = 0x0000ffff;
const GREEN = 0x00ff00ff;
const WHITE = 0xffffffff;

// Undoing a key with no base value, and setting a style twice, log dev
// warnings; several tests below do that on purpose.
v.beforeEach(() => {
  v.vi.spyOn(console, 'warn').mockImplementation(() => {});
});
v.afterEach(() => {
  v.vi.restoreAllMocks();
});

/** Wait for an animation to land. The DOM renderer animates on rAF. */
const settle = (check: () => void) =>
  v.vi.waitFor(check, { timeout: 3000, interval: 10 });

// A static module-level style object: the most common pattern in apps.
const Tile: lng.NodeStyles = {
  width: 100,
  height: 50,
  color: RED,
  alpha: 0.8,
  $focus: { color: BLUE, alpha: 1 },
};

v.describe('contract: static module-level style objects', () => {
  v.it(
    'one style object shared by several nodes gives every node its values',
    () => {
      const nodes: lng.ElementNode[] = [];
      const dispose = renderer.render(() => (
        <view>
          <s.For each={[0, 1, 2]}>
            {(i) => <view ref={(el) => (nodes[i] = el)} style={Tile} />}
          </s.For>
        </view>
      ));
      v.expect(nodes).toHaveLength(3);
      for (const node of nodes) {
        v.expect(node.width).toBe(100);
        v.expect(node.height).toBe(50);
        v.expect(node.color).toBe(RED);
        v.expect(node.alpha).toBe(0.8);
      }
      dispose();
    },
  );

  v.it(
    'a state on one node does not change the other nodes sharing the object',
    () => {
      let a!: lng.ElementNode;
      let b!: lng.ElementNode;
      const dispose = renderer.render(() => (
        <view>
          <view ref={a} style={Tile} />
          <view ref={b} style={Tile} />
        </view>
      ));
      a.states.add('$focus');
      v.expect(a.color).toBe(BLUE);
      v.expect(b.color).toBe(RED);
      a.states.remove('$focus');
      b.states.add('$focus');
      v.expect(a.color).toBe(RED);
      v.expect(b.color).toBe(BLUE);
      dispose();
    },
  );

  v.it(
    'applying and undoing states never mutates the shared style object',
    () => {
      const Shared: lng.NodeStyles = {
        color: RED,
        scale: 1,
        transition: { scale: { duration: 10 } },
        $focus: { color: BLUE, scale: 1.2 },
        $active: { color: GREEN, alpha: 0.5 },
      };
      const before = structuredClone(Shared);
      let a!: lng.ElementNode;
      let b!: lng.ElementNode;
      const dispose = renderer.render(() => (
        <view>
          <view ref={a} style={Shared} />
          <view ref={b} style={Shared} color={WHITE} />
        </view>
      ));
      a.states.add('$focus');
      a.states.add('$active');
      b.states.add('$active');
      a.color = WHITE;
      a.states.remove('$focus');
      a.states.remove('$active');
      b.states.remove('$active');
      v.expect(Shared).toEqual(before);
      dispose();
    },
  );
});

v.describe('contract: inline style literals re-created on every render', () => {
  v.it(
    'a parent that re-renders its child gives each new node the values of its new literal, $state blocks included',
    () => {
      let node!: lng.ElementNode;
      const [color, setColor] = s.createSignal(RED);
      const dispose = renderer.render(() => (
        <view>
          <s.Show when={color()} keyed>
            {(c) => (
              <view
                ref={node}
                style={{
                  color: c,
                  alpha: 0.8,
                  $focus: { alpha: 1, scale: 1.1 },
                }}
              />
            )}
          </s.Show>
        </view>
      ));
      const first = node;
      v.expect(first.color).toBe(RED);

      setColor(GREEN);
      v.expect(node).not.toBe(first);
      v.expect(node.color).toBe(GREEN);
      v.expect(node.alpha).toBe(0.8);
      node.states.add('$focus');
      v.expect(node.alpha).toBe(1);
      v.expect(node.scale).toBe(1.1);
      node.states.remove('$focus');
      v.expect(node.alpha).toBe(0.8);
      v.expect(node.color).toBe(GREEN);
      dispose();
    },
  );

  v.it(
    'a reactive literal on the same node is read once; later literals are ignored (Config.lockStyles, default true)',
    () => {
      // Pinned as is (documented in docs/essentials/styling.md: style is
      // read-only once set). The compiler re-creates the literal and sets
      // `style` again when color() changes; the node keeps the first one, for
      // its values and as the undo baseline.
      let node!: lng.ElementNode;
      const [color, setColor] = s.createSignal(RED);
      const dispose = renderer.render(() => (
        <view ref={node} style={{ color: color(), $focus: { color: BLUE } }} />
      ));
      v.expect(node.color).toBe(RED);
      setColor(GREEN);
      v.expect(node.color).toBe(RED);
      v.expect(node.style.color).toBe(RED);
      node.states.add('$focus');
      node.states.remove('$focus');
      v.expect(node.color).toBe(RED);
      dispose();
    },
  );
});

v.describe('contract: object spread', () => {
  const Base: lng.NodeStyles = {
    width: 100,
    color: RED,
    $focus: { color: BLUE, scale: 1.1 },
  };

  v.it(
    'a style built by spreading a base keeps the base keys and $state blocks; its own keys win',
    () => {
      const Wide: lng.NodeStyles = { ...Base, width: 300 };
      let node!: lng.ElementNode;
      const dispose = renderer.render(() => <view ref={node} style={Wide} />);
      v.expect(node.width).toBe(300);
      v.expect(node.color).toBe(RED);
      node.states.add('$focus');
      v.expect(node.color).toBe(BLUE);
      v.expect(node.scale).toBe(1.1);
      dispose();
    },
  );

  v.it(
    'spread is shallow: a $state block in the new object replaces the base block wholesale',
    () => {
      const Override: lng.NodeStyles = { ...Base, $focus: { alpha: 0.5 } };
      let node!: lng.ElementNode;
      const dispose = renderer.render(() => (
        <view ref={node} style={Override} />
      ));
      node.states.add('$focus');
      v.expect(node.alpha).toBe(0.5);
      v.expect(node.color).toBe(RED);
      v.expect(node.scale).toBe(1);
      dispose();
    },
  );

  v.it(
    'an inline literal with spread (style={{ ...Base, color }}) applies and undoes like a static object',
    () => {
      let node!: lng.ElementNode;
      const dispose = renderer.render(() => (
        <view ref={node} style={{ ...Base, color: GREEN }} />
      ));
      v.expect(node.color).toBe(GREEN);
      v.expect(node.width).toBe(100);
      node.states.add('$focus');
      v.expect(node.color).toBe(BLUE);
      node.states.remove('$focus');
      v.expect(node.color).toBe(GREEN);
      dispose();
    },
  );

  v.it(
    'spreading a style object as JSX props ({...obj}) sets its keys as props; undo then treats them as JSX props',
    () => {
      // The pattern in docs/essentials/theming.md. Pinned as is: the values are
      // props, not style, so undo has no baseline and writes undefined.
      const Dark: lng.NodeStyles = { color: RED, $focus: { color: BLUE } };
      let node!: lng.ElementNode;
      const dispose = renderer.render(() => <view ref={node} {...Dark} />);
      v.expect(node.color).toBe(RED);
      node.states.add('$focus');
      v.expect(node.color).toBe(BLUE);
      node.states.remove('$focus');
      v.expect(node.color).toBeUndefined();
      dispose();
    },
  );
});

v.describe('contract: combineStyles', () => {
  v.it(
    'the first argument wins on shared keys; keys from both are kept',
    () => {
      const combined = lng.combineStyles<lng.NodeStyles>(
        { color: GREEN, alpha: 0.5 },
        { color: RED, width: 100 },
      );
      v.expect(combined).toEqual({ color: GREEN, alpha: 0.5, width: 100 });
    },
  );

  v.it('when one argument is undefined the other is returned as is', () => {
    const style: lng.NodeStyles = { color: RED };
    v.expect(lng.combineStyles(undefined, style)).toBe(style);
    v.expect(lng.combineStyles(style, undefined)).toBe(style);
  });

  v.it(
    'merges shallowly: a $state block in the first replaces the one in the second; a block only in the second is kept',
    () => {
      // Pinned as is: $state blocks are not merged key by key.
      const combined = lng.combineStyles<lng.NodeStyles>(
        { $focus: { color: GREEN } },
        {
          color: RED,
          $focus: { color: BLUE, scale: 1.2 },
          $active: { alpha: 0.5 },
        },
      );
      v.expect(combined.$focus).toEqual({ color: GREEN });
      v.expect(combined.$active).toEqual({ alpha: 0.5 });
    },
  );

  v.it(
    'a combined style applies and undoes its $state blocks on a node',
    () => {
      const Defaults: lng.NodeStyles = {
        color: RED,
        alpha: 0.8,
        $focus: { color: BLUE, alpha: 1 },
        $active: { scale: 1.2 },
      };
      const style = lng.combineStyles<lng.NodeStyles>(
        { color: WHITE, $focus: { color: GREEN } },
        Defaults,
      );
      let node!: lng.ElementNode;
      const dispose = renderer.render(() => <view ref={node} style={style} />);
      v.expect(node.color).toBe(WHITE);
      v.expect(node.alpha).toBe(0.8);
      node.states.add('$focus');
      v.expect(node.color).toBe(GREEN);
      v.expect(node.alpha).toBe(0.8);
      node.states.add('$active');
      v.expect(node.scale).toBe(1.2);
      node.states.remove('$focus');
      node.states.remove('$active');
      v.expect(node.color).toBe(WHITE);
      v.expect(node.scale).toBe(1);
      dispose();
    },
  );

  v.it(
    'getters are read once, at combine time: the result holds plain values',
    () => {
      const [color, setColor] = s.createSignal(RED);
      const combined = lng.combineStyles<lng.NodeStyles>(
        {
          get color() {
            return color();
          },
        },
        { alpha: 1 },
      );
      setColor(GREEN);
      v.expect(combined.color).toBe(RED);
      v.expect(Object.getOwnPropertyDescriptor(combined, 'color')?.get).toBe(
        undefined,
      );
    },
  );
});

v.describe('contract: getter properties inside styles', () => {
  v.it(
    'a constant getter works like a plain value (pattern in the demo app)',
    () => {
      const Key: lng.NodeStyles = {
        get color() {
          return RED;
        },
        $focus: {
          get color() {
            return BLUE;
          },
        },
      };
      let node!: lng.ElementNode;
      const dispose = renderer.render(() => <view ref={node} style={Key} />);
      v.expect(node.color).toBe(RED);
      node.states.add('$focus');
      v.expect(node.color).toBe(BLUE);
      node.states.remove('$focus');
      v.expect(node.color).toBe(RED);
      dispose();
    },
  );

  v.it(
    'a getter in the base style is read when the style is set; a later signal change does not update the node',
    () => {
      // Pinned as is: style getters are not reactive.
      const [color, setColor] = s.createSignal(RED);
      const Style: lng.NodeStyles = {
        get color() {
          return color();
        },
      };
      let node!: lng.ElementNode;
      const dispose = renderer.render(() => <view ref={node} style={Style} />);
      v.expect(node.color).toBe(RED);
      setColor(GREEN);
      v.expect(node.color).toBe(RED);
      dispose();
    },
  );

  v.it(
    'a getter in a $state block is read each time the state is applied, not while it stays on',
    () => {
      const [focusColor, setFocusColor] = s.createSignal(BLUE);
      const Style: lng.NodeStyles = {
        color: RED,
        $focus: {
          get color() {
            return focusColor();
          },
        },
      };
      let node!: lng.ElementNode;
      const dispose = renderer.render(() => <view ref={node} style={Style} />);
      node.states.add('$focus');
      v.expect(node.color).toBe(BLUE);
      setFocusColor(GREEN);
      v.expect(node.color).toBe(BLUE);
      node.states.remove('$focus');
      node.states.add('$focus');
      v.expect(node.color).toBe(GREEN);
      dispose();
    },
  );

  v.it(
    'undo re-reads a getter in the base style, so it lands on the current value',
    () => {
      const [color, setColor] = s.createSignal(RED);
      const Style: lng.NodeStyles = {
        get color() {
          return color();
        },
        $focus: { color: BLUE },
      };
      let node!: lng.ElementNode;
      const dispose = renderer.render(() => <view ref={node} style={Style} />);
      node.states.add('$focus');
      setColor(GREEN);
      node.states.remove('$focus');
      v.expect(node.color).toBe(GREEN);
      dispose();
    },
  );
});

v.describe('contract: explicit props override style', () => {
  const Style: lng.NodeStyles = { x: 10, color: RED, alpha: 0.8 };

  v.it('a JSX prop written before style wins', () => {
    let node!: lng.ElementNode;
    const dispose = renderer.render(() => (
      <view ref={node} color={GREEN} style={Style} />
    ));
    v.expect(node.color).toBe(GREEN);
    v.expect(node.alpha).toBe(0.8);
    dispose();
  });

  v.it('a JSX prop written after style wins', () => {
    let node!: lng.ElementNode;
    const dispose = renderer.render(() => (
      <view ref={node} style={Style} color={GREEN} />
    ));
    v.expect(node.color).toBe(GREEN);
    v.expect(node.alpha).toBe(0.8);
    dispose();
  });

  v.it('an explicit 0 wins over a non-zero style value', () => {
    let node!: lng.ElementNode;
    const dispose = renderer.render(() => (
      <view ref={node} x={0} alpha={0} style={Style} />
    ));
    v.expect(node.x).toBe(0);
    v.expect(node.alpha).toBe(0);
    dispose();
  });

  v.it('spread props ({...props}) win over style, before or after it', () => {
    const props = { color: GREEN };
    let a!: lng.ElementNode;
    let b!: lng.ElementNode;
    const dispose = renderer.render(() => (
      <view>
        <view ref={a} {...props} style={Style} />
        <view ref={b} style={Style} {...props} />
      </view>
    ));
    v.expect(a.color).toBe(GREEN);
    v.expect(b.color).toBe(GREEN);
    dispose();
  });

  v.it(
    'a reactive JSX prop keeps updating the node; the style value is never re-applied',
    () => {
      let node!: lng.ElementNode;
      const [color, setColor] = s.createSignal(GREEN);
      const dispose = renderer.render(() => (
        <view ref={node} style={Style} color={color()} />
      ));
      setColor(WHITE);
      v.expect(node.color).toBe(WHITE);
      setColor(BLUE);
      v.expect(node.color).toBe(BLUE);
      dispose();
    },
  );
});

v.describe('contract: transition', () => {
  let animate: v.MockInstance<lng.ElementNode['animate']>;
  v.beforeEach(() => {
    animate = v.vi.spyOn(lng.ElementNode.prototype, 'animate');
  });

  v.it(
    'no transition, or transition={false}: a write lands at once and nothing animates',
    () => {
      let a!: lng.ElementNode;
      let b!: lng.ElementNode;
      const dispose = renderer.render(() => (
        <view>
          <view ref={a} x={0} />
          <view ref={b} x={0} transition={false} />
        </view>
      ));
      a.x = 100;
      b.x = 100;
      v.expect(a.x).toBe(100);
      v.expect(b.x).toBe(100);
      v.expect(animate).not.toHaveBeenCalled();
      dispose();
    },
  );

  v.it(
    'transition={true}: every animatable prop animates with the default settings, then lands',
    async () => {
      let node!: lng.ElementNode;
      const dispose = renderer.render(() => (
        <view ref={node} x={0} alpha={1} transition />
      ));
      node.x = 100;
      node.alpha = 0.5;
      // The write goes through an animation, so it is not there yet.
      v.expect(node.x).toBe(0);
      v.expect(animate).toHaveBeenCalledTimes(2);
      v.expect(animate.mock.calls[0]![0]).toEqual({ x: 100 });
      v.expect(animate.mock.calls[1]![0]).toEqual({ alpha: 0.5 });
      // Settings are the node's animationSettings, which default to
      // Config.animationSettings (passed, or resolved inside animate()).
      v.expect(animate.mock.calls[0]![1] ?? node.animationSettings).toEqual(
        lng.Config.animationSettings,
      );
      await settle(() => {
        v.expect(node.x).toBe(100);
        v.expect(node.alpha).toBe(0.5);
      });
      dispose();
    },
  );

  v.it(
    'transition={{ y: true }}: only y animates, with the default settings; x lands at once',
    async () => {
      let node!: lng.ElementNode;
      const dispose = renderer.render(() => (
        <view ref={node} x={0} y={0} transition={{ y: true }} />
      ));
      node.x = 50;
      node.y = 80;
      v.expect(node.x).toBe(50);
      v.expect(node.y).toBe(0);
      v.expect(animate).toHaveBeenCalledTimes(1);
      v.expect(animate.mock.calls[0]![0]).toEqual({ y: 80 });
      v.expect(animate.mock.calls[0]![1] ?? node.animationSettings).toEqual(
        lng.Config.animationSettings,
      );
      await settle(() => v.expect(node.y).toBe(80));
      dispose();
    },
  );

  v.it(
    'transition={{ x: { duration, easing, delay } }}: x animates with exactly those settings, then lands',
    async () => {
      let node!: lng.ElementNode;
      const settings = { duration: 30, easing: 'linear', delay: 5 };
      const dispose = renderer.render(() => (
        <view ref={node} x={0} transition={{ x: settings }} />
      ));
      node.x = 100;
      v.expect(node.x).toBe(0);
      v.expect(animate).toHaveBeenCalledTimes(1);
      v.expect(animate.mock.calls[0]).toEqual([{ x: 100 }, settings]);
      await settle(() => v.expect(node.x).toBe(100));
      dispose();
    },
  );

  v.it('transition keys accept width/height for w/h', async () => {
    let node!: lng.ElementNode;
    const dispose = renderer.render(() => (
      <view
        ref={node}
        width={100}
        height={100}
        transition={{ width: { duration: 10 } }}
      />
    ));
    node.width = 300;
    node.height = 50;
    v.expect(node.width).toBe(100);
    v.expect(node.height).toBe(50);
    v.expect(animate).toHaveBeenCalledTimes(1);
    await settle(() => v.expect(node.width).toBe(300));
    dispose();
  });

  v.it('transition inside a style object works like the prop', async () => {
    let node!: lng.ElementNode;
    const dispose = renderer.render(() => (
      <view ref={node} style={{ x: 0, transition: { x: { duration: 10 } } }} />
    ));
    node.x = 100;
    v.expect(node.x).toBe(0);
    v.expect(animate).toHaveBeenCalledTimes(1);
    await settle(() => v.expect(node.x).toBe(100));
    dispose();
  });

  v.it(
    'nothing animates before the node renders: initial props and initial states land at once',
    () => {
      let node!: lng.ElementNode;
      const dispose = renderer.render(() => (
        <view
          ref={node}
          x={50}
          states="$focus"
          transition={{ x: { duration: 10 }, scale: { duration: 10 } }}
          style={{ scale: 1, $focus: { scale: 1.2 } }}
        />
      ));
      v.expect(node.x).toBe(50);
      v.expect(node.scale).toBe(1.2);
      v.expect(animate).not.toHaveBeenCalled();
      dispose();
    },
  );

  v.it(
    'Config.animationsEnabled = false: transitions are skipped and writes land at once',
    () => {
      const saved = lng.Config.animationsEnabled;
      let node!: lng.ElementNode;
      const dispose = renderer.render(() => (
        <view ref={node} x={0} transition={{ x: { duration: 10 } }} />
      ));
      try {
        lng.Config.animationsEnabled = false;
        node.x = 100;
        v.expect(node.x).toBe(100);
        v.expect(animate).not.toHaveBeenCalled();
      } finally {
        lng.Config.animationsEnabled = saved;
        dispose();
      }
    },
  );

  v.it(
    'a base transition in style animates a $focus block on and off (pattern in the demo app)',
    async () => {
      const settings = { duration: 10, easing: 'linear' };
      let node!: lng.ElementNode;
      const dispose = renderer.render(() => (
        <view
          ref={node}
          style={{
            scale: 1,
            transition: { scale: settings },
            $focus: { scale: 1.1 },
          }}
        />
      ));
      node.states.add('$focus');
      v.expect(node.scale).toBe(1);
      v.expect(animate.mock.calls[0]).toEqual([{ scale: 1.1 }, settings]);
      await settle(() => v.expect(node.scale).toBe(1.1));

      node.states.remove('$focus');
      v.expect(node.scale).toBe(1.1);
      v.expect(animate.mock.calls[1]).toEqual([{ scale: 1 }, settings]);
      await settle(() => v.expect(node.scale).toBe(1));
      dispose();
    },
  );

  v.it(
    'a transition inside a $focus block is set before the block is applied, so the block animates',
    async () => {
      const settings = { duration: 10 };
      let node!: lng.ElementNode;
      const dispose = renderer.render(() => (
        <view
          ref={node}
          style={{
            scale: 1,
            $focus: { scale: 1.2, transition: { scale: settings } },
          }}
        />
      ));
      node.states.add('$focus');
      v.expect(node.scale).toBe(1);
      v.expect(animate.mock.calls[0]).toEqual([{ scale: 1.2 }, settings]);
      v.expect(node.transition).toEqual({ scale: settings });
      await settle(() => v.expect(node.scale).toBe(1.2));
      dispose();
    },
  );

  v.it(
    'undo of a $focus block with its own transition: transition key LAST, the undo animates with it',
    async () => {
      // Pinned as is, and order-dependent: undo writes the block's keys back in
      // the block's key order. `scale` comes before `transition` here, so scale
      // is written while the block's transition is still set and animates; then
      // transition is restored to the style value (none).
      const settings = { duration: 10 };
      let node!: lng.ElementNode;
      const dispose = renderer.render(() => (
        <view
          ref={node}
          style={{
            scale: 1,
            $focus: { scale: 1.2, transition: { scale: settings } },
          }}
        />
      ));
      node.states.add('$focus');
      await settle(() => v.expect(node.scale).toBe(1.2));

      node.states.remove('$focus');
      v.expect(node.scale).toBe(1.2);
      v.expect(animate).toHaveBeenCalledTimes(2);
      v.expect(animate.mock.calls[1]).toEqual([{ scale: 1 }, settings]);
      v.expect(node.transition).toBeUndefined();
      await settle(() => v.expect(node.scale).toBe(1));
      dispose();
    },
  );

  v.it(
    'undo of a $focus block with its own transition: transition key FIRST, the undo lands at once',
    async () => {
      // Pinned as is, the other half of the order dependence above: here
      // `transition` is restored (to none) before `scale` is written back.
      const settings = { duration: 10 };
      let node!: lng.ElementNode;
      const dispose = renderer.render(() => (
        <view
          ref={node}
          style={{
            scale: 1,
            $focus: { transition: { scale: settings }, scale: 1.2 },
          }}
        />
      ));
      node.states.add('$focus');
      v.expect(animate.mock.calls[0]).toEqual([{ scale: 1.2 }, settings]);
      await settle(() => v.expect(node.scale).toBe(1.2));

      node.states.remove('$focus');
      v.expect(node.scale).toBe(1);
      v.expect(animate).toHaveBeenCalledTimes(1);
      v.expect(node.transition).toBeUndefined();
      dispose();
    },
  );
});
