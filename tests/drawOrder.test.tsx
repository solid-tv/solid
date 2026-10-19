/**
 * B19 on the store: a node's place among its parent's store children is its
 * paint order (among equal z-index), and `children` is its child list. Both
 * follow from the first insert, as insertNode links in the store at once.
 * 1.8 read the DOM renderer's handle (`div`, its `children` Set); here the
 * order is the store's own child links (the parent's first child, then each
 * node's `next`), mapped back to the nodes.
 */
import * as v from 'vitest';
import * as s from 'solid-js';
import { I_FIRST_CHILD, I_STRIDE, NULL } from '@solidtv/renderer';
import { ElementNode, TextNode, NodeType } from '@solidtv/solid';
import { scrollRow } from '@solidtv/solid/primitives';
import { F_STRIDE, F_WIDTH } from '@solidtv/renderer';
import nodeOpts from '../src/solidOpts.js';
import { core, renderer, tick, waitForUpdate } from './setup.js';

/** The ids of the element children that have a store slot, in `children` order. */
const expected = (parent: ElementNode) =>
  parent.children
    .filter((c) => c instanceof ElementNode && c.slot !== NULL)
    .map((c) => (c as ElementNode).id);

/** The ids behind the parent's store child links, in link (paint) order. */
const storeOrder = (parent: ElementNode) => {
  const out: Array<string | undefined> = [];
  let slot = core.nodes.i32[parent.slot * I_STRIDE + I_FIRST_CHILD]!;
  while (slot !== NULL) {
    out.push((core.nodes.handles[slot] as ElementNode).id);
    slot = core.nodes.next[slot]!;
  }
  return out;
};

const ids = (parent: ElementNode) =>
  parent.children.map((c) => (c instanceof ElementNode ? c.id : '#text'));

const expectOrder = (parent: ElementNode) => {
  v.expect(storeOrder(parent)).toEqual(expected(parent));
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
    await waitForUpdate();
    expectOrder(parent);

    setShow(true);
    await waitForUpdate();
    v.expect(ids(parent)).toEqual(['first', 'middle', 'last']);
    expectOrder(parent);
    v.expect(storeOrder(parent)).toEqual(['first', 'middle', 'last']);
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
    await waitForUpdate();
    expectOrder(parent);

    setItems(['a', 'b', 'c']);
    await waitForUpdate();
    v.expect(ids(parent)).toEqual(['head', 'a', 'b', 'c', 'tail']);
    expectOrder(parent);

    setItems(['c', 'b', 'a']);
    await waitForUpdate();
    v.expect(ids(parent)).toEqual(['head', 'c', 'b', 'a', 'tail']);
    expectOrder(parent);
    v.expect(storeOrder(parent)).toEqual(['head', 'c', 'b', 'a', 'tail']);
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
    // It left the old parent's store children at once.
    v.expect(storeOrder(left)).toEqual(['x']);

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
      await waitForUpdate();
      setItems(['a', 'y', 'x', 'b']);
      await waitForUpdate();
      v.expect(ids(parent)).toEqual(['head', 'a', 'y', 'x', 'b', 'tail']);
      expectOrder(parent);
      v.expect(storeOrder(parent)).toEqual([
        'head',
        'a',
        'y',
        'x',
        'b',
        'tail',
      ]);
      dispose();
    },
  );

  // 1.8 spied on the DOM handle's insertBefore; the store's own is the one
  // insertChild calls to (re)link a node.
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
      const spy = v.vi.spyOn(core.nodes, 'insertBefore');
      try {
        parent.insertChild(b, c);
        parent.insertChild(c);
        parent.insertChild(a, a);
        v.expect(ids(parent)).toEqual(['a', 'b', 'c']);
        v.expect(storeOrder(parent)).toEqual(['a', 'b', 'c']);
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
      const fresh = new ElementNode(core, NodeType.Element);
      fresh.id = 'fresh';
      const [n1, n2] = ['n1', 'n2'].map((id) => {
        const n = new ElementNode(core, NodeType.Element);
        n.id = id;
        return n;
      }) as [ElementNode, ElementNode];
      fresh.insertChild(n1);
      fresh.insertChild(moved);
      fresh.insertChild(n2);
      v.expect(moved.rendered).toBe(true);
      // Linked in child order before `fresh` is attached.
      v.expect(storeOrder(fresh)).toEqual(['n1', 'moved', 'n2']);
      host.insertChild(fresh);
      v.expect(fresh.rendered).toBe(true);
      v.expect(ids(fresh)).toEqual(['n1', 'moved', 'n2']);
      expectOrder(fresh);
      v.expect(storeOrder(host)).toEqual(['fresh']);
      dispose();
    },
  );

  // As renderer v2: a destroyed child is left alone, a destroyed anchor
  // appends (its slot is gone, so no sibling link points to it). 1.8 called
  // the DOM handle's insertBefore with a destroyed handle; here the node is
  // destroyed (slot NULL) and inserted through insertChild.
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
    a.destroy();
    v.expect(a.slot).toBe(NULL);
    v.expect(storeOrder(parent)).toEqual(['b']);

    // A destroyed child gets no store link.
    parent.insertChild(a);
    v.expect(storeOrder(parent)).toEqual(['b']);
    // A destroyed anchor: the node stays last among the linked children.
    v.expect(() => parent.insertChild(b, a)).not.toThrow();
    v.expect(storeOrder(parent)).toEqual(['b']);
    v.expect(core.nodes.next[b.slot]).toBe(NULL);
    dispose();
  });
});

v.describe('child list', () => {
  // N3: a removed node keeps its parent link, as in 1.6 (keys and events
  // from a removed focused subtree still bubble through it).
  v.test(
    'removeChild takes the child out and keeps its parent link (1.6)',
    () => {
      const parent = new ElementNode(core, NodeType.Element);
      const [a, b, c] = ['a', 'b', 'c'].map((id) => {
        const n = new ElementNode(core, NodeType.Element);
        n.id = id;
        parent.insertChild(n);
        return n;
      }) as [ElementNode, ElementNode, ElementNode];

      parent.removeChild(b);
      v.expect(ids(parent)).toEqual(['a', 'c']);
      v.expect(b.parent).toBe(parent);

      // Not a child: nothing changes.
      parent.removeChild(b);
      v.expect(ids(parent)).toEqual(['a', 'c']);

      // Re-inserted elsewhere: it is in one child list only.
      const other = new ElementNode(core, NodeType.Element);
      other.insertChild(b);
      v.expect(ids(other)).toEqual(['b']);
      v.expect(ids(parent)).toEqual(['a', 'c']);
      v.expect(b.parent).toBe(other);
      // And in one place in the store.
      v.expect(storeOrder(other)).toEqual(['b']);
      v.expect(storeOrder(parent)).toEqual(['a', 'c']);

      // Re-inserted where it was, before a sibling.
      parent.removeChild(a);
      v.expect(a.parent).toBe(parent);
      parent.insertChild(a, c);
      v.expect(ids(parent)).toEqual(['a', 'c']);
      v.expect(storeOrder(parent)).toEqual(['a', 'c']);
      parent.insertChild(a, a);
      v.expect(ids(parent)).toEqual(['a', 'c']);
      v.expect(storeOrder(parent)).toEqual(['a', 'c']);
    },
  );

  v.test('replaceText on a removed text child changes only its text', () => {
    const text = new ElementNode(core, NodeType.TextNode);
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
      await waitForUpdate();
      v.expect(el.preserve).toBe(true);

      const host = el.parent!;
      setShow(false);
      await waitForUpdate();
      v.expect(host.children).not.toContain(el);
      v.expect(el.parent).toBe(host);
      setShow(true);
      await waitForUpdate();
      v.expect(host.children).toContain(el);
      v.expect(el.preserve).toBe(true);
      v.expect(destroyed).toBe(0);
      dispose();
    },
  );

  // A Row that is itself a removed root, with focus still in it, takes its
  // first scroll (its parent link is kept, as in 1.6).
  v.test('a removed Row still scrolls', () => {
    let host!: ElementNode;
    let row!: ElementNode;
    const dispose = renderer.render(() => (
      <view ref={host} width={1920} height={300}>
        <view ref={row} display="flex" width={1920} height={100}>
          <view width={500} height={100} />
          <view width={500} height={100} />
          <view width={500} height={100} />
        </view>
      </view>
    ));
    host.removeChild(row);
    v.expect(row.parent).toBe(host);
    v.expect(() => scrollRow(1, row, undefined, 0)).not.toThrow();
    dispose();
  });

  // N3: a removed node keeps its parent link, but must not lay out its old
  // parent: not on a load, not when its own layout changes its size. (1.8's
  // removed node kept its renderer node; a removed node here is destroyed at
  // the next delete flush, so these two are `preserve`d to stay alive and
  // keep their store record, the loads and resizes they test.)
  v.test("a removed node's load does not lay out its old parent", async () => {
    let count = 0;
    let row!: ElementNode;
    let auto!: ElementNode;
    const dispose = renderer.render(() => (
      <view ref={row} display="flex" onLayout={() => void count++}>
        <view ref={auto} autosize preserve width={50} height={50} />
        <view width={20} height={20} />
      </view>
    ));
    await waitForUpdate();
    const before = count;
    row.removeChild(auto);
    await waitForUpdate();
    const afterRemove = count;
    v.expect(afterRemove).toBeGreaterThan(before);

    // The texture's size lands in the store, then `loaded` reaches the node.
    core.nodes.f64[auto.slot * F_STRIDE + F_WIDTH] = 120;
    core.events.queue(auto, 'loaded', {
      type: 'texture',
      dimensions: { width: 120, height: 50 },
    });
    core.events.flush();
    await waitForUpdate();
    v.expect(count).toBe(afterRemove);
    dispose();
  });

  v.test(
    "a removed container's resize does not lay out its old parent",
    async () => {
      let count = 0;
      let outer!: ElementNode;
      let inner!: ElementNode;
      let item!: ElementNode;
      const dispose = renderer.render(() => (
        <view ref={outer} display="flex" onLayout={() => void count++}>
          <view ref={inner} display="flex" preserve height={20}>
            <view ref={item} width={20} height={20} />
          </view>
          <view width={10} height={10} />
        </view>
      ));
      await waitForUpdate();
      outer.removeChild(inner);
      await waitForUpdate();
      const afterRemove = count;

      item.width = 70;
      inner.updateLayout();
      await waitForUpdate();
      v.expect(inner.width).toBe(70);
      v.expect(count).toBe(afterRemove);
      dispose();
    },
  );

  v.test(
    "a removed text's change does not lay out its old parent",
    async () => {
      let count = 0;
      let row!: ElementNode;
      let label!: ElementNode;
      const dispose = renderer.render(() => (
        <view ref={row} display="flex" onLayout={() => void count++}>
          <text ref={label}>Short</text>
          <view width={20} height={20} />
        </view>
      ));
      await waitForUpdate();
      row.removeChild(label);
      await waitForUpdate();
      const afterRemove = count;

      // N3 keeps `parent` on a removed node: the text's measure path must
      // still treat it as out of the tree. (The size change comes from
      // maxWidth, which flex reads first.)
      v.expect(label.parent).toBe(row);
      label.text = 'A much longer label than before';
      label.maxWidth = 200;
      await waitForUpdate();
      v.expect(count).toBe(afterRemove);
      dispose();
    },
  );
});

v.afterEach(() => {
  tick();
});
