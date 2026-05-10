import type { ElementText } from './intrinsicTypes.js';

export const NodeType = {
  Element: 'element',
  TextNode: 'textNode',
  Text: 'text',
} as const;
export type NodeTypes = (typeof NodeType)[keyof typeof NodeType];

export class TextNode {
  readonly _type: 'text' = 'text';
  parent: ElementText | undefined = undefined;
  text: string;

  constructor(text: string) {
    this.text = text;
  }
}
