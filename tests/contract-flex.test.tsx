/**
 * Phase 1 contract tests: flex layout.
 *
 * Part 1 runs ONE table of flex cases against BOTH engines by calling them
 * directly on ElementNode trees:
 *   - src/core/flex.ts       (default)
 *   - src/core/flexLayout.ts (selected in src/core/elementNode.ts:22 by
 *     `import.meta.env?.VITE_USE_NEW_FLEX` being truthy — note any non-empty
 *     string, including "false", selects it)
 * Where the engines differ today, a case carries `expectedNew` and a
 * `newDiffers` note. The rewrite keeps one engine; these cases show what each
 * one does.
 *
 * Part 2 pins the end-to-end behaviour through JSX, the renderer and the
 * post-mutation layout queue, on whichever engine elementNode.ts selected.
 * Run it on both:
 *   npx vitest run tests/contract-flex.test.tsx
 *   VITE_USE_NEW_FLEX=true npx vitest run tests/contract-flex.test.tsx
 */
import { describe, it, expect, vi } from 'vitest';
import * as s from 'solid-js';
import * as lng from '@solidtv/solid';
import { ElementNode } from '../src/core/elementNode.ts';
import { TextNode } from '../src/core/nodeTypes.ts';
import flexOld from '../src/core/flex.ts';
import flexNew from '../src/core/flexLayout.ts';
import { renderer, waitForUpdate } from './setup.js';

const NEW_FLEX_ACTIVE = !!import.meta.env?.VITE_USE_NEW_FLEX;

// ---------------------------------------------------------------------------
// Part 1: table of flex cases, run on both engines
// ---------------------------------------------------------------------------

type Props = Record<string, unknown>;
type KidSpec =
  | { kind?: 'view'; props: Props }
  | { kind: 'text'; props: Props }
  | { kind: 'textNode' };

interface Box {
  x?: number;
  y?: number;
  w?: number;
  h?: number;
}
interface FlexResult {
  returned: boolean;
  container: { w?: number; h?: number };
  children: Box[];
}
interface FlexCase {
  /** The contract bullet the case pins, then what it checks. */
  name: string;
  container: Props;
  kids: KidSpec[];
  expected: FlexResult;
  /** flexLayout.ts result, when it differs from flex.ts today. */
  expectedNew?: FlexResult;
  /** Why the engines differ (listed in the Phase 1 report). */
  newDiffers?: string;
}

const view = (width: number, height: number, extra: Props = {}): KidSpec => ({
  props: { width, height, ...extra },
});
const A = (extra: Props = {}) => view(50, 50, extra);
const B = (extra: Props = {}) => view(60, 40, extra);

// "untouched" = the engine never wrote the prop (unrendered nodes start
// undefined), so a case can tell "set to 0" from "not positioned".
const U = undefined;

function build(container: Props, kids: KidSpec[]) {
  const node = new ElementNode('view');
  Object.assign(node, { display: 'flex' }, container);
  const children: Array<ElementNode | TextNode> = [];
  for (const k of kids) {
    let c: ElementNode | TextNode;
    if (k.kind === 'textNode') {
      c = new TextNode('raw string child');
      (c as TextNode).parent = node as never;
    } else {
      c = new ElementNode(k.kind === 'text' ? 'text' : 'view');
      Object.assign(c, k.props);
      c.parent = node;
    }
    node.children.push(c as ElementNode);
    children.push(c);
  }
  return { node, children };
}

function snapshot(
  node: ElementNode,
  children: Array<ElementNode | TextNode>,
  returned: boolean,
): FlexResult {
  return {
    returned,
    container: { w: node.width, h: node.height },
    children: children
      .filter((c): c is ElementNode => c instanceof ElementNode)
      .map((c) => ({ x: c.x, y: c.y, w: c.width, h: c.height })),
  };
}

function run(engine: typeof flexOld, c: Pick<FlexCase, 'container' | 'kids'>) {
  const { node, children } = build(c.container, c.kids);
  const returned = engine(node);
  return snapshot(node, children, returned);
}

const res = (
  returned: boolean,
  container: FlexResult['container'],
  children: Box[],
): FlexResult => ({ returned, container, children });

const cases: FlexCase[] = [
  // --- display: "flex" + container auto-size (flexBoundary) ---------------
  {
    name: 'display flex / auto-size: row flexStart shrinks an explicit width to the content (no flexBoundary)',
    container: { width: 300, height: 100, gap: 10 },
    kids: [A(), B()],
    // 50 + 10 + 60 = 120; the explicit 300 is overwritten.
    expected: res(true, { w: 120, h: 100 }, [
      { x: 0, y: U, w: 50, h: 50 },
      { x: 60, y: U, w: 60, h: 40 },
    ]),
  },
  {
    name: 'display flex / auto-size: row flexStart with no width takes the content width',
    container: { gap: 10 },
    kids: [A(), B()],
    expected: res(true, { w: 120, h: U }, [
      { x: 0, y: U, w: 50, h: 50 },
      { x: 60, y: U, w: 60, h: 40 },
    ]),
  },
  {
    name: 'flexBoundary: "fixed" keeps the container width with flexStart',
    container: { width: 300, height: 100, gap: 10, flexBoundary: 'fixed' },
    kids: [A(), B()],
    expected: res(false, { w: 300, h: 100 }, [
      { x: 0, y: U, w: 50, h: 50 },
      { x: 60, y: U, w: 60, h: 40 },
    ]),
  },
  {
    name: 'flexBoundary: "contain" with flexEnd does NOT resize the container (only flexStart resizes, despite the docs)',
    container: {
      width: 300,
      height: 100,
      justifyContent: 'flexEnd',
      flexBoundary: 'contain',
    },
    kids: [A(), B()],
    expected: res(false, { w: 300, h: 100 }, [
      { x: 190, y: U, w: 50, h: 50 },
      { x: 240, y: U, w: 60, h: 40 },
    ]),
  },
  {
    name: 'auto-size: a container minWidth is the floor for the content size',
    container: { minWidth: 400 },
    kids: [A(), B()],
    expected: res(true, { w: 400, h: U }, [
      { x: 0, y: U, w: 50, h: 50 },
      { x: 50, y: U, w: 60, h: 40 },
    ]),
  },
  {
    name: 'display flex: a container with no children is not laid out',
    container: { width: 300, height: 100 },
    kids: [],
    expected: res(false, { w: 300, h: 100 }, []),
  },

  // --- justifyContent, row -------------------------------------------------
  {
    name: 'justifyContent flexEnd (row)',
    container: { width: 300, height: 100, gap: 10, justifyContent: 'flexEnd' },
    kids: [A(), B()],
    expected: res(false, { w: 300, h: 100 }, [
      { x: 180, y: U, w: 50, h: 50 },
      { x: 240, y: U, w: 60, h: 40 },
    ]),
  },
  {
    name: 'justifyContent center (row, gap counts)',
    container: { width: 300, height: 100, gap: 10, justifyContent: 'center' },
    kids: [A(), B()],
    expected: res(false, { w: 300, h: 100 }, [
      { x: 90, y: U, w: 50, h: 50 },
      { x: 150, y: U, w: 60, h: 40 },
    ]),
  },
  {
    name: 'justifyContent spaceBetween (row, gap ignored)',
    container: {
      width: 300,
      height: 100,
      gap: 10,
      justifyContent: 'spaceBetween',
    },
    kids: [A(), B()],
    expected: res(false, { w: 300, h: 100 }, [
      { x: 0, y: U, w: 50, h: 50 },
      { x: 240, y: U, w: 60, h: 40 },
    ]),
  },
  {
    name: 'justifyContent spaceBetween with a single child puts it at the start',
    container: { width: 300, height: 100, justifyContent: 'spaceBetween' },
    kids: [A()],
    expected: res(false, { w: 300, h: 100 }, [{ x: 0, y: U, w: 50, h: 50 }]),
  },
  {
    name: 'justifyContent spaceAround (row)',
    container: { width: 300, height: 100, justifyContent: 'spaceAround' },
    kids: [A(), B()],
    expected: res(false, { w: 300, h: 100 }, [
      { x: 47.5, y: U, w: 50, h: 50 },
      { x: 192.5, y: U, w: 60, h: 40 },
    ]),
  },
  {
    name: 'justifyContent spaceEvenly (row)',
    container: { width: 290, height: 100, justifyContent: 'spaceEvenly' },
    kids: [A(), B()],
    expected: res(false, { w: 290, h: 100 }, [
      { x: 60, y: U, w: 50, h: 50 },
      { x: 170, y: U, w: 60, h: 40 },
    ]),
  },

  // --- flexDirection column + justifyContent -------------------------------
  {
    name: 'flexDirection column / auto-size: flexStart sets the container height to the content',
    container: { width: 200, height: 500, gap: 5, flexDirection: 'column' },
    kids: [A(), B()],
    expected: res(true, { w: 200, h: 95 }, [
      { x: U, y: 0, w: 50, h: 50 },
      { x: U, y: 55, w: 60, h: 40 },
    ]),
  },
  {
    name: 'flexDirection column + justifyContent flexEnd',
    container: {
      width: 200,
      height: 300,
      gap: 5,
      flexDirection: 'column',
      justifyContent: 'flexEnd',
    },
    kids: [A(), B()],
    expected: res(false, { w: 200, h: 300 }, [
      { x: U, y: 205, w: 50, h: 50 },
      { x: U, y: 260, w: 60, h: 40 },
    ]),
  },
  {
    name: 'flexDirection column + justifyContent center',
    container: {
      width: 200,
      height: 300,
      flexDirection: 'column',
      justifyContent: 'center',
    },
    kids: [A(), B()],
    expected: res(false, { w: 200, h: 300 }, [
      { x: U, y: 105, w: 50, h: 50 },
      { x: U, y: 155, w: 60, h: 40 },
    ]),
  },
  {
    name: 'flexDirection column + justifyContent spaceBetween',
    container: {
      width: 200,
      height: 300,
      flexDirection: 'column',
      justifyContent: 'spaceBetween',
    },
    kids: [A(), B()],
    expected: res(false, { w: 200, h: 300 }, [
      { x: U, y: 0, w: 50, h: 50 },
      { x: U, y: 260, w: 60, h: 40 },
    ]),
  },
  {
    name: 'flexDirection column + justifyContent spaceEvenly',
    container: {
      width: 200,
      height: 300,
      flexDirection: 'column',
      justifyContent: 'spaceEvenly',
    },
    kids: [A(), B()],
    expected: res(false, { w: 200, h: 300 }, [
      { x: U, y: 70, w: 50, h: 50 },
      { x: U, y: 190, w: 60, h: 40 },
    ]),
  },
  {
    name: 'flexDirection column + justifyContent spaceAround',
    container: {
      width: 200,
      height: 300,
      flexDirection: 'column',
      justifyContent: 'spaceAround',
    },
    kids: [A(), B()],
    expected: res(false, { w: 200, h: 300 }, [
      { x: U, y: 52.5, w: 50, h: 50 },
      { x: U, y: 207.5, w: 60, h: 40 },
    ]),
  },

  // --- reverse directions ---------------------------------------------------
  {
    name: 'flexDirection row-reverse: reverses the order, still packed from the left with flexStart',
    container: { width: 300, gap: 10, flexDirection: 'row-reverse' },
    kids: [A(), B()],
    expected: res(true, { w: 120, h: U }, [
      { x: 70, y: U, w: 50, h: 50 },
      { x: 0, y: U, w: 60, h: 40 },
    ]),
  },
  {
    name: 'flexDirection row-reverse + flexEnd: first child ends up at the right edge',
    container: {
      width: 300,
      gap: 10,
      flexDirection: 'row-reverse',
      justifyContent: 'flexEnd',
    },
    kids: [A(), B()],
    expected: res(false, { w: 300, h: U }, [
      { x: 250, y: U, w: 50, h: 50 },
      { x: 180, y: U, w: 60, h: 40 },
    ]),
  },
  {
    name: 'flexDirection column-reverse: reverses the order on the y axis',
    container: { width: 200, height: 300, flexDirection: 'column-reverse' },
    kids: [A(), B()],
    expected: res(true, { w: 200, h: 90 }, [
      { x: U, y: 40, w: 50, h: 50 },
      { x: U, y: 0, w: 60, h: 40 },
    ]),
  },
  {
    name: 'direction rtl: reverses the order like row-reverse',
    container: { width: 300, gap: 10, direction: 'rtl' },
    kids: [A(), B()],
    expected: res(true, { w: 120, h: U }, [
      { x: 70, y: U, w: 50, h: 50 },
      { x: 0, y: U, w: 60, h: 40 },
    ]),
  },

  // --- alignItems / alignSelf ----------------------------------------------
  {
    name: 'alignItems flexStart (row)',
    container: {
      width: 300,
      height: 100,
      flexBoundary: 'fixed',
      alignItems: 'flexStart',
    },
    kids: [A(), B()],
    expected: res(false, { w: 300, h: 100 }, [
      { x: 0, y: 0, w: 50, h: 50 },
      { x: 50, y: 0, w: 60, h: 40 },
    ]),
  },
  {
    name: 'alignItems center (row)',
    container: {
      width: 300,
      height: 100,
      flexBoundary: 'fixed',
      alignItems: 'center',
    },
    kids: [A(), B()],
    expected: res(false, { w: 300, h: 100 }, [
      { x: 0, y: 25, w: 50, h: 50 },
      { x: 50, y: 30, w: 60, h: 40 },
    ]),
  },
  {
    name: 'alignItems flexEnd (row)',
    container: {
      width: 300,
      height: 100,
      flexBoundary: 'fixed',
      alignItems: 'flexEnd',
    },
    kids: [A(), B()],
    expected: res(false, { w: 300, h: 100 }, [
      { x: 0, y: 50, w: 50, h: 50 },
      { x: 50, y: 60, w: 60, h: 40 },
    ]),
  },
  {
    name: 'alignItems center (column aligns on x)',
    container: {
      width: 200,
      height: 300,
      flexDirection: 'column',
      flexBoundary: 'fixed',
      alignItems: 'center',
    },
    kids: [A(), B()],
    expected: res(false, { w: 200, h: 300 }, [
      { x: 75, y: 0, w: 50, h: 50 },
      { x: 70, y: 50, w: 60, h: 40 },
    ]),
  },
  {
    name: 'alignItems: no-op when the container has no cross size',
    container: { width: 300, flexBoundary: 'fixed', alignItems: 'center' },
    kids: [A(), B()],
    expected: res(false, { w: 300, h: U }, [
      { x: 0, y: U, w: 50, h: 50 },
      { x: 50, y: U, w: 60, h: 40 },
    ]),
  },
  {
    name: 'alignSelf overrides alignItems',
    container: {
      width: 300,
      height: 100,
      flexBoundary: 'fixed',
      alignItems: 'center',
    },
    kids: [A(), B({ alignSelf: 'flexEnd' })],
    expected: res(false, { w: 300, h: 100 }, [
      { x: 0, y: 25, w: 50, h: 50 },
      { x: 50, y: 60, w: 60, h: 40 },
    ]),
  },
  {
    name: 'alignSelf works without alignItems; siblings keep their y',
    container: { width: 300, height: 100, flexBoundary: 'fixed' },
    kids: [A(), B({ alignSelf: 'center' })],
    expected: res(false, { w: 300, h: 100 }, [
      { x: 0, y: U, w: 50, h: 50 },
      { x: 50, y: 30, w: 60, h: 40 },
    ]),
  },

  // --- gap ------------------------------------------------------------------
  {
    name: 'gap (column)',
    container: { width: 200, height: 500, gap: 20, flexDirection: 'column' },
    kids: [A(), B(), A()],
    expected: res(true, { w: 200, h: 180 }, [
      { x: U, y: 0, w: 50, h: 50 },
      { x: U, y: 70, w: 60, h: 40 },
      { x: U, y: 130, w: 50, h: 50 },
    ]),
  },
  {
    name: 'rowGap/columnGap are ignored on the main axis without wrap (only gap counts)',
    container: { width: 300, rowGap: 7, columnGap: 9 },
    kids: [A(), B()],
    expected: res(true, { w: 110, h: U }, [
      { x: 0, y: U, w: 50, h: 50 },
      { x: 50, y: U, w: 60, h: 40 },
    ]),
  },

  // --- padding (a number) ---------------------------------------------------
  {
    name: 'padding number + flexStart: main-axis start and auto-size include padding; cross-axis padding only in flexLayout.ts',
    container: {
      width: 300,
      height: 100,
      padding: 10,
      alignItems: 'flexStart',
    },
    kids: [A(), B()],
    expected: res(true, { w: 130, h: 100 }, [
      { x: 10, y: 0, w: 50, h: 50 },
      { x: 60, y: 0, w: 60, h: 40 },
    ]),
    expectedNew: res(true, { w: 130, h: 100 }, [
      { x: 10, y: 10, w: 50, h: 50 },
      { x: 60, y: 10, w: 60, h: 40 },
    ]),
    newDiffers:
      'flex.ts applies a number padding on the main axis only; flexLayout.ts also offsets the cross axis by paddingTop',
  },
  {
    name: 'padding number + alignItems flexEnd: flexLayout.ts adds the top padding instead of subtracting the bottom one',
    container: {
      width: 300,
      height: 100,
      padding: 10,
      flexBoundary: 'fixed',
      alignItems: 'flexEnd',
    },
    kids: [A(), B()],
    expected: res(false, { w: 300, h: 100 }, [
      { x: 10, y: 50, w: 50, h: 50 },
      { x: 60, y: 60, w: 60, h: 40 },
    ]),
    // BUG (flexLayout.ts:271-276): flexEnd adds paddingCrossStart, pushing the
    // child 10px past the container's bottom edge (60 + 50 = 110 > 100).
    expectedNew: res(false, { w: 300, h: 100 }, [
      { x: 10, y: 60, w: 50, h: 50 },
      { x: 60, y: 70, w: 60, h: 40 },
    ]),
    newDiffers:
      'cross-axis flexEnd/center with padding: flexLayout.ts offsets by paddingTop (child overflows the bottom); flex.ts ignores cross padding',
  },
  {
    name: 'padding number + alignItems center',
    container: {
      width: 300,
      height: 100,
      padding: 10,
      flexBoundary: 'fixed',
      alignItems: 'center',
    },
    kids: [A(), B()],
    expected: res(false, { w: 300, h: 100 }, [
      { x: 10, y: 25, w: 50, h: 50 },
      { x: 60, y: 30, w: 60, h: 40 },
    ]),
    expectedNew: res(false, { w: 300, h: 100 }, [
      { x: 10, y: 35, w: 50, h: 50 },
      { x: 60, y: 40, w: 60, h: 40 },
    ]),
    newDiffers:
      'cross-axis center with padding: flexLayout.ts shifts by paddingTop instead of centering in the padded box',
  },
  {
    name: 'padding number + flexEnd (row)',
    container: {
      width: 300,
      height: 100,
      padding: 10,
      justifyContent: 'flexEnd',
    },
    kids: [A(), B()],
    expected: res(false, { w: 300, h: 100 }, [
      { x: 180, y: U, w: 50, h: 50 },
      { x: 230, y: U, w: 60, h: 40 },
    ]),
  },
  {
    name: 'padding number + center (row): content is shifted right by the padding (see BUG test below)',
    container: {
      width: 300,
      height: 100,
      padding: 10,
      justifyContent: 'center',
    },
    kids: [A(), B()],
    expected: res(false, { w: 300, h: 100 }, [
      { x: 105, y: U, w: 50, h: 50 },
      { x: 155, y: U, w: 60, h: 40 },
    ]),
  },
  {
    name: 'padding number + spaceBetween (row)',
    container: {
      width: 300,
      height: 100,
      padding: 10,
      justifyContent: 'spaceBetween',
    },
    kids: [A(), B()],
    expected: res(false, { w: 300, h: 100 }, [
      { x: 10, y: U, w: 50, h: 50 },
      { x: 230, y: U, w: 60, h: 40 },
    ]),
  },
  {
    name: 'padding number + spaceEvenly (row)',
    container: {
      width: 310,
      height: 100,
      padding: 10,
      justifyContent: 'spaceEvenly',
    },
    kids: [A(), B()],
    expected: res(false, { w: 310, h: 100 }, [
      { x: 70, y: U, w: 50, h: 50 },
      { x: 180, y: U, w: 60, h: 40 },
    ]),
  },
  {
    name: 'padding number + spaceAround (row)',
    container: {
      width: 300,
      height: 100,
      padding: 10,
      justifyContent: 'spaceAround',
    },
    kids: [A(), B()],
    expected: res(false, { w: 300, h: 100 }, [
      { x: 52.5, y: U, w: 50, h: 50 },
      { x: 187.5, y: U, w: 60, h: 40 },
    ]),
  },
  {
    name: 'padding number (column): start and auto-size height include padding',
    container: {
      width: 200,
      height: 500,
      padding: 10,
      flexDirection: 'column',
    },
    kids: [A(), B()],
    expected: res(true, { w: 200, h: 110 }, [
      { x: U, y: 10, w: 50, h: 50 },
      { x: U, y: 60, w: 60, h: 40 },
    ]),
  },

  // --- margins --------------------------------------------------------------
  {
    name: 'marginLeft/marginRight (row) count in positions and in the auto-size',
    container: { width: 300 },
    kids: [A({ marginLeft: 5, marginRight: 10 }), B({ marginLeft: 15 })],
    expected: res(true, { w: 140, h: U }, [
      { x: 5, y: U, w: 50, h: 50 },
      { x: 80, y: U, w: 60, h: 40 },
    ]),
  },
  {
    name: 'marginTop/marginBottom (column) count in positions and in the auto-size',
    container: { width: 200, height: 500, flexDirection: 'column' },
    kids: [A({ marginTop: 5, marginBottom: 10 }), B({ marginTop: 15 })],
    expected: res(true, { w: 200, h: 120 }, [
      { x: U, y: 5, w: 50, h: 50 },
      { x: U, y: 80, w: 60, h: 40 },
    ]),
  },
  {
    name: 'cross-axis margins: alignItems flexEnd uses marginBottom only',
    container: {
      width: 300,
      height: 100,
      flexBoundary: 'fixed',
      alignItems: 'flexEnd',
    },
    kids: [A({ marginBottom: 4 }), B({ marginTop: 3 })],
    expected: res(false, { w: 300, h: 100 }, [
      { x: 0, y: 46, w: 50, h: 50 },
      { x: 50, y: 60, w: 60, h: 40 },
    ]),
  },
  {
    name: 'cross-axis margins: alignItems center adds marginTop only',
    container: {
      width: 300,
      height: 100,
      flexBoundary: 'fixed',
      alignItems: 'center',
    },
    kids: [A({ marginTop: 10 }), B({ marginBottom: 10 })],
    expected: res(false, { w: 300, h: 100 }, [
      { x: 0, y: 35, w: 50, h: 50 },
      { x: 50, y: 30, w: 60, h: 40 },
    ]),
  },
  {
    name: 'margin array [t, r, b, l]: only flexLayout.ts reads it',
    container: { width: 300, height: 100, alignItems: 'flexStart' },
    kids: [A({ margin: [1, 2, 3, 4] }), B()],
    expected: res(true, { w: 110, h: 100 }, [
      { x: 0, y: 0, w: 50, h: 50 },
      { x: 50, y: 0, w: 60, h: 40 },
    ]),
    expectedNew: res(true, { w: 116, h: 100 }, [
      { x: 4, y: 1, w: 50, h: 50 },
      { x: 56, y: 0, w: 60, h: 40 },
    ]),
    newDiffers:
      '`margin` array is read by flexLayout.ts only; flex.ts ignores it',
  },

  // --- flexGrow -------------------------------------------------------------
  {
    name: 'flexGrow: one growing child takes the free space; the container width is kept',
    container: { width: 300, height: 100, gap: 10 },
    kids: [A({ flexGrow: 1 }), B()],
    expected: res(false, { w: 300, h: 100 }, [
      { x: 0, y: U, w: 230, h: 50 },
      { x: 240, y: U, w: 60, h: 40 },
    ]),
  },
  {
    name: 'flexGrow: free space is split by the grow ratio',
    container: { width: 300, height: 100 },
    kids: [A({ flexGrow: 1 }), B({ flexGrow: 3 })],
    expected: res(false, { w: 300, h: 100 }, [
      { x: 0, y: U, w: 97.5, h: 50 },
      { x: 97.5, y: U, w: 202.5, h: 40 },
    ]),
  },
  {
    name: 'flexGrow: a single child does not grow (needs 2+ items); container auto-sizes',
    container: { width: 300, height: 100 },
    kids: [A({ flexGrow: 1 })],
    expected: res(true, { w: 50, h: 100 }, [{ x: 0, y: U, w: 50, h: 50 }]),
  },
  {
    name: 'flexGrow: no free space means no growth (flex.ts also console.warns)',
    container: { width: 100, height: 100 },
    kids: [A({ flexGrow: 1 }), B()],
    expected: res(false, { w: 100, h: 100 }, [
      { x: 0, y: U, w: 50, h: 50 },
      { x: 50, y: U, w: 60, h: 40 },
    ]),
  },
  {
    name: 'flexGrow: a negative value is ignored (container auto-sizes as without grow)',
    container: { width: 300, height: 100 },
    kids: [A({ flexGrow: -1 }), B()],
    expected: res(true, { w: 110, h: 100 }, [
      { x: 0, y: U, w: 50, h: 50 },
      { x: 50, y: U, w: 60, h: 40 },
    ]),
  },

  // --- flexWrap -------------------------------------------------------------
  {
    name: 'flexWrap wrap (row): overflow goes to a new line; line gap = gap; container height grows',
    container: { width: 250, height: 50, gap: 10, flexWrap: 'wrap' },
    kids: [view(100, 50), view(100, 50), view(100, 50)],
    expected: res(true, { w: 250, h: 110 }, [
      { x: 0, y: 0, w: 100, h: 50 },
      { x: 110, y: 0, w: 100, h: 50 },
      { x: 0, y: 60, w: 100, h: 50 },
    ]),
  },
  {
    name: 'flexWrap + columnGap/rowGap (row): the line gap is columnGap (CSS would use rowGap); items use gap',
    container: {
      width: 250,
      height: 50,
      rowGap: 20,
      columnGap: 5,
      flexWrap: 'wrap',
    },
    kids: [view(100, 50), view(100, 50), view(100, 50)],
    expected: res(true, { w: 250, h: 105 }, [
      { x: 0, y: 0, w: 100, h: 50 },
      { x: 100, y: 0, w: 100, h: 50 },
      { x: 0, y: 55, w: 100, h: 50 },
    ]),
  },
  {
    name: 'flexWrap wrap (column): the line gap is rowGap; container width grows',
    container: {
      width: 50,
      height: 250,
      gap: 10,
      rowGap: 4,
      flexDirection: 'column',
      flexWrap: 'wrap',
    },
    kids: [view(50, 100), view(50, 100), view(50, 100)],
    expected: res(true, { w: 104, h: 250 }, [
      { x: 0, y: 0, w: 50, h: 100 },
      { x: 0, y: 110, w: 50, h: 100 },
      { x: 54, y: 0, w: 50, h: 100 },
    ]),
  },
  {
    name: 'flexWrap: every line is as tall as the FIRST child',
    container: { width: 250, height: 50, flexWrap: 'wrap' },
    kids: [view(100, 30), view(100, 80), view(100, 50)],
    expected: res(true, { w: 250, h: 60 }, [
      { x: 0, y: 0, w: 100, h: 30 },
      { x: 100, y: 0, w: 100, h: 80 },
      { x: 0, y: 30, w: 100, h: 50 },
    ]),
  },
  {
    name: 'flexWrap + padding: cross-axis padding only in flexLayout.ts',
    container: {
      width: 250,
      height: 50,
      gap: 10,
      padding: 10,
      flexWrap: 'wrap',
    },
    kids: [view(100, 50), view(100, 50), view(100, 50)],
    expected: res(true, { w: 250, h: 110 }, [
      { x: 10, y: 0, w: 100, h: 50 },
      { x: 120, y: 0, w: 100, h: 50 },
      { x: 10, y: 60, w: 100, h: 50 },
    ]),
    expectedNew: res(true, { w: 250, h: 130 }, [
      { x: 10, y: 10, w: 100, h: 50 },
      { x: 120, y: 10, w: 100, h: 50 },
      { x: 10, y: 70, w: 100, h: 50 },
    ]),
    newDiffers:
      'wrap + padding: flexLayout.ts starts lines at paddingTop and adds paddingBottom to the height; flex.ts ignores cross padding',
  },
  {
    name: 'flexWrap with no container height: lines are counted but children are never moved on the cross axis (see BUG test)',
    container: { width: 250, gap: 10, flexWrap: 'wrap' },
    kids: [view(100, 50), view(100, 50), view(100, 50)],
    expected: res(true, { w: 250, h: 110 }, [
      { x: 0, y: U, w: 100, h: 50 },
      { x: 110, y: U, w: 100, h: 50 },
      { x: 0, y: U, w: 100, h: 50 },
    ]),
  },
  {
    name: 'flexWrap wrap-reverse: flex.ts stacks lines upward to negative y and shrinks the width; flexLayout.ts does not wrap',
    container: { width: 250, height: 50, gap: 10, flexWrap: 'wrap-reverse' },
    kids: [view(100, 50), view(100, 50), view(100, 50)],
    expected: res(true, { w: 100, h: 110 }, [
      { x: 0, y: 0, w: 100, h: 50 },
      { x: 110, y: 0, w: 100, h: 50 },
      { x: 0, y: -60, w: 100, h: 50 },
    ]),
    expectedNew: res(true, { w: 320, h: 50 }, [
      { x: 0, y: 0, w: 100, h: 50 },
      { x: 110, y: 0, w: 100, h: 50 },
      { x: 220, y: 0, w: 100, h: 50 },
    ]),
    newDiffers:
      'wrap-reverse: flexLayout.ts only wraps for "wrap" (flexLayout.ts:297), so it lays out one line and auto-sizes the width',
  },

  // --- flexOrder ------------------------------------------------------------
  {
    name: 'flexOrder sorts items; a missing flexOrder counts as 0',
    container: { width: 300 },
    kids: [A({ flexOrder: 2 }), B({ flexOrder: 1 }), view(30, 30)],
    expected: res(true, { w: 140, h: U }, [
      { x: 90, y: U, w: 50, h: 50 },
      { x: 30, y: U, w: 60, h: 40 },
      { x: 0, y: U, w: 30, h: 30 },
    ]),
  },
  {
    name: 'flexOrder then row-reverse: sorted first, then reversed',
    container: { width: 300, flexDirection: 'row-reverse' },
    kids: [A({ flexOrder: 2 }), B({ flexOrder: 1 }), view(30, 30)],
    expected: res(true, { w: 140, h: U }, [
      { x: 0, y: U, w: 50, h: 50 },
      { x: 50, y: U, w: 60, h: 40 },
      { x: 110, y: U, w: 30, h: 30 },
    ]),
  },

  // --- flexItem={false}, raw text, <text> children, min sizes ---------------
  {
    name: 'flexItem={false}: the child is skipped and keeps its own x; siblings close the gap',
    container: { width: 300 },
    kids: [A(), view(999, 10, { flexItem: false, x: 5 }), B()],
    expected: res(true, { w: 110, h: U }, [
      { x: 0, y: U, w: 50, h: 50 },
      { x: 5, y: U, w: 999, h: 10 },
      { x: 50, y: U, w: 60, h: 40 },
    ]),
  },
  {
    name: 'flexItem={false} on every child: nothing to lay out',
    container: { width: 300, height: 100 },
    kids: [A({ flexItem: false }), B({ flexItem: false })],
    expected: res(false, { w: 300, h: 100 }, [
      { x: U, y: U, w: 50, h: 50 },
      { x: U, y: U, w: 60, h: 40 },
    ]),
  },
  {
    name: 'a raw string child (TextNode) is skipped',
    container: { width: 300 },
    kids: [A(), { kind: 'textNode' }, B()],
    expected: res(true, { w: 110, h: U }, [
      { x: 0, y: U, w: 50, h: 50 },
      { x: 50, y: U, w: 60, h: 40 },
    ]),
  },
  {
    name: 'text in flex: a <text> child with text and no size aborts the WHOLE pass',
    container: { width: 300, height: 100 },
    kids: [A(), { kind: 'text', props: { text: 'Hello' } }, B()],
    expected: res(false, { w: 300, h: 100 }, [
      { x: U, y: U, w: 50, h: 50 },
      { x: U, y: U, w: U, h: U },
      { x: U, y: U, w: 60, h: 40 },
    ]),
  },
  {
    name: 'text in flex: a sized <text> child is laid out like a view',
    container: { width: 300 },
    kids: [
      A(),
      { kind: 'text', props: { text: 'Hello', width: 80, height: 20 } },
      B(),
    ],
    expected: res(true, { w: 190, h: U }, [
      { x: 0, y: U, w: 50, h: 50 },
      { x: 50, y: U, w: 80, h: 20 },
      { x: 130, y: U, w: 60, h: 40 },
    ]),
  },
  {
    name: 'text in flex: maxWidth/maxHeight stand in for width/height (ElementNode.width = maxWidth || w)',
    container: { width: 300 },
    kids: [
      A(),
      { kind: 'text', props: { text: 'Hello', maxWidth: 70, maxHeight: 25 } },
      B(),
    ],
    expected: res(true, { w: 180, h: U }, [
      { x: 0, y: U, w: 50, h: 50 },
      { x: 50, y: U, w: 70, h: 25 },
      { x: 120, y: U, w: 60, h: 40 },
    ]),
  },
  {
    name: 'text in flex: an empty <text> with no size does not block the pass (size 0)',
    container: { width: 300 },
    kids: [A(), { kind: 'text', props: { text: '' } }, B()],
    expected: res(true, { w: 110, h: U }, [
      { x: 0, y: U, w: 50, h: 50 },
      { x: 50, y: U, w: U, h: U },
      { x: 50, y: U, w: 60, h: 40 },
    ]),
  },
  {
    name: 'child minWidth/minHeight raise the child size before layout',
    container: { width: 300 },
    kids: [A({ minWidth: 80, minHeight: 70 }), B()],
    expected: res(true, { w: 140, h: U }, [
      { x: 0, y: U, w: 80, h: 70 },
      { x: 80, y: U, w: 60, h: 40 },
    ]),
  },
];

describe.each([
  ['flex.ts', flexOld, false],
  ['flexLayout.ts', flexNew, true],
] as const)(
  'contract: flex props, table run on %s',
  (_label, engine, isNew) => {
    it.each(cases.map((c) => [c.name, c] as const))('%s', (_name, c) => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        const expected = isNew && c.expectedNew ? c.expectedNew : c.expected;
        expect(run(engine, c)).toEqual(expected);
      } finally {
        warn.mockRestore();
      }
    });
  },
);

describe('contract: flex props, engine-specific details', () => {
  const both = [
    ['flex.ts', flexOld],
    ['flexLayout.ts', flexNew],
  ] as const;

  it.each(both)(
    'flexGrow: a second pass on the same tree gives the same result (%s)',
    (_label, engine) => {
      const { node, children } = build({ width: 300, gap: 10 }, [
        A({ flexGrow: 1 }),
        B(),
      ]);
      const first = snapshot(node, children, engine(node));
      const second = snapshot(node, children, engine(node));
      expect(second).toEqual(first);
      expect(first.children[0]).toEqual({ x: 0, y: U, w: 230, h: 50 });
    },
  );

  it.each(both)(
    'flexGrow: on a relayout the grown width is the new base, so the item never shrinks back (%s)',
    (_label, engine) => {
      const { node, children } = build({ width: 300, gap: 10 }, [
        A({ flexGrow: 1 }),
        B(),
      ]);
      engine(node);
      const [grow, sibling] = children as ElementNode[];
      expect(grow!.width).toBe(230);
      sibling!.width = 100;
      engine(node);
      // 230 + 10 + 100 = 340 > 300: the row overflows (see BUG test below).
      expect(grow!.width).toBe(230);
      expect(sibling!.x).toBe(240);
    },
  );

  // BUG: flexGrow should start from the item's own size on every pass; after
  // the sibling grows to 100 the grow item should be 300 - 100 - 10 = 190.
  // flex.ts:146 / flexLayout.ts:199 add the free space to the current, already
  // grown, width.
  it.skip.each(both)(
    'BUG: flexGrow: a grown item shrinks back when a sibling grows (%s)',
    (_label, engine) => {
      const { node, children } = build({ width: 300, gap: 10 }, [
        A({ flexGrow: 1 }),
        B(),
      ]);
      engine(node);
      const [grow, sibling] = children as ElementNode[];
      sibling!.width = 100;
      engine(node);
      expect(grow!.width).toBe(190);
      expect(sibling!.x).toBe(200);
    },
  );

  it.each(both)(
    'flexGrow: the container gets flexBoundary "fixed" written onto it (%s)',
    (_label, engine) => {
      const { node } = build({ width: 300 }, [A({ flexGrow: 1 }), B()]);
      expect(node.flexBoundary).toBeUndefined();
      engine(node);
      expect(node.flexBoundary).toBe('fixed');
    },
  );

  it('flexGrow with no free space: flex.ts warns, flexLayout.ts is silent', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      flexOld(build({ width: 100 }, [A({ flexGrow: 1 }), B()]).node);
      expect(warn).toHaveBeenCalledTimes(1);
      warn.mockClear();
      flexNew(build({ width: 100 }, [A({ flexGrow: 1 }), B()]).node);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('padding array: flex.ts does not support it (docs: number only); positions become non-numeric', () => {
    // flex.ts:95 casts `padding` to a number; an array then string-concatenates.
    const { node, children } = build(
      { width: 300, height: 100, padding: [5, 20, 15, 10] },
      [A(), B()],
    );
    flexOld(node);
    const [a, b] = children as ElementNode[];
    expect(Number.isFinite(a!.x)).toBe(false);
    expect(Number.isFinite(b!.x)).toBe(false);
    expect(Number.isFinite(node.width)).toBe(false);
  });

  it('padding array [t, r, b, l] (flexLayout.ts)', () => {
    const r = run(flexNew, {
      container: {
        width: 300,
        height: 100,
        padding: [5, 20, 15, 10],
        alignItems: 'flexStart',
      },
      kids: [A(), B()],
    });
    expect(r).toEqual(
      res(true, { w: 140, h: 100 }, [
        { x: 10, y: 5, w: 50, h: 50 },
        { x: 60, y: 5, w: 60, h: 40 },
      ]),
    );
  });

  it('padding array [v, h] and [t, h, b] (flexLayout.ts)', () => {
    const two = run(flexNew, {
      container: {
        width: 300,
        height: 100,
        padding: [5, 10],
        alignItems: 'flexStart',
      },
      kids: [A(), B()],
    });
    expect(two).toEqual(
      res(true, { w: 130, h: 100 }, [
        { x: 10, y: 5, w: 50, h: 50 },
        { x: 60, y: 5, w: 60, h: 40 },
      ]),
    );
    const three = run(flexNew, {
      container: {
        width: 200,
        height: 500,
        flexDirection: 'column',
        padding: [5, 10, 15],
        alignItems: 'flexStart',
      },
      kids: [A(), B()],
    });
    expect(three).toEqual(
      res(true, { w: 200, h: 110 }, [
        { x: 10, y: 5, w: 50, h: 50 },
        { x: 10, y: 55, w: 60, h: 40 },
      ]),
    );
  });

  it('paddingLeft/paddingTop override the padding value (flexLayout.ts only)', () => {
    const container = {
      width: 300,
      height: 100,
      padding: 10,
      paddingLeft: 30,
      paddingTop: 2,
      alignItems: 'flexStart',
    };
    expect(run(flexNew, { container, kids: [A(), B()] })).toEqual(
      res(true, { w: 150, h: 100 }, [
        { x: 30, y: 2, w: 50, h: 50 },
        { x: 80, y: 2, w: 60, h: 40 },
      ]),
    );
    // flex.ts ignores paddingLeft/paddingTop.
    expect(run(flexOld, { container, kids: [A(), B()] })).toEqual(
      res(true, { w: 130, h: 100 }, [
        { x: 10, y: 0, w: 50, h: 50 },
        { x: 60, y: 0, w: 60, h: 40 },
      ]),
    );
  });

  // BUG: with a symmetric padding, justifyContent center should center the
  // items in the container: (300 - 110) / 2 = 95. Both engines add the padding
  // on top of an already-centered start (flex.ts:282-284,
  // flexLayout.ts:361-363), giving 105.
  it.skip.each(both)(
    'BUG: padding + justifyContent center centers the items (%s)',
    (_label, engine) => {
      const r = run(engine, {
        container: {
          width: 300,
          height: 100,
          padding: 10,
          justifyContent: 'center',
        },
        kids: [A(), B()],
      });
      expect(r.children.map((c) => c.x)).toEqual([95, 145]);
    },
  );

  // BUG: a wrapped row with no height never writes y, so the wrapped item
  // overlaps the first line (doCrossAlign is a no-op when the container cross
  // size is 0: flex.ts:179, flexLayout.ts:258).
  it.skip.each(both)(
    'BUG: flexWrap moves wrapped items to the next line even when the container has no height (%s)',
    (_label, engine) => {
      const r = run(engine, {
        container: { width: 250, gap: 10, flexWrap: 'wrap' },
        kids: [view(100, 50), view(100, 50), view(100, 50)],
      });
      expect(r.children.map((c) => c.y)).toEqual([0, 0, 60]);
    },
  );

  // BUG: wrap-reverse should put the first line at the bottom of the grown
  // container (CSS): lines at y 60 and 0 in a 110-high container, width kept.
  // flex.ts stacks lines upward to y = -60 and shrinks the width to the last
  // line; flexLayout.ts does not wrap at all.
  it.skip.each(both)(
    'BUG: flexWrap wrap-reverse stacks lines from the bottom (%s)',
    (_label, engine) => {
      const r = run(engine, {
        container: {
          width: 250,
          height: 50,
          gap: 10,
          flexWrap: 'wrap-reverse',
        },
        kids: [view(100, 50), view(100, 50), view(100, 50)],
      });
      expect(r).toEqual(
        res(true, { w: 250, h: 110 }, [
          { x: 0, y: 60, w: 100, h: 50 },
          { x: 110, y: 60, w: 100, h: 50 },
          { x: 0, y: 0, w: 100, h: 50 },
        ]),
      );
    },
  );

  // BUG (flexLayout.ts only): cross-axis flexEnd with padding should keep the
  // child inside the padded box: y = 100 - 10 - 50 = 40 for a 50-high child.
  it.skip('BUG: padding + alignItems flexEnd keeps children inside the padding (flexLayout.ts)', () => {
    const r = run(flexNew, {
      container: {
        width: 300,
        height: 100,
        padding: 10,
        flexBoundary: 'fixed',
        alignItems: 'flexEnd',
      },
      kids: [A(), B()],
    });
    expect(r.children.map((c) => c.y)).toEqual([40, 50]);
  });
});

// ---------------------------------------------------------------------------
// Part 2: end to end through JSX and the layout queue (active engine)
// ---------------------------------------------------------------------------

describe(`contract: flex through the renderer (active engine: ${
  NEW_FLEX_ACTIVE ? 'flexLayout.ts' : 'flex.ts'
})`, () => {
  it('engine selection: a truthy VITE_USE_NEW_FLEX string selects flexLayout.ts (margin arrays only work there)', async () => {
    let item!: lng.ElementNode;
    const dispose = renderer.render(() => (
      <view display="flex">
        <view ref={item} width={50} height={50} margin={[0, 0, 0, 10]} />
      </view>
    ));
    await waitForUpdate();
    expect(item.x).toBe(NEW_FLEX_ACTIVE ? 10 : 0);
    dispose();
  });

  it('auto-size: a row with no width/height takes its children width and the tallest child height', async () => {
    let row!: lng.ElementNode;
    const dispose = renderer.render(() => (
      <view ref={row} display="flex" gap={10}>
        <view width={50} height={50} />
        <view width={60} height={40} />
      </view>
    ));
    await waitForUpdate();
    expect(row.width).toBe(120);
    expect(row.height).toBe(50);
    dispose();
  });

  it('auto-size: a column with no size takes the content height and keeps the parent width', async () => {
    let col!: lng.ElementNode;
    const dispose = renderer.render(() => (
      <view width={800} height={600}>
        <view ref={col} display="flex" flexDirection="column" x={100} gap={5}>
          <view width={50} height={50} />
          <view width={60} height={40} />
        </view>
      </view>
    ));
    await waitForUpdate();
    expect(col.height).toBe(95);
    // Width is the parent width less x; a column never fits its width.
    expect(col.width).toBe(700);
    dispose();
  });

  it('auto-size: an explicit height on a row is kept (cross size is only fitted when height was not set)', async () => {
    let row!: lng.ElementNode;
    const dispose = renderer.render(() => (
      <view ref={row} display="flex" height={300}>
        <view width={50} height={50} />
      </view>
    ));
    await waitForUpdate();
    expect(row.height).toBe(300);
    expect(row.width).toBe(50);
    dispose();
  });

  it('flexCrossBoundary "fixed": a row with no height keeps the parent-derived height', async () => {
    let row!: lng.ElementNode;
    const dispose = renderer.render(() => (
      <view width={800} height={600}>
        <view ref={row} display="flex" y={100} flexCrossBoundary="fixed">
          <view width={50} height={50} />
        </view>
      </view>
    ));
    await waitForUpdate();
    expect(row.height).toBe(500);
    expect(row.width).toBe(50);
    dispose();
  });

  it('flexBoundary "fixed": a row with no width fills the parent width', async () => {
    let row!: lng.ElementNode;
    let second!: lng.ElementNode;
    const dispose = renderer.render(() => (
      <view width={800} height={600}>
        <view ref={row} display="flex" x={100} flexBoundary="fixed">
          <view width={50} height={50} />
          <view ref={second} width={50} height={50} />
        </view>
      </view>
    ));
    await waitForUpdate();
    expect(row.width).toBe(700);
    expect(second.x).toBe(50);
    dispose();
  });

  it('nested flex containers: inner rows size first, then the outer row places them; adding a child relays out both', async () => {
    const [extra, setExtra] = s.createSignal(false);
    let outer!: lng.ElementNode;
    let innerA!: lng.ElementNode;
    let innerB!: lng.ElementNode;
    const dispose = renderer.render(() => (
      <view ref={outer} display="flex" gap={10}>
        <view ref={innerA} display="flex">
          <view width={50} height={50} />
          <view width={50} height={50} />
          <s.Show when={extra()}>
            <view width={50} height={80} />
          </s.Show>
        </view>
        <view ref={innerB} display="flex">
          <view width={30} height={30} />
        </view>
      </view>
    ));
    await waitForUpdate();
    expect(innerA.width).toBe(100);
    expect(innerA.height).toBe(50);
    expect(innerB.x).toBe(110);
    expect(outer.width).toBe(140);
    expect(outer.height).toBe(50);

    setExtra(true);
    await waitForUpdate();
    expect(innerA.width).toBe(150);
    expect(innerA.height).toBe(80);
    expect(innerB.x).toBe(160);
    expect(outer.width).toBe(190);
    expect(outer.height).toBe(80);

    setExtra(false);
    await waitForUpdate();
    expect(innerA.width).toBe(100);
    expect(innerB.x).toBe(110);
    expect(outer.width).toBe(140);
    dispose();
  });

  it('flexGrow on a nested flex container: it grows inside its parent, then lays out its own children', async () => {
    let inner!: lng.ElementNode;
    let last!: lng.ElementNode;
    const dispose = renderer.render(() => (
      <view display="flex" width={400} height={100}>
        <view width={100} height={50} />
        <view
          ref={inner}
          display="flex"
          flexGrow={1}
          justifyContent="spaceBetween"
        >
          <view width={20} height={20} />
          <view ref={last} width={20} height={20} />
        </view>
      </view>
    ));
    await waitForUpdate();
    expect(inner.x).toBe(100);
    expect(inner.width).toBe(300);
    expect(last.x).toBe(280);
    dispose();
  });

  it('onLayout: called once after the first flex pass, with this = node and (node) as the only argument, after children are placed', async () => {
    const calls: Array<{ self: unknown; args: unknown[]; secondX: unknown }> =
      [];
    let row!: lng.ElementNode;
    let second!: lng.ElementNode;
    const dispose = renderer.render(() => (
      <view
        ref={row}
        display="flex"
        gap={10}
        onLayout={function (this: lng.ElementNode, ...args: unknown[]) {
          calls.push({ self: this, args, secondX: second.x });
        }}
      >
        <view width={50} height={50} />
        <view ref={second} width={60} height={40} />
      </view>
    ));
    await waitForUpdate();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.self).toBe(row);
    expect(calls[0]!.args).toEqual([row]);
    expect(calls[0]!.secondX).toBe(60);
    dispose();
  });

  it('onLayout: fires again when a child is added or removed, and on updateLayout() (synchronously)', async () => {
    const [show, setShow] = s.createSignal(true);
    let count = 0;
    let row!: lng.ElementNode;
    let last!: lng.ElementNode;
    const dispose = renderer.render(() => (
      <view ref={row} display="flex" onLayout={() => void count++}>
        <s.Show when={show()}>
          <view width={50} height={50} />
        </s.Show>
        <view ref={last} width={60} height={40} />
      </view>
    ));
    await waitForUpdate();
    expect(count).toBe(1);
    expect(last.x).toBe(50);

    setShow(false);
    await waitForUpdate();
    expect(count).toBe(2);
    expect(last.x).toBe(0);
    expect(row.width).toBe(60);

    row.updateLayout();
    expect(count).toBe(3);
    dispose();
  });

  it('onLayout: fires on a non-flex view with children; never on a view without children', async () => {
    let withKids = 0;
    let withoutKids = 0;
    const dispose = renderer.render(() => (
      <view>
        <view onLayout={() => void withKids++}>
          <view width={10} height={10} />
        </view>
        <view onLayout={() => void withoutKids++} />
      </view>
    ));
    await waitForUpdate();
    expect(withKids).toBe(1);
    expect(withoutKids).toBe(0);
    dispose();
  });

  it('onLayout: a truthy return value queues the parent layout; a falsy one does not', async () => {
    let parentCount = 0;
    let returnValue = false;
    let child!: lng.ElementNode;
    const dispose = renderer.render(() => (
      <view display="flex" onLayout={() => void parentCount++}>
        <view ref={child} width={50} height={50} onLayout={() => returnValue}>
          <view width={10} height={10} />
        </view>
      </view>
    ));
    await waitForUpdate();
    const afterRender = parentCount;
    expect(afterRender).toBeGreaterThanOrEqual(1);

    child.updateLayout();
    await waitForUpdate();
    expect(parentCount).toBe(afterRender);

    returnValue = true;
    child.updateLayout();
    await waitForUpdate();
    expect(parentCount).toBe(afterRender + 1);
    dispose();
  });

  it('relayout: a reactive width change on a flex child does NOT reflow the parent; updateLayout() does', async () => {
    const [w, setW] = s.createSignal(50);
    let row!: lng.ElementNode;
    let first!: lng.ElementNode;
    let second!: lng.ElementNode;
    const dispose = renderer.render(() => (
      <view ref={row} display="flex">
        <view ref={first} width={w()} height={50} />
        <view ref={second} width={60} height={50} />
      </view>
    ));
    await waitForUpdate();
    expect(second.x).toBe(50);
    expect(row.width).toBe(110);

    setW(100);
    await waitForUpdate();
    expect(first.width).toBe(100);
    // Today: no automatic relayout on a child size change.
    expect(second.x).toBe(50);
    expect(row.width).toBe(110);

    row.updateLayout();
    expect(second.x).toBe(100);
    expect(row.width).toBe(160);
    dispose();
  });

  it('relayout: updateLayoutOn={signal} relays out when the signal changes', async () => {
    const [w, setW] = s.createSignal(50);
    const [tick, setTick] = s.createSignal(0);
    let row!: lng.ElementNode;
    let second!: lng.ElementNode;
    const dispose = renderer.render(() => (
      <view ref={row} display="flex" updateLayoutOn={tick()}>
        <view width={w()} height={50} />
        <view ref={second} width={60} height={50} />
      </view>
    ));
    await waitForUpdate();
    expect(second.x).toBe(50);

    setW(100);
    setTick(1);
    expect(second.x).toBe(100);
    expect(row.width).toBe(160);
    dispose();
  });

  it('$focus: a focus-state width change on a flex child does NOT reflow its flex parent', async () => {
    let row!: lng.ElementNode;
    let first!: lng.ElementNode;
    let second!: lng.ElementNode;
    const dispose = renderer.render(() => (
      <view ref={row} display="flex">
        <view
          ref={first}
          style={{ width: 50, height: 50, $focus: { width: 100, height: 70 } }}
        />
        <view ref={second} style={{ width: 60, height: 50 }} />
      </view>
    ));
    await waitForUpdate();
    expect(second.x).toBe(50);
    expect(row.width).toBe(110);
    expect(row.height).toBe(50);

    first.setFocus();
    await waitForUpdate();
    expect(first.states.has('$focus')).toBe(true);
    expect(first.width).toBe(100);
    expect(first.height).toBe(70);
    // Today: siblings and the parent keep the pre-focus layout.
    expect(second.x).toBe(50);
    expect(row.width).toBe(110);
    expect(row.height).toBe(50);

    second.setFocus();
    await waitForUpdate();
    expect(first.states.has('$focus')).toBe(false);
    expect(first.width).toBe(50);
    expect(second.x).toBe(50);
    expect(row.width).toBe(110);
    dispose();
  });
});
