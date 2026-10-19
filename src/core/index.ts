export { ElementNode } from './node/ElementNode.js';
export { convertToShader } from './node/shader.js';
export { enqueueDelete } from './node/postMutation.js';
export {
  startRenderer,
  loadFonts,
  renderer,
  getRenderer,
  type RendererOptions,
} from './renderer.js';
export * from './nodeTypes.js';
export * from './utils.js';
export type * from './intrinsicTypes.js';
export type * from './focusKeyTypes.js';
export * from './config.js';
export * from './shaders.js';
export type * from '@solidtv/renderer';
// The node handle types, in '@solidtv/renderer/node' since renderer 2.1.
export type {
  INode,
  INodeProps,
  ITextNode,
  ITextNodeProps,
  Node,
} from '@solidtv/renderer/node';
export { type AnimationSettings } from './intrinsicTypes.js';
// Solid's own versions of names the renderer also exports
export { TextNode } from './nodeTypes.js';
export type { FontLoadOptions, TextProps } from './intrinsicTypes.js';
// hopefully fix up webpack error
import { assertTruthy, deg2Rad } from '@solidtv/renderer/utils';
export { assertTruthy, deg2Rad };
