import * as lng from '@solidtv/renderer';
import { EventEmitter } from '@solidtv/renderer/utils';
import {
  ShaderBorderPrefixedProps,
  ShaderHolePunchProps,
  ShaderLinearGradientProps,
  ShaderRadialGradientProps,
  ShaderRoundedProps,
  ShaderShadowPrefixedProps,
} from '../shaders.js';

/** Based on 1.10's CoreRenderer (2.0 has one backend, and no such type) */
export interface IRendererCoreRenderer {
  mode: 'canvas' | 'webgl' | undefined;
  boundsMargin?: number;
}
/** Based on 1.10's TrFontManager (2.0 has no such type) */
export interface IRendererFontManager {
  addFontFace: (...a: any[]) => void;
}
/** Based on {@link lng.RendererMain} (1.10's Stage: in 2.0 the stage is the renderer) */
export interface IRendererStage {
  root: IRendererNode;
  renderer: IRendererCoreRenderer;
  shManager: IRendererShaderManager;
  animationManager: {
    registerAnimation: (anim: any) => void;
    unregisterAnimation: (anim: any) => void;
  };
  loadFont: lng.RendererMain['loadFont'];
  reprocessUpdates?: (callback?: () => void) => void;
  requestRender: () => void;
  cleanup(full: boolean): void;
}

/** Based on {@link lng.RendererMain}'s registerShaderType (1.10's CoreShaderManager) */
export interface IRendererShaderManager {
  registerShaderType: (name: string, shader: any) => void;
}

/** Based on {@link lng.ShaderType} (1.10's CoreShaderType) */
export interface IRendererShaderType {}

export type IRendererShaderProps = Partial<ShaderBorderPrefixedProps> &
  Partial<ShaderShadowPrefixedProps> &
  Partial<ShaderRoundedProps> &
  Partial<ShaderHolePunchProps> &
  Partial<ShaderRadialGradientProps> &
  Partial<ShaderLinearGradientProps>;

/** Based on {@link lng.ShaderNode} */
export interface IRendererShader extends Partial<lng.ShaderType> {
  shaderType: IRendererShaderType;
  props?: IRendererShaderProps;
  program?: {};
}

export type ExtractProps<Type> = Type extends { z$__type__Props: infer Props }
  ? Props
  : never;

export interface IEventEmitter<
  T extends object = { [s: string]: (target: any, data: any) => void },
> {
  on<K extends keyof T>(event: Extract<K, string>, listener: T[K]): void;
  once<K extends keyof T>(event: Extract<K, string>, listener: T[K]): void;
  off<K extends keyof T>(event: Extract<K, string>, listener: T[K]): void;
  emit<K extends keyof T>(
    event: Extract<K, string>,
    data: Parameters<any>[1],
  ): void;
}

export interface IRendererNodeShaded extends EventEmitter {
  stage: IRendererStage;
  id: number;
  animate: (
    props: Partial<lng.AnimateProps>,
    settings: Partial<lng.AnimationSettings>,
  ) => lng.IAnimationController;
  get absX(): number;
  get absY(): number;
}

/** Based on {@link lng.INodeProps} */
export interface IRendererNodeProps extends Omit<
  lng.INodeProps,
  'shader' | 'parent'
> {
  shader: IRendererShader | null;
  parent: IRendererNode | null;
}

/** Based on {@link lng.Node} (1.10's CoreNode) */
export interface IRendererNode extends IRendererNodeShaded, IRendererNodeProps {
  div?: HTMLElement;
  props: IRendererNodeProps;
  renderState: lng.CoreNodeRenderState;
}

/** Based on {@link lng.ITextNodeProps} */
export interface IRendererTextNodeProps extends Omit<
  lng.ITextNodeProps,
  'shader' | 'parent'
> {
  shader: IRendererShader | null;
  parent: IRendererNode | null;
  fontWeight?: string;
  fontStretch?: string;
}

/** Based on {@link lng.ITextNode} */
export interface IRendererTextNode
  extends IRendererNodeShaded, IRendererTextNodeProps {
  div?: HTMLElement;
  props: IRendererTextNodeProps;
  renderState: lng.CoreNodeRenderState;
}

/** Based on {@link lng.RendererMain} */
export interface IRendererMain extends IEventEmitter {
  root: IRendererNode;
  stage: IRendererStage;
  canvas: HTMLCanvasElement;
  createTextNode(props: Partial<IRendererTextNodeProps>): IRendererTextNode;
  createNode(props: Partial<IRendererNodeProps>): IRendererNode;
  createShader: typeof lng.RendererMain.prototype.createShader;
  createTexture: typeof lng.RendererMain.prototype.createTexture;
}

export interface DomRendererMainSettings {
  /**
   * The logical width of the application (default: 1920)
   */
  appWidth?: number;

  /**
   * The logical height of the application (default: 1080)
   */
  appHeight?: number;

  /**
   * Device logical pixel ratio (default: 1)
   */
  deviceLogicalPixelRatio?: number;

  /**
   * Preload margin around the viewport, in logical pixels (default: 200)
   *
   * @remarks
   * A single number applied to all sides. The `[top, right, bottom, left]`
   * array form was dropped in renderer 1.8; it is still tolerated at runtime
   * (the largest edge wins, with a warning) but should be replaced.
   */
  boundsMargin?: number;
}
