// Phase 1 contract tests: States (brief "Compatibility contract" -> "States").
//
// These pin today's behaviour (arm B) through public node props and the
// public `states` API only. Where today's behaviour is odd it is pinned anyway
// and the comment says so; where it looks like a genuine bug the
// correct-behaviour test is an `it.skip` marked `// BUG:`.
//
// vitest runs with `isolate: false`: Config and focus state are shared across
// files in a worker, so every test disposes its render and restores Config.
import * as v from 'vitest';
import * as s from 'solid-js';
import * as lng from '@solidtv/solid';
import { renderer } from './setup.js';

const RED = 0xff0000ff;
const BLUE = 0x0000ffff;
const GREEN = 0x00ff00ff;
const WHITE = 0xffffffff;

/** A state name without the `$` prefix, which the types do not allow. */
const bare = (name: string) => name as lng.DollarString;

/** The states on a node, as a plain array. */
const statesOf = (node: lng.ElementNode) => [...node.states];

/** The props of a node's shader (the DOM renderer keeps them as given). */
const shaderProps = (node: lng.ElementNode) =>
  (node.lng as unknown as { shader: { props: Record<string, unknown> } }).shader
    .props;

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

// Undoing a key with no base value logs a dev warning ("fallback style key
// not found"); several tests below do that on purpose.
v.beforeEach(() => {
  v.vi.spyOn(console, 'warn').mockImplementation(() => {});
});
v.afterEach(() => {
  v.vi.restoreAllMocks();
});

v.describe('contract: states accepts a string, an array or an object', () => {
  v.it('string form: states="$active" turns on the $active block', () => {
    let node!: lng.ElementNode;
    const dispose = renderer.render(() => (
      <view
        ref={node}
        states="$active"
        style={{ color: RED, $active: { color: GREEN } }}
      />
    ));
    v.expect(statesOf(node)).toEqual(['$active']);
    v.expect(node.color).toBe(GREEN);
    dispose();
  });

  v.it('array form: every listed state is on', () => {
    let node!: lng.ElementNode;
    const dispose = renderer.render(() => (
      <view
        ref={node}
        states={['$active', '$disabled']}
        style={{
          color: RED,
          $active: { color: GREEN },
          $disabled: { alpha: 0.2 },
        }}
      />
    ));
    v.expect(statesOf(node)).toEqual(['$active', '$disabled']);
    v.expect(node.color).toBe(GREEN);
    v.expect(node.alpha).toBe(0.2);
    dispose();
  });

  v.it('object form: only truthy keys are on', () => {
    let node!: lng.ElementNode;
    const dispose = renderer.render(() => (
      <view
        ref={node}
        states={{ $active: true, $disabled: false, $happy: undefined }}
        style={{
          color: RED,
          $active: { color: GREEN },
          $disabled: { alpha: 0.2 },
        }}
      />
    ));
    v.expect(statesOf(node)).toEqual(['$active']);
    v.expect(node.color).toBe(GREEN);
    v.expect(node.alpha).toBe(1);
    dispose();
  });

  v.it(
    'reactive string: a new string replaces the whole list, dropping a state added imperatively (e.g. $focus)',
    () => {
      // Pinned as is: the string and array forms replace every state, so a
      // reactive `states` string also wipes the $focus the focus manager added.
      let node!: lng.ElementNode;
      const [states, setStates] = s.createSignal<lng.DollarString>('$active');
      const dispose = renderer.render(() => (
        <view
          ref={node}
          states={states()}
          style={{
            color: RED,
            $active: { color: GREEN },
            $focus: { scale: 1.5 },
            $disabled: { alpha: 0.2 },
          }}
        />
      ));
      node.states.add('$focus');
      v.expect(statesOf(node)).toEqual(['$active', '$focus']);
      v.expect(node.scale).toBe(1.5);

      setStates('$disabled');
      v.expect(statesOf(node)).toEqual(['$disabled']);
      v.expect(node.color).toBe(RED);
      v.expect(node.alpha).toBe(0.2);
      v.expect(node.states.has('$focus')).toBe(false);
      dispose();
    },
  );

  v.it(
    'reactive array: a new array replaces the whole list, dropping a state added imperatively',
    () => {
      let node!: lng.ElementNode;
      const [states, setStates] = s.createSignal<lng.DollarString[]>([
        '$active',
      ]);
      const dispose = renderer.render(() => (
        <view
          ref={node}
          states={states()}
          style={{
            color: RED,
            $active: { color: GREEN },
            $focus: { scale: 1.5 },
            $disabled: { alpha: 0.2 },
          }}
        />
      ));
      node.states.add('$focus');

      setStates(['$disabled', '$active']);
      v.expect(statesOf(node)).toEqual(['$disabled', '$active']);
      v.expect(node.color).toBe(GREEN);
      v.expect(node.alpha).toBe(0.2);
      v.expect(node.states.has('$focus')).toBe(false);

      setStates([]);
      v.expect(statesOf(node)).toEqual([]);
      v.expect(node.color).toBe(RED);
      dispose();
    },
  );

  v.it(
    'reactive object: truthy keys are added, falsy keys removed, other states (e.g. $focus) kept',
    () => {
      let node!: lng.ElementNode;
      const [states, setStates] = s.createSignal<
        Record<lng.DollarString, boolean>
      >({ $active: true });
      const dispose = renderer.render(() => (
        <view
          ref={node}
          states={states()}
          style={{
            color: RED,
            $active: { color: GREEN },
            $focus: { scale: 1.5 },
            $disabled: { alpha: 0.2 },
          }}
        />
      ));
      node.states.add('$focus');

      setStates({ $active: false, $disabled: true });
      v.expect(statesOf(node)).toEqual(['$focus', '$disabled']);
      v.expect(node.color).toBe(RED);
      v.expect(node.alpha).toBe(0.2);
      v.expect(node.scale).toBe(1.5);
      dispose();
    },
  );

  v.it(
    'object form with a key without $ stores it verbatim; it does not turn on the $-prefixed block',
    () => {
      // Pinned as is: only `has` treats `active` and `$active` as the same.
      let node!: lng.ElementNode;
      const dispose = renderer.render(() => (
        <view
          ref={node}
          states={{ [bare('active')]: true }}
          style={{ color: RED, $active: { color: GREEN } }}
        />
      ));
      v.expect(statesOf(node)).toEqual(['active']);
      v.expect(node.color).toBe(RED);
      dispose();
    },
  );
});

v.describe('contract: state keys with and without $', () => {
  v.it('has("focus") and has("$focus") both match "$focus"', () => {
    let node!: lng.ElementNode;
    const dispose = renderer.render(() => <view ref={node} states="$focus" />);
    v.expect(node.states.has('$focus')).toBe(true);
    v.expect(node.states.has(bare('focus'))).toBe(true);
    v.expect(node.states.has('$active')).toBe(false);
    v.expect(node.states.has(bare('active'))).toBe(false);
    dispose();
  });

  v.it('has("$focus") does not match a bare "focus" entry', () => {
    let node!: lng.ElementNode;
    const dispose = renderer.render(() => (
      <view ref={node} states={[bare('focus')]} />
    ));
    v.expect(node.states.has(bare('focus'))).toBe(true);
    v.expect(node.states.has('$focus')).toBe(false);
    dispose();
  });

  v.it('is() is strict: is("focus") does not match "$focus"', () => {
    // Pinned as is: docs/essentials/states.md says "is and has are
    // identical", but only `has` accepts the name without `$`.
    let node!: lng.ElementNode;
    const dispose = renderer.render(() => <view ref={node} states="$focus" />);
    v.expect(node.states.is('$focus')).toBe(true);
    v.expect(node.states.is(bare('focus'))).toBe(false);
    dispose();
  });

  v.it(
    'add("$focus") turns the $focus block on; remove("$focus") undoes it',
    () => {
      let node!: lng.ElementNode;
      const dispose = renderer.render(() => (
        <view ref={node} style={{ color: RED, $focus: { color: BLUE } }} />
      ));
      node.states.add('$focus');
      v.expect(statesOf(node)).toEqual(['$focus']);
      v.expect(node.color).toBe(BLUE);
      node.states.remove('$focus');
      v.expect(statesOf(node)).toEqual([]);
      v.expect(node.color).toBe(RED);
      dispose();
    },
  );

  v.it(
    'add() of a state already on changes nothing (styles are not re-applied)',
    () => {
      let node!: lng.ElementNode;
      const dispose = renderer.render(() => (
        <view ref={node} style={{ color: RED, $focus: { color: BLUE } }} />
      ));
      node.states.add('$focus');
      node.color = WHITE;
      node.states.add('$focus');
      node.states.add(bare('focus'));
      v.expect(statesOf(node)).toEqual(['$focus']);
      v.expect(node.color).toBe(WHITE);
      dispose();
    },
  );

  v.it(
    'setting states to an unchanged value changes nothing (styles are not re-applied), in every form',
    () => {
      // 1.7 (design 3.3.3): `set states` compares before it merges. Before,
      // an equal list re-applied every state style.
      let node!: lng.ElementNode;
      const [states, setStates] = s.createSignal<lng.DollarString[]>([
        '$focus',
      ]);
      const dispose = renderer.render(() => (
        <view
          ref={node}
          states={states()}
          style={{ color: RED, $focus: { color: BLUE } }}
        />
      ));
      v.expect(node.color).toBe(BLUE);
      node.color = WHITE;
      setStates(['$focus']);
      v.expect(node.color).toBe(WHITE);
      node.states = '$focus';
      node.states = { $focus: true, $active: false };
      // Its own list: an equal list. (Before 1.7 this one emptied the list.)
      const own = node.states;
      node.states = own;
      v.expect(statesOf(node)).toEqual(['$focus']);
      v.expect(node.color).toBe(WHITE);
      setStates([]);
      v.expect(node.color).toBe(RED);
      dispose();
    },
  );

  v.it(
    'add("focus") without "$focus" on stores "focus" verbatim and does not turn on the $focus block',
    () => {
      let node!: lng.ElementNode;
      const dispose = renderer.render(() => (
        <view ref={node} style={{ color: RED, $focus: { color: BLUE } }} />
      ));
      node.states.add(bare('focus'));
      v.expect(statesOf(node)).toEqual(['focus']);
      v.expect(node.states.has(bare('focus'))).toBe(true);
      v.expect(node.color).toBe(RED);
      dispose();
    },
  );

  v.it('remove("focus") removes "$focus", as has("focus") matches it', () => {
    // B2 (fixed in 1.7): before, remove() was strict: `has("focus")` was true
    // here, yet `remove("focus")` left "$focus" on.
    let node!: lng.ElementNode;
    const dispose = renderer.render(() => (
      <view ref={node} style={{ color: RED, $focus: { color: BLUE } }} />
    ));
    node.states.add('$focus');
    node.states.remove(bare('focus'));
    v.expect(statesOf(node)).toEqual([]);
    v.expect(node.color).toBe(RED);
    dispose();
  });

  v.it('toggle("$focus") turns the state on, then off', () => {
    let node!: lng.ElementNode;
    const dispose = renderer.render(() => (
      <view ref={node} style={{ color: RED, $focus: { color: BLUE } }} />
    ));
    node.states.toggle('$focus');
    v.expect(statesOf(node)).toEqual(['$focus']);
    v.expect(node.color).toBe(BLUE);
    node.states.toggle('$focus');
    v.expect(statesOf(node)).toEqual([]);
    v.expect(node.color).toBe(RED);
    dispose();
  });

  v.it(
    'toggle(state, true) only adds, toggle(state, false) only removes',
    () => {
      let node!: lng.ElementNode;
      const dispose = renderer.render(() => (
        <view ref={node} style={{ color: RED, $focus: { color: BLUE } }} />
      ));
      node.states.toggle('$focus', true);
      node.states.toggle('$focus', true);
      v.expect(statesOf(node)).toEqual(['$focus']);
      v.expect(node.color).toBe(BLUE);
      node.states.toggle('$focus', false);
      node.states.toggle('$focus', false);
      v.expect(statesOf(node)).toEqual([]);
      v.expect(node.color).toBe(RED);
      dispose();
    },
  );

  // B2 (fixed in 1.7): toggle("focus") while "$focus" was on did nothing.
  // toggle() asked has("focus") (true: has() accepts the bare name), then
  // called remove("focus"), which was strict and found nothing to remove. A
  // toggle must change the state.
  v.it('toggle("focus") while "$focus" is on turns it off', () => {
    let node!: lng.ElementNode;
    const dispose = renderer.render(() => (
      <view ref={node} style={{ color: RED, $focus: { color: BLUE } }} />
    ));
    node.states.add('$focus');
    node.states.toggle(bare('focus'));
    v.expect(node.states.has('$focus')).toBe(false);
    v.expect(node.color).toBe(RED);
    dispose();
  });

  // Changed in 1.7 (MIGRATION 2.5): States no longer builds a States for
  // Array methods' results (one was built per remove()).
  v.it('Array methods on states return plain arrays', () => {
    let node!: lng.ElementNode;
    const dispose = renderer.render(() => (
      <view ref={node} states={['$a', '$b']} />
    ));
    const copy = node.states.slice();
    v.expect(copy).toEqual(['$a', '$b']);
    v.expect(copy.constructor).toBe(Array);
    v.expect(node.states.filter(() => true).constructor).toBe(Array);
    v.expect(node.states).toBeInstanceOf(Array);
    dispose();
  });
});

v.describe('contract: $state blocks inside style apply and undo', () => {
  v.it(
    'a $focus block in style applies every key while the state is on',
    () => {
      let node!: lng.ElementNode;
      const dispose = renderer.render(() => (
        <view
          ref={node}
          style={{
            color: RED,
            alpha: 0.8,
            scale: 1,
            width: 100,
            $focus: { color: BLUE, alpha: 1, scale: 1.2, width: 200 },
          }}
        />
      ));
      v.expect(node.color).toBe(RED);
      v.expect(node.alpha).toBe(0.8);
      node.states.add('$focus');
      v.expect(node.color).toBe(BLUE);
      v.expect(node.alpha).toBe(1);
      v.expect(node.scale).toBe(1.2);
      v.expect(node.width).toBe(200);
      node.states.remove('$focus');
      v.expect(node.color).toBe(RED);
      v.expect(node.alpha).toBe(0.8);
      v.expect(node.scale).toBe(1);
      v.expect(node.width).toBe(100);
      dispose();
    },
  );

  v.it('any $name block works, not only $focus', () => {
    let node!: lng.ElementNode;
    const dispose = renderer.render(() => (
      <view ref={node} style={{ color: RED, $selected: { color: GREEN } }} />
    ));
    node.states.add('$selected');
    v.expect(node.color).toBe(GREEN);
    node.states.remove('$selected');
    v.expect(node.color).toBe(RED);
    dispose();
  });

  v.it(
    'a $state block passed as a JSX prop works like one inside style',
    () => {
      let node!: lng.ElementNode;
      const dispose = renderer.render(() => (
        <view ref={node} style={{ color: RED }} $focus={{ color: BLUE }} />
      ));
      node.states.add('$focus');
      v.expect(node.color).toBe(BLUE);
      node.states.remove('$focus');
      v.expect(node.color).toBe(RED);
      dispose();
    },
  );

  v.it('states given at creation are applied when the node renders', () => {
    let node!: lng.ElementNode;
    const dispose = renderer.render(() => (
      <view
        ref={node}
        states="$focus"
        style={{ color: RED, $focus: { color: BLUE } }}
      />
    ));
    v.expect(node.color).toBe(BLUE);
    node.states.remove('$focus');
    v.expect(node.color).toBe(RED);
    dispose();
  });

  // The undo table. "Undo restores the theme and style values, not JSX
  // props" (docs/essentials/states.md, brief). For each key the last state
  // application wrote, undo writes theme[key], else style[key], else
  // undefined.

  v.it('undo: a prop only in style returns to the style value', () => {
    let node!: lng.ElementNode;
    const dispose = renderer.render(() => (
      <view ref={node} style={{ color: RED, $focus: { color: BLUE } }} />
    ));
    node.states.add('$focus');
    node.states.remove('$focus');
    v.expect(node.color).toBe(RED);
    dispose();
  });

  v.it(
    'undo: a prop in both style and JSX returns to the STYLE value, not the JSX value',
    () => {
      let node!: lng.ElementNode;
      const dispose = renderer.render(() => (
        <view
          ref={node}
          style={{ color: RED, $focus: { color: BLUE } }}
          color={GREEN}
        />
      ));
      v.expect(node.color).toBe(GREEN);
      node.states.add('$focus');
      v.expect(node.color).toBe(BLUE);
      node.states.remove('$focus');
      v.expect(node.color).toBe(RED);
      dispose();
    },
  );

  v.it(
    'undo: a prop only in JSX, overridden by $focus, returns to undefined (the JSX value is lost)',
    () => {
      let node!: lng.ElementNode;
      const dispose = renderer.render(() => (
        <view ref={node} color={GREEN} style={{ $focus: { color: BLUE } }} />
      ));
      v.expect(node.color).toBe(GREEN);
      node.states.add('$focus');
      v.expect(node.color).toBe(BLUE);
      node.states.remove('$focus');
      v.expect(node.color).toBeUndefined();
      dispose();
    },
  );

  v.it('undo: a prop with no base value anywhere is written undefined', () => {
    // The DOM renderer reads back an undefined alpha as undefined and an
    // undefined scale as 1 (its getter is `props.scale ?? 1`).
    let node!: lng.ElementNode;
    const dispose = renderer.render(() => (
      <view ref={node} style={{ $focus: { alpha: 0.5, scale: 1.2 } }} />
    ));
    v.expect(node.alpha).toBe(1);
    node.states.add('$focus');
    v.expect(node.alpha).toBe(0.5);
    v.expect(node.scale).toBe(1.2);
    node.states.remove('$focus');
    v.expect(node.alpha).toBeUndefined();
    v.expect(node.scale).toBe(1);
    dispose();
  });

  v.it(
    'undo: a value a handler wrote while the state was on is replaced by the style value',
    () => {
      let node!: lng.ElementNode;
      const dispose = renderer.render(() => (
        <view ref={node} style={{ color: RED, $focus: { color: BLUE } }} />
      ));
      node.states.add('$focus');
      node.color = WHITE;
      v.expect(node.color).toBe(WHITE);
      node.states.remove('$focus');
      v.expect(node.color).toBe(RED);
      dispose();
    },
  );

  v.it(
    'undo: a handler write to a key the state does not touch survives the undo',
    () => {
      let node!: lng.ElementNode;
      const dispose = renderer.render(() => (
        <view
          ref={node}
          style={{ color: RED, alpha: 1, $focus: { color: BLUE } }}
        />
      ));
      node.states.add('$focus');
      node.alpha = 0.4;
      node.states.remove('$focus');
      v.expect(node.alpha).toBe(0.4);
      v.expect(node.color).toBe(RED);
      dispose();
    },
  );

  v.it(
    'undo: a reactive JSX prop that changes while the state is on wins until undo, then style wins',
    () => {
      let node!: lng.ElementNode;
      const [color, setColor] = s.createSignal(GREEN);
      const dispose = renderer.render(() => (
        <view
          ref={node}
          color={color()}
          style={{ color: RED, $focus: { color: BLUE } }}
        />
      ));
      node.states.add('$focus');
      setColor(WHITE);
      v.expect(node.color).toBe(WHITE);
      node.states.remove('$focus');
      v.expect(node.color).toBe(RED);
      dispose();
    },
  );

  // BUG: B18. The undo writes the base border object back, but a border
  // write merges its sub-props into the shader props, so the ones only the
  // $focus border named (border-gap, border-align) stay: a blurred node keeps
  // the focus gap. A blurred node must equal a never-focused one. Not fixed
  // in 1.7 (user decision at Checkpoint 2: the fix needed a per-node record
  // of every border and shadow write).
  v.it.skip(
    'BUG: B18: undo of a $focus border resets the border sub-props the base border does not name',
    () => {
      const Thumb: lng.NodeStyles = {
        width: 100,
        height: 100,
        borderRadius: 16,
        border: { width: 0, color: 0x00000000 },
        $focus: { border: { color: BLUE, width: 6, gap: 4, align: 'outside' } },
      };
      let focused!: lng.ElementNode;
      let never!: lng.ElementNode;
      const dispose = renderer.render(() => (
        <view>
          <view ref={focused} style={Thumb} />
          <view ref={never} style={Thumb} />
        </view>
      ));
      focused.states.add('$focus');
      v.expect(shaderProps(focused)['border-gap']).toBe(4);
      v.expect(shaderProps(focused)['border-w']).toBe(6);
      focused.states.remove('$focus');
      v.expect(shaderProps(focused)).toEqual(shaderProps(never));
      v.expect(focused.border).toBe(Thumb.border);
      dispose();
    },
  );

  v.it('undo: a theme value takes precedence over the style value', () => {
    let node!: lng.ElementNode;
    const dispose = renderer.render(() => (
      <view
        ref={node}
        theme={{ color: GREEN }}
        style={{ color: RED, $focus: { color: BLUE } }}
      />
    ));
    v.expect(node.color).toBe(GREEN);
    node.states.add('$focus');
    v.expect(node.color).toBe(BLUE);
    node.states.remove('$focus');
    v.expect(node.color).toBe(GREEN);
    dispose();
  });

  v.it(
    'the focus manager drives $focus: the focused node and its ancestors get it, and lose it on blur',
    async () => {
      let row!: lng.ElementNode;
      let a!: lng.ElementNode;
      let b!: lng.ElementNode;
      const Item = { color: RED, $focus: { color: BLUE } };
      const dispose = renderer.render(() => (
        <view ref={row} style={{ alpha: 0.5, $focus: { alpha: 1 } }}>
          <view ref={a} style={Item} />
          <view ref={b} style={Item} />
        </view>
      ));
      a.setFocus();
      await tick();
      v.expect(a.states.has(lng.Config.focusStateKey)).toBe(true);
      v.expect(a.color).toBe(BLUE);
      v.expect(row.alpha).toBe(1);
      v.expect(b.color).toBe(RED);

      b.setFocus();
      await tick();
      v.expect(a.states.has('$focus')).toBe(false);
      v.expect(a.color).toBe(RED);
      v.expect(b.color).toBe(BLUE);
      v.expect(row.alpha).toBe(1);
      dispose();
    },
  );
});

v.describe('contract: multiple states and Config.stateOrder', () => {
  let savedOrder: lng.DollarString[] | undefined;
  v.beforeEach(() => {
    savedOrder = lng.Config.stateOrder;
  });
  v.afterEach(() => {
    lng.Config.stateOrder = savedOrder;
  });

  v.it(
    'with an empty Config.stateOrder the state added last wins on shared keys',
    () => {
      lng.Config.stateOrder = [];
      let node!: lng.ElementNode;
      const dispose = renderer.render(() => (
        <view
          ref={node}
          style={{
            color: RED,
            $active: { color: GREEN },
            $focus: { color: BLUE },
          }}
        />
      ));
      node.states.add('$active');
      node.states.add('$focus');
      v.expect(node.color).toBe(BLUE);
      node.states.remove('$active');
      node.states.add('$active');
      v.expect(node.color).toBe(GREEN);
      dispose();
    },
  );

  v.it(
    'removing one of two states undoes only its keys; the other state is re-applied',
    () => {
      lng.Config.stateOrder = ['$active', '$focus'];
      let node!: lng.ElementNode;
      const dispose = renderer.render(() => (
        <view
          ref={node}
          style={{
            color: RED,
            alpha: 0.8,
            $active: { color: GREEN },
            $focus: { color: BLUE, alpha: 1, scale: 1.2 },
          }}
        />
      ));
      node.states.add('$active');
      node.states.add('$focus');
      v.expect(node.color).toBe(BLUE);
      v.expect(node.alpha).toBe(1);

      node.states.remove('$focus');
      v.expect(node.color).toBe(GREEN);
      v.expect(node.alpha).toBe(0.8);
      v.expect(node.scale).toBe(1);

      node.states.remove('$active');
      v.expect(node.color).toBe(RED);
      dispose();
    },
  );

  v.it(
    'stateOrder decides precedence whatever order the states were added in',
    () => {
      lng.Config.stateOrder = ['$active', '$focus'];
      let node!: lng.ElementNode;
      const dispose = renderer.render(() => (
        <view
          ref={node}
          style={{
            color: RED,
            $active: { color: GREEN },
            $focus: { color: BLUE },
          }}
        />
      ));
      node.states.add('$focus');
      node.states.add('$active');
      v.expect(node.color).toBe(BLUE);
      dispose();
    },
  );

  v.it(
    'a state with no block on the node is ignored when combined with others',
    () => {
      let node!: lng.ElementNode;
      const dispose = renderer.render(() => (
        <view
          ref={node}
          states={['$focus', '$unknown']}
          style={{ color: RED, $focus: { color: BLUE } }}
        />
      ));
      v.expect(node.color).toBe(BLUE);
      dispose();
    },
  );
});

v.describe('contract: forwardStates', () => {
  v.it(
    'children receive the parent states and apply their own $state blocks; removing undoes them',
    () => {
      let parent!: lng.ElementNode;
      let child!: lng.ElementNode;
      let label!: lng.ElementNode;
      const dispose = renderer.render(() => (
        <view
          ref={parent}
          forwardStates
          style={{ alpha: 0.5, $focus: { alpha: 1 } }}
        >
          <view ref={child} style={{ color: RED, $focus: { color: BLUE } }} />
          <text ref={label} style={{ color: WHITE, $focus: { color: GREEN } }}>
            Label
          </text>
        </view>
      ));
      parent.states.add('$focus');
      v.expect(parent.alpha).toBe(1);
      v.expect(statesOf(child)).toEqual(['$focus']);
      v.expect(child.color).toBe(BLUE);
      v.expect(statesOf(label)).toEqual(['$focus']);
      v.expect(label.color).toBe(GREEN);

      parent.states.remove('$focus');
      v.expect(statesOf(child)).toEqual([]);
      v.expect(child.color).toBe(RED);
      v.expect(label.color).toBe(WHITE);
      dispose();
    },
  );

  v.it(
    'children get a copy: a child can change its own states afterwards without touching the parent',
    () => {
      let parent!: lng.ElementNode;
      let a!: lng.ElementNode;
      let b!: lng.ElementNode;
      const dispose = renderer.render(() => (
        <view ref={parent} forwardStates>
          <view ref={a} style={{ color: RED, $active: { color: GREEN } }} />
          <view ref={b} style={{ color: RED, $active: { color: GREEN } }} />
        </view>
      ));
      parent.states.add('$focus');
      a.states.add('$active');
      v.expect(statesOf(a)).toEqual(['$focus', '$active']);
      v.expect(a.color).toBe(GREEN);
      v.expect(statesOf(b)).toEqual(['$focus']);
      v.expect(statesOf(parent)).toEqual(['$focus']);
      dispose();
    },
  );

  v.it(
    "a child's own states are overwritten by the parent's states (current behaviour)",
    () => {
      // Pinned as is: the brief notes forwardStates overwrites the children's
      // own states. The child's $active is dropped when the parent's states
      // change, and stays dropped after the parent's state is removed.
      let parent!: lng.ElementNode;
      let child!: lng.ElementNode;
      const dispose = renderer.render(() => (
        <view ref={parent} forwardStates>
          <view
            ref={child}
            states="$active"
            style={{
              color: RED,
              $active: { color: GREEN, alpha: 0.3 },
              $focus: { color: BLUE },
            }}
          />
        </view>
      ));
      v.expect(statesOf(child)).toEqual(['$active']);
      v.expect(child.color).toBe(GREEN);
      v.expect(child.alpha).toBe(0.3);

      parent.states.add('$focus');
      v.expect(statesOf(child)).toEqual(['$focus']);
      v.expect(child.color).toBe(BLUE);
      // $active's alpha was undone; the style has no alpha, so it is undefined.
      v.expect(child.alpha).toBeUndefined();

      parent.states.remove('$focus');
      v.expect(statesOf(child)).toEqual([]);
      v.expect(child.color).toBe(RED);
      dispose();
    },
  );

  v.it(
    "initial render: the parent's initial states replace a child's initial states",
    () => {
      let child!: lng.ElementNode;
      const dispose = renderer.render(() => (
        <view forwardStates states="$focus">
          <view
            ref={child}
            states="$active"
            style={{
              color: RED,
              $active: { color: GREEN, alpha: 0.3 },
              $focus: { color: BLUE },
            }}
          />
        </view>
      ));
      v.expect(statesOf(child)).toEqual(['$focus']);
      v.expect(child.color).toBe(BLUE);
      v.expect(child.alpha).toBe(1);
      dispose();
    },
  );

  v.it(
    "a child inserted later does not get the parent's current states until they change again",
    () => {
      // Pinned as is: states are forwarded only when the parent's states change
      // (or when the parent first renders with states).
      let parent!: lng.ElementNode;
      let late!: lng.ElementNode;
      const [show, setShow] = s.createSignal(false);
      const Child = { color: RED, $focus: { color: BLUE } };
      const dispose = renderer.render(() => (
        <view ref={parent} forwardStates>
          <s.Show when={show()}>
            <view ref={late} style={Child} />
          </s.Show>
        </view>
      ));
      parent.states.add('$focus');
      setShow(true);
      v.expect(statesOf(late)).toEqual([]);
      v.expect(late.color).toBe(RED);

      parent.states.add('$active');
      v.expect(statesOf(late)).toEqual(['$focus', '$active']);
      v.expect(late.color).toBe(BLUE);
      dispose();
    },
  );

  v.it(
    'forwarding goes one level down unless the child also sets forwardStates',
    () => {
      let parent!: lng.ElementNode;
      let plainChild!: lng.ElementNode;
      let plainGrandchild!: lng.ElementNode;
      let forwardingChild!: lng.ElementNode;
      let forwardedGrandchild!: lng.ElementNode;
      const dispose = renderer.render(() => (
        <view ref={parent} forwardStates>
          <view ref={plainChild}>
            <view ref={plainGrandchild} />
          </view>
          <view ref={forwardingChild} forwardStates>
            <view ref={forwardedGrandchild} />
          </view>
        </view>
      ));
      parent.states.add('$focus');
      v.expect(statesOf(plainChild)).toEqual(['$focus']);
      v.expect(statesOf(plainGrandchild)).toEqual([]);
      v.expect(statesOf(forwardingChild)).toEqual(['$focus']);
      v.expect(statesOf(forwardedGrandchild)).toEqual(['$focus']);
      dispose();
    },
  );
});
