/*

Experimental DOM renderer

*/

import * as lng from '@solidtv/renderer';

import { EventEmitter } from '@solidtv/renderer/utils';
import { Config } from '../config.js';
import { FontLoadOptions } from '../intrinsicTypes.js';
import type {
  DomRendererMainSettings,
  ExtractProps,
  IRendererMain,
  IRendererNode,
  IRendererNodeProps,
  IRendererShader,
  IRendererStage,
  IRendererTextNode,
  IRendererTextNodeProps,
} from './domRendererTypes.js';
import {
  applyEasing,
  applySubTextureScaling,
  buildGradientStops,
  colorToRgba,
  compactString,
  computeLegacyObjectFit,
  computeRenderStateForNode,
  getNodeLineHeight,
  interpolateProp,
  isRenderStateInBounds,
  nodeHasTextureSource,
} from './domRendererUtils.js';

// Feature detection for legacy brousers
const _styleRef: any =
  typeof document !== 'undefined' ? document.documentElement?.style || {} : {};

const supportsObjectFit: boolean = 'objectFit' in _styleRef;
const supportsObjectPosition: boolean = 'objectPosition' in _styleRef;
const supportsMixBlendMode: boolean = 'mixBlendMode' in _styleRef;
const supportsStandardMask: boolean = 'maskImage' in _styleRef;
const supportsWebkitMask: boolean = 'webkitMaskImage' in _styleRef;
const supportsCssMask: boolean = supportsStandardMask || supportsWebkitMask;

/*
 Animations
*/

const animationTasks: AnimationController[] = [];
let animationFrameRequested = false;

function requestAnimationUpdate() {
  if (!animationFrameRequested && animationTasks.length > 0) {
    animationFrameRequested = true;
    requestAnimationFrame(updateAnimations);
  }
}

function updateAnimations(time: number) {
  animationFrameRequested = false;

  /*
   tasks are iterated in insertion order
   so that the later task will override the earlier ones
  */
  for (let i = 0; i < animationTasks.length; i++) {
    const task = animationTasks[i]!;
    if (task.pausedTime != null) continue;

    const elapsed = time - task.timeStart;

    // Still in delay period
    if (elapsed < task.settings.delay) {
      requestAnimationUpdate();
      continue;
    }

    const activeTime = elapsed - task.settings.delay;

    if (activeTime >= task.settings.duration) {
      // Start next iteration
      if (task.settings.loop || task.iteration < task.settings.repeat - 1) {
        task.iteration++;
        task.timeStart = time - task.settings.delay;
        requestAnimationUpdate();
      }
      // Animation complete
      else {
        Object.assign(task.node.props, task.propsEnd);
        task.node.boundsDirty = true;
        task.node.markChildrenBoundsDirty();
        updateNodeStyles(task.node);

        task.stop();
        i--;
      }
      continue;
    }

    /*
     Update props and styles
    */
    let t = activeTime / task.settings.duration;
    t = applyEasing(task.settings.easing, t);

    for (const prop in task.propsEnd) {
      const start = task.propsStart[prop]!;
      const end = task.propsEnd[prop]!;
      (task.node.props as any)[prop] = interpolateProp(prop, start, end, t);
    }

    updateNodeStyles(task.node);
  }

  requestAnimationUpdate();
}

class AnimationController implements lng.IAnimationController {
  state: lng.AnimationControllerState = 'paused';

  stopPromise: Promise<void> | null = null;
  stopResolve: (() => void) | null = null;

  propsStart: Record<string, number> = {};
  propsEnd: Record<string, number> = {};
  timeStart: number = performance.now();
  timeEnd: number;
  settings: Required<lng.AnimationSettings>;
  iteration: number = 0;
  pausedTime: number | null = null;

  constructor(
    public node: DOMNode,
    props: Partial<lng.INodeAnimateProps<any>>,
    rawSettings: Partial<lng.AnimationSettings>,
  ) {
    this.settings = {
      duration: rawSettings.duration ?? 300,
      delay: rawSettings.delay ?? 0,
      easing: rawSettings.easing ?? 'linear',
      loop: rawSettings.loop ?? false,
      repeat: rawSettings.repeat ?? 1,
      stopMethod: false,
      adaptiveDuration: rawSettings.adaptiveDuration ?? false,
    };

    this.timeEnd =
      this.timeStart + this.settings.delay + this.settings.duration;

    for (const [prop, value] of Object.entries(props)) {
      if (value != null && typeof value === 'number') {
        this.propsStart[prop] = (node.props as any)[prop];
        this.propsEnd[prop] = value;
      }
    }

    animationTasks.push(this);
  }

  start() {
    if (this.pausedTime != null) {
      this.timeStart += performance.now() - this.pausedTime;
      this.pausedTime = null;
    } else {
      this.timeStart = performance.now();
    }
    this.state = 'running';
    requestAnimationUpdate();
    return this;
  }
  pause() {
    this.pausedTime = performance.now();
    this.state = 'paused';
    return this;
  }
  stop() {
    const index = animationTasks.indexOf(this);
    if (index !== -1) {
      animationTasks.splice(index, 1);
    }
    this.state = 'stopped';
    if (this.stopResolve) {
      this.stopResolve();
      this.stopResolve = null;
      this.stopPromise = null;
    }
    return this;
  }
  restore() {
    return this;
  }
  waitUntilStopped() {
    this.stopPromise ??= new Promise((resolve) => {
      this.stopResolve = resolve;
    });
    return this.stopPromise;
  }
  on() {
    return this;
  }
  once() {
    return this;
  }
  off() {
    return this;
  }
  emit() {
    return this;
  }
}

function animate(
  this: DOMNode,
  props: Partial<lng.INodeAnimateProps<any>>,
  settings: Partial<lng.AnimationSettings>,
): lng.IAnimationController {
  return new AnimationController(this, props, settings);
}

/*
  Node Properties
*/

const elMap = new WeakMap<DOMNode, HTMLElement>();

function updateNodeParent(node: DOMNode | DOMText) {
  const parent = node.props.parent;
  if (parent instanceof DOMNode) {
    elMap.get(parent)!.appendChild(node.div);
  } else {
    node.div.parentNode?.removeChild(node.div);
  }
}

/**
 * Builds the CSS transform string from node props (x, y, rotation, scale, mount).
 * Returns an empty string if no transform is needed.
 */
function buildTransformCSS(props: IRendererNodeProps): string {
  const transforms: string[] = [];

  const { x, y } = props;
  const hasMountX = props.mountX != null && props.mountX !== 0;
  const hasMountY = props.mountY != null && props.mountY !== 0;

  if (x !== 0) transforms.push(`translateX(${x}px)`);
  if (hasMountX) transforms.push(`translateX(${-props.mountX * 100}%)`);

  if (y !== 0) transforms.push(`translateY(${y}px)`);
  if (hasMountY) transforms.push(`translateY(${-props.mountY * 100}%)`);

  if (props.rotation !== 0) transforms.push(`rotate(${props.rotation}rad)`);

  if (props.scale !== 1 && props.scale != null) {
    transforms.push(`scale(${props.scale})`);
  } else {
    if (props.scaleX !== 1) transforms.push(`scaleX(${props.scaleX})`);
    if (props.scaleY !== 1) transforms.push(`scaleY(${props.scaleY})`);
  }

  return transforms.join(' ');
}

/**
 * Fast path for transform-only updates (x, y, rotation, scale, mount).
 * Skips full style rebuild but still re-evaluates viewport bounds for nodes
 * with a texture source to drive lazy image load/unload during scroll.
 */
function updateTransformOnly(node: DOMNode | DOMText): void {
  const transform = buildTransformCSS(node.props);
  const s = node.div.style;

  if (transform.length > 0) {
    s.transform = `${transform}`;
  } else {
    s.transform = '';
  }

  updateRenderStateIfNeeded(node);
}

/**
 * Recomputes the viewport bounds state for a node with a texture source and,
 * if changed, triggers lazy image load or unload via updateRenderState.
 */
function updateRenderStateIfNeeded(node: DOMNode | DOMText): void {
  if (!(node instanceof DOMNode) || node === node.stage.root) return;
  const hasTextureSrc = nodeHasTextureSource(node);
  if (hasTextureSrc && node.boundsDirty) {
    const next = computeRenderStateForNode(node);
    if (next != null) {
      node.updateRenderState(next);
    }
    node.boundsDirty = false;
  } else if (!hasTextureSrc) {
    node.boundsDirty = false;
  }
}

function applyLegacyObjectFit(
  node: DOMNode,
  img: HTMLImageElement,
  srcPos: InstanceType<lng.TextureMap['SubTexture']>['props'] | null,
): void {
  const resizeMode = node.props.textureOptions?.resizeMode;
  const clipX =
    resizeMode?.type !== 'contain' && resizeMode?.clipX
      ? resizeMode?.clipX
      : 0.5;
  const clipY =
    resizeMode?.type !== 'contain' && resizeMode?.clipY
      ? resizeMode?.clipY
      : 0.5;
  computeLegacyObjectFit(
    node,
    img,
    resizeMode,
    clipX,
    clipY,
    srcPos,
    supportsObjectFit,
    supportsObjectPosition,
  );
}

function updateNodeStyles(node: DOMNode | DOMText) {
  const { props } = node;

  let style = `position: absolute; z-index: ${props.zIndex};`;

  if (props.alpha !== 1) style += `opacity: ${props.alpha};`;

  if (props.clipping) {
    style += `overflow: hidden;`;
  }

  // Transform
  {
    const transform = buildTransformCSS(props);
    if (transform.length > 0) {
      style += `transform: ${transform};`;
    }
  }

  // <Text>
  if (node instanceof DOMText) {
    const textProps = node.props;

    if (textProps.color != null && textProps.color !== 0) {
      style += `color: ${colorToRgba(textProps.color)};`;
    }
    if (textProps.fontFamily) {
      style += `font-family: ${textProps.fontFamily};`;
    }
    if (textProps.fontSize) {
      style += `font-size: ${textProps.fontSize}px;`;
    }
    if (textProps.fontStyle !== 'normal') {
      style += `font-style: ${textProps.fontStyle};`;
    }
    if (textProps.fontWeight !== 'normal') {
      style += `font-weight: ${textProps.fontWeight};`;
    }
    if (textProps.fontStretch && textProps.fontStretch !== 'normal') {
      style += `font-stretch: ${textProps.fontStretch};`;
    }
    if (textProps.lineHeight) {
      style += `line-height: ${textProps.lineHeight}px;`;
    }
    if (textProps.letterSpacing) {
      style += `letter-spacing: ${textProps.letterSpacing}px;`;
    }
    if (textProps.textAlign !== 'left') {
      style += `text-align: ${textProps.textAlign};`;
    }

    let maxLines = textProps.maxLines || Infinity;
    switch (textProps.contain) {
      case 'width':
        if (textProps.maxWidth && textProps.maxWidth > 0) {
          if (node.textAlign === 'center') {
            style += `width: ${textProps.maxWidth}px;`;
          } else {
            style += `max-width: ${textProps.maxWidth}px;`;
          }
          style += `overflow: hidden;`;
        } else {
          style += `width: 100%;`;
        }
        break;
      case 'both': {
        const lineHeight = getNodeLineHeight(textProps);
        const widthConstraint =
          textProps.maxWidth && textProps.maxWidth > 0
            ? `${textProps.maxWidth}px`
            : `100%`;
        const heightConstraint =
          textProps.maxHeight && textProps.maxHeight > 0
            ? textProps.maxHeight
            : props.h;

        let height = heightConstraint || 0;
        if (height > 0) {
          const maxLinesByHeight = Math.max(1, Math.floor(height / lineHeight));
          maxLines = Math.min(maxLines, maxLinesByHeight);
          height = Math.max(lineHeight, maxLines * lineHeight);
        } else {
          maxLines = Number.isFinite(maxLines) ? Math.max(1, maxLines) : 1;
          height = maxLines * lineHeight;
        }

        style += `width: ${widthConstraint}; height: ${height}px; overflow: hidden;`;
        break;
      }
      case 'none':
        style += `width: -webkit-max-content;`;
        style += `width: max-content;`;
        break;
    }

    style += `white-space: pre-wrap;`;

    if (maxLines !== Infinity) {
      // https://stackoverflow.com/a/13924997
      style += `display: -webkit-box;
        overflow: hidden;
        -webkit-line-clamp: ${maxLines};
        line-clamp: ${maxLines};
        -webkit-box-orient: vertical;`;
    }

    if (textProps.offsetY != null && textProps.offsetY !== 0) {
      style += `margin-top: ${textProps.offsetY}px;`;
    }

    if (textProps.wordBreak) {
      const wb = textProps.wordBreak as string;
      if (wb !== 'normal') {
        if (wb === 'break-all') {
          style += `word-break: break-all;`;
        } else if (wb === 'keep-all') {
          style += `word-break: keep-all;`;
        } else if (wb === 'break-word') {
          style += `word-wrap: break-word; overflow-wrap: break-word;`;
        } else {
          style += `overflow-wrap: break-word;`;
        }
      }
    }

    // if (node.overflowSuffix) style += `overflow-suffix: ${node.overflowSuffix};`
    // if (node.verticalAlign) style += `vertical-align: ${node.verticalAlign};`
  }
  // <Node>
  else {
    if (props.w !== 0) style += `width: ${props.w < 0 ? 0 : props.w}px;`;
    if (props.h !== 0) style += `height: ${props.h}px;`;

    const vGradient =
      props.colorBottom !== props.colorTop
        ? `linear-gradient(to bottom, ${colorToRgba(props.colorTop)}, ${colorToRgba(props.colorBottom)})`
        : null;

    const hGradient =
      props.colorLeft !== props.colorRight
        ? `linear-gradient(to right, ${colorToRgba(props.colorLeft)}, ${colorToRgba(props.colorRight)})`
        : null;

    const gradient =
      vGradient && hGradient
        ? `${vGradient}, ${hGradient}`
        : vGradient || hGradient;

    let srcImg: string | null = null;
    let srcPos: null | InstanceType<lng.TextureMap['SubTexture']>['props'] =
      null;
    let rawImgSrc: string | null = null;

    if (
      props.texture != null &&
      props.texture.type === lng.TextureType.subTexture
    ) {
      const texture = props.texture as InstanceType<
        lng.TextureMap['SubTexture']
      >;
      srcPos = texture.props;
      rawImgSrc = (texture.props.texture as any).props.src;
    } else if (props.src) {
      rawImgSrc = props.src;
    }

    if (rawImgSrc) {
      srcImg = `url(${rawImgSrc})`;
    }

    let bgStyle = '';
    let borderStyle = '';
    let radiusStyle = '';
    let maskStyle = '';
    let needsBackgroundLayer = false;
    let imgStyle = '';
    let hasDivBgTint = false;

    let hasTint = false;
    if (rawImgSrc) {
      hasTint = props.color !== 0xffffffff && props.color !== 0x00000000;

      if (hasTint) {
        bgStyle += `background-color: ${colorToRgba(props.color)};`;
        if (srcImg) {
          maskStyle += `mask-image: ${srcImg};`;
          if (srcPos !== null) {
            maskStyle += `mask-position: -${srcPos.x}px -${srcPos.y}px;`;
          } else {
            maskStyle += `mask-size: 100% 100%;`;
          }
          hasDivBgTint = true;
        }
      } else {
        if (gradient) {
          // use gradient as a mask when no tint is applied
          maskStyle += `mask-image: ${gradient};`;
        }
        if (props.placeholderColor !== 0) {
          bgStyle += `background-color: ${colorToRgba(props.placeholderColor)};`;
        }
      }

      const imgStyleParts = [
        'position: absolute',
        'top: 0',
        'left: 0',
        'right: 0',
        'bottom: 0',
        'display: block',
        'pointer-events: none',
        `opacity: ${node.imageLoading ? 0 : 1}`,
        'transition: opacity 100ms linear',
      ];

      if (props.textureOptions.resizeMode?.type) {
        const resizeMode = props.textureOptions.resizeMode;
        imgStyleParts.push('width: 100%');
        imgStyleParts.push('height: 100%');
        imgStyleParts.push(`object-fit: ${resizeMode.type}`);

        // Handle clipX and clipY for object-position
        const clipX = (resizeMode as any).clipX ?? 0.5;
        const clipY = (resizeMode as any).clipY ?? 0.5;
        imgStyleParts.push(`object-position: ${clipX * 100}% ${clipY * 100}%`);
      } else if (srcPos !== null) {
        imgStyleParts.push('width: auto');
        imgStyleParts.push('height: auto');
        imgStyleParts.push('object-fit: none');
        imgStyleParts.push(`object-position: -${srcPos.x}px -${srcPos.y}px`);
      } else if (props.w && !props.h) {
        imgStyleParts.push('width: 100%');
        imgStyleParts.push('height: auto');
      } else if (props.h && !props.w) {
        imgStyleParts.push('width: auto');
        imgStyleParts.push('height: 100%');
      } else {
        imgStyleParts.push('width: 100%');
        imgStyleParts.push('height: 100%');
        imgStyleParts.push('object-fit: fill');
      }
      if (hasTint) {
        if (supportsMixBlendMode) {
          imgStyleParts.push('mix-blend-mode: multiply');
        } else {
          imgStyleParts.push('opacity: 1');
        }
      }

      imgStyle = imgStyleParts.join('; ') + ';';
    } else if (gradient) {
      bgStyle += `background-image: ${gradient};`;
      bgStyle += `background-repeat: no-repeat;`;
      bgStyle += `background-size: 100% 100%;`;
    } else if (props.color !== 0) {
      bgStyle += `background-color: ${colorToRgba(props.color)};`;
    }

    if (props.shader?.props != null) {
      const shaderProps = props.shader.props;

      const borderWidth = shaderProps['border-w'];
      const borderColor = shaderProps['border-color'];
      const borderGap = shaderProps['border-gap'] ?? 0;
      const borderAlign = shaderProps['border-align'] ?? 'inside';
      const radius = shaderProps['radius'];

      // Border
      const borderWidthIsNumber = typeof borderWidth === 'number';
      const borderWidthIsArray = Array.isArray(borderWidth);
      const borderWidthHasValue =
        (borderWidthIsNumber && borderWidth !== 0) ||
        (borderWidthIsArray &&
          (borderWidth as number[]).some(
            (w) => typeof w === 'number' && w !== 0,
          ));

      if (
        borderWidthHasValue &&
        typeof borderColor === 'number' &&
        borderColor !== 0
      ) {
        const rgbaColor = colorToRgba(borderColor);

        if (borderWidthIsNumber) {
          let insideWidth = 0;
          let outsideWidth = 0;

          if (borderAlign === 'inside') {
            insideWidth = borderWidth;
          } else if (borderAlign === 'center') {
            insideWidth = borderWidth / 2;
            outsideWidth = borderWidth / 2;
          } else {
            outsideWidth = borderWidth;
          }

          outsideWidth += borderGap;
          insideWidth -= borderGap;

          if (insideWidth < 0) {
            outsideWidth += insideWidth;
            insideWidth = 0;
          }
          if (outsideWidth < 0) {
            insideWidth += outsideWidth;
            outsideWidth = 0;
          }

          const shadows: string[] = [];
          if (outsideWidth > 0) {
            shadows.push(`0 0 0 ${outsideWidth}px ${rgbaColor}`);
          }
          if (insideWidth > 0) {
            shadows.push(`inset 0 0 0 ${insideWidth}px ${rgbaColor}`);
          }

          if (shadows.length > 0) {
            borderStyle += `box-shadow: ${shadows.join(', ')};`;
          }
        } else if (borderWidthIsArray) {
          // Individual borders per side [top, right, bottom, left]
          // Allow individual properties to override array values
          const topWidth =
            shaderProps['border-top'] ?? (borderWidth as number[])[0];
          const rightWidth =
            shaderProps['border-right'] ?? (borderWidth as number[])[1];
          const bottomWidth =
            shaderProps['border-bottom'] ?? (borderWidth as number[])[2];
          const leftWidth =
            shaderProps['border-left'] ?? (borderWidth as number[])[3];

          const widths = [topWidth, rightWidth, bottomWidth, leftWidth];
          const sides = ['top', 'right', 'bottom', 'left'] as const;

          for (let i = 0; i < sides.length; i++) {
            const width = widths[i];
            if (typeof width === 'number' && width !== 0) {
              borderStyle += `border-${sides[i]}: ${width}px solid ${rgbaColor};`;
            }
          }
        }
      }
      // Rounded
      if (typeof radius === 'number' && radius > 0) {
        radiusStyle += `border-radius: ${radius}px;`;
      } else if (Array.isArray(radius) && radius.length === 4) {
        radiusStyle += `border-radius: ${radius[0]}px ${radius[1]}px ${radius[2]}px ${radius[3]}px;`;
      }

      if ('radial' in shaderProps) {
        const rg = shaderProps.radial as
          | Partial<lng.RadialGradientProps>
          | undefined;
        const colors = Array.isArray(rg?.colors) ? rg.colors : [];
        const stops = Array.isArray(rg?.stops) ? rg.stops : undefined;
        const pivot = Array.isArray(rg?.pivot) ? rg.pivot : [0.5, 0.5];
        const width = typeof rg?.w === 'number' ? rg.w : props.w || 0;
        const height = typeof rg?.h === 'number' ? rg.h : width;

        if (colors.length > 0) {
          const gradientStops = buildGradientStops(colors, stops);
          if (gradientStops) {
            if (colors.length === 1) {
              // Single color -> solid fill
              if (srcImg || gradient) {
                maskStyle += `mask-image: linear-gradient(${gradientStops});`;
              } else {
                bgStyle += `background-color: ${colorToRgba(colors[0]!)};`;
              }
            } else {
              const isEllipse = width > 0 && height > 0 && width !== height;
              const pivotX = (pivot[0] ?? 0.5) * 100;
              const pivotY = (pivot[1] ?? 0.5) * 100;
              let sizePart = '';
              if (width > 0 && height > 0) {
                if (!isEllipse && width === height) {
                  sizePart = `${Math.round(width)}px`;
                } else {
                  sizePart = `${Math.round(width)}px ${Math.round(height)}px`;
                }
              } else {
                sizePart = 'closest-side';
              }
              const radialGradient = `radial-gradient(${isEllipse ? 'ellipse' : 'circle'} ${sizePart} at ${pivotX.toFixed(2)}% ${pivotY.toFixed(2)}%, ${gradientStops})`;
              if (srcImg || gradient) {
                maskStyle += `mask-image: ${radialGradient};`;
              } else {
                bgStyle += `background-image: ${radialGradient};`;
                bgStyle += `background-repeat: no-repeat;`;
                bgStyle += `background-size: 100% 100%;`;
              }
            }
          }
        }
      }

      if ('linear' in shaderProps) {
        const lg = shaderProps.linear as
          | Partial<lng.LinearGradientProps>
          | undefined;
        const colors = Array.isArray(lg?.colors) ? lg.colors : [];
        const stops = Array.isArray(lg?.stops) ? lg.stops : undefined;
        const angleRad = typeof lg?.angle === 'number' ? lg.angle : 0; // radians

        if (colors.length > 0) {
          const gradientStops = buildGradientStops(colors, stops);
          if (gradientStops) {
            if (colors.length === 1) {
              if (srcImg || gradient) {
                maskStyle += `mask-image: linear-gradient(${gradientStops});`;
              } else {
                bgStyle += `background-color: ${colorToRgba(colors[0]!)};`;
              }
            } else {
              const angleDeg = 180 * (angleRad / Math.PI - 1);
              const linearGradient = `linear-gradient(${angleDeg.toFixed(2)}deg, ${gradientStops})`;
              if (srcImg || gradient) {
                maskStyle += `mask-image: ${linearGradient};`;
              } else {
                bgStyle += `background-image: ${linearGradient};`;
                bgStyle += `background-repeat: no-repeat;`;
                bgStyle += `background-size: 100% 100%;`;
              }
            }
          }
        }
      }
    }

    if (maskStyle !== '') {
      if (!supportsStandardMask && supportsWebkitMask) {
        maskStyle = maskStyle.replace(/mask-/g, '-webkit-mask-');
      } else if (!supportsCssMask) {
        maskStyle = '';
      }
      if (maskStyle !== '') {
        needsBackgroundLayer = true;
      }
    }

    // If there's still no reason to use divBg, check out tint/gradient/subtexture/radius/bgStyle
    if (!needsBackgroundLayer && rawImgSrc) {
      needsBackgroundLayer =
        hasTint ||
        !!gradient ||
        srcPos !== null ||
        radiusStyle !== '' ||
        bgStyle !== '';
    }

    style += radiusStyle;

    if (needsBackgroundLayer) {
      if (node.divBg == null) {
        node.divBg = document.createElement('div');
        node.div.insertBefore(node.divBg, node.div.firstChild);
      } else if (node.divBg.parentElement !== node.div) {
        node.div.insertBefore(node.divBg, node.div.firstChild);
      }

      const isSyncSubtextureUpdate =
        rawImgSrc != null &&
        srcPos != null &&
        !!node.imgEl &&
        node.imgEl.complete &&
        node.imgEl.dataset.rawSrc === rawImgSrc;
      if (isSyncSubtextureUpdate) {
        node.imageLoading = true;
      }

      let bgLayerStyle =
        'position: absolute; top:0; left:0; right:0; bottom:0; z-index: -1; pointer-events: none;';
      // overflow:hidden clips the transformed imgEl to prevent sprite bleed-through
      // for non-tinted subtextures. NOT applied when hasDivBgTint because
      // overflow:hidden + CSS mask-image causes a 1px white border artifact on WebKit.
      // Tinted nodes use mask-image for visual clipping, so overflow:hidden is unnecessary.
      if (srcPos !== null && !hasDivBgTint) {
        bgLayerStyle += 'overflow: hidden;';
      }
      if (bgStyle) {
        bgLayerStyle += bgStyle;
      }
      if (maskStyle) {
        bgLayerStyle += maskStyle;
      }
      if (hasDivBgTint && srcPos != null && node.imageLoading) {
        bgLayerStyle += 'opacity: 0;';
      }

      node.divBg.setAttribute('style', bgLayerStyle + radiusStyle);

      if (rawImgSrc) {
        if (!node.imgEl) {
          node.imgEl = document.createElement('img');
          node.imgEl.alt = '';
          node.imgEl.crossOrigin = 'anonymous';
          node.imgEl.setAttribute('aria-hidden', 'true');
          node.imgEl.setAttribute('loading', 'lazy');
          node.imgEl.removeAttribute('src');

          node.imgEl.addEventListener('load', () => {
            const payload: lng.NodeTextureLoadedPayload = {
              type: 'texture',
              dimensions: {
                w: node.imgEl!.naturalWidth,
                h: node.imgEl!.naturalHeight,
              },
            };
            node.imgEl!.style.display = '';
            applySubTextureScaling(
              node,
              node.imgEl!,
              node.lazyImageSubTextureProps,
            );

            if (!node.lazyImageSubTextureProps) {
              applyLegacyObjectFit(node, node.imgEl!, null);
            }

            // Reveal only after final fit/positioning is applied
            if (node.imgEl) {
              node.imageLoading = false;
              node.imgEl.style.opacity = '1';
            }
            node.showBackgroundLayer();
            node.emit('loaded', payload);
          });

          node.imgEl.addEventListener('error', () => {
            node.imageLoading = false;

            const failedSrc =
              node.imgEl?.dataset.pendingSrc || node.lazyImagePendingSrc || '';

            const fallback = node.props.fallbackImage;
            if (
              fallback &&
              node.imgEl &&
              node.imgEl.dataset.rawSrc !== fallback
            ) {
              node.imgEl.dataset.pendingSrc = fallback;
              node.imgEl.dataset.rawSrc = fallback;
              node.imgEl.src = fallback;
              return;
            }

            node.showBackgroundLayer();
            if (node.imgEl) {
              node.imgEl.removeAttribute('src');
              node.imgEl.style.display = 'none';
              node.imgEl.removeAttribute('data-rawSrc');
            }

            const payload: lng.NodeTextureFailedPayload = {
              type: 'texture',
              error: new Error(`Failed to load image: ${failedSrc}`),
            };
            node.emit('failed', payload);
          });
        }

        node.lazyImagePendingSrc = rawImgSrc;
        node.lazyImageSubTextureProps = srcPos;
        node.imgEl.dataset.pendingSrc = rawImgSrc;

        if (node.imgEl.parentElement !== node.divBg) {
          node.divBg.appendChild(node.imgEl);
        }

        node.imgEl.setAttribute('style', imgStyle + radiusStyle);

        if (hasDivBgTint) {
          node.imgEl.style.visibility = 'hidden';
        }

        if (isRenderStateInBounds(node.renderState)) {
          node.applyPendingImageSrc();
        } else if (!node.imgEl.dataset.rawSrc) {
          node.imgEl.removeAttribute('src');
        }

        if (
          srcPos &&
          node.imgEl.complete &&
          node.imgEl.dataset.rawSrc === rawImgSrc
        ) {
          applySubTextureScaling(node, node.imgEl, srcPos);
          if (node.imageLoading) {
            node.imageLoading = false;
            node.imgEl.style.opacity = '1';
            node.showBackgroundLayer();
          }
        }
        if (
          !srcPos &&
          node.imgEl.complete &&
          (!supportsObjectFit || !supportsObjectPosition) &&
          node.imgEl.dataset.rawSrc === rawImgSrc
        ) {
          applyLegacyObjectFit(node, node.imgEl, srcPos);
        }
      } else {
        node.lazyImagePendingSrc = null;
        node.lazyImageSubTextureProps = null;
        if (node.imgEl) {
          node.imgEl.remove();
          node.imgEl = undefined;
        }
      }
    } else if (rawImgSrc) {
      // Image directly in node.div (without divBg) when there is no tint/gradient

      // Cleanup divBg
      if (node.divBg) {
        node.divBg.remove();
        node.divBg = undefined;
      }

      const isSyncSubtextureUpdate =
        srcPos != null &&
        !!node.imgEl &&
        node.imgEl.complete &&
        node.imgEl.dataset.rawSrc === rawImgSrc;
      if (isSyncSubtextureUpdate) {
        node.imageLoading = true;
      }

      if (!node.imgEl) {
        node.imgEl = document.createElement('img');
        node.imgEl.alt = '';
        node.imgEl.crossOrigin = 'anonymous';
        node.imgEl.setAttribute('aria-hidden', 'true');
        node.imgEl.setAttribute('loading', 'lazy');
        node.imgEl.removeAttribute('src');

        node.imgEl.addEventListener('load', () => {
          const payload: lng.NodeTextureLoadedPayload = {
            type: 'texture',
            dimensions: {
              w: node.imgEl!.naturalWidth,
              h: node.imgEl!.naturalHeight,
            },
          };
          node.imgEl!.style.display = '';
          applySubTextureScaling(
            node,
            node.imgEl!,
            node.lazyImageSubTextureProps,
          );

          if (!node.lazyImageSubTextureProps) {
            applyLegacyObjectFit(node, node.imgEl!, null);
          }

          if (node.imgEl) {
            node.imageLoading = false;
            node.imgEl.style.opacity = '1';
          }
          node.emit('loaded', payload);
        });

        node.imgEl.addEventListener('error', () => {
          node.imageLoading = false;

          const failedSrc =
            node.imgEl?.dataset.pendingSrc || node.lazyImagePendingSrc || '';

          const fallback = node.props.fallbackImage;
          if (
            fallback &&
            node.imgEl &&
            node.imgEl.dataset.rawSrc !== fallback
          ) {
            node.imgEl.dataset.pendingSrc = fallback;
            node.imgEl.dataset.rawSrc = fallback;
            node.imgEl.src = fallback;
            return;
          }

          if (node.imgEl) {
            node.imgEl.removeAttribute('src');
            node.imgEl.style.display = 'none';
            node.imgEl.removeAttribute('data-rawSrc');
          }

          const payload: lng.NodeTextureFailedPayload = {
            type: 'texture',
            error: new Error(`Failed to load image: ${failedSrc}`),
          };
          node.emit('failed', payload);
        });
      }

      node.lazyImagePendingSrc = rawImgSrc;
      node.lazyImageSubTextureProps = srcPos;
      node.imgEl.dataset.pendingSrc = rawImgSrc;

      if (node.imgEl.parentElement !== node.div) {
        node.div.appendChild(node.imgEl);
      }

      node.imgEl.setAttribute('style', imgStyle + radiusStyle);

      if (isRenderStateInBounds(node.renderState)) {
        node.applyPendingImageSrc();
      } else if (!node.imgEl.dataset.rawSrc) {
        node.imgEl.removeAttribute('src');
      }

      if (
        srcPos &&
        node.imgEl.complete &&
        node.imgEl.dataset.rawSrc === rawImgSrc
      ) {
        applySubTextureScaling(node, node.imgEl, srcPos);
        if (node.imageLoading) {
          node.imageLoading = false;
          node.imgEl.style.opacity = '1';
        }
      }
      if (
        !srcPos &&
        node.imgEl.complete &&
        (!supportsObjectFit || !supportsObjectPosition) &&
        node.imgEl.dataset.rawSrc === rawImgSrc
      ) {
        applyLegacyObjectFit(node, node.imgEl, srcPos);
      }
    } else {
      node.lazyImagePendingSrc = null;
      node.lazyImageSubTextureProps = null;
      if (node.imgEl) {
        node.imgEl.remove();
        node.imgEl = undefined;
      }
      if (node.divBg) {
        node.divBg.remove();
        node.divBg = undefined;
      }
      style += bgStyle;
    }

    const needsSeparateBorderLayer = needsBackgroundLayer && maskStyle !== '';

    if (needsSeparateBorderLayer) {
      if (node.divBorder == null) {
        node.divBorder = document.createElement('div');
        node.div.appendChild(node.divBorder);
      }
    } else if (node.divBorder) {
      node.divBorder.remove();
      node.divBorder = undefined;
    }

    if (node.divBorder == null) {
      style += borderStyle;
    } else {
      let borderLayerStyle =
        'position: absolute; top:0; left:0; right:0; bottom:0; z-index: -1; pointer-events: none;';
      borderLayerStyle += borderStyle;
      node.divBorder.setAttribute('style', borderLayerStyle + radiusStyle);
    }
  }

  const newStyle = compactString(style);
  if (node._lastStyleStr !== newStyle) {
    node._lastStyleStr = newStyle;
    node.div.setAttribute('style', newStyle);
  }

  updateRenderStateIfNeeded(node);
}

const textNodesToMeasure = new Set<DOMText>();
const containTextNodes = new Set<DOMText>();
let fontLoadingListenerSetup = false;

type Size = { width: number; height: number };

function getElSize(node: DOMNode): Size {
  const rawRect = node.div.getBoundingClientRect();
  const dpr = Config.rendererOptions?.deviceLogicalPixelRatio ?? 1;
  let width = rawRect.width / dpr;
  let height = rawRect.height / dpr;

  for (;;) {
    if (node.props.scale != null && node.props.scale !== 1) {
      width /= node.props.scale;
      height /= node.props.scale;
    } else {
      width /= node.props.scaleX;
      height /= node.props.scaleY;
    }

    if (node.parent instanceof DOMNode) {
      node = node.parent;
    } else {
      break;
    }
  }

  return { width, height };
}

/*
  Text nodes with contain 'width' or 'none'
  need to have their height or width calculated.
  And then cause the flex layout to be recalculated.
*/
function updateDOMTextSize(node: DOMText, emitLoaded = true): void {
  let size: Size;
  let dimensionsChanged = false;
  switch (node.contain) {
    case 'width':
      size = getElSize(node);
      if (node.props.w !== size.width) {
        node.w = size.width;
        dimensionsChanged = true;
      }
      if (node.props.h !== size.height) {
        node.h = size.height;
        dimensionsChanged = true;
      }
      break;
    case 'none':
      size = getElSize(node);
      if (node.props.h !== size.height || node.props.w !== size.width) {
        node.w = size.width;
        node.h = size.height;
        dimensionsChanged = true;
      }
      break;
  }

  if (emitLoaded && (!node.loaded || dimensionsChanged)) {
    const payload: lng.NodeTextLoadedPayload = {
      type: 'text',
      dimensions: {
        w: node.w,
        h: node.h,
      },
    };
    node.emit('loaded', payload);
    node.loaded = true;
  }
}

function updateDOMTextMeasurements() {
  textNodesToMeasure.forEach((node) => updateDOMTextSize(node));
  textNodesToMeasure.clear();
}

function shouldTrackContainTextNode(node: DOMText): boolean {
  return node.contain === 'width' || node.contain === 'none';
}

function syncContainTextNodeTracking(node: DOMText): void {
  if (shouldTrackContainTextNode(node)) {
    containTextNodes.add(node);
  } else {
    containTextNodes.delete(node);
  }
}

function scheduleContainTextNodesMeasurement(): void {
  if (containTextNodes.size === 0) return;

  containTextNodes.forEach((node) => {
    if (node.div.isConnected) {
      textNodesToMeasure.add(node);
    }
  });

  if (textNodesToMeasure.size > 0) {
    setTimeout(updateDOMTextMeasurements);
  }
}

function setupFontLoadingListeners(): void {
  if (fontLoadingListenerSetup) return;
  if (
    typeof document === 'undefined' ||
    !(document.fonts as FontFaceSet | undefined)
  ) {
    return;
  }

  const fonts = document.fonts;
  if (typeof fonts.addEventListener === 'function') {
    fonts.addEventListener('loadingdone', scheduleContainTextNodesMeasurement);
  }

  fontLoadingListenerSetup = true;
}

function scheduleUpdateDOMTextMeasurement(node: DOMText) {
  /*
    Make sure the font is loaded before measuring
  */

  setupFontLoadingListeners();

  if (textNodesToMeasure.size === 0) {
    if (typeof document !== 'undefined' && 'fonts' in document) {
      const fonts = document.fonts;
      if (fonts.status === 'loaded') {
        setTimeout(updateDOMTextMeasurements);
      } else if (
        fonts.ready != null &&
        typeof fonts.ready.then === 'function'
      ) {
        void fonts.ready.then(updateDOMTextMeasurements);
      } else {
        setTimeout(updateDOMTextMeasurements, 500);
      }
    } else {
      // Fallback for devices without FontFaceSet.ready()
      setTimeout(updateDOMTextMeasurements, 500);
    }
  }

  textNodesToMeasure.add(node);
}

function updateNodeData(node: DOMNode | DOMText) {
  const data = node.data;
  for (const key in data) {
    const keyValue: unknown = data[key];
    if (keyValue === undefined) {
      node.div.removeAttribute('data-' + key);
    } else {
      node.div.dataset[key] = String(keyValue);
    }
  }
}

function resolveNodeDefaults(
  props: Partial<IRendererNodeProps>,
): IRendererNodeProps {
  const color = props.color ?? 0x00000000;

  return {
    x: props.x ?? 0,
    y: props.y ?? 0,
    w: props.w ?? 0,
    h: props.h ?? 0,
    alpha: props.alpha ?? 1,
    ignoreParentAlpha: props.ignoreParentAlpha ?? false,
    autosize: props.autosize ?? false,
    boundsMargin: props.boundsMargin ?? null,
    clipping: props.clipping ?? false,
    color,
    colorTop: props.colorTop ?? color,
    colorBottom: props.colorBottom ?? color,
    colorLeft: props.colorLeft ?? color,
    colorRight: props.colorRight ?? color,
    colorBl: props.colorBl ?? props.colorBottom ?? props.colorLeft ?? color,
    colorBr: props.colorBr ?? props.colorBottom ?? props.colorRight ?? color,
    colorTl: props.colorTl ?? props.colorTop ?? props.colorLeft ?? color,
    colorTr: props.colorTr ?? props.colorTop ?? props.colorRight ?? color,
    zIndex: props.zIndex ?? 0,
    parent: props.parent ?? null,
    texture: props.texture ?? null,
    textureOptions: props.textureOptions ?? {},
    shader: props.shader ?? defaultShader,
    // Since setting the `src` will trigger a texture load, we need to set it after
    // we set the texture. Otherwise, problems happen.
    src: props.src ?? null,
    srcHeight: props.srcHeight,
    srcWidth: props.srcWidth,
    srcX: props.srcX,
    srcY: props.srcY,
    scale: props.scale ?? null,
    scaleX: props.scaleX ?? props.scale ?? 1,
    scaleY: props.scaleY ?? props.scale ?? 1,
    mount: props.mount ?? 0,
    mountX: props.mountX ?? props.mount ?? 0,
    mountY: props.mountY ?? props.mount ?? 0,
    pivot: props.pivot ?? 0.5,
    pivotX: props.pivotX ?? props.pivot ?? 0.5,
    pivotY: props.pivotY ?? props.pivot ?? 0.5,
    rotation: props.rotation ?? 0,
    rtt: props.rtt ?? false,
    placeholderColor: props.placeholderColor ?? 0,
    fallbackImage: props.fallbackImage ?? null,
    data: {},
    imageType: props.imageType,
  };
}

function resolveTextNodeDefaults(
  props: Partial<IRendererTextNodeProps>,
): IRendererTextNodeProps {
  return {
    ...resolveNodeDefaults(props),
    text: props.text ?? '',
    textRendererOverride: props.textRendererOverride ?? null,
    fontSize: props.fontSize ?? 16,
    fontFamily: props.fontFamily ?? 'sans-serif',
    fontStyle: props.fontStyle ?? 'normal',
    fontWeight: props.fontWeight ?? 'normal',
    forceLoad: props.forceLoad ?? false,
    textAlign: props.textAlign ?? 'left',
    contain: props.contain ?? 'none',
    offsetY: props.offsetY ?? 0,
    letterSpacing: props.letterSpacing ?? 0,
    lineHeight: props.lineHeight ?? 0,
    maxLines: props.maxLines ?? 0,
    maxWidth: props.maxWidth ?? 0,
    maxHeight: props.maxHeight ?? 0,
    verticalAlign: props.verticalAlign ?? 'middle',
    overflowSuffix: props.overflowSuffix ?? '...',
    wordBreak: props.wordBreak ?? 'overflow',
  };
}

const defaultShader: IRendererShader = {
  shaderType: '',
  props: undefined,
};

let lastNodeId = 0;

const CoreNodeRenderStateMap = new Map<number, string>([
  [0, 'init'],
  [2, 'outOfBounds'],
  [4, 'inBounds'],
  [8, 'inViewport'],
]);

export class DOMNode extends EventEmitter implements IRendererNode {
  div = document.createElement('div');
  divBg: HTMLElement | undefined;
  divBorder: HTMLElement | undefined;
  imgEl: HTMLImageElement | undefined;
  imageLoading = false;
  lazyImagePendingSrc: string | null = null;
  lazyImageSubTextureProps:
    | InstanceType<lng.TextureMap['SubTexture']>['props']
    | null = null;
  boundsDirty = true;
  children = new Set<DOMNode>();
  /** Cached result of the last updateNodeStyles call — avoids redundant setAttribute writes. */
  _lastStyleStr: string = '';

  id = ++lastNodeId;

  renderState: lng.CoreNodeRenderState = 0 /* Init */;

  preventCleanup = true;

  constructor(
    public stage: IRendererStage,
    public props: IRendererNodeProps,
  ) {
    super();

    // @ts-ignore
    this.div._node = this;
    this.div.setAttribute('data-id', String(this.id));
    elMap.set(this, this.div);

    const parent = this.props.parent;
    if (parent instanceof DOMNode) {
      parent.children.add(this);
    }

    updateNodeParent(this);
    updateNodeStyles(this);
    updateNodeData(this);
  }

  destroy(): void {
    elMap.delete(this);
    const parent = this.props.parent;
    if (parent instanceof DOMNode) {
      parent.children.delete(this);
    }
    this.div.parentNode?.removeChild(this.div);
  }

  get parent() {
    return this.props.parent;
  }
  set parent(value: IRendererNode | null) {
    if (this.props.parent === value) return;

    const prevParent = this.props.parent;
    if (prevParent instanceof DOMNode) {
      prevParent.children.delete(this);
      prevParent.markChildrenBoundsDirty();
    }

    this.props.parent = value;

    if (value instanceof DOMNode) {
      value.children.add(this);
      value.markChildrenBoundsDirty();
    }

    this.boundsDirty = true;
    this.markChildrenBoundsDirty();
    updateNodeParent(this);
  }

  public markChildrenBoundsDirty() {
    for (const child of this.children) {
      child.boundsDirty = true;

      if (child !== child.stage.root) {
        if (nodeHasTextureSource(child)) {
          const nextState = computeRenderStateForNode(child);

          if (nextState != null) {
            child.updateRenderState(nextState);
          }
        }
        child.boundsDirty = false;
      }

      child.markChildrenBoundsDirty();
    }
  }

  animate = animate;

  updateRenderState(renderState: lng.CoreNodeRenderState) {
    if (renderState === this.renderState) return;
    const previous = this.renderState;
    this.renderState = renderState;
    const event = CoreNodeRenderStateMap.get(renderState);
    if (isRenderStateInBounds(renderState)) {
      this.applyPendingImageSrc();
    }
    if (event && event !== 'init') {
      this.emit(event, { previous, current: renderState });
    }
    if (this.imgEl) {
      this.imgEl.dataset.state = event;
    }
  }

  showBackgroundLayer() {
    if (this.divBg) {
      this.divBg.style.opacity = '1';
    }
  }

  hideMaskedBackgroundLayer() {
    if (
      this.divBg &&
      (this.divBg.style.maskImage || this.divBg.style.webkitMaskImage)
    ) {
      this.divBg.style.opacity = '0';
    }
  }

  applyPendingImageSrc() {
    if (!this.imgEl) return;
    const pendingSrc = this.lazyImagePendingSrc;
    if (!pendingSrc) return;
    if (this.imgEl.dataset.rawSrc === pendingSrc) return;
    // Hide transient frame while source is loading and being fitted.
    this.imageLoading = true;
    this.imgEl.style.opacity = '0';
    this.hideMaskedBackgroundLayer();
    this.imgEl.style.display = '';
    this.imgEl.dataset.pendingSrc = pendingSrc;
    this.imgEl.src = pendingSrc;
    this.imgEl.dataset.rawSrc = pendingSrc;
    this.imgEl.dataset.pendingSrc = '';
  }

  get x() {
    return this.props.x;
  }
  set x(v) {
    if (this.props.x === v) return;
    this.props.x = v;
    this.boundsDirty = true;
    this.markChildrenBoundsDirty();
    updateTransformOnly(this);
  }
  get y() {
    return this.props.y;
  }
  set y(v) {
    if (this.props.y === v) return;
    this.props.y = v;
    this.boundsDirty = true;
    this.markChildrenBoundsDirty();
    updateTransformOnly(this);
  }
  get w() {
    return this.props.w;
  }
  set w(v) {
    if (this.props.w === v) return;
    this.props.w = v;
    this.boundsDirty = true;
    this.markChildrenBoundsDirty();
    updateNodeStyles(this);
  }
  get h() {
    return this.props.h;
  }
  set h(v) {
    if (this.props.h === v) return;
    this.props.h = v;
    this.boundsDirty = true;
    this.markChildrenBoundsDirty();
    updateNodeStyles(this);
  }
  get width() {
    return this.props.w;
  }
  set width(v) {
    if (this.props.w === v) return;
    this.props.w = v;
    this.boundsDirty = true;
    this.markChildrenBoundsDirty();
    updateNodeStyles(this);
  }
  get height() {
    return this.props.h;
  }
  set height(v) {
    if (this.props.h === v) return;
    this.props.h = v;
    this.boundsDirty = true;
    this.markChildrenBoundsDirty();
    updateNodeStyles(this);
  }
  get alpha() {
    return this.props.alpha;
  }
  set alpha(v) {
    this.props.alpha = v;
    updateNodeStyles(this);
  }
  get autosize() {
    return this.props.autosize;
  }
  set autosize(v) {
    this.props.autosize = v;
    updateNodeStyles(this);
  }
  get clipping() {
    return this.props.clipping;
  }
  set clipping(v) {
    this.props.clipping = v;
    updateNodeStyles(this);
  }
  get color() {
    return this.props.color;
  }
  set color(v) {
    this.props.color = v;
    updateNodeStyles(this);
  }
  get colorTop() {
    return this.props.colorTop;
  }
  set colorTop(v) {
    this.props.colorTop = v;
    updateNodeStyles(this);
  }
  get colorBottom() {
    return this.props.colorBottom;
  }
  set colorBottom(v) {
    this.props.colorBottom = v;
    updateNodeStyles(this);
  }
  get colorLeft() {
    return this.props.colorLeft;
  }
  set colorLeft(v) {
    this.props.colorLeft = v;
    updateNodeStyles(this);
  }
  get colorRight() {
    return this.props.colorRight;
  }
  set colorRight(v) {
    this.props.colorRight = v;
    updateNodeStyles(this);
  }
  get colorTl() {
    return this.props.colorTl;
  }
  set colorTl(v) {
    this.props.colorTl = v;
    updateNodeStyles(this);
  }
  get colorTr() {
    return this.props.colorTr;
  }
  set colorTr(v) {
    this.props.colorTr = v;
    updateNodeStyles(this);
  }
  get colorBr() {
    return this.props.colorBr;
  }
  set colorBr(v) {
    this.props.colorBr = v;
    updateNodeStyles(this);
  }
  get colorBl() {
    return this.props.colorBl;
  }
  set colorBl(v) {
    this.props.colorBl = v;
    updateNodeStyles(this);
  }
  get zIndex() {
    return this.props.zIndex;
  }
  set zIndex(v) {
    if (this.props.zIndex === v) return;
    this.props.zIndex = Math.ceil(v);
    updateNodeStyles(this);
  }
  get texture() {
    return this.props.texture;
  }
  set texture(v) {
    if (this.props.texture === v) return;
    this.props.texture = v;
    this.boundsDirty = true;
    updateNodeStyles(this);
  }
  get textureOptions(): IRendererNode['textureOptions'] {
    return this.props.textureOptions;
  }
  set textureOptions(v) {
    this.props.textureOptions = v;
    updateNodeStyles(this);
  }
  get src() {
    return this.props.src;
  }
  set src(v) {
    if (this.props.src === v) return;
    this.props.src = v;
    this.boundsDirty = true;
    updateNodeStyles(this);
  }
  get scale() {
    return this.props.scale ?? 1;
  }
  set scale(v) {
    if (this.props.scale === v) return;
    this.props.scale = v;
    this.boundsDirty = true;
    this.markChildrenBoundsDirty();
    updateTransformOnly(this);
  }
  get scaleX() {
    return this.props.scaleX;
  }
  set scaleX(v) {
    if (this.props.scaleX === v) return;
    this.props.scaleX = v;
    this.boundsDirty = true;
    this.markChildrenBoundsDirty();
    updateTransformOnly(this);
  }
  get scaleY() {
    return this.props.scaleY;
  }
  set scaleY(v) {
    if (this.props.scaleY === v) return;
    this.props.scaleY = v;
    this.boundsDirty = true;
    this.markChildrenBoundsDirty();
    updateTransformOnly(this);
  }
  get mount() {
    return this.props.mount;
  }
  set mount(v) {
    if (this.props.mount === v) return;
    this.props.mount = v;
    this.boundsDirty = true;
    this.markChildrenBoundsDirty();
    updateTransformOnly(this);
  }
  get mountX() {
    return this.props.mountX;
  }
  set mountX(v) {
    if (this.props.mountX === v) return;
    this.props.mountX = v;
    this.boundsDirty = true;
    this.markChildrenBoundsDirty();
    updateTransformOnly(this);
  }
  get mountY() {
    return this.props.mountY;
  }
  set mountY(v) {
    if (this.props.mountY === v) return;
    this.props.mountY = v;
    this.boundsDirty = true;
    this.markChildrenBoundsDirty();
    updateTransformOnly(this);
  }
  get pivot() {
    return this.props.pivot;
  }
  set pivot(v) {
    if (this.props.pivot === v) return;
    this.props.pivot = v;
    this.boundsDirty = true;
    this.markChildrenBoundsDirty();
    updateNodeStyles(this);
  }
  get pivotX() {
    return this.props.pivotX;
  }
  set pivotX(v) {
    if (this.props.pivotX === v) return;
    this.props.pivotX = v;
    this.boundsDirty = true;
    this.markChildrenBoundsDirty();
    updateNodeStyles(this);
  }
  get pivotY() {
    return this.props.pivotY;
  }
  set pivotY(v) {
    if (this.props.pivotY === v) return;
    this.props.pivotY = v;
    this.boundsDirty = true;
    this.markChildrenBoundsDirty();
    updateNodeStyles(this);
  }
  get rotation() {
    return this.props.rotation;
  }
  set rotation(v) {
    if (this.props.rotation === v) return;
    this.props.rotation = v;
    this.boundsDirty = true;
    this.markChildrenBoundsDirty();
    updateTransformOnly(this);
  }
  get rtt() {
    return this.props.rtt;
  }
  set rtt(v) {
    this.props.rtt = v;
    updateNodeStyles(this);
  }
  get shader() {
    return this.props.shader;
  }
  set shader(v) {
    this.props.shader = v;
    updateNodeStyles(this);
  }

  get data(): IRendererNode['data'] {
    return this.props.data;
  }
  set data(v) {
    this.props.data = v;
    updateNodeData(this);
  }

  get imageType() {
    return this.props.imageType;
  }
  set imageType(v) {
    this.props.imageType = v;
  }
  get srcWidth() {
    return this.props.srcWidth;
  }
  set srcWidth(v) {
    this.props.srcWidth = v;
  }
  get srcHeight() {
    return this.props.srcHeight;
  }
  set srcHeight(v) {
    this.props.srcHeight = v;
  }
  get srcX() {
    return this.props.srcX;
  }
  set srcX(v) {
    this.props.srcX = v;
  }
  get srcY() {
    return this.props.srcY;
  }
  set srcY(v) {
    this.props.srcY = v;
  }

  get boundsMargin(): number | [number, number, number, number] | null {
    return this.props.boundsMargin;
  }
  set boundsMargin(value: number | [number, number, number, number] | null) {
    this.props.boundsMargin = value;
    this.boundsDirty = true;
    this.markChildrenBoundsDirty();
  }

  get ignoreParentAlpha(): boolean {
    return this.props.ignoreParentAlpha;
  }
  set ignoreParentAlpha(v: boolean) {
    this.props.ignoreParentAlpha = v;
    updateNodeStyles(this);
  }

  get placeholderColor(): number {
    return this.props.placeholderColor;
  }
  set placeholderColor(v: number) {
    this.props.placeholderColor = v;
    updateNodeStyles(this);
  }

  get fallbackImage(): string | null {
    return this.props.fallbackImage ?? null;
  }

  set fallbackImage(v: string | null) {
    if (this.props.fallbackImage === v) return;
    this.props.fallbackImage = v;
  }

  get absX(): number {
    const parent = this.props.parent;
    return (
      this.x +
      -this.w * this.mountX +
      (parent instanceof DOMNode ? parent.absX : 0)
    );
  }
  get absY(): number {
    const parent = this.props.parent;
    return (
      this.y +
      -this.h * this.mountY +
      (parent instanceof DOMNode ? parent.absY : 0)
    );
  }
}

class DOMText extends DOMNode {
  public loaded = false;

  constructor(
    stage: IRendererStage,
    public override props: IRendererTextNodeProps,
  ) {
    super(stage, props);
    this.div.innerText = props.text;
    updateNodeStyles(this);
    updateDOMTextSize(this, false);
    syncContainTextNodeTracking(this);
    scheduleUpdateDOMTextMeasurement(this);
  }

  override destroy(): void {
    textNodesToMeasure.delete(this);
    containTextNodes.delete(this);
    super.destroy();
  }

  get text() {
    return this.props.text;
  }
  set text(v) {
    if (this.props.text === v) return;
    this.props.text = v;
    this.div.innerText = v;
    scheduleUpdateDOMTextMeasurement(this);
  }
  get fontFamily() {
    return this.props.fontFamily;
  }
  set fontFamily(v) {
    if (this.props.fontFamily === v) return;
    this.props.fontFamily = v;
    updateNodeStyles(this);
    scheduleUpdateDOMTextMeasurement(this);
  }
  get fontSize() {
    return this.props.fontSize;
  }
  set fontSize(v) {
    if (this.props.fontSize === v) return;
    this.props.fontSize = v;
    updateNodeStyles(this);
    scheduleUpdateDOMTextMeasurement(this);
  }
  get fontStyle() {
    return this.props.fontStyle;
  }
  set fontStyle(v) {
    if (this.props.fontStyle === v) return;
    this.props.fontStyle = v;
    updateNodeStyles(this);
    scheduleUpdateDOMTextMeasurement(this);
  }
  get fontWeight() {
    return this.props.fontWeight;
  }
  set fontWeight(v) {
    if (this.props.fontWeight === v) return;
    this.props.fontWeight = v;
    updateNodeStyles(this);
    scheduleUpdateDOMTextMeasurement(this);
  }
  get fontStretch() {
    return this.props.fontStretch;
  }
  set fontStretch(v) {
    if (this.props.fontStretch === v) return;
    this.props.fontStretch = v;
    updateNodeStyles(this);
    scheduleUpdateDOMTextMeasurement(this);
  }
  get forceLoad() {
    return this.props.forceLoad;
  }
  set forceLoad(v) {
    this.props.forceLoad = v;
  }
  get lineHeight() {
    return this.props.lineHeight;
  }
  set lineHeight(v) {
    if (this.props.lineHeight === v) return;
    this.props.lineHeight = v;
    updateNodeStyles(this);
    scheduleUpdateDOMTextMeasurement(this);
  }
  get maxWidth() {
    return this.props.maxWidth;
  }
  set maxWidth(v) {
    if (this.props.maxWidth === v) return;
    this.props.maxWidth = v;
    updateNodeStyles(this);
    scheduleUpdateDOMTextMeasurement(this);
  }
  get maxHeight() {
    return this.props.maxHeight;
  }
  set maxHeight(v) {
    if (this.props.maxHeight === v) return;
    this.props.maxHeight = v;
    updateNodeStyles(this);
    scheduleUpdateDOMTextMeasurement(this);
  }
  get letterSpacing() {
    return this.props.letterSpacing;
  }
  set letterSpacing(v) {
    if (this.props.letterSpacing === v) return;
    this.props.letterSpacing = v;
    updateNodeStyles(this);
    scheduleUpdateDOMTextMeasurement(this);
  }
  get textAlign() {
    return this.props.textAlign;
  }
  set textAlign(v) {
    if (this.props.textAlign === v) return;
    this.props.textAlign = v;
    updateNodeStyles(this);
  }
  get overflowSuffix() {
    return this.props.overflowSuffix;
  }
  set overflowSuffix(v) {
    if (this.props.overflowSuffix === v) return;
    this.props.overflowSuffix = v;
    updateNodeStyles(this);
  }
  get maxLines() {
    return this.props.maxLines;
  }
  set maxLines(v) {
    if (this.props.maxLines === v) return;
    this.props.maxLines = v;
    updateNodeStyles(this);
    scheduleUpdateDOMTextMeasurement(this);
  }
  get contain() {
    return this.props.contain;
  }
  set contain(v) {
    if (this.props.contain === v) return;
    this.props.contain = v;
    syncContainTextNodeTracking(this);
    updateNodeStyles(this);
    scheduleUpdateDOMTextMeasurement(this);
  }
  get verticalAlign() {
    return this.props.verticalAlign;
  }
  set verticalAlign(v) {
    this.props.verticalAlign = v;
    updateNodeStyles(this);
  }
  get textRendererOverride() {
    return this.props.textRendererOverride;
  }
  set textRendererOverride(v) {
    this.props.textRendererOverride = v;
    updateNodeStyles(this);
  }
  get offsetY() {
    return this.props.offsetY;
  }
  set offsetY(v) {
    this.props.offsetY = v;
    updateNodeStyles(this);
  }
  get wordBreak() {
    return this.props.wordBreak;
  }
  set wordBreak(v) {
    this.props.wordBreak = v;
    updateNodeStyles(this);
  }
}

function updateRootPosition(this: DOMRendererMain) {
  const { canvas, settings } = this;

  const rect = canvas.getBoundingClientRect();
  const top = document.documentElement.scrollTop + rect.top;
  const left = document.documentElement.scrollLeft + rect.left;

  const dpr = settings.deviceLogicalPixelRatio ?? 1;

  const height = Math.ceil(settings.appHeight ?? 1080 / dpr);
  const width = Math.ceil(settings.appWidth ?? 1920 / dpr);

  this.root.div.style.left = `${left}px`;
  this.root.div.style.top = `${top}px`;
  this.root.div.style.width = `${width}px`;
  this.root.div.style.height = `${height}px`;
  this.root.div.style.position = 'absolute';
  this.root.div.style.transformOrigin = '0 0 0';
  this.root.div.style.transform = `scale(${dpr}, ${dpr})`;
  this.root.div.style.overflow = 'hidden';
}

export class DOMRendererMain implements IRendererMain {
  root: DOMNode;
  canvas: HTMLCanvasElement;
  stage: IRendererStage;
  private eventListeners: Map<
    string,
    Set<(target: unknown, data: unknown) => void>
  > = new Map();

  constructor(
    public settings: DomRendererMainSettings,
    rawTarget: string | HTMLElement,
  ) {
    let target: HTMLElement;
    if (typeof rawTarget === 'string') {
      const result = document.getElementById(rawTarget);
      if (result instanceof HTMLElement) {
        target = result;
      } else {
        throw new Error(`Target #${rawTarget} not found`);
      }
    } else {
      target = rawTarget;
    }

    const canvas = document.body.appendChild(document.createElement('canvas'));
    canvas.style.position = 'absolute';
    canvas.style.top = '0';
    canvas.style.left = '0';
    canvas.style.width = '100vw';
    canvas.style.height = '100vh';

    this.canvas = canvas;

    this.stage = {
      root: null!,
      renderer: {
        mode: 'canvas',
        boundsMargin: settings.boundsMargin,
      },
      shManager: {
        registerShaderType() {},
      },
      animationManager: {
        registerAnimation(anim) {
          console.log('registerAnimation', anim);
        },
        unregisterAnimation(anim) {
          console.log('unregisterAnimation', anim);
        },
      },
      loadFont: async () => {},
      cleanup() {},
      requestRender() {},
    };

    this.root = new DOMNode(
      this.stage,
      resolveNodeDefaults({
        w: settings.appWidth ?? 1920,
        h: settings.appHeight ?? 1080,
        shader: defaultShader,
        zIndex: 1,
      }),
    );
    this.stage.root = this.root;
    target.appendChild(this.root.div);

    if (Config.fontSettings.fontFamily) {
      this.root.div.style.fontFamily = Config.fontSettings.fontFamily;
    }
    if (Config.fontSettings.fontSize) {
      this.root.div.style.fontSize = Config.fontSettings.fontSize + 'px';
    }
    if (Config.fontSettings.lineHeight) {
      this.root.div.style.lineHeight = Config.fontSettings.lineHeight + 'px';
    } else {
      this.root.div.style.lineHeight = '1.2';
    }
    if (Config.fontSettings.fontWeight) {
      if (typeof Config.fontSettings.fontWeight === 'number') {
        this.root.div.style.fontWeight = Config.fontSettings.fontWeight + 'px';
      } else {
        this.root.div.style.fontWeight = Config.fontSettings.fontWeight;
      }
    }

    updateRootPosition.call(this);

    new MutationObserver(updateRootPosition.bind(this)).observe(this.canvas, {
      attributes: true,
    });
    new ResizeObserver(updateRootPosition.bind(this)).observe(this.canvas);
    window.addEventListener('resize', updateRootPosition.bind(this));
  }

  removeAllListeners(): void {
    if (this.eventListeners.size === 0) return;
    this.eventListeners.forEach((listeners) => listeners.clear());
    this.eventListeners.clear();
  }

  once<K extends string | number>(
    event: Extract<K, string>,
    listener: { [s: string]: (target: any, data: any) => void }[K],
  ): void {
    const wrappedListener = (target: any, data: any) => {
      this.off(event, wrappedListener);
      listener(target, data);
    };
    this.on(event, wrappedListener);
  }

  on(name: string, callback: (target: any, data: any) => void) {
    let listeners = this.eventListeners.get(name);
    if (!listeners) {
      listeners = new Set();
      this.eventListeners.set(name, listeners);
    }
    listeners.add(callback);
  }

  off<K extends string | number>(
    event: Extract<K, string>,
    listener: { [s: string]: (target: any, data: any) => void }[K],
  ): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      listeners.delete(listener);
      if (listeners.size === 0) {
        this.eventListeners.delete(event);
      }
    }
  }

  emit<K extends string | number>(
    event: Extract<K, string>,
    data: Parameters<any>[1],
  ): void;
  emit<K extends string | number>(
    event: Extract<K, string>,
    target: unknown,
    data: Parameters<any>[1],
  ): void;
  emit<K extends string | number>(
    event: Extract<K, string>,
    targetOrData: unknown,
    maybeData?: Parameters<any>[1],
  ): void {
    const listeners = this.eventListeners.get(event);
    if (!listeners || listeners.size === 0) {
      return;
    }

    const hasExplicitTarget = arguments.length === 3;
    const target = hasExplicitTarget ? targetOrData : this.root;
    const data = hasExplicitTarget ? maybeData : targetOrData;

    for (const listener of Array.from(listeners)) {
      try {
        listener(target, data);
      } catch (error) {
        console.error(`Error in listener for event "${event}"`, error);
      }
    }
  }

  createNode(props: Partial<IRendererNodeProps>): IRendererNode {
    return new DOMNode(this.stage, resolveNodeDefaults(props));
  }

  createTextNode(props: Partial<IRendererTextNodeProps>): IRendererTextNode {
    return new DOMText(this.stage, resolveTextNodeDefaults(props));
  }

  /** TODO: restore this */
  // createShader<ShType extends keyof ShaderMap>(
  //   shType: ShType,
  //   props?: OptionalShaderProps<ShType>,
  // ): InstanceType<lng.ShaderMap[ShType]> {
  //   return { shaderType: shType, props, program: {} } as InstanceType<
  //     lng.ShaderMap[ShType]
  //   >;
  // }

  createShader(
    ...args: Parameters<typeof lng.RendererMain.prototype.createShader>
  ): ReturnType<typeof lng.RendererMain.prototype.createShader> {
    const [shaderType, props] = args;
    return {
      // @ts-ignore
      shaderType,
      props,
      program: {},
    };
  }

  createTexture<Type extends keyof lng.TextureMap>(
    textureType: Type,
    props: ExtractProps<lng.TextureMap[Type]>,
  ): InstanceType<lng.TextureMap[Type]> {
    let type = lng.TextureType.generic;
    switch (textureType) {
      case 'SubTexture':
        type = lng.TextureType.subTexture;
        break;
      case 'ImageTexture':
        type = lng.TextureType.image;
        break;
      case 'ColorTexture':
        type = lng.TextureType.color;
        break;
      case 'NoiseTexture':
        type = lng.TextureType.noise;
        break;
      case 'RenderTexture':
        type = lng.TextureType.renderToTexture;
        break;
    }
    return { type, props } as InstanceType<lng.TextureMap[Type]>;
  }
}

export function loadFontToDom(font: FontLoadOptions): void {
  // fontFamily: string;
  // metrics?: FontMetrics;
  // fontUrl?: string;
  // atlasUrl?: string;
  // atlasDataUrl?: string;

  if (
    typeof document === 'undefined' ||
    !('fonts' in document) ||
    typeof FontFace === 'undefined' ||
    !font.fontUrl
  ) {
    return;
  }

  const fontFace = new FontFace(font.fontFamily, `url(${font.fontUrl})`);
  const fontSet = document.fonts as FontFaceSet & {
    add?: (font: FontFace) => FontFaceSet;
  };
  fontSet.add?.(fontFace);

  fontFace
    .load()
    .then(scheduleContainTextNodesMeasurement)
    .catch(() => {});
}

export function isDomRenderer(
  r: lng.RendererMain | DOMRendererMain,
): r is DOMRendererMain {
  return r instanceof DOMRendererMain;
}
