import { type Component, createTrackedEffect, createSignal } from 'solid-js';
import {
  ImageTexture,
  renderer,
  type ElementNode,
  type NodeProps,
} from '@solidtv/solid';

export interface ImageProps extends NodeProps {
  src: string;
  /* image to load while src is being loaded */
  placeholder?: string;
  fallback?: string;
}

type OnEvent = NonNullable<ImageProps['onEvent']>;

export const Image: Component<ImageProps> = (props) => {
  const [texture, setTexture] = createSignal<ImageTexture | null>(null);
  const [src, setSrc] = createSignal<string | null>(props.placeholder || null);
  // A texture written with the placeholder would replace it at once (the
  // store shows the last of src and texture written): with a placeholder,
  // the texture is set once the view shows it (its first `loaded`, or
  // `failed`, which only an Image with a placeholder listens for), and the
  // renderer keeps the placeholder until the image is uploaded (a texture
  // swap keeps the old image). The image's download starts then too, as 2.0
  // loads a texture once a node wants it (1.6.4 started both downloads at
  // once).
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
  // Written out, not spread: the app's handlers first, then the two that
  // show the texture and call the app's own, as Solid calls them.
  const onEvent: OnEvent = {};
  if (userEvents !== undefined) {
    Object.assign(onEvent, userEvents);
  }
  onEvent.loaded = (target, event) => {
    show();
    userEvents?.loaded?.call(target, target, event);
  };
  onEvent.failed = (target, event) => {
    show();
    userEvents?.failed?.call(target, target, event);
  };

  createTrackedEffect(() => {
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

  // texture before src: each prop is written to the store as it is applied,
  // and a texture write (even null) drops the node's src, so written after
  // it the placeholder would never show. color last: a null src writes it
  // transparent.
  return (
    <view
      {...props}
      texture={texture()}
      src={src()}
      color={props.color || 0xffffffff}
      onEvent={props.placeholder ? onEvent : props.onEvent}
    />
  );
};
