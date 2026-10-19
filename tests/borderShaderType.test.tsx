// Which rounded shader a node gets: `roundedWithBorder` only while its border
// has a width above 0, `rounded` otherwise, swapping when the width changes
// after render. The DOM renderer's shader is `{ shaderType, props }`, with the
// registered name as `shaderType`.
import * as v from 'vitest';
import * as lng from '@solidtv/solid';
import { renderer } from './setup.js';

const RED = 0xff0000ff;

const shaderOf = (node: lng.ElementNode) =>
  node.lng.shader as unknown as {
    shaderType: string;
    props: Record<string, unknown>;
  };

/** Render one view and return it with its dispose. */
function renderView(props: lng.NodeProps) {
  let node!: lng.ElementNode;
  const dispose = renderer.render(() => <view ref={node} {...props} />);
  return { node, dispose };
}

v.describe('rounded shader type from the border width', () => {
  v.test('a border of width 0 renders with the rounded shader', () => {
    const { node, dispose } = renderView({
      borderRadius: 8,
      border: { width: 0, color: RED },
    });
    v.expect(shaderOf(node).shaderType).toBe('rounded');
    dispose();
  });

  v.test('a border width array of zeros renders with rounded', () => {
    const { node, dispose } = renderView({
      borderRadius: 8,
      border: { width: [0, 0, 0, 0], color: RED },
    });
    v.expect(shaderOf(node).shaderType).toBe('rounded');
    dispose();
  });

  v.test('one side above 0 renders with roundedWithBorder', () => {
    const { node, dispose } = renderView({
      borderRadius: 8,
      border: { width: [0, 2, 0, 0], color: RED },
    });
    v.expect(shaderOf(node).shaderType).toBe('roundedWithBorder');
    dispose();
  });

  v.test('a border side of width 0 renders with rounded', () => {
    const { node, dispose } = renderView({
      borderRadius: 8,
      borderTop: { width: 0, color: RED },
    });
    v.expect(shaderOf(node).shaderType).toBe('rounded');
    dispose();
  });

  v.test('a border of width 0 with a shadow renders roundedWithShadow', () => {
    const { node, dispose } = renderView({
      borderRadius: 8,
      border: { width: 0, color: RED },
      shadow: { color: 0x000000ff, blur: 8, spread: 2, x: 0, y: 0 },
    });
    v.expect(shaderOf(node).shaderType).toBe('roundedWithShadow');
    dispose();
  });

  v.test(
    'a width set after render swaps in roundedWithBorder, keeping the radius and color',
    () => {
      const { node, dispose } = renderView({
        borderRadius: 8,
        border: { width: 0, color: RED },
      });
      node.border = { width: 4 };
      const shader = shaderOf(node);
      v.expect(shader.shaderType).toBe('roundedWithBorder');
      v.expect(shader.props.radius).toBe(8);
      v.expect(shader.props['border-color']).toBe(RED);
      v.expect(shader.props['border-w']).toBe(4);
      dispose();
    },
  );

  v.test('a width back to 0 after render swaps back to rounded', () => {
    const { node, dispose } = renderView({
      borderRadius: 8,
      border: { width: 4, color: RED },
    });
    v.expect(shaderOf(node).shaderType).toBe('roundedWithBorder');
    node.border = { width: 0, color: RED };
    v.expect(shaderOf(node).shaderType).toBe('rounded');
    v.expect(shaderOf(node).props.radius).toBe(8);
    dispose();
  });

  v.test('a $focus border width swaps the shader on focus and blur', () => {
    const { node, dispose } = renderView({
      style: {
        borderRadius: 8,
        border: { width: 0, color: RED },
        $focus: { border: { width: 4, color: RED } },
      },
    });
    v.expect(shaderOf(node).shaderType).toBe('rounded');
    node.states.add('$focus');
    v.expect(shaderOf(node).shaderType).toBe('roundedWithBorder');
    v.expect(shaderOf(node).props['border-w']).toBe(4);
    node.states.remove('$focus');
    v.expect(shaderOf(node).shaderType).toBe('rounded');
    dispose();
  });

  v.test('effects with a border width swap in roundedWithBorder', () => {
    const { node, dispose } = renderView({
      borderRadius: 8,
      border: { width: 0, color: RED },
    });
    node.effects = { border: { width: 3 } };
    v.expect(shaderOf(node).shaderType).toBe('roundedWithBorder');
    v.expect(shaderOf(node).props['border-w']).toBe(3);
    dispose();
  });

  v.test('a shader set with the shader prop is never swapped', () => {
    const { node, dispose } = renderView({
      borderRadius: 8,
      border: { width: 0, color: RED },
    });
    node.shader = ['custom', { radius: 8 }];
    node.border = { width: 4 };
    v.expect(shaderOf(node).shaderType).toBe('custom');
    dispose();
  });

  v.test(
    'an animated width swaps in roundedWithBorder before the animation starts',
    () => {
      const animate = v.vi.spyOn(lng.ElementNode.prototype, 'animate');
      const { node, dispose } = renderView({
        borderRadius: 8,
        border: { width: 0, color: RED },
        transition: { border: { duration: 10 } },
      });
      let typeAtAnimate: string | undefined;
      animate.mockImplementation(function (this: lng.ElementNode) {
        typeAtAnimate = shaderOf(this).shaderType;
        return {
          start() {
            return this;
          },
          waitUntilStopped: () => Promise.resolve(),
        } as unknown as lng.IAnimationController;
      });
      node.border = { width: 4, color: RED };
      v.expect(typeAtAnimate).toBe('roundedWithBorder');
      animate.mockRestore();
      dispose();
    },
  );

  v.test(
    'an animated width back to 0 keeps roundedWithBorder until the animation stops',
    async () => {
      const animate = v.vi.spyOn(lng.ElementNode.prototype, 'animate');
      const { node, dispose } = renderView({
        borderRadius: 8,
        border: { width: 4, color: RED },
        transition: { border: { duration: 10 } },
      });
      let stop!: () => void;
      const stopped = new Promise<void>((resolve) => (stop = resolve));
      animate.mockImplementation(
        () =>
          ({
            start() {
              return this;
            },
            waitUntilStopped: () => stopped,
          }) as unknown as lng.IAnimationController,
      );
      node.border = { width: 0, color: RED };
      v.expect(shaderOf(node).shaderType).toBe('roundedWithBorder');
      stop();
      await stopped;
      await Promise.resolve();
      v.expect(shaderOf(node).shaderType).toBe('rounded');
      animate.mockRestore();
      dispose();
    },
  );
});
