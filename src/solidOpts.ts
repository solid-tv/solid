import { ElementNode, TextNode, log, NodeType, isDev } from './core/index.js';
import { core } from './core/renderer.js';
import { insertChild, removeChild } from './core/node/lifecycle.js';
import { setStateBlock } from './core/node/styles.js';
import type { DollarString } from './core/intrinsicTypes.js';
import type { SolidNode, SolidRendererOptions } from './types.js';

/**
 * A prop write from JSX: a `$name` prop is a state block (styles.ts); any
 * other name is the node's prop of that name, written through its setter.
 */
function writeProp(node: ElementNode, name: string, value: unknown): void {
  if (name.charCodeAt(0) === 36 /* $ */) {
    // The check above makes the name a DollarString.
    setStateBlock(node, name as DollarString, value);
  } else {
    // A JSX prop names a prop of the node: an accessor or a field. The
    // class has no index signature, so the write goes through a record view.
    (node as unknown as Record<string, unknown>)[name] = value;
  }
}

export default {
  createElement(
    name: string,
    staticProps?: Record<string, unknown>,
  ): ElementNode {
    const node = new ElementNode(
      core,
      name === 'text' ? NodeType.TextNode : NodeType.Element,
    );
    if (staticProps !== undefined) {
      // Solid 2.0 hands every compile-time-constant prop here as one object
      // instead of a setProp call each. Written through the same path
      // setProperty uses, in declaration order, as 1.x applied them.
      for (const key in staticProps) {
        writeProp(node, key, staticProps[key]);
      }
    }
    return node;
  },
  createTextNode(text: string): TextNode {
    // A text node is just a string - not the <text> node
    return new TextNode(text);
  },
  replaceText(node: TextNode, value: string): void {
    if (isDev) {
      log('Replace Text: ', node, value);
    }
    node.text = value;
    const parent = node.parent;
    // A text node never inserted has no parent.
    if (parent !== undefined) {
      parent.text = parent.getText();
    }
  },
  setProperty(node: ElementNode, name: string, value: unknown): void {
    writeProp(node, name, value);
  },
  insertNode(parent: ElementNode, node: SolidNode, anchor?: SolidNode): void {
    if (isDev) {
      log('INSERT: ', parent, node, anchor);
    }
    insertChild(parent, node, anchor);
  },
  isTextNode(node: SolidNode): boolean {
    return node._type === NodeType.TextNode;
  },
  removeNode(parent: ElementNode, node: SolidNode): void {
    if (isDev) {
      log('REMOVE: ', parent, node);
    }
    removeChild(parent, node);
  },
  getParentNode(node: SolidNode): ElementNode | undefined {
    return node.parent;
  },
  getFirstChild(node: ElementNode): SolidNode | undefined {
    return node.children[0];
  },
  getNextSibling(node: SolidNode): SolidNode | undefined {
    const parent = node.parent;
    if (parent === undefined) {
      return undefined;
    }
    // From the end: Solid asks for the sibling after a list's last item. A
    // removed node keeps its parent link, but is not in the list.
    const children = parent.children;
    let i = children.length - 1;
    while (i >= 0 && children[i] !== node) {
      i--;
    }
    return i >= 0 ? children[i + 1] : undefined;
  },
} satisfies SolidRendererOptions;
