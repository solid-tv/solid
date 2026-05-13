import {
  assertTruthy,
  isElementText,
  ElementNode,
  TextNode,
  log,
  type ElementText,
  elementDeleteQueue,
  schedulePostMutation,
} from './core/index.js';
import type { SolidNode, SolidRendererOptions } from './types.js';

Object.defineProperty(ElementNode.prototype, 'preserve', {
  get(): boolean | undefined {
    return this._queueDelete === 0;
  },
  set(v: boolean) {
    this._queueDelete = v ? 0 : undefined;
  },
});

function pushDeleteQueue(node: ElementNode, n: number): void {
  if (node._queueDelete === undefined) {
    node._queueDelete = n;
    if (elementDeleteQueue.push(node) === 1) {
      schedulePostMutation();
    }
  } else {
    node._queueDelete += n;
  }
}

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
  setProperty(node: ElementNode, name: string, value: any = true): void {
    node[name] = value;
  },
  insertNode(parent: ElementNode, node: SolidNode, anchor: SolidNode): void {
    log('INSERT: ', parent, node, anchor);

    const prevParent = node.parent;
    parent.insertChild(node, anchor);

    if (node instanceof ElementNode) {
      node.parent!.rendered && node.render(true);
      if (prevParent !== undefined) {
        pushDeleteQueue(node, 1);
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
      pushDeleteQueue(node, -1);
    } else if (isElementText(parent)) {
      // TextNodes can be placed outside of <text> nodes when <Show> is used as placeholder
      parent.text = parent.getText();
    }
  },
  getParentNode(node: SolidNode): ElementNode | ElementText | undefined {
    return node.parent;
  },
  getFirstChild(node: ElementNode): SolidNode | undefined {
    return node.children[0] as SolidNode;
  },
  getNextSibling(node: SolidNode): SolidNode | undefined {
    const children = node.parent!.children || [];
    const index = children.indexOf(node as any) + 1;
    if (index < children.length) {
      return children[index] as SolidNode;
    }
    return undefined;
  },
} satisfies SolidRendererOptions;
