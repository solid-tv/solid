import type { NodeProps, TextProps } from './src/core/index.js';
import type { Element as SolidElement } from 'solid-js';

/**
 * SolidTV owns its JSX namespace.
 *
 * Solid 2.0 no longer ships a `JSX` namespace of its own — core models a
 * rendered value as the renderer-agnostic `Element` type, and each renderer
 * (`@solidjs/web`, `@solidjs/h`, or a custom one like this) declares its own
 * JSX contract. `jsxImportSource: "@solidtv/solid"` resolves to this module,
 * so this is where TypeScript looks for `JSX.Element`,
 * `JSX.IntrinsicElements`, and the rest of the JSX plumbing.
 *
 * In 1.x this file only merged `IntrinsicElements` into solid-js's namespace
 * and re-exported it; that namespace no longer exists to merge into.
 */
export namespace JSX {
  /** What a JSX expression evaluates to. */
  type Element = SolidElement;

  /** Anything usable as a JSX tag: an intrinsic name or a component. */
  type ElementType =
    | keyof IntrinsicElements
    | ((props: any) => Element)
    | (new (props: any) => object);

  /** `children` is the prop that receives JSX children. */
  interface ElementChildrenAttribute {
    children: object;
  }

  /** Props accepted by every element, intrinsic or component. */
  interface IntrinsicAttributes {
    ref?: unknown;
  }

  interface IntrinsicElements {
    node: NodeProps;
    view: NodeProps;
    text: TextProps;
  }
}
