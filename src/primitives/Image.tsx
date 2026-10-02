import { type Component, createRenderEffect, createSignal } from 'solid-js';
import {
  ImageTexture,
  renderer,
  type ElementNode,
  type NodeProps,
} from '@solidtv/solid';
import { Config } from '../core/config.js';

export interface ImageProps extends NodeProps {
  src: string;
  /* image to load while src is being loaded */
  placeholder?: string;
  fallback?: string;
}

export const Image: Component<ImageProps> = (props) => {
  const [texture, setTexture] = createSignal<ImageTexture | null>(null);
  const [src, setSrc] = createSignal<string | null>(props.placeholder || null);
  // @solidtv/renderer 2.0 applies src after texture, so a texture in the
  // view's first props bag would stay unseen behind the placeholder: with a
  // placeholder, the texture is set once the view shows it (its first
  // `loaded`, or `failed`, which only an Image with a placeholder listens
  // for), and the renderer keeps the placeholder until the image is
  // uploaded (a texture swap keeps the old image). The image's download
  // starts then too, as 2.0 loads a texture once a node wants it (1.6.4
  // started both downloads at once).
  let shown = !props.placeholder;
  let pending: ImageTexture | null = null;
  const show = () => {
    shown = true;
    if (pending !== null) {
      setTexture(pending);
      pending = null;
    }
  };
  const userEvents = props.onEvent;
  const onEvent = {
    ...userEvents,
    // The app's own handlers, called as Solid calls them.
    loaded: (target: ElementNode, event?: unknown) => {
      show();
      userEvents?.loaded?.call(target, target, event as never);
    },
    failed: (target: ElementNode, event?: unknown) => {
      show();
      userEvents?.failed?.call(target, target, event as never);
    },
  };

  createRenderEffect(() => {
    if (Config.domRendererEnabled) {
      const img = new window.Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        setSrc(props.src);
      };
      if (props.fallback) {
        img.onerror = () => {
          if (props.fallback === props.placeholder) {
            return;
          }
          setSrc(props.fallback!);
        };
      }
      img.src = props.src;
      return;
    }

    const srcTexture = renderer.createTexture('ImageTexture', props);

    if (props.fallback) {
      srcTexture.once('failed', () => {
        if (props.fallback === props.placeholder) {
          return;
        }
        setSrc(props.fallback!);
      });
    }

    // No getTextureData() in @solidtv/renderer 2.0: the node keeps what it
    // shows until this texture is uploaded.
    if (shown) {
      setTexture(srcTexture);
    } else {
      pending = srcTexture;
    }
  });

  return (
    <view
      {...props}
      src={src()}
      color={props.color || 0xffffffff}
      texture={texture()}
      onEvent={props.placeholder ? onEvent : props.onEvent}
    />
  );
};
