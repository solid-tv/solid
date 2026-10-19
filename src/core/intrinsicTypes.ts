import * as lngr from '@solidtv/renderer';
import type { INodeProps, ITextNodeProps } from '@solidtv/renderer/node';
import type { ElementNode } from './node/ElementNode.js';
import { NodeStates } from './states.js';
import {
  ShaderBorderProps,
  ShaderHolePunchProps,
  ShaderLinearGradientProps,
  ShaderRadialGradientProps,
  ShaderRoundedProps,
  ShaderShadowProps,
} from './shaders.js';
import { EventHandlers, DefaultKeyMap, FocusNode } from './focusKeyTypes.js';
import type { Element as JSXElement } from 'solid-js';

export type AnimationSettings = Partial<lngr.AnimationSettings>;

export type AddColorString<T> = {
  [K in keyof T]: K extends `color${string}` ? string | number : T[K];
};

export interface BorderStyleObject extends AddColorString<
  Partial<lngr.BorderProps>
> {
  width?: number | [number, number, number, number];
  gap?: number;
  align?: 'inside' | 'outside' | 'center';
  fill?: number | string;
}

export interface SingleBorderStyleObject extends AddColorString<
  Partial<lngr.BorderProps>
> {
  width?: number;
  w?: number;
  gap?: number;
  align?: 'inside' | 'outside' | 'center';
  fill?: number | string;
}

export type DollarString = `$${string}`;
export type BorderStyle = BorderStyleObject;
export type SingleBorderStyle = SingleBorderStyleObject;
export type BorderRadius = number | number[];

export interface Effects {
  linearGradient?: Partial<ShaderLinearGradientProps>;
  radialGradient?: Partial<ShaderRadialGradientProps>;
  holePunch?: Partial<ShaderHolePunchProps>;
  shadow?: Partial<ShaderShadowProps>;
  rounded?: Partial<ShaderRoundedProps>;
  borderRadius?: Partial<BorderRadius>;
  border?: Partial<ShaderBorderProps>;
  borderTop?: Partial<ShaderBorderProps>;
  borderBottom?: Partial<ShaderBorderProps>;
  borderLeft?: Partial<ShaderBorderProps>;
  borderRight?: Partial<ShaderBorderProps>;
}

export type StyleEffects = Effects;

export type FontLoadOptions = Omit<
  lngr.FontLoadOptions,
  'atlasUrl' | 'atlasDataUrl'
> & {
  type?: 'ssdf' | 'msdf';
  // For web fonts (DOM renderer)
  fontUrl?: string;
  // For SDF fonts
  atlasUrl?: string;
  atlasDataUrl?: string;
};

export type CoreShaderManager = Pick<lngr.RendererMain, 'registerShaderType'>;

export type NewOmit<T, K extends PropertyKey> = {
  [P in keyof T as Exclude<P, K>]: T[P];
};

export type RemoveUnderscoreProps<T> = {
  [K in keyof T as K extends `_${string}` ? never : K]: T[K];
};

/** The renderer node's props, as JSX takes them (colours as strings too). */
export type RendererNode = AddColorString<
  Partial<NewOmit<INodeProps, 'parent' | 'shader' | 'src'>>
>;

type RendererText = AddColorString<
  Partial<Omit<ITextNodeProps, 'debug' | 'shader' | 'parent'>>
>;

type CleanElementNode = NewOmit<
  RemoveUnderscoreProps<ElementNode>,
  | keyof RendererNode
  | 'parent'
  | 'insertChild'
  | 'removeChild'
  | 'selectedNode'
  | 'shader'
  | 'animate'
  | 'chain'
  | 'start'
  | 'getText'
  | 'destroy'
  | 'destroyed'
  | 'hasChildren'
  | 'getChildById'
  | 'searchChildrenById'
  | 'states'
  | 'requiresLayout'
  | 'updateLayout'
  | 'style'
  | 'slot'
  | 'core'
  | 'setNow'
  | 'writeProp'
  | 'emit'
  | 'hasListener'
  | 'removeAllListeners'
  | 'on'
  | 'off'
  | 'bubble'
  | 'measureText'
  | 'setFocus'
>;
/** A `<text>`: an ElementNode of type TextNode; its children are strings. */
export interface ElementText extends ElementNode {
  readonly _type: 'textNode';
}

export interface NodeProps
  extends
    RendererNode,
    EventHandlers<DefaultKeyMap>,
    FocusNode,
    Partial<
      NewOmit<
        CleanElementNode,
        | 'children'
        | 'text'
        | 'lng'
        | 'rendered'
        | 'renderer'
        | 'emit'
        | 'preFlexwidth'
        | 'preFlexheight'
        | 'width'
        | 'height'
        | 'componentName'
        | 'componentLocation'
      >
    > {
  // Any other prop: an app's own field on the node (1.x typed the node with
  // an index signature; the class has none now, its props do).
  [key: string]: unknown;
  ref?: ElementNode | ((node: ElementNode) => void);
  states?: NodeStates;
  style?: NodeStyles;
  children?: JSXElement | undefined;
}
export interface NodeStyles extends NewOmit<NodeProps, 'style'> {
  [key: `$${string}`]: NodeProps;
}

export interface TextProps
  extends
    RendererText,
    Partial<
      NewOmit<
        CleanElementNode,
        | 'lng'
        | 'rendered'
        | 'renderer'
        | 'alignItems'
        | 'autosize'
        | 'children'
        | 'data'
        | 'direction'
        | 'display'
        | 'flexBoundary'
        | 'flexDirection'
        | 'gap'
        | 'justifyContent'
        | 'forwardFocus'
        | 'forwardStates'
        | 'linearGradient'
        | 'src'
        | 'scale'
        | 'texture'
        | 'textureOptions'
      >
    > {
  // Any other prop, as for NodeProps.
  [key: string]: unknown;
  ref?: ElementNode | ((node: ElementNode) => void);
  states?: NodeStates;
  fontWeight?: number | string;
  style?: TextStyles;
  children?: string | string[] | undefined;
}

export interface TextStyles extends NewOmit<TextProps, 'style'> {
  [key: `$${string}`]: TextProps;
}

export type Styles = NodeStyles | TextStyles;

// TODO: deprecated
export interface IntrinsicNodeProps extends NodeProps {}
export interface IntrinsicNodeStyleProps extends NodeStyles {}
export interface IntrinsicTextNodeStyleProps extends TextStyles {}

export type AnimationEvents = 'animating' | 'stopped';
export type AnimationEventHandler = (
  this: ElementNode,
  name: string,
  endValue: number,
) => void;

type EventPayloadMap = {
  loaded: lngr.NodeLoadedPayload;
  failed: lngr.NodeFailedPayload;
  freed: Event;
  inViewport: lngr.NodeViewportPayload;
  outOfViewport: lngr.NodeViewportPayload;
};

type NodeEvents = keyof EventPayloadMap;

type EventHandler<E extends NodeEvents> = (
  target: ElementNode,
  event?: EventPayloadMap[E],
) => void;

export type OnEvent = Partial<{
  [K in NodeEvents]: EventHandler<K>;
}>;
