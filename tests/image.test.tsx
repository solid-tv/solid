import * as v from 'vitest';
import * as s from 'solid-js';
import { NULL } from '@solidtv/renderer';
import * as lng from '@solidtv/solid';
import { Image } from '../src/primitives/Image.jsx';
import { core, renderer, tick } from './setup.js';

// <Image> on the headless core: the texture it creates (spied on, the
// real one comes back), and what is written to its view's node afterwards.
// @solidtv/renderer 2.0 applies src after texture, so with a placeholder
// the texture must come after the node shows the placeholder.
v.describe('Image on the WebGL renderer', () => {
  v.afterEach(() => {
    v.vi.restoreAllMocks();
  });

  const setup = () => {
    const textures: lng.ImageTexture[] = [];
    const createTexture = lng.renderer.createTexture.bind(lng.renderer);
    v.vi
      .spyOn(lng.renderer, 'createTexture')
      .mockImplementation((type, props) => {
        const texture = createTexture(type, props);
        textures.push(texture as unknown as lng.ImageTexture);
        return texture;
      });
    return { textures };
  };

  /** Every value written to `target[key]` from now on. */
  const recordWrites = (
    target: lng.ElementNode,
    key: 'src' | 'texture',
  ): unknown[] => {
    const writes: unknown[] = [];
    const own = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(target),
      key,
    )!;
    Object.defineProperty(target, key, {
      configurable: true,
      get: () => own.get!.call(target),
      set: (value: unknown) => {
        writes.push(value);
        own.set!.call(target, value);
      },
    });
    return writes;
  };

  /** Mount an Image and hand back its view's node. */
  const mount = (props: Partial<lng.NodeProps> & Record<string, unknown>) => {
    let el!: lng.ElementNode;
    const dispose = renderer.render(() => (
      <Image
        ref={(node: lng.ElementNode) => (el = node)}
        src="img.png"
        {...props}
      />
    ));
    s.flush();
    return { el, dispose };
  };

  v.test('sets the texture at once without a placeholder', () => {
    const { textures } = setup();
    const { el, dispose } = mount({});

    v.expect(textures.length).toBe(1);
    v.expect(el.texture).toBe(textures[0]);
    // Nothing to wait for: the view listens for neither event.
    v.expect(el.hasListener('loaded')).toBe(false);
    v.expect(el.hasListener('failed')).toBe(false);
    dispose();
  });

  v.test(
    'with a placeholder, shows it first and sets the texture at its first loaded',
    () => {
      const { textures } = setup();
      const { el, dispose } = mount({ placeholder: 'ph.png' });
      const writes = recordWrites(el, 'texture');

      v.expect(textures.length).toBe(1);
      v.expect(el.src).toBe('ph.png');
      v.expect(el.texture == null).toBe(true);
      el.emit('loaded', {
        type: 'texture',
        dimensions: { width: 1, height: 1 },
      });
      s.flush();
      v.expect(writes.length).toBe(1);
      v.expect(writes[0]).toBe(textures[0]);
      v.expect(el.texture).toBe(textures[0]);
      dispose();
    },
  );

  v.test(
    'with a placeholder that fails, sets the texture at its failed',
    () => {
      const { textures } = setup();
      const { el, dispose } = mount({ placeholder: 'ph.png' });
      const writes = recordWrites(el, 'texture');

      el.emit('failed', { type: 'texture', error: new Error('404') });
      s.flush();
      v.expect(writes.length).toBe(1);
      v.expect(writes[0]).toBe(textures[0]);
      dispose();
    },
  );

  v.test(
    'with a placeholder, hands loaded and failed on to the onEvent handlers, as Solid calls them',
    () => {
      setup();
      const calls: unknown[][] = [];
      const loaded = function (this: unknown, ...args: unknown[]) {
        calls.push(['loaded', this, ...args]);
      };
      const failed = function (this: unknown, ...args: unknown[]) {
        calls.push(['failed', this, ...args]);
      };
      const { el, dispose } = mount({
        placeholder: 'ph.png',
        onEvent: { loaded, failed },
      });
      const loadedEvent = {
        type: 'texture',
        dimensions: { width: 1, height: 1 },
      };
      const failedEvent = { type: 'texture', error: new Error('404') };

      el.emit('loaded', loadedEvent);
      el.emit('failed', failedEvent);
      v.expect(calls.length).toBe(2);
      // The view's element, as `this` and as the first argument.
      v.expect(calls[0]).toEqual(['loaded', el, el, loadedEvent]);
      v.expect(calls[1]).toEqual(['failed', el, el, failedEvent]);
      dispose();
    },
  );

  v.test(
    'with a placeholder, the app handler hears loaded after the texture is shown',
    () => {
      const { textures } = setup();
      let shown: unknown = 'not called';
      let held: lng.ElementNode | undefined;
      const { el, dispose } = mount({
        placeholder: 'ph.png',
        onEvent: {
          loaded: (node: lng.ElementNode) => {
            held = node;
            // show() ran before this handler: its write lands on a flush.
            s.flush();
            shown = el.texture;
          },
        },
      });
      el.emit('loaded', {
        type: 'texture',
        dimensions: { width: 1, height: 1 },
      });
      v.expect(held).toBe(el);
      v.expect(shown).toBe(textures[0]);
      dispose();
    },
  );

  v.test(
    'with a placeholder, the core delivers its loaded and the image replaces it',
    () => {
      const { textures } = setup();
      const loaded = v.vi.fn();
      const { el, dispose } = mount({
        width: 10,
        height: 10,
        src: 'core-img.png',
        placeholder: 'core-ph.png',
        onEvent: { loaded },
      });
      v.expect(el.texture == null).toBe(true);

      // The headless core's loader and uploader are the test: the
      // placeholder loads and uploads, and the view hears `loaded`.
      tick();
      const records = core.textures;
      for (let r = records.nextQueued(); r !== NULL; r = records.nextQueued()) {
        records.decoded(r, {}, 10, 10, false);
        records.nextDecoded();
        records.uploaded(r, 400);
      }
      core.events.flush();
      core.events.flush();
      s.flush();
      tick();

      v.expect(loaded).toHaveBeenCalledTimes(1);
      v.expect(loaded.mock.calls[0]![0]).toBe(el);
      v.expect(loaded.mock.calls[0]![1]).toMatchObject({ type: 'texture' });
      v.expect(el.texture).toBe(textures[0]);
      dispose();
    },
  );

  v.test(
    'with a fallback, sets the texture at once and writes the fallback src after it once the image fails',
    () => {
      const { textures } = setup();
      const { el, dispose } = mount({ fallback: 'fb.png' });
      const srcWrites = recordWrites(el, 'src');
      const textureWrites = recordWrites(el, 'texture');

      v.expect(el.texture).toBe(textures[0]);
      v.expect(el.src == null).toBe(true);
      (
        textures[0] as unknown as { emit: (e: string, d: unknown) => void }
      ).emit('failed', new Error('404'));
      s.flush();
      // The renderer shows what was written last: the fallback's src, over
      // the failed texture, which stays assigned.
      v.expect(srcWrites).toEqual(['fb.png']);
      v.expect(textureWrites.length).toBe(0);
      dispose();
    },
  );
});
