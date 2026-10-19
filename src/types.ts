import {
  type ElementNode,
  type Styles,
  type ElementText,
  type TextNode,
} from './core/index.js';
import { createRenderer } from '@solidjs/universal';

export type SolidRendererOptions = Parameters<
  typeof createRenderer<SolidNode>
>[0];

export type SolidNode = ElementNode | ElementText | TextNode;

export type SolidStyles = Styles;
