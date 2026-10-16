import { type Component, createRenderEffect, createSignal } from 'solid-js';
import { ImageTexture, renderer, type NodeProps } from '@solidtv/solid';
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

    // Renderer 2.x loads a texture only once a node shows it
    setTexture(srcTexture);
  });

  return (
    <view
      {...props}
      src={src()}
      color={props.color || 0xffffffff}
      texture={texture()}
    />
  );
};
