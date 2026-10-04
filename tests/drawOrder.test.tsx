/**
 * B19 on the DOM renderer: a node's `div` order among its parent's divs is
 * its paint order (among equal z-index), and its `children` set is its child
 * list. Both must follow the ElementNode's `children`, as renderer v2's child
 * list does (tests/webgl/drawOrder.test.tsx).
 */
import * as v from 'vitest';
import * as s from 'solid-js';
import { ElementNode, TextNode } from '@solidtv/solid';
import nodeOpts from '../src/solidOpts.js';
import { renderer } from './setup.js';

type DomHandle = { div: HTMLElement; children: Set<unknown> };
const dom = (el: ElementNode) => el.lng as unknown as DomHandle;

/** The ids of the rendered element children, in `children` order. */
const expected = (parent: ElementNode) =>
  parent.children
    .filter((c) => c instanceof ElementNode && c.rendered)
    .map((c) => (c as ElementNode).id);

function byHandle(parent: ElementNode) {
  const map = new Map<unknown, string | undefined>();
  for (const c of parent.children) {
    if (c instanceof ElementNode) map.set(c.lng, c.id);
  }
  return map;
}

/** The ids behind the parent's child divs, in DOM (paint) order. */
const painted = (parent: ElementNode) => {
  const map = byHandle(parent);
  const out: Array<string | undefined> = [];
  for (const div of Array.from(dom(parent).div.children)) {
    const node = (div as unknown as { _node?: unknown })._node;
    if (node !== undefined) out.push(map.has(node) ? map.get(node) : '?');
  }
  return out;
};

/** The ids behind the parent's DOM renderer child list. */
const listed = (parent: ElementNode) => {
  const map = byHandle(parent);
  return Array.from(dom(parent).children).map((n) =>
    map.has(n) ? map.get(n) : '?',
  );
};

const ids = (parent: ElementNode) =>
  parent.children.map((c) => (c instanceof ElementNode ? c.id : '#text'));

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

const expectOrder = (parent: ElementNode) => {
  v.expect(painted(parent)).toEqual(expected(parent));
  v.expect(listed(parent)).toEqual(expected(parent));
};

v.describe('B19: the DOM renderer draws children in children order', () => {
  v.test('<Show> inserted before an anchor', async () => {
    const [show, setShow] = s.createSignal(false);
    let parent!: ElementNode;
    const dispose = renderer.render(() => (
      <view ref={parent} width={300} height={100}>
        <view id="first" width={10} height={10} />
        <s.Show when={show()}>
          <view id="middle" width={10} height={10} />
        </s.Show>
        <view id="last" width={10} height={10} />
      </view>
    ));
    await tick();
    expectOrder(parent);

    setShow(true);
    await tick();
    v.expect(ids(parent)).toEqual(['first', 'middle', 'last']);
    expectOrder(parent);
    dispose();
  });

  v.test('<For> insert in the middle and reorder', async () => {
    const [items, setItems] = s.createSignal(['a', 'c']);
    let parent!: ElementNode;
    const dispose = renderer.render(() => (
      <view ref={parent} width={300} height={100}>
        <view id="head" width={10} height={10} />
        <s.For each={items()}>
          {(id) => <view id={id} width={10} height={10} />}
        </s.For>
        <view id="tail" width={10} height={10} />
      </view>
    ));
    await tick();
    expectOrder(parent);

    setItems(['a', 'b', 'c']);
    await tick();
    v.expect(ids(parent)).toEqual(['head', 'a', 'b', 'c', 'tail']);
    expectOrder(parent);

    setItems(['c', 'b', 'a']);
    await tick();
    v.expect(ids(parent)).toEqual(['head', 'c', 'b', 'a', 'tail']);
    expectOrder(parent);
    dispose();
  });

  v.test('insertChild(node, before) between rendered parents', () => {
    let left!: ElementNode;
    let right!: ElementNode;
    let moved!: ElementNode;
    let anchor!: ElementNode;
    const dispose = renderer.render(() => (
      <view width={300} height={100}>
        <view ref={left} width={100} height={100}>
          <view id="x" width={10} height={10} />
          <view ref={moved} id="moved" width={10} height={10} />
        </view>
        <view ref={right} width={100} height={100}>
          <view ref={anchor} id="anchor" width={10} height={10} />
          <view id="y" width={10} height={10} />
        </view>
      </view>
    ));
    right.insertChild(moved, anchor);
    v.expect(ids(right)).toEqual(['moved', 'anchor', 'y']);
    expectOrder(right);
    expectOrder(left);

    const y = right.children[2] as ElementNode;
    right.insertChild(y, moved);
    v.expect(ids(right)).toEqual(['y', 'moved', 'anchor']);
    expectOrder(right);
    right.insertChild(y);
    v.expect(ids(right)).toEqual(['moved', 'anchor', 'y']);
    expectOrder(right);
    dispose();
  });

  // Solid's swap of adjacent items asks for insertNode(parent, y, y): a node
  // placed before itself stays (DOM semantics), it is not appended.
  v.test(
    'an adjacent <For> swap with a later sibling keeps the declared order',
    async () => {
      const [items, setItems] = s.createSignal(['a', 'x', 'y', 'b']);
      let parent!: ElementNode;
      const dispose = renderer.render(() => (
        <view ref={parent} width={300} height={100}>
          <view id="head" width={10} height={10} />
          <s.For each={items()}>
            {(id) => <view id={id} width={10} height={10} />}
          </s.For>
          <view id="tail" width={10} height={10} />
        </view>
      ));
      await tick();
      setItems(['a', 'y', 'x', 'b']);
      await tick();
      v.expect(ids(parent)).toEqual(['head', 'a', 'y', 'x', 'b', 'tail']);
      expectOrder(parent);
      dispose();
    },
  );

  v.test(
    'a move that leaves a child where it is does not call the renderer',
    () => {
      let parent!: ElementNode;
      const dispose = renderer.render(() => (
        <view ref={parent} width={300} height={100}>
          <view id="a" width={10} height={10} />
          <view id="b" width={10} height={10} />
          <view id="c" width={10} height={10} />
        </view>
      ));
      const [a, b, c] = parent.children as [
        ElementNode,
        ElementNode,
        ElementNode,
      ];
      const spy = v.vi.spyOn(
        parent.lng as unknown as { insertBefore: () => void },
        'insertBefore',
      );
      try {
        parent.insertChild(b, c);
        parent.insertChild(c);
        parent.insertChild(a, a);
        v.expect(ids(parent)).toEqual(['a', 'b', 'c']);
        v.expect(spy).not.toHaveBeenCalled();

        parent.insertChild(c, a);
        v.expect(ids(parent)).toEqual(['c', 'a', 'b']);
        v.expect(spy).toHaveBeenCalledTimes(1);
        expectOrder(parent);
      } finally {
        spy.mockRestore();
        dispose();
      }
    },
  );

  v.test(
    'a parent rendered after it got rendered and new children draws them in order',
    () => {
      let host!: ElementNode;
      let moved!: ElementNode;
      const dispose = renderer.render(() => (
        <view ref={host} width={300} height={100}>
          <view ref={moved} id="moved" width={10} height={10} />
        </view>
      ));
      const fresh = new ElementNode('view');
      fresh.id = 'fresh';
      const [n1, n2] = ['n1', 'n2'].map((id) => {
        const n = new ElementNode('view');
        n.id = id;
        return n;
      }) as [ElementNode, ElementNode];
      fresh.insertChild(n1);
      fresh.insertChild(moved);
      fresh.insertChild(n2);
      v.expect(moved.rendered).toBe(true);
      host.insertChild(fresh);
      fresh.render(true);
      v.expect(ids(fresh)).toEqual(['n1', 'moved', 'n2']);
      expectOrder(fresh);
      v.expect(listed(host)).toEqual(['fresh']);
      dispose();
    },
  );

  // As renderer v2: a destroyed child is left alone, a destroyed anchor
  // appends (its div is gone from the parent's).
  v.test('DOM renderer insertBefore with a destroyed child or anchor', () => {
    let parent!: ElementNode;
    let a!: ElementNode;
    let b!: ElementNode;
    const dispose = renderer.render(() => (
      <view ref={parent} width={300} height={100}>
        <view ref={a} id="a" width={10} height={10} />
        <view ref={b} id="b" width={10} height={10} />
      </view>
    ));
    type Insert = {
      insertBefore: (child: unknown, before: unknown) => void;
      destroy: () => void;
    };
    const lngOf = (el: ElementNode) => el.lng as unknown as Insert;
    lngOf(a).destroy();
    lngOf(parent).insertBefore(lngOf(a), null);
    v.expect(painted(parent)).toEqual(['b']);
    v.expect(listed(parent)).toEqual(['b']);
    v.expect(() =>
      lngOf(parent).insertBefore(lngOf(b), lngOf(a)),
    ).not.toThrow();
    v.expect(painted(parent)).toEqual(['b']);
    v.expect(listed(parent)).toEqual(['b']);
    dispose();
  });
});

v.describe('child list', () => {
  v.test('removeChild takes the child out and clears its parent', () => {
    const parent = new ElementNode('view');
    const [a, b, c] = ['a', 'b', 'c'].map((id) => {
      const n = new ElementNode('view');
      n.id = id;
      parent.insertChild(n);
      return n;
    }) as [ElementNode, ElementNode, ElementNode];

    parent.removeChild(b);
    v.expect(ids(parent)).toEqual(['a', 'c']);
    v.expect(b.parent).toBeUndefined();
    v.expect(a.parent).toBe(parent);

    // Not a child: nothing changes.
    parent.removeChild(b);
    v.expect(ids(parent)).toEqual(['a', 'c']);

    parent.removeChild(a);
    parent.removeChild(c);
    v.expect(ids(parent)).toEqual([]);
    parent.insertChild(b);
    v.expect(ids(parent)).toEqual(['b']);
    v.expect(b.parent).toBe(parent);
  });

  v.test('replaceText on a removed text child changes only its text', () => {
    const text = new ElementNode('text');
    const child = new TextNode('a');
    text.insertChild(child);
    text.removeChild(child);
    v.expect(() => nodeOpts.replaceText(child, 'b')).not.toThrow();
    v.expect(child.text).toBe('b');
  });

  v.test(
    'a preserved element stays preserved through a remove and re-insert',
    async () => {
      const [show, setShow] = s.createSignal(true);
      let el!: ElementNode;
      let destroyed = 0;
      const dispose = renderer.render(() => {
        const kept = (
          <view
            ref={el}
            id="kept"
            preserve
            onDestroy={() => void destroyed++}
          />
        );
        return <view>{show() ? kept : null}</view>;
      });
      await tick();
      v.expect(el.preserve).toBe(true);

      setShow(false);
      await tick();
      v.expect(el.parent).toBeUndefined();
      setShow(true);
      await tick();
      v.expect(el.parent).toBeDefined();
      v.expect(el.preserve).toBe(true);
      v.expect(destroyed).toBe(0);
      dispose();
    },
  );
});
