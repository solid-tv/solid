import {
  assertTruthy,
  isElementText,
  ElementNode,
  TextNode,
  log,
  type ElementText,
  enqueueDelete,
} from './core/index.js';
import type { SolidNode, SolidRendererOptions } from './types.js';

export default {
  createElement(name: string): ElementNode {
    return new ElementNode(name);
  },
  createTextNode(text: string): TextNode {
    // A text node is just a string - not the <text> node
    return new TextNode(text);
  },
  replaceText(node: TextNode, value: string): void {
    log('Replace Text: ', node, value);
    node.text = value;
    const parent = node.parent;
    assertTruthy(parent);
    parent.text = parent.getText();
  },
  setProperty(node: ElementNode, name: string, value: any): void {
    node[name] = value;
  },
  insertNode(parent: ElementNode, node: SolidNode, anchor: SolidNode): void {
    log('INSERT: ', parent, node, anchor);

    const prevParent = node.parent;
    parent.insertChild(node, anchor);

    if (node instanceof ElementNode) {
      if (node.parent!.rendered) {
        node.render(true);
      }
      if (prevParent !== undefined) {
        enqueueDelete(node, 1);
      }
    } else if (isElementText(parent)) {
      // TextNodes can be placed outside of <text> nodes when <Show> is used as placeholder
      parent.text = parent.getText();
    }
  },
  isTextNode(node: SolidNode): boolean {
    return isElementText(node);
  },
  removeNode(parent: ElementNode, node: SolidNode): void {
    log('REMOVE: ', parent, node);

    parent.removeChild(node);

    if (node instanceof ElementNode) {
      enqueueDelete(node, -1);
    } else if (isElementText(parent)) {
      // TextNodes can be placed outside of <text> nodes when <Show> is used as placeholder
      parent.text = parent.getText();
    }
  },
  getParentNode(node: SolidNode): ElementNode | ElementText | undefined {
    return node.parent;
  },
  getFirstChild(node: ElementNode): SolidNode | undefined {
    return node.children[0];
  },
  getNextSibling(node: SolidNode): SolidNode | undefined {
    const children = (node.parent!.children || []) as SolidNode[];
    const index = children.indexOf(node) + 1;
    if (index < children.length) {
      return children[index];
    }
    return undefined;
  },
} satisfies SolidRendererOptions;
