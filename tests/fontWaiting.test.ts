/**
 * Texts that wait for their font (Solid's text measurement, spec 5.7 items 2
 * and 6): many texts in two families render before either font loads; one
 * family loads while the other is still missing, so the texts of the missing
 * one wait again while the waiting list is being measured (1.8, T1 review 2,
 * Important 1: the list used to be swept under that loop once it reached its
 * sweep length, losing waiting texts or throwing).
 *
 * The waiting list and its sweep length are module state, and this suite
 * runs with `isolate: false`: each case imports a fresh @solidtv/solid
 * (vi.resetModules) with a headless core of its own, so no earlier test has
 * grown the sweep length. No JSX: the JSX runtime is the shared instance, so
 * the trees are built with the fresh instance's ElementNode.
 *
 * No frame runs (no `tick`), so no walk lays a text out and no `loaded`
 * wakes the waiting list: only Solid's font-loaded pass (`fontLoaded()`, as
 * loadFonts() calls it) measures. The fonts are the Box fixture
 * (tests/fonts.ts) under the families FA and FB.
 */
import { describe, it, expect, vi } from 'vitest';
import { boxFont, loadBoxFont } from './fonts.js';

type Solid = typeof import('@solidtv/solid');
type ElementNode = InstanceType<Solid['ElementNode']>;

const settle = () => new Promise<void>((r) => setTimeout(r, 0));

/** A fresh @solidtv/solid and its fontLoaded(), on a headless core of its own. */
async function freshSolid() {
  vi.resetModules();
  const { RendererCore } = await import('@solidtv/renderer');
  const solid = await import('@solidtv/solid');
  // The instance @solidtv/solid's post-mutation pass registered with.
  const { fontLoaded } = await import('../src/core/fontLoaded.js');
  const core = new RendererCore({ appWidth: 1920, appHeight: 1080 });
  solid.registerDefaultShaders(core);
  const app = solid.createRenderer({ core });
  return { solid, core, fontLoaded, render: app.render };
}

/** Errors thrown by post-mutation runs (microtasks) meanwhile. */
function catchMicrotaskErrors() {
  const errors: unknown[] = [];
  const saved = globalThis.queueMicrotask;
  globalThis.queueMicrotask = (fn: () => void) =>
    saved(() => {
      try {
        fn();
      } catch (e) {
        errors.push(e);
      }
    });
  return {
    errors,
    restore() {
      globalThis.queueMicrotask = saved;
    },
  };
}

/** Whether Solid still waits for the font of each text. */
const waiting = (texts: ElementNode[]) =>
  texts.map((t) => t._text?.waiting === true);

const cases: Array<[string, string[]]> = [
  [
    '120 texts, two families alternating',
    [...Array(120)].map((_, i) => (i % 2 === 0 ? 'FA' : 'FB')),
  ],
  [
    '100 texts, two families alternating',
    [...Array(100)].map((_, i) => (i % 2 === 0 ? 'FA' : 'FB')),
  ],
  [
    '100 texts of one family, then 20 of another',
    [...Array(120)].map((_, i) => (i < 100 ? 'FA' : 'FB')),
  ],
];

describe('texts that wait for their font', () => {
  for (const [name, families] of cases) {
    it(`${name}: each is measured when its font loads, and none is lost`, async () => {
      const caught = catchMicrotaskErrors();
      const app = await freshSolid();
      try {
        const { ElementNode, NodeType } = app.solid;
        const core = app.core;
        // Each text in a flex row of its own, so Solid measures it.
        const container = new ElementNode(core, NodeType.Element);
        const texts: ElementNode[] = [];
        for (let i = 0; i < families.length; i++) {
          const row = new ElementNode(core, NodeType.Element);
          row.display = 'flex';
          row.y = i * 30;
          const t = new ElementNode(core, NodeType.TextNode);
          t.fontFamily = families[i];
          t.text = 'Hello';
          row.insertChild(t);
          container.insertChild(row);
          texts.push(t);
        }
        const dispose = app.render(() => container as never);
        let heard = 0;
        for (const t of texts) {
          t.on('loaded', () => void heard++);
        }
        await settle();
        expect(waiting(texts).every((w) => w)).toBe(true);
        expect(texts[0]!.width).toBe(0);

        // FA arrives (its atlas too); FB is still missing.
        await loadBoxFont(core, 'FA');
        // Precondition: only Solid's font-loaded pass measures them (no
        // `loaded` has woken the waiting list).
        expect(heard).toBe(0);
        expect(waiting(texts).every((w) => w)).toBe(true);

        app.fontLoaded();
        await settle();
        expect(caught.errors).toEqual([]);
        expect(waiting(texts)).toEqual(families.map((f) => f === 'FB'));
        // Box at the default size: 5 glyphs.
        const measured = texts[families.indexOf('FA')]!;
        expect(measured.width).toBeGreaterThan(0);

        // FB arrives through loadFonts() (the atlas is FA's, already up),
        // which calls fontLoaded() once the font has loaded.
        core.fonts.fetch = () => Promise.resolve(boxFont());
        await app.solid.loadFonts([
          { fontFamily: 'FB', atlasUrl: 'box.png', atlasDataUrl: 'fb.json' },
        ]);
        await settle();
        expect(caught.errors).toEqual([]);
        expect(waiting(texts).some((w) => w)).toBe(false);
        expect(texts[families.indexOf('FB')]!.width).toBe(measured.width);
        dispose();
        await settle();
      } finally {
        caught.restore();
        vi.resetModules();
      }
    });
  }

  it('a text whose font never loads is dropped from the waiting list once destroyed', async () => {
    const app = await freshSolid();
    try {
      const { ElementNode, NodeType } = app.solid;
      const core = app.core;
      const row = new ElementNode(core, NodeType.Element);
      row.display = 'flex';
      const t = new ElementNode(core, NodeType.TextNode);
      t.fontFamily = 'Never';
      t.text = 'Hello';
      row.insertChild(t);
      const dispose = app.render(() => row as never);
      await settle();
      expect(t._text?.waiting).toBe(true);
      expect(t.hasListener('loaded')).toBe(true);

      // Removed: the delete flush destroys the row and its text.
      row.parent!.removeChild(row);
      await settle();
      expect(t.destroyed).toBe(true);
      // A font loaded: the pass measures the waiting list, and the
      // destroyed text leaves it, listening no more.
      app.fontLoaded();
      await settle();
      expect(t._text?.waiting).toBe(false);
      expect(t.hasListener('loaded')).toBe(false);
      dispose();
    } finally {
      vi.resetModules();
    }
  });
});
