/**
 * Texts that wait for their font (Solid's text measurement, stream T): many
 * texts in two families render before either font loads; one family loads
 * while the other is still missing, so the texts of the missing one wait
 * again while the waiting list is being measured (T1 review 2, Important 1:
 * the list used to be swept under that loop once it reached its sweep
 * length, losing waiting texts or throwing).
 *
 * The waiting list and its sweep length are module state, and this suite
 * runs with `isolate: false`: each case imports a fresh @solidtv/solid
 * (vi.resetModules) with its own renderer, so no earlier test has grown the
 * sweep length or left a DOM-renderer re-measure pending. No JSX: the JSX
 * runtime is the shared instance, so the trees are built with the fresh
 * instance's ElementNode.
 *
 * DOM renderer (jsdom). `document.fonts.check` answers per family; the DOM
 * renderer's own re-measure is held (fonts loading, `ready` pending), so only
 * Solid's font-loaded pass (fontLoaded(), as loadFonts() calls it) measures.
 */
import { describe, it, expect, vi } from 'vitest';
import './setup.js';

type Solid = typeof import('@solidtv/solid');
type ElementNode = InstanceType<Solid['ElementNode']>;

const settle = () => new Promise<void>((r) => setTimeout(r, 0));

/** A fresh @solidtv/solid and its fontLoaded(), with a DOM renderer of its own. */
async function freshSolid() {
  vi.resetModules();
  const solid = await import('@solidtv/solid');
  // The instance @solidtv/solid's elementNode registered with.
  const { fontLoaded } = await import('../src/core/fontLoaded.js');
  solid.Config.rendererOptions = {};
  solid.Config.domRendererEnabled = true;
  const root = document.createElement('div');
  document.body.appendChild(root);
  const app = solid.createRenderer(undefined, root);
  return {
    solid,
    fontLoaded,
    render: app.render,
    remove() {
      root.remove();
    },
  };
}

/** `document.fonts.check` per family, with the DOM renderer's re-measure held. */
function fontsByFamily() {
  const loaded = new Set<string>();
  const fonts = document.fonts as unknown as {
    check: (font: string) => boolean;
    status: string;
    ready: Promise<unknown>;
  };
  const saved = fonts.check;
  const savedReady = fonts.ready;
  fonts.check = (font: string) => {
    const m = /"([^"]+)"$/.exec(font);
    return m !== null && loaded.has(m[1]!);
  };
  let ready!: () => void;
  fonts.ready = new Promise<void>((r) => (ready = r));
  fonts.status = 'loading';
  return {
    loaded,
    restore() {
      fonts.check = saved;
      fonts.status = 'loaded';
      ready();
      fonts.ready = savedReady;
    },
  };
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
  texts.map(
    (t) =>
      (t as unknown as { _text?: { waiting: boolean } })._text?.waiting ===
      true,
  );

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
      const fonts = fontsByFamily();
      const caught = catchMicrotaskErrors();
      const app = await freshSolid();
      try {
        const { ElementNode } = app.solid;
        // Each text in a flex row of its own, so Solid measures it.
        const container = new ElementNode('view');
        const texts: ElementNode[] = [];
        for (let i = 0; i < families.length; i++) {
          const row = new ElementNode('view');
          row.display = 'flex';
          row.y = i * 30;
          const t = new ElementNode('text');
          t.fontFamily = families[i];
          t.text = 'Hello';
          row.insertChild(t);
          container.insertChild(row);
          texts.push(t);
        }
        const dispose = app.render(() => container as never);
        let heard = 0;
        for (const t of texts) {
          (t.lng as unknown as { on(e: string, f: () => void): void }).on(
            'loaded',
            () => void heard++,
          );
        }
        await settle();
        expect(waiting(texts).every((w) => w)).toBe(true);

        // Precondition: only Solid's font-loaded pass measures them (no
        // `loaded` has woken the waiting list).
        expect(heard).toBe(0);

        fonts.loaded.add('FA');
        app.fontLoaded();
        await settle();
        expect(caught.errors).toEqual([]);
        expect(waiting(texts)).toEqual(families.map((f) => f === 'FB'));

        fonts.loaded.add('FB');
        app.fontLoaded();
        await settle();
        expect(caught.errors).toEqual([]);
        expect(waiting(texts).some((w) => w)).toBe(false);
        dispose();
        await settle();
      } finally {
        caught.restore();
        fonts.restore();
        app.remove();
        vi.resetModules();
      }
    });
  }
});
