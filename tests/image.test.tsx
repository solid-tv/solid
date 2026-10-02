import * as v from 'vitest';
import * as lng from '@solidtv/solid';
import { EventEmitter } from '@solidtv/renderer/utils';
import { Image } from '../src/primitives/Image.jsx';
import { renderer } from './setup.js';

// <Image> on the WebGL renderer (these tests run the DOM renderer, so the
// test switches the flag Image reads): the props bag the view's renderer
// node is created with, and what is written to that node afterwards.
// @solidtv/renderer 2.0 applies src after texture, so with a placeholder
// the texture must come after the node shows the placeholder.
v.describe('Image on the WebGL renderer', () => {
  v.afterEach(() => {
    lng.Config.domRendererEnabled = true;
    v.vi.restoreAllMocks();
  });

  const setup = () => {
    lng.Config.domRendererEnabled = false;
    const textures: EventEmitter[] = [];
    const createTexture = lng.renderer.createTexture.bind(lng.renderer);
    v.vi
      .spyOn(lng.renderer, 'createTexture')
      .mockImplementation((type, props) => {
        // An event emitter, as a @solidtv/renderer texture is: Image
        // listens for `failed` on it to switch to the fallback.
        const texture = Object.assign(
          new EventEmitter(),
          createTexture(type, props),
        );
        textures.push(texture);
        return texture as unknown as ReturnType<typeof createTexture>;
      });
    const bags: Record<string, unknown>[] = [];
    const created: Record<string, unknown>[] = [];
    const createNode = lng.renderer.createNode.bind(lng.renderer);
    v.vi.spyOn(lng.renderer, 'createNode').mockImplementation((props) => {
      bags.push({ ...(props as Record<string, unknown>) });
      const node = createNode(props);
      created.push(node as unknown as Record<string, unknown>);
      return node;
    });
    return { textures, bags, created };
  };

  /** Every value written to `target[key]` from now on. */
  const recordWrites = (
    target: Record<string, unknown>,
    key: string,
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

  v.test('sets the texture at once without a placeholder', () => {
    const { textures, bags, created } = setup();
    const dispose = renderer.render(() => <Image src="img.png" />);

    v.expect(textures.length).toBe(1);
    v.expect(bags.length).toBe(1);
    v.expect(bags[0]!.texture).toBe(textures[0]);
    // Nothing to wait for: the view listens for neither event.
    const node = created[0] as unknown as EventEmitter;
    v.expect(node.hasListener('loaded')).toBe(false);
    v.expect(node.hasListener('failed')).toBe(false);
    dispose();
  });

  v.test(
    'with a placeholder, shows it first and sets the texture at its first loaded',
    () => {
      const { textures, bags, created } = setup();
      const dispose = renderer.render(() => (
        <Image src="img.png" placeholder="ph.png" />
      ));
      const writes = recordWrites(created[0]!, 'texture');

      v.expect(bags.length).toBe(1);
      v.expect(bags[0]!.src).toBe('ph.png');
      v.expect(bags[0]!.texture == null).toBe(true);
      (created[0] as unknown as lng.IEventEmitter).emit('loaded', {
        type: 'texture',
        dimensions: { w: 1, h: 1 },
      });
      v.expect(writes.length).toBe(1);
      v.expect(writes[0]).toBe(textures[0]);
      dispose();
    },
  );

  v.test(
    'with a placeholder that fails, sets the texture at its failed',
    () => {
      const { textures, created } = setup();
      const dispose = renderer.render(() => (
        <Image src="img.png" placeholder="ph.png" />
      ));
      const writes = recordWrites(created[0]!, 'texture');

      (created[0] as unknown as lng.IEventEmitter).emit('failed', {
        type: 'texture',
        error: new Error('404'),
      });
      v.expect(writes.length).toBe(1);
      v.expect(writes[0]).toBe(textures[0]);
      dispose();
    },
  );

  v.test(
    'with a placeholder, hands loaded and failed on to the onEvent handlers, as Solid calls them',
    () => {
      const { created } = setup();
      const calls: unknown[][] = [];
      const loaded = function (this: unknown, ...args: unknown[]) {
        calls.push(['loaded', this, ...args]);
      };
      const failed = function (this: unknown, ...args: unknown[]) {
        calls.push(['failed', this, ...args]);
      };
      const dispose = renderer.render(() => (
        <Image
          src="img.png"
          placeholder="ph.png"
          onEvent={{ loaded, failed }}
        />
      ));
      const node = created[0] as unknown as lng.IEventEmitter;
      const loadedEvent = { type: 'texture', dimensions: { w: 1, h: 1 } };
      const failedEvent = { type: 'texture', error: new Error('404') };

      node.emit('loaded', loadedEvent);
      node.emit('failed', failedEvent);
      v.expect(calls.length).toBe(2);
      const element = calls[0]![1] as lng.ElementNode;
      // The view's element, as `this` and as the first argument.
      v.expect(element.lng === created[0]).toBe(true);
      v.expect(calls[0]).toEqual(['loaded', element, element, loadedEvent]);
      v.expect(calls[1]).toEqual(['failed', element, element, failedEvent]);
      dispose();
    },
  );

  v.test(
    'with a fallback, sets the texture at once and writes the fallback src after it once the image fails',
    () => {
      const { textures, bags, created } = setup();
      const dispose = renderer.render(() => (
        <Image src="img.png" fallback="fb.png" />
      ));
      const srcWrites = recordWrites(created[0]!, 'src');
      const textureWrites = recordWrites(created[0]!, 'texture');

      v.expect(bags.length).toBe(1);
      v.expect(bags[0]!.texture).toBe(textures[0]);
      v.expect(bags[0]!.src == null).toBe(true);
      textures[0]!.emit('failed', new Error('404'));
      // The renderer shows what was written last: the fallback's src, over
      // the failed texture, which stays assigned.
      v.expect(srcWrites).toEqual(['fb.png']);
      v.expect(textureWrites.length).toBe(0);
      dispose();
    },
  );
});
