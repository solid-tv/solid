/**
 * The rounded shader type a border width gives on the real renderer:
 * `Rounded` while the width is 0, `RoundedWithBorder` above it, swapping
 * as the width changes after render. A renderer 2.x shader keeps only the
 * props its type declares, so a border written while the node is on
 * `Rounded` must still reach the `RoundedWithBorder` swapped in later.
 *
 * Only `rounded`, `roundedWithBorder` and `roundedWithShadow` are
 * registered, as in an app that registers just the shaders it uses: a swap
 * to the unregistered `roundedWithBorderWithShadow` keeps the shader.
 *
 *   pnpm test:webgl
 */
import * as v from 'vitest';
import {
  defaultShaderRounded,
  defaultShaderRoundedWithBorder,
  defaultShaderRoundedWithShadow,
  registerDefaultShaderRounded,
  registerDefaultShaderRoundedWithBorder,
  registerDefaultShaderRoundedWithShadow,
  type ElementNode,
  type NodeStyles,
} from '@solidtv/solid';
import { render, renderer, settle } from './setup.js';

const RED = 0xff0000ff;

registerDefaultShaderRounded(renderer);
registerDefaultShaderRoundedWithBorder(renderer);
registerDefaultShaderRoundedWithShadow(renderer);

const shaderOf = (node: ElementNode) =>
  node.lng.shader as unknown as {
    shaderType: unknown;
    props: Record<string, unknown>;
  };

v.describe('rounded shader type from the border width', () => {
  v.test(
    'a $focus border width swaps Rounded and RoundedWithBorder',
    async () => {
      const style: NodeStyles = {
        width: 100,
        height: 100,
        color: 0xffffffff,
        borderRadius: 8,
        border: { width: 0, color: RED },
        $focus: { border: { width: 4 } },
      };
      let node!: ElementNode;
      const dispose = render(() => <view ref={node} style={style} />);
      await settle();
      v.expect(shaderOf(node).shaderType).toBe(defaultShaderRounded);

      for (let i = 0; i < 2; i++) {
        node.states.add('$focus');
        const shader = shaderOf(node);
        v.expect(shader.shaderType).toBe(defaultShaderRoundedWithBorder);
        v.expect(shader.props['border-w']).toEqual([4, 4, 4, 4]);
        v.expect(shader.props['border-color']).toBe(RED);
        v.expect(shader.props.radius).toEqual([8, 8, 8, 8]);
        await settle();

        node.states.remove('$focus');
        v.expect(shaderOf(node).shaderType).toBe(defaultShaderRounded);
        v.expect(shaderOf(node).props.radius).toEqual([8, 8, 8, 8]);
        await settle();
      }
      dispose();
    },
  );

  v.test(
    'an animated border width grows from 0 on RoundedWithBorder and swaps back once it shrinks to 0',
    async () => {
      let node!: ElementNode;
      const dispose = render(() => (
        <view
          ref={node}
          width={100}
          height={100}
          color={0xffffffff}
          borderRadius={8}
          border={{ width: 0, color: RED }}
          transition={{ border: { duration: 50 } }}
        />
      ));
      await settle();
      v.expect(shaderOf(node).shaderType).toBe(defaultShaderRounded);

      node.border = { width: 4, color: RED };
      v.expect(shaderOf(node).shaderType).toBe(defaultShaderRoundedWithBorder);
      v.expect(shaderOf(node).props['border-w']).toEqual([0, 0, 0, 0]);
      await v.vi.waitFor(() =>
        v.expect(shaderOf(node).props['border-w']).toEqual([4, 4, 4, 4]),
      );

      node.border = { width: 0, color: RED };
      v.expect(shaderOf(node).shaderType).toBe(defaultShaderRoundedWithBorder);
      await v.vi.waitFor(() =>
        v.expect(shaderOf(node).shaderType).toBe(defaultShaderRounded),
      );
      dispose();
    },
  );

  v.test(
    'a $focus border on RoundedWithShadow keeps the shader when roundedWithBorderWithShadow is not registered',
    async () => {
      const shadow = { color: 0x000000ff, blur: 8, spread: 2, x: 0, y: 0 };
      const style: NodeStyles = {
        width: 100,
        height: 100,
        color: 0xffffffff,
        borderRadius: 8,
        shadow,
        $focus: { border: { width: 4, color: RED } },
      };
      let node!: ElementNode;
      const dispose = render(() => <view ref={node} style={style} />);
      await settle();
      const shader = node.lng.shader;
      v.expect(shaderOf(node).shaderType).toBe(defaultShaderRoundedWithShadow);

      const warn = v.vi.spyOn(console, 'warn').mockImplementation(() => {});
      for (let i = 0; i < 2; i++) {
        node.states.add('$focus');
        v.expect(node.lng.shader).toBe(shader);
        await settle();

        node.states.remove('$focus');
        v.expect(node.lng.shader).toBe(shader);
        v.expect(shaderOf(node).props.radius).toEqual([8, 8, 8, 8]);
        v.expect(shaderOf(node).props['shadow-blur']).toBe(8);
        await settle();
      }
      warn.mockRestore();
      dispose();
    },
  );

  v.test(
    'a border written after the node is destroyed is ignored',
    async () => {
      let node!: ElementNode;
      const dispose = render(() => (
        <view ref={node} borderRadius={8} border={{ width: 0, color: RED }} />
      ));
      await settle();
      node.destroy();
      v.expect(() => (node.border = { width: 4, color: RED })).not.toThrow();
      dispose();
    },
  );
});
