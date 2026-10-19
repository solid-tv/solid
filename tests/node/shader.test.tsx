import { describe, expect, it, vi } from 'vitest';
import { NULL, RendererCore } from '@solidtv/renderer';
import { Config } from '../../src/core/config.js';
import { ElementNode } from '../../src/core/node/ElementNode.js';
import {
  SET_BORDER,
  SET_BORDER_RADIUS,
  SET_BORDER_TOP,
  SET_HOLE_PUNCH,
  SET_LINEAR_GRADIENT,
  SET_SHADER,
  SET_SHADOW,
} from '../../src/core/node/defaults.js';
import {
  SHADER_UNMANAGED,
  convertToShader,
  shaderParse,
  syncShaderType,
} from '../../src/core/node/shader.js';
import { NodeType } from '../../src/core/nodeTypes.js';
import {
  defaultShaderHolePunch,
  defaultShaderLinearGradient,
  defaultShaderRadialGradient,
  defaultShaderRounded,
  defaultShaderRoundedWithBorder,
  defaultShaderRoundedWithBorderAndShadow,
  defaultShaderRoundedWithShadow,
  registerDefaultShaders,
} from '../../src/core/shaders.js';

const RED = 0xff0000ff;

/** A headless core with the default shader types registered. */
function headless(): RendererCore {
  const core = new RendererCore({ appWidth: 640, appHeight: 360 });
  registerDefaultShaders(core);
  return core;
}

// The registered name of each default type, by the type object a shader
// carries (the facade's `shaderType`).
const NAMES = new Map<unknown, string>([
  [defaultShaderRounded, 'rounded'],
  [defaultShaderRoundedWithBorder, 'roundedWithBorder'],
  [defaultShaderRoundedWithShadow, 'roundedWithShadow'],
  [defaultShaderRoundedWithBorderAndShadow, 'roundedWithBorderWithShadow'],
  [defaultShaderHolePunch, 'holePunch'],
  [defaultShaderRadialGradient, 'radialGradient'],
  [defaultShaderLinearGradient, 'linearGradient'],
]);

function typeName(node: ElementNode): string | undefined {
  return node._shader === undefined
    ? undefined
    : NAMES.get(node._shader.shaderType);
}

/** What attach does with the shader props (Task 8). */
function attach(node: ElementNode): void {
  node.rendered = true;
  if (node._shader === undefined && node._shaderProps !== undefined) {
    Config.convertToShader(node);
  }
}

/** A rendered view with a radius, as the border cases start. */
function rendered(): { core: RendererCore; node: ElementNode } {
  const core = headless();
  const node = new ElementNode(core, NodeType.Element);
  node.borderRadius = 8;
  node.border = { width: 0, color: RED };
  attach(node);
  return { core, node };
}

describe('ElementNode shader props', () => {
  it('border width 0 gives the rounded shader; above 0 roundedWithBorder; back to 0 swaps back', () => {
    const { node } = rendered();
    expect(typeName(node)).toBe('rounded');
    node.border = { width: 4, color: RED };
    expect(typeName(node)).toBe('roundedWithBorder');
    node.border = { width: 0, color: RED };
    expect(typeName(node)).toBe('rounded');
    // The radius made it through both swaps.
    expect(node._shader!.props.radius).toEqual([8, 8, 8, 8]);
  });

  it('a border object is parsed once per identity', () => {
    const border = { color: RED, width: 2, gap: 4 };
    const parse = shaderParse('border', border);
    expect(shaderParse('border', border)).toBe(parse);
    // Facade keys only: no `border` entry, width is `border-width`.
    expect(parse.keys).toEqual(['border-color', 'border-width', 'border-gap']);
    expect(parse.values).toEqual([RED, 2, 4]);
    expect(parse.cached).toBe(true);
    // One cache per style key: the same object under a side is another parse.
    const side = shaderParse('borderTop', border);
    expect(side).not.toBe(parse);
    expect(side.keys).toEqual(['border-color', 'border-top', 'border-gap']);
    // `w` and `width` merge, the later one winning.
    expect(shaderParse('border', { w: 1, width: 3 }).keys).toEqual([
      'border-width',
    ]);
    expect(shaderParse('border', { w: 1, width: 3 }).values).toEqual([3]);
    // A getter keeps the parse from being cached: it is read again.
    let n = 0;
    const live = {
      get width() {
        return ++n;
      },
    };
    expect(shaderParse('border', live).cached).toBe(false);
    expect(shaderParse('border', live)).not.toBe(shaderParse('border', live));
    expect(shaderParse('shadow', { blur: 8 }).keys).toEqual(['shadow-blur']);
  });

  it('the facade receives flattened keys only', () => {
    const { node } = rendered();
    node.border = { width: 3, color: RED, gap: 2 };
    const props = node._shader!.props;
    expect(props['border-width']).toEqual([3, 3, 3, 3]);
    expect(props['border-color']).toBe(RED);
    expect(props['border-gap']).toBe(2);
    // The raw object is not a shader prop, and `border-w` is gone.
    expect(props.border).toBeUndefined();
    expect(props['border-w']).toBeUndefined();
    expect(node.border).toEqual({ width: 3, color: RED, gap: 2 });
  });

  it('a border written without a colour keeps the colour across a swap', () => {
    const { node } = rendered();
    node.border = { width: 4 };
    expect(typeName(node)).toBe('roundedWithBorder');
    expect(node._shader!.props['border-color']).toBe(RED);
    expect(node._shader!.props['border-width']).toEqual([4, 4, 4, 4]);
    expect(node._shader!.props.radius).toEqual([8, 8, 8, 8]);
    // The getter still returns what was written last.
    expect(node.border).toEqual({ width: 4 });
  });

  it('a side writes its width as the side', () => {
    const { node } = rendered();
    node.borderTop = { width: 2, color: RED };
    expect(typeName(node)).toBe('roundedWithBorder');
    const props = node._shader!.props;
    expect(props['border-top']).toBe(2);
    expect(props['border-width']).toEqual([2, 0, 0, 0]);
    expect(props['border-color']).toBe(RED);
  });

  it('linearGradient replaces the rounded shader', () => {
    const { core, node } = rendered();
    const rounded = node._shader;
    expect(typeName(node)).toBe('rounded');
    node.linearGradient = { colors: [RED, 0x0000ffff], angle: 1 };
    expect(typeName(node)).toBe('linearGradient');
    expect(node._shader).not.toBe(rounded);
    // One slot: the store holds the gradient, not the rounded shader.
    expect(core.nodes.shaderRefs[node.slot]).toBe(node._shader);
    expect(node._shader!.props.angle).toBe(1);
    // It is not swapped by a border width, and the radius is not its prop.
    node.border = { width: 4, color: RED };
    expect(typeName(node)).toBe('linearGradient');
    // Taking it away brings the rounded shader of the border props back.
    node.linearGradient = undefined;
    expect(typeName(node)).toBe('roundedWithBorder');
    expect(core.nodes.shaderRefs[node.slot]).toBe(node._shader);
  });

  it('radialGradient and holePunch replace the shader too', () => {
    const { core, node } = rendered();
    node.radialGradient = { colors: [RED, 0x0000ffff] };
    expect(typeName(node)).toBe('radialGradient');
    node.holePunch = { x: 10, y: 10, w: 20, h: 20, radius: 4 };
    expect(typeName(node)).toBe('holePunch');
    expect(node._shader!.props.w).toBe(20);
    expect(core.nodes.shaderRefs[node.slot]).toBe(node._shader);
  });

  it('border transition animates through the shader track', () => {
    const { core, node } = rendered();
    node.transition = { border: { duration: 10 } };
    node.border = { width: 4, color: RED };
    // The border shader is swapped in before the animation reads its start.
    expect(typeName(node)).toBe('roundedWithBorder');
    const props = node._shader!.props;
    expect(props['border-width']).toEqual([0, 0, 0, 0]);
    expect(props['border-color']).toBe(RED);
    // The bag holds the target at once (the getter, a later swap, undo).
    expect(node._shaderProps!['border-width']).toBe(4);
    core.step(5);
    core.update();
    expect(node._shader!.props['border-width']).toEqual([2, 2, 2, 2]);
    core.step(5);
    core.update();
    expect(node._shader!.props['border-width']).toEqual([4, 4, 4, 4]);
    // Back to 0: the border shader stays while the width animates down,
    // and the stop (syncShaderType from onStop) swaps rounded back in.
    node.border = { width: 0, color: RED };
    expect(typeName(node)).toBe('roundedWithBorder');
    core.step(5);
    core.update();
    expect(typeName(node)).toBe('roundedWithBorder');
    expect(node._shader!.props['border-width']).toEqual([2, 2, 2, 2]);
    core.step(5);
    core.update();
    expect(typeName(node)).toBe('rounded');
  });

  it('a border write with no transition, or before attach, lands at once', () => {
    const { node } = rendered();
    node.transition = { x: { duration: 10 } };
    node.border = { width: 4, color: RED };
    expect(node._shader!.props['border-width']).toEqual([4, 4, 4, 4]);
  });

  it('shadow and border give roundedWithShadow and roundedWithBorderWithShadow', () => {
    const core = headless();
    const node = new ElementNode(core, NodeType.Element);
    node.borderRadius = 8;
    node.border = { width: 0, color: RED };
    node.shadow = { color: 0x000000ff, blur: 8, spread: 2, x: 0, y: 0 };
    attach(node);
    expect(typeName(node)).toBe('roundedWithShadow');
    expect(node._shader!.props['shadow-blur']).toBe(8);
    node.border = { width: 2, color: RED };
    expect(typeName(node)).toBe('roundedWithBorderWithShadow');
    expect(node._shader!.props['shadow-blur']).toBe(8);
    expect(node._shader!.props['border-width']).toEqual([2, 2, 2, 2]);
  });

  it('before attach the objects wait in _shaderProps and attach makes the shader', () => {
    const core = headless();
    const node = new ElementNode(core, NodeType.Element);
    const border = { width: 2, color: RED };
    node.borderRadius = 8;
    node.border = border;
    expect(node._shader).toBeUndefined();
    expect(core.nodes.shaderRefs[node.slot]).toBeNull();
    expect(node._shaderProps!.border).toBe(border);
    expect(node._shaderProps!.rounded).toBe(8);
    attach(node);
    expect(typeName(node)).toBe('roundedWithBorder');
    expect(core.nodes.shaderRefs[node.slot]).toBe(node._shader);
    expect(node._shader!.props['border-width']).toEqual([2, 2, 2, 2]);
    expect(node._shader!.props.radius).toEqual([8, 8, 8, 8]);
  });

  it('convertToShader makes nothing without a rounded-family prop', () => {
    const core = headless();
    const node = new ElementNode(core, NodeType.Element);
    convertToShader(node);
    expect(node._shader).toBeUndefined();
    node.linearGradient = undefined;
    node.rendered = true;
    convertToShader(node);
    expect(node._shader).toBeUndefined();
  });

  it('a shader set with the shader prop is never swapped', () => {
    const { core, node } = rendered();
    node.shader = ['roundedWithShadow', { radius: 8 }];
    expect(typeName(node)).toBe('roundedWithShadow');
    expect(node._shaderFeatures).toBe(SHADER_UNMANAGED);
    node.border = { width: 4, color: RED };
    expect(typeName(node)).toBe('roundedWithShadow');
    expect(node.shader).toBe(node._shader);
    expect(core.nodes.shaderRefs[node.slot]).toBe(node._shader);
    // A ShaderNode goes in as it is, null takes the shader away.
    const made = core.createShader('rounded', { radius: 2 })!;
    node.shader = made;
    expect(node._shader).toBe(made);
    node.shader = null;
    expect(node._shader).toBeUndefined();
    expect(core.nodes.shaderRefs[node.slot]).toBeNull();
  });

  it('a border written to a shader the app made reaches its facade', () => {
    const core = headless();
    const node = new ElementNode(core, NodeType.Element);
    node.shader = ['roundedWithBorder', { radius: 8 }];
    node.border = { width: 4, color: RED };
    expect(node._shader!.props['border-width']).toEqual([4, 4, 4, 4]);
  });

  it('syncShaderType keeps a border an animation takes away until it stops', () => {
    const { node } = rendered();
    node.border = { width: 4, color: RED };
    expect(typeName(node)).toBe('roundedWithBorder');
    // The bag holds the width 0 the animation moves to.
    node._shaderProps!['border-width'] = 0;
    syncShaderType(node, { 'border-width': 0 });
    expect(typeName(node)).toBe('roundedWithBorder');
    syncShaderType(node);
    expect(typeName(node)).toBe('rounded');
    // A border it adds is swapped in before the animation starts.
    syncShaderType(node, { 'border-width': 4 });
    expect(typeName(node)).toBe('roundedWithBorder');
  });

  it('getters return what was written; rounded is the alias of borderRadius', () => {
    const core = headless();
    const node = new ElementNode(core, NodeType.Element);
    const border = { width: 1 };
    const shadow = { blur: 2 };
    expect(node.border).toBeUndefined();
    node.border = border;
    node.shadow = shadow;
    node.borderRadius = 4;
    expect(node.border).toBe(border);
    expect(node.shadow).toBe(shadow);
    expect(node.borderRadius).toBe(4);
    expect(node.rounded).toBe(4);
    node.rounded = [1, 2, 3, 4];
    expect(node.borderRadius).toEqual([1, 2, 3, 4]);
  });

  it('a write records the prop in _set', () => {
    const core = headless();
    const node = new ElementNode(core, NodeType.Element);
    node.border = { width: 1 };
    node.borderTop = { width: 1 };
    node.shadow = { blur: 1 };
    node.rounded = 2;
    node.linearGradient = { colors: [RED, RED] };
    node.holePunch = { w: 1 };
    node.shader = null;
    for (const i of [
      SET_BORDER,
      SET_BORDER_TOP,
      SET_SHADOW,
      SET_BORDER_RADIUS,
      SET_LINEAR_GRADIENT,
      SET_HOLE_PUNCH,
      SET_SHADER,
    ]) {
      expect(node._set[i]).toBe(1);
    }
  });

  it('a destroyed node ignores shader writes', () => {
    const core = headless();
    const node = new ElementNode(core, NodeType.Element);
    node.slot = NULL;
    node.border = { width: 1 };
    node.borderRadius = 2;
    node.linearGradient = { colors: [RED, RED] };
    node.shader = ['rounded', {}];
    expect(node._shaderProps).toBeUndefined();
    expect(node._shader).toBeUndefined();
    expect(node._set[SET_BORDER]).toBe(0);
  });

  it('an unregistered shader type leaves the node without a shader', () => {
    const core = new RendererCore({ appWidth: 640, appHeight: 360 });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const node = new ElementNode(core, NodeType.Element);
    node.borderRadius = 8;
    attach(node);
    expect(node._shader).toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('writing the same border object again touches no facade prop', () => {
    const { core, node } = rendered();
    const border = { width: 4, color: RED, gap: 1 };
    node.border = border;
    const shader = node._shader;
    const mark = vi.spyOn(core.shaders, 'markUsers');
    node.border = border;
    node.borderRadius = 8;
    expect(node._shader).toBe(shader);
    expect(mark).not.toHaveBeenCalled();
    // A new object with the same values is no write either.
    node.border = { width: 4, color: RED, gap: 1 };
    expect(mark).not.toHaveBeenCalled();
    // A changed value reaches the facade, and only it.
    node.border = { width: 6, color: RED, gap: 1 };
    expect(mark).toHaveBeenCalledTimes(1);
    expect(node._shader!.props['border-width']).toEqual([6, 6, 6, 6]);
    mark.mockRestore();
  });

  it('a getter object is read once per write', () => {
    const { node } = rendered();
    let reads = 0;
    const live = {
      color: RED,
      get width() {
        return (++reads, 3);
      },
    };
    node.border = live;
    expect(reads).toBe(1);
    expect(node._shader!.props['border-width']).toEqual([3, 3, 3, 3]);
  });

  it('writing the same gradient object again keeps its shader', () => {
    const { core, node } = rendered();
    const gradient = { colors: [RED, 0x0000ffff], angle: 1 };
    node.linearGradient = gradient;
    const shader = node._shader;
    node.linearGradient = gradient;
    expect(node._shader).toBe(shader);
    expect(core.nodes.shaderRefs[node.slot]).toBe(shader);
    // Another object makes another shader.
    node.linearGradient = { colors: [RED, RED] };
    expect(node._shader).not.toBe(shader);
  });

  it('clearing one replacing key leaves the shader another made', () => {
    const { core, node } = rendered();
    node.linearGradient = { colors: [RED, 0x0000ffff] };
    const gradient = node._shader;
    node.radialGradient = undefined;
    node.holePunch = undefined;
    expect(node._shader).toBe(gradient);
    expect(typeName(node)).toBe('linearGradient');
    // The shader of the `shader` prop stays when a gradient key is cleared.
    const made = core.createShader('rounded', { radius: 2 })!;
    node.shader = made;
    node.holePunch = undefined;
    node.linearGradient = undefined;
    expect(node._shader).toBe(made);
    // Clearing the key that made a shader takes it away: the rounded one
    // of the border props comes back.
    node.holePunch = { x: 1, y: 1, w: 2, h: 2 };
    expect(typeName(node)).toBe('holePunch');
    node.holePunch = undefined;
    expect(typeName(node)).toBe('rounded');
    expect(core.nodes.shaderRefs[node.slot]).toBe(node._shader);
  });

  it('a shadow written after attach swaps in roundedWithShadow; removing it swaps back', () => {
    const { node } = rendered();
    expect(typeName(node)).toBe('rounded');
    node.shadow = { color: 0x000000ff, blur: 8 };
    expect(typeName(node)).toBe('roundedWithShadow');
    expect(node._shader!.props['shadow-blur']).toBe(8);
    node.shadow = undefined;
    expect(typeName(node)).toBe('rounded');
    expect(node.shadow).toBeUndefined();
  });
});
