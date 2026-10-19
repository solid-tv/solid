// States and `$state` blocks on the 2.0 ElementNode (src/core/node), on a
// headless core: the JSX host builds the old node until Task 8, so `style`,
// `states` and the blocks are written directly, and `attach` below does what
// attach does with states (1.8's render: the states are applied, then the
// node is rendered).
import * as v from 'vitest';
import { F_ALPHA, F_STRIDE, RendererCore } from '@solidtv/renderer';
import { Config } from '../src/core/config.js';
import type { DollarString } from '../src/core/intrinsicTypes.js';
import { ElementNode } from '../src/core/node/ElementNode.js';
import { SET_BORDER, SET_BORDER_TOP } from '../src/core/node/defaults.js';
import { convertToShader } from '../src/core/node/shader.js';
import { setStateBlock } from '../src/core/node/styles.js';
import { NodeType } from '../src/core/nodeTypes.js';
import {
  defaultShaderRounded,
  defaultShaderRoundedWithBorder,
  registerDefaultShaders,
} from '../src/core/shaders.js';
import { createStates } from '../src/core/states.js';

const RED = 0xff0000ff;
const GREEN = 0x00ff00ff;
const BLUE = 0x0000ffff;
const WHITE = 0xffffffff;

function headless(): RendererCore {
  const core = new RendererCore({ appWidth: 640, appHeight: 360 });
  registerDefaultShaders(core);
  return core;
}

/** A view (or a text) on `core`, not attached. */
const view = (core: RendererCore, type: 'element' | 'textNode' = 'element') =>
  new ElementNode(
    core,
    type === 'element' ? NodeType.Element : NodeType.TextNode,
  );

/** What attach does with states and the shader props (Task 8). */
function attach(node: ElementNode): void {
  if (node._states !== undefined) {
    node._stateChanged();
  }
  node.rendered = true;
  convertToShader(node);
}

let savedOrder: DollarString[] | undefined;
v.beforeEach(() => {
  savedOrder = Config.stateOrder;
  // Undoing a key with no base value logs a dev warning.
  v.vi.spyOn(console, 'warn').mockImplementation(() => {});
});
v.afterEach(() => {
  Config.stateOrder = savedOrder;
  v.vi.restoreAllMocks();
});

v.describe('State Specificity', () => {
  v.test('Applies states in the order defined by Config.stateOrder', () => {
    // Define mapper: $active has lower specificity than $focus
    Config.stateOrder = ['$active', '$focus'];

    const node = view(headless());
    node.color = 0xff0000ff; // default red
    node.states = ['$focus', '$active']; // passed in reverse order to ensure sorting works
    setStateBlock(node, '$active', {
      color: 0x00ff00ff, // green
      scale: 1.5,
      alpha: 0.5,
    });
    setStateBlock(node, '$focus', {
      color: 0x0000ffff, // blue
      scale: 2.0,
    });
    attach(node);

    // Since $focus is after $active in stateOrder, $focus should win where properties collide
    v.assert.equal(node.color, 0x0000ffff);
    v.assert.equal(node.scale, 2.0);
    // alpha is only in $active, so it should still apply
    v.assert.equal(node.alpha, 0.5);
  });

  v.test('Unmapped states have lower specificity than mapped ones', () => {
    // Only map $focus
    Config.stateOrder = ['$focus'];

    const node = view(headless());
    node.color = 0xff0000ff; // default red
    node.states = ['$focus', '$hover']; // hover is unmapped
    setStateBlock(node, '$hover', {
      color: 0x00ff00ff, // green
      scale: 1.5,
      alpha: 0.5,
    });
    setStateBlock(node, '$focus', {
      color: 0x0000ffff, // blue
      scale: 2.0,
    });
    attach(node);

    // even though $hover comes after $focus in the states array, it is unmapped,
    // so it has lower specificity than $focus
    v.assert.equal(node.color, 0x0000ffff);
    v.assert.equal(node.scale, 2.0);
    v.assert.equal(node.alpha, 0.5);
  });

  v.test('Element-level stateOrder overrides global Config.stateOrder', () => {
    // Global order: $focus > $active
    Config.stateOrder = ['$active', '$focus'];

    const node = view(headless());
    node.color = 0xff0000ff;
    node.states = ['$focus', '$active'];
    node.stateOrder = ['$focus', '$active']; // Override: $active > $focus
    setStateBlock(node, '$active', {
      color: 0x00ff00ff, // green
    });
    setStateBlock(node, '$focus', {
      color: 0x0000ffff, // blue
    });
    attach(node);

    // Local override says $active is higher specificity, so color should be green
    v.assert.equal(node.color, 0x00ff00ff);
  });
});

v.describe('States copies a list by index', () => {
  /** A list whose iterator throws: a spread of it fails. */
  function noIterator<T extends string[]>(list: T): T {
    Object.defineProperty(list, Symbol.iterator, {
      value() {
        throw new Error('iterated');
      },
    });
    return list;
  }

  v.test(
    'merge takes an array or another States (forwardStates) without iterating it, in place',
    () => {
      const states = createStates(() => {}, ['$a', '$b', '$c']);
      const parent = noIterator(createStates(() => {}, ['$x']));

      v.expect(states.merge(parent)).toBe(states);
      v.expect([...states]).toEqual(['$x']);

      states.merge(noIterator(['$p', '$q'] as DollarString[]));
      v.expect([...states]).toEqual(['$p', '$q']);

      // A self-merge clears the list, as in 1.6.
      states.merge(states);
      v.expect([...states]).toEqual([]);

      states.merge('$s');
      v.expect([...states]).toEqual(['$s']);

      states.merge({ $t: true, $s: false });
      v.expect([...states]).toEqual(['$t']);

      states.merge([]);
      v.expect(states.length).toBe(0);
    },
  );

  v.test('the constructor takes an array without iterating it', () => {
    const states = createStates(
      () => {},
      noIterator(['$a', '$b'] as DollarString[]),
    );
    v.expect([...states]).toEqual(['$a', '$b']);
    v.expect(createStates(() => {}, '$c').slice()).toEqual(['$c']);
    v.expect(createStates(() => {}, { $d: true, $e: false }).slice()).toEqual([
      '$d',
    ]);
  });
});

v.describe('States is a plain Array', () => {
  // V8's fast push and pop take only an Array of the initial prototype; on an
  // Array subclass the generic path drops the backing store when the list
  // empties, and the next add allocates a new one (76 bytes per focus change).
  v.test('of the initial prototype, its methods own and non-enumerable', () => {
    const states = createStates(() => {}, ['$a']);
    v.expect(Object.getPrototypeOf(states)).toBe(Array.prototype);
    v.expect(Array.isArray(states)).toBe(true);
    v.expect(Object.keys(states)).toEqual(['0']);
    const keys: string[] = [];
    for (const k in states) keys.push(k);
    v.expect(keys).toEqual(['0']);
  });

  v.test(
    'emptied and refilled, it keeps its methods and calls onChange',
    () => {
      const onChange = v.vi.fn();
      const states = createStates(onChange);
      states.add('$focus');
      states.remove('$focus');
      v.expect(states.length).toBe(0);
      states.add('$focus');
      v.expect([...states]).toEqual(['$focus']);
      v.expect(onChange).toHaveBeenCalledTimes(3);
      states.merge(['$a', '$b']);
      states.merge([]);
      v.expect(states.length).toBe(0);
      v.expect(states.has('$a')).toBe(false);
    },
  );
});

v.describe('style, theme and the undo of a $state block', () => {
  v.test(
    'undo with no base value writes the default and the node reads it',
    () => {
      const core = headless();
      const node = view(core);
      node.style = { $focus: { alpha: 0.5 } };
      attach(node);
      node.states.add('$focus');
      v.expect(node.alpha).toBe(0.5);
      node.states.remove('$focus');
      v.expect(node.alpha).toBe(1);
      v.expect(core.nodes.f64[node.slot * F_STRIDE + F_ALPHA]).toBe(1);
    },
  );

  v.test(
    'undo with no base value: color transparent, scale 1, clipping off, src none',
    () => {
      const node = view(headless());
      node.style = {
        $focus: { color: BLUE, scale: 1.2, clipping: true, src: 'a.png' },
      };
      attach(node);
      node.states.add('$focus');
      v.expect(node.color).toBe(BLUE);
      v.expect(node.clipping).toBe(true);
      v.expect(node.src).toBe('a.png');
      node.states.remove('$focus');
      v.expect(node.color).toBe(0x00000000);
      v.expect(node.scale).toBe(1);
      v.expect(node.clipping).toBe(false);
      v.expect(node.src).toBe(null);
    },
  );

  v.test('undo with no base value: a text prop reads its text default', () => {
    const text = view(headless(), 'textNode');
    text.style = { $focus: { fontSize: 40, lineHeight: 2 } };
    attach(text);
    text.states.add('$focus');
    v.expect(text.fontSize).toBe(40);
    text.states.remove('$focus');
    v.expect(text.fontSize).toBe(16);
    v.expect(text.lineHeight).toBe(1.2);
  });

  v.test(
    'undo with no base value: a $focus border is taken off the shader',
    () => {
      const node = view(headless());
      node.style = {
        borderRadius: 8,
        $focus: { border: { width: 4, color: RED, gap: 2 } },
      };
      attach(node);
      v.expect(node._shader!.shaderType).toBe(defaultShaderRounded);
      node.states.add('$focus');
      v.expect(node._shader!.shaderType).toBe(defaultShaderRoundedWithBorder);
      v.expect(node._shader!.props['border-gap']).toBe(2);
      node.states.remove('$focus');
      v.expect(node.border).toBeUndefined();
      v.expect(node._shader!.shaderType).toBe(defaultShaderRounded);
      v.expect(node._shader!.props.radius).toEqual([8, 8, 8, 8]);
      v.expect(node._shaderProps!['border-width']).toBeUndefined();
      v.expect(node._shaderProps!['border-gap']).toBeUndefined();
    },
  );

  v.test(
    'undo with no base value: a node whose only shader prop was the $focus border has no shader again',
    () => {
      const node = view(headless());
      node.style = { $focus: { border: { width: 4, color: RED } } };
      attach(node);
      v.expect(node._shader).toBeUndefined();
      node.states.add('$focus');
      v.expect(node._shader!.shaderType).toBe(defaultShaderRoundedWithBorder);
      node.states.remove('$focus');
      v.expect(node._shader).toBeUndefined();
      // No value is not a value the app set.
      v.expect(node._set[SET_BORDER]).toBe(0);
    },
  );

  v.test(
    'undo with no base value of a border side keeps what the border names',
    () => {
      const node = view(headless());
      node.style = {
        borderRadius: 8,
        border: { width: 2, color: RED },
        $focus: { borderTop: { width: 4, color: BLUE } },
      };
      attach(node);
      node.states.add('$focus');
      v.expect(node._shader!.props['border-color']).toBe(BLUE);
      node.states.remove('$focus');
      // The side's keys are cleared; the border's colour is merged back.
      v.expect(node.borderTop).toBeUndefined();
      v.expect(node._shader!.props['border-color']).toBe(RED);
      v.expect(node._shader!.props['border-width']).toEqual([2, 2, 2, 2]);
      v.expect(node._set[SET_BORDER_TOP]).toBe(0);
    },
  );

  v.test('a JSX prop written undefined does not block the style value', () => {
    const node = view(headless());
    (node as { color: number | undefined }).color = undefined;
    node.style = { color: RED };
    v.expect(node.color).toBe(RED);
  });

  v.test('a $focus border width swaps the shader on focus and blur', () => {
    const node = view(headless());
    node.style = {
      borderRadius: 8,
      border: { width: 0, color: RED },
      $focus: { border: { width: 4, color: RED } },
    };
    attach(node);
    v.expect(node._shader!.shaderType).toBe(defaultShaderRounded);
    node.states.add('$focus');
    v.expect(node._shader!.shaderType).toBe(defaultShaderRoundedWithBorder);
    v.expect(node._shader!.props['border-width']).toEqual([4, 4, 4, 4]);
    node.states.remove('$focus');
    v.expect(node._shader!.shaderType).toBe(defaultShaderRounded);
  });

  v.test('undo writes theme[key], else style[key]', () => {
    const node = view(headless());
    node.theme = { color: GREEN };
    node.style = { color: RED, alpha: 0.8, $focus: { color: BLUE, alpha: 1 } };
    attach(node);
    v.expect(node.color).toBe(GREEN);
    v.expect(node.alpha).toBe(0.8);
    node.states.add('$focus');
    v.expect(node.color).toBe(BLUE);
    node.states.remove('$focus');
    v.expect(node.color).toBe(GREEN);
    v.expect(node.alpha).toBe(0.8);
  });

  v.test(
    'a prop the app wrote wins over the style; one it did not is written',
    () => {
      const node = view(headless());
      node.color = GREEN;
      node.alpha = 1;
      node.style = { color: RED, alpha: 0.5, x: 10, fontSize: 30 };
      v.expect(node.color).toBe(GREEN);
      v.expect(node.alpha).toBe(1);
      v.expect(node.x).toBe(10);
      v.expect(node.fontSize).toBe(30);
    },
  );

  v.test('a plain field the app set wins over the style too', () => {
    const node = view(headless());
    node.display = 'block';
    node.style = { display: 'flex', flexDirection: 'column' };
    v.expect(node.display).toBe('block');
    v.expect(node.flexDirection).toBe('column');
  });

  v.test('a second style is ignored under Config.lockStyles', () => {
    const saved = Config.lockStyles;
    try {
      Config.lockStyles = true;
      const node = view(headless());
      const first = { color: RED };
      node.style = first;
      node.style = { color: BLUE };
      v.expect(node.style).toBe(first);
      v.expect(node.color).toBe(RED);
    } finally {
      Config.lockStyles = saved;
    }
  });

  v.test('a $state block written on the node wins over the style block', () => {
    const node = view(headless());
    node.style = { color: RED, $focus: { color: BLUE } };
    setStateBlock(node, '$focus', { color: GREEN });
    attach(node);
    node.states.add('$focus');
    v.expect(node.color).toBe(GREEN);
    node.states.remove('$focus');
    v.expect(node.color).toBe(RED);
  });

  v.test(
    'a $focus block with its own transition is applied transition first, so its keys animate',
    () => {
      const core = headless();
      const node = view(core);
      node.style = {
        scale: 1,
        $focus: { scale: 1.2, transition: { scale: { duration: 100 } } },
      };
      attach(node);
      node.states.add('$focus');
      // The animation writes the store, not the setter.
      v.expect(node.scale).toBe(1);
      core.step(100);
      core.update();
      v.expect(node.scale).toBe(1.2);
      // Undo: `scale` comes before `transition` in the block, so the scale
      // undo animates and transition then goes back to none.
      node.states.remove('$focus');
      v.expect(node.scale).toBe(1.2);
      v.expect(node.transition).toBeUndefined();
      core.step(100);
      core.update();
      v.expect(node.scale).toBe(1);
    },
  );
});

v.describe('setting states', () => {
  v.test('an unchanged list is not applied again, in every form', () => {
    const node = view(headless());
    node.style = { color: RED, $focus: { color: BLUE } };
    node.states = ['$focus'];
    attach(node);
    v.expect(node.color).toBe(BLUE);
    const writeStates = v.vi.spyOn(node, '_writeStates');
    node.color = WHITE;
    node.states = ['$focus'];
    node.states = '$focus';
    node.states = { $focus: true, $active: false };
    const own = node.states;
    node.states = own;
    v.expect(writeStates).not.toHaveBeenCalled();
    v.expect(node.color).toBe(WHITE);
    node.states = [];
    v.expect(node.color).toBe(RED);
  });

  v.test('states with no block allocate no undo bookkeeping', () => {
    const node = view(headless());
    attach(node);
    node.states.add('$focus');
    node.states = ['$focus', '$active'];
    v.expect(node._undoStyles).toBeUndefined();
    v.expect(node._applied).toBeUndefined();
  });

  v.test(
    'forwardStates gives the children the states; they apply their own blocks',
    () => {
      const core = headless();
      const parent = view(core);
      const child = view(core);
      parent.forwardStates = true;
      parent.children.push(child);
      child.parent = parent;
      child.style = { color: RED, $focus: { color: BLUE } };
      attach(parent);
      attach(child);
      parent.states.add('$focus');
      v.expect([...child.states]).toEqual(['$focus']);
      v.expect(child.color).toBe(BLUE);
      parent.states.remove('$focus');
      v.expect([...child.states]).toEqual([]);
      v.expect(child.color).toBe(RED);
    },
  );

  v.test('style, theme, states and a $state block add no field', () => {
    const core = headless();
    const plain = view(core);
    const styled = view(core);
    styled.theme = { alpha: 0.5 };
    styled.style = { color: RED, $focus: { color: BLUE } };
    setStateBlock(styled, '$active', { scale: 2 });
    styled.forwardStates = true;
    styled.stateOrder = ['$focus'];
    attach(styled);
    styled.states.add('$focus');
    styled.states.add('$active');
    styled.states.remove('$focus');
    v.expect(Object.keys(styled)).toEqual(Object.keys(plain));
  });
});
