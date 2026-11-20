/**
 * B19: renderer v2 draws siblings in its own child order (among equal
 * zIndex), so that order must follow the ElementNode's `children`. Before
 * 1.7, a node inserted before an anchor (`<Show>` between siblings, `<For>`
 * adding in the middle) was appended to the renderer's children, and a
 * same-parent move (a `<For>` reorder) never moved the renderer node.
 *
 * Read through the renderer's public children list (`Node.children`).
 */
import * as v from 'vitest';
import * as s from 'solid-js';
import { ElementNode } from '@solidtv/solid';
import { render } from './setup.js';

type Handle = { children: unknown[] };

/** The ids of the rendered element children, in `children` order. */
const expected = (parent: ElementNode) =>
  parent.children
    .filter((c) => c instanceof ElementNode && c.rendered)
    .map((c) => (c as ElementNode).id);

/** The ids behind the renderer's children of `parent`, in draw order. */
const drawn = (parent: ElementNode) => {
  const byHandle = new Map<unknown, string | undefined>();
  for (const c of parent.children) {
    if (c instanceof ElementNode) byHandle.set(c.lng, c.id);
  }
  return (parent.lng as unknown as Handle).children.map((h) =>
    byHandle.has(h) ? byHandle.get(h) : '?',
  );
};

const ids = (parent: ElementNode) =>
  parent.children.map((c) => (c instanceof ElementNode ? c.id : '#text'));

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

v.test('<Show> inserted before an anchor is drawn before it', async () => {
  const [show, setShow] = s.createSignal(false);
  let parent!: ElementNode;
  const dispose = render(() => (
    <view ref={parent} width={300} height={100}>
      <view id="first" width={10} height={10} />
      <s.Show when={show()}>
        <view id="middle" width={10} height={10} />
      </s.Show>
      <view id="last" width={10} height={10} />
    </view>
  ));
  await tick();
  v.expect(drawn(parent)).toEqual(expected(parent));

  setShow(true);
  await tick();
  v.expect(ids(parent)).toEqual(['first', 'middle', 'last']);
  v.expect(drawn(parent)).toEqual(expected(parent));

  setShow(false);
  await tick();
  setShow(true);
  await tick();
  v.expect(drawn(parent)).toEqual(expected(parent));
  dispose();
});

v.test(
  '<For> insert in the middle and reorder keep the drawn order',
  async () => {
    const [items, setItems] = s.createSignal(['a', 'c']);
    let parent!: ElementNode;
    const dispose = render(() => (
      <view ref={parent} width={300} height={100}>
        <view id="head" width={10} height={10} />
        <s.For each={items()}>
          {(id) => <view id={id} width={10} height={10} />}
        </s.For>
        <view id="tail" width={10} height={10} />
      </view>
    ));
    await tick();
    v.expect(drawn(parent)).toEqual(expected(parent));

    setItems(['a', 'b', 'c']);
    await tick();
    v.expect(ids(parent)).toEqual(['head', 'a', 'b', 'c', 'tail']);
    v.expect(drawn(parent)).toEqual(expected(parent));

    setItems(['c', 'b', 'a']);
    await tick();
    v.expect(ids(parent)).toEqual(['head', 'c', 'b', 'a', 'tail']);
    v.expect(drawn(parent)).toEqual(expected(parent));

    setItems(['b', 'd', 'a', 'c']);
    await tick();
    v.expect(ids(parent)).toEqual(['head', 'b', 'd', 'a', 'c', 'tail']);
    v.expect(drawn(parent)).toEqual(expected(parent));
    dispose();
  },
);

v.test('insertChild(node, before) between rendered parents', () => {
  let left!: ElementNode;
  let right!: ElementNode;
  let moved!: ElementNode;
  let anchor!: ElementNode;
  const dispose = render(() => (
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
  v.expect(drawn(right)).toEqual(expected(right));
  v.expect(drawn(left)).toEqual(expected(left));

  // Same parent, before an earlier sibling, then back to the end.
  const y = right.children[2] as ElementNode;
  right.insertChild(y, moved);
  v.expect(ids(right)).toEqual(['y', 'moved', 'anchor']);
  v.expect(drawn(right)).toEqual(expected(right));
  right.insertChild(y);
  v.expect(ids(right)).toEqual(['moved', 'anchor', 'y']);
  v.expect(drawn(right)).toEqual(expected(right));
  dispose();
});

// Solid's swap of adjacent items asks for insertNode(parent, y, y): a node
// placed before itself stays (DOM semantics), it is not appended.
v.test(
  'an adjacent <For> swap with a later sibling keeps the drawn order',
  async () => {
    const [items, setItems] = s.createSignal(['a', 'x', 'y', 'b']);
    let parent!: ElementNode;
    const dispose = render(() => (
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
    v.expect(drawn(parent)).toEqual(expected(parent));
    dispose();
  },
);

v.test(
  'a parent rendered after it got rendered and new children draws them in order',
  () => {
    let host!: ElementNode;
    let moved!: ElementNode;
    const dispose = render(() => (
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
    host.insertChild(fresh);
    fresh.render(true);
    v.expect(ids(fresh)).toEqual(['n1', 'moved', 'n2']);
    v.expect(drawn(fresh)).toEqual(expected(fresh));
    v.expect(drawn(host)).toEqual(['fresh']);
    dispose();
  },
);
