// Which rounded shader a node gets: `roundedWithBorder` only while its border
// has a width above 0, `rounded` otherwise, swapping when the width changes
// after render. The node is an ElementNode on a headless core with the
// default shader types registered; the shader is the renderer's ShaderNode,
// whose `shaderType` is the registered type object.
import * as v from 'vitest';
import { RendererCore } from '@solidtv/renderer';
import { Config } from '../src/core/config.js';
import { ElementNode } from '../src/core/node/ElementNode.js';
import { syncShaderType } from '../src/core/node/shader.js';
import { NodeType } from '../src/core/nodeTypes.js';
import {
  defaultShaderRounded,
  defaultShaderRoundedWithBorder,
  defaultShaderRoundedWithBorderAndShadow,
  defaultShaderRoundedWithShadow,
  registerDefaultShaders,
} from '../src/core/shaders.js';

const RED = 0xff0000ff;

// The registered name of each type, by the type object a shader carries.
const NAMES = new Map<unknown, string>([
  [defaultShaderRounded, 'rounded'],
  [defaultShaderRoundedWithBorder, 'roundedWithBorder'],
  [defaultShaderRoundedWithShadow, 'roundedWithShadow'],
  [defaultShaderRoundedWithBorderAndShadow, 'roundedWithBorderWithShadow'],
]);

/** The registered type name of the node's shader. */
const shaderType = (node: ElementNode) =>
  node._shader === undefined ? undefined : NAMES.get(node._shader.shaderType);

/** The node's facade props. */
const propsOf = (node: ElementNode) => node._shader!.props;

/**
 * One view with the given props written, then attached: attach turns the
 * shader props into the shader (Task 8 does it; here the same call).
 */
function renderView(write: (node: ElementNode) => void) {
  const core = new RendererCore({ appWidth: 640, appHeight: 360 });
  registerDefaultShaders(core);
  const node = new ElementNode(core, NodeType.Element);
  write(node);
  node.rendered = true;
  Config.convertToShader(node);
  return node;
}

v.describe('rounded shader type from the border width', () => {
  v.test('a border of width 0 renders with the rounded shader', () => {
    const node = renderView((n) => {
      n.borderRadius = 8;
      n.border = { width: 0, color: RED };
    });
    v.expect(shaderType(node)).toBe('rounded');
  });

  v.test('a border width array of zeros renders with rounded', () => {
    const node = renderView((n) => {
      n.borderRadius = 8;
      n.border = { width: [0, 0, 0, 0], color: RED };
    });
    v.expect(shaderType(node)).toBe('rounded');
  });

  v.test('one side above 0 renders with roundedWithBorder', () => {
    const node = renderView((n) => {
      n.borderRadius = 8;
      n.border = { width: [0, 2, 0, 0], color: RED };
    });
    v.expect(shaderType(node)).toBe('roundedWithBorder');
  });

  v.test('a border side of width 0 renders with rounded', () => {
    const node = renderView((n) => {
      n.borderRadius = 8;
      n.borderTop = { width: 0, color: RED };
    });
    v.expect(shaderType(node)).toBe('rounded');
  });

  v.test('a border of width 0 with a shadow renders roundedWithShadow', () => {
    const node = renderView((n) => {
      n.borderRadius = 8;
      n.border = { width: 0, color: RED };
      n.shadow = { color: 0x000000ff, blur: 8, spread: 2, x: 0, y: 0 };
    });
    v.expect(shaderType(node)).toBe('roundedWithShadow');
  });

  v.test(
    'a width set after render swaps in roundedWithBorder, keeping the radius and color',
    () => {
      const node = renderView((n) => {
        n.borderRadius = 8;
        n.border = { width: 0, color: RED };
      });
      node.border = { width: 4 };
      v.expect(shaderType(node)).toBe('roundedWithBorder');
      v.expect(propsOf(node).radius).toEqual([8, 8, 8, 8]);
      v.expect(propsOf(node)['border-color']).toBe(RED);
      v.expect(propsOf(node)['border-width']).toEqual([4, 4, 4, 4]);
    },
  );

  v.test('a width back to 0 after render swaps back to rounded', () => {
    const node = renderView((n) => {
      n.borderRadius = 8;
      n.border = { width: 4, color: RED };
    });
    v.expect(shaderType(node)).toBe('roundedWithBorder');
    node.border = { width: 0, color: RED };
    v.expect(shaderType(node)).toBe('rounded');
    v.expect(propsOf(node).radius).toEqual([8, 8, 8, 8]);
  });

  v.test('a $focus border width swaps the shader on focus and blur', () => {
    // A state block writes its border object through the accessor (Task 7
    // wires the states); the base and the $focus objects are written here.
    const base = { width: 0, color: RED };
    const focus = { width: 4, color: RED };
    const node = renderView((n) => {
      n.borderRadius = 8;
      n.border = base;
    });
    v.expect(shaderType(node)).toBe('rounded');
    node.border = focus;
    v.expect(shaderType(node)).toBe('roundedWithBorder');
    v.expect(propsOf(node)['border-width']).toEqual([4, 4, 4, 4]);
    node.border = base;
    v.expect(shaderType(node)).toBe('rounded');
  });

  v.test('effects with a border width swap in roundedWithBorder', () => {
    // `effects` is gone (it was a second entry point for the border props):
    // the width goes through `border`.
    const node = renderView((n) => {
      n.borderRadius = 8;
      n.border = { width: 0, color: RED };
    });
    v.expect('effects' in node).toBe(false);
    node.border = { width: 3 };
    v.expect(shaderType(node)).toBe('roundedWithBorder');
    v.expect(propsOf(node)['border-width']).toEqual([3, 3, 3, 3]);
  });

  v.test('a shader set with the shader prop is never swapped', () => {
    const node = renderView((n) => {
      n.borderRadius = 8;
      n.border = { width: 0, color: RED };
    });
    node.shader = ['roundedWithShadow', { radius: 8 }];
    node.border = { width: 4 };
    v.expect(shaderType(node)).toBe('roundedWithShadow');
  });

  v.test(
    'an animated width swaps in roundedWithBorder before the animation starts',
    () => {
      const node = renderView((n) => {
        n.borderRadius = 8;
        n.border = { width: 0, color: RED };
        n.transition = { border: { duration: 10 } };
      });
      // What the animation reads its start values from is the swapped-in
      // shader: the type is already roundedWithBorder after the write, and
      // the width starts at 0.
      node.border = { width: 4, color: RED };
      v.expect(shaderType(node)).toBe('roundedWithBorder');
      v.expect(propsOf(node)['border-width']).toEqual([0, 0, 0, 0]);
      node.core.step(10);
      node.core.update();
      v.expect(propsOf(node)['border-width']).toEqual([4, 4, 4, 4]);
    },
  );

  v.test(
    'an animated width back to 0 keeps roundedWithBorder until the animation stops',
    () => {
      const node = renderView((n) => {
        n.borderRadius = 8;
        n.border = { width: 4, color: RED };
      });
      v.expect(shaderType(node)).toBe('roundedWithBorder');
      // Starting the animation to 0 (Task 6 calls it with the animated keys).
      syncShaderType(node, { 'border-width': 0 });
      v.expect(shaderType(node)).toBe('roundedWithBorder');
      // The animation stopped: the width is 0 and the type follows.
      node._shaderProps!['border-width'] = 0;
      syncShaderType(node);
      v.expect(shaderType(node)).toBe('rounded');
    },
  );
});
