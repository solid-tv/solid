import type { ElementNode } from './node/ElementNode.js';

export const NodeType = {
  Element: 'element',
  TextNode: 'textNode',
  Text: 'text',
} as const;
export type NodeTypes = (typeof NodeType)[keyof typeof NodeType];

export class TextNode {
  // Assigned in the constructor, not class fields (design 3.6.5).
  declare readonly _type: 'text';
  declare parent: ElementNode | undefined;
  declare text: string;

  constructor(text: string) {
    this._type = 'text';
    this.parent = undefined;
    this.text = text;
  }
}
