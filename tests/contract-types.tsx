// Contract tests: the public types apps augment, and the type-only export
// names of every entry point.
//
// Type-level only: never executed, not a vitest file. `pnpm tsc` checks it
// through tests/tsconfig.contract.json. A failure here is a type error.
import type {
  ElementNode,
  IntrinsicNodeStyleProps,
  IntrinsicTextNodeStyleProps,
  KeyMap,
  NodeStyles,
  TextStyles,
} from '@solidtv/solid';
import { useFocusManager } from '@solidtv/solid/primitives';
import type { KeyMap as PrimitivesKeyMap } from '@solidtv/solid/primitives';

// --- Types: augmentable with `declare module "@solidtv/solid"` -------------
//
// Each augmentation adds a member with a precise type, then uses it both ways:
// a valid use, and an invalid one under @ts-expect-error. The index
// signatures on ElementNode, NodeProps and KeyMap would accept the valid use
// even without the augmentation; the invalid one only fails if it merged.

declare module '@solidtv/solid' {
  // demo app LeftNavWrapper.tsx, announcer.ts
  interface ElementNode {
    contractItem?: { href: string };
  }
  interface NodeProps {
    contractNodeProp?: number;
  }
  interface NodeStyles {
    contractNodeStyle?: number;
  }
  interface TextStyles {
    contractTextStyle?: number;
  }
  // demo app styles.ts: app-specific states
  interface IntrinsicNodeStyleProps {
    contractActive?: IntrinsicNodeStyleProps;
  }
  interface IntrinsicTextNodeStyleProps {
    contractActive?: IntrinsicTextNodeStyleProps;
  }
  // demo app LeftNavWrapper.tsx: custom keys, required like the demo's
  interface KeyMap {
    ContractMenu: (string | number)[];
  }
}

export function elementNodeAugmentation(el: ElementNode) {
  const href: string | undefined = el.contractItem?.href;
  // @ts-expect-error -- contractItem.href is a string
  const wrong: number | undefined = el.contractItem?.href;
  // An ElementNode member is also a JSX prop.
  const ok = <view contractItem={{ href: 'x' }} />;
  // @ts-expect-error -- contractItem.href is a string
  const bad = <view contractItem={{ href: 1 }} />;
  return [href, wrong, ok, bad];
}

export function nodePropsAugmentation() {
  const ok = <view contractNodeProp={1} />;
  // @ts-expect-error -- contractNodeProp is a number
  const bad = <view contractNodeProp="1" />;
  return [ok, bad];
}

export function nodeStylesAugmentation() {
  const style: NodeStyles = { contractNodeStyle: 1, alpha: 0.5 };
  // @ts-expect-error -- contractNodeStyle is a number
  const bad: NodeStyles = { contractNodeStyle: '1' };
  const inJsx = <view style={{ contractNodeStyle: 1 }} />;
  return [style, bad, inJsx];
}

export function textStylesAugmentation() {
  const style: TextStyles = { contractTextStyle: 1, fontSize: 20 };
  // @ts-expect-error -- contractTextStyle is a number
  const bad: TextStyles = { contractTextStyle: '1' };
  const inJsx = <text style={{ contractTextStyle: 1 }}>x</text>;
  return [style, bad, inJsx];
}

export function intrinsicStylePropsAugmentation() {
  const node = {
    alpha: 1,
    contractActive: { alpha: 0.5 },
  } satisfies IntrinsicNodeStyleProps;
  const text = {
    fontSize: 20,
    contractActive: { fontSize: 30 },
  } satisfies IntrinsicTextNodeStyleProps;
  // @ts-expect-error -- contractActive is a style object
  const bad: IntrinsicNodeStyleProps = { contractActive: 1 };
  // @ts-expect-error -- contractActive is a style object
  const badText: IntrinsicTextNodeStyleProps = { contractActive: 1 };
  return [node, text, bad, badText];
}

export function keyMapAugmentation() {
  useFocusManager({ ContractMenu: ['m', 77], Left: ['ArrowLeft', 37] });
  const keyMap = {
    Left: 'ArrowLeft',
    Right: 'ArrowRight',
    Up: 'ArrowUp',
    Down: 'ArrowDown',
    Enter: 'Enter',
    Last: null,
    ContractMenu: ['m'],
  } satisfies KeyMap;
  // @ts-expect-error -- the augmented member is required
  const missing: KeyMap = {
    Left: null,
    Right: null,
    Up: null,
    Down: null,
    Enter: null,
    Last: null,
  };
  // @ts-expect-error -- the index signature allows null, ContractMenu does not
  const nullMenu: KeyMap['ContractMenu'] = null;
  // The primitives entry exports the same, augmented KeyMap.
  const viaPrimitives: PrimitivesKeyMap['ContractMenu'] = ['m'];
  // @ts-expect-error -- the index signature allows null, ContractMenu does not
  const nullViaPrimitives: PrimitivesKeyMap['ContractMenu'] = null;
  return [keyMap, missing, nullMenu, viaPrimitives, nullViaPrimitives];
}

// --- Exports: type-only names ----------------------------------------------
//
// Every type-only export of each entry point today. Importing a name that is
// gone is a type error. (Runtime names are pinned in publicApi.test.ts.)

// @solidtv/solid: Solid's own types (82). Six of them, the Shader*Props
// names and WebGlShader, are re-exported by src/core/shaders.ts from
// @solidtv/renderer/webgl[/shaders] (the renderer's root does not export
// them, so they are not in the next list).
export type {
  AddColorString,
  AnimationEventHandler,
  AnimationEvents,
  AnimationSettings,
  BorderRadius,
  BorderStyle,
  BorderStyleObject,
  CoreShaderManager,
  DefaultKeyMap,
  DollarString,
  DomRendererMainSettings,
  Effects,
  ElementText,
  EventHandlers,
  ExtractProps,
  FocusNode,
  FontLoadOptions,
  ForwardFocusHandler,
  IEventEmitter,
  IRendererCoreRenderer,
  IRendererFontManager,
  IRendererMain,
  IRendererNode,
  IRendererNodeProps,
  IRendererNodeShaded,
  IRendererShader,
  IRendererShaderManager,
  IRendererShaderProps,
  IRendererShaderType,
  IRendererStage,
  IRendererTextNode,
  IRendererTextNodeProps,
  IntrinsicNodeProps,
  IntrinsicNodeStyleProps,
  IntrinsicTextNodeStyleProps,
  JSX,
  KeyEventLike,
  KeyEventTarget,
  KeyHandler,
  KeyHandlerReturn,
  KeyMap,
  KeyNameOrKeyCode,
  NewOmit,
  NodeProps,
  NodeStyles,
  NodeTypes,
  OnEvent,
  Rect,
  RemoveUnderscoreProps,
  RenderedNode,
  RendererNode,
  SdfFontType,
  ShaderBorderPrefixedProps,
  ShaderBorderProps,
  ShaderHolePunch,
  ShaderHolePunchProps,
  ShaderLinearGradient,
  ShaderLinearGradientProps,
  ShaderRadialGradient,
  ShaderRadialGradientProps,
  ShaderRounded,
  ShaderRoundedProps,
  ShaderRoundedWithBorder,
  ShaderRoundedWithBorderAndShadow,
  ShaderRoundedWithBorderAndShadowProps,
  ShaderRoundedWithBorderProps,
  ShaderRoundedWithShadow,
  ShaderRoundedWithShadowProps,
  ShaderShadow,
  ShaderShadowPrefixedProps,
  ShaderShadowProps,
  SingleBorderStyle,
  SingleBorderStyleObject,
  SolidNode,
  SolidRendererOptions,
  SolidStyles,
  StyleEffects,
  Styles,
  TextProps,
  TextStyles,
  Vec4,
  WebGlShader,
} from '@solidtv/solid';

// @solidtv/solid: the renderer's names, via `export type * from
// '@solidtv/renderer'` in src/core/index.ts: 100 on the installed
// @solidtv/renderer 1.10 (AnimationSettings is Solid's own). Some are values
// in the renderer but type-only here. A renderer-side rename or removal is a
// break inherited from the renderer.
export type {
  AdvShaderProp,
  AdvancedShaderProp,
  AnimationControllerState,
  BorderProps,
  BorderTemplate,
  BoundsMargin,
  CompressedData,
  CoreNodeRenderState,
  CoreShaderNode,
  CoreShaderType,
  CoreTextureManager,
  Dimensions,
  EdgeFadeProps,
  EdgeFadeTemplate,
  FRAME_TIME_BUCKET_COUNT,
  FRAME_TIME_COARSE_MS,
  FRAME_TIME_FINE_MS,
  FRAME_TIME_MAX_MS,
  FRAME_TIME_SPLIT_MS,
  FontPrefetchOptions,
  FpsUpdatePayload,
  FrameTickPayload,
  HolePunchProps,
  HolePunchTemplate,
  IAnimationController,
  INode,
  INodeAnimateProps,
  INodeProps,
  ITextNode,
  ITextNodeProps,
  ImageTexture,
  Inspector,
  LinearGradientProps,
  LinearGradientTemplate,
  MemoryInfo,
  NodeFailedEventHandler,
  NodeFailedPayload,
  NodeLoadedEventHandler,
  NodeLoadedPayload,
  NodeRenderableEventHandler,
  NodeRenderablePayload,
  NodeTextFailedPayload,
  NodeTextLoadedPayload,
  NodeTextureFailedPayload,
  NodeTextureFreedPayload,
  NodeTextureLoadedPayload,
  NodeViewportPayload,
  RadialGradientProps,
  RadialGradientTemplate,
  RenderUpdatePayload,
  RendererCapabilities,
  RendererMain,
  RendererMainContextLostEvent,
  RendererMainCriticalCleanupEvent,
  RendererMainCriticalCleanupFailedEvent,
  RendererMainFpsUpdateEvent,
  RendererMainFrameTickEvent,
  RendererMainIdleEvent,
  RendererMainOutOfMemoryEvent,
  RendererMainRenderUpdateEvent,
  RendererMainSettings,
  RendererRuntimeSettings,
  RoundedProps,
  RoundedTemplate,
  ShaderProgramSources,
  ShaderProp,
  ShaderProps,
  ShadowProps,
  ShadowTemplate,
  Stage,
  StageFpsUpdateHandler,
  StageFrameTickHandler,
  StageOptions,
  Texture,
  TextureCoords,
  TextureData,
  TextureError,
  TextureErrorCode,
  TextureFailedEventHandler,
  TextureFreedEventHandler,
  TextureLoadedEventHandler,
  TextureLoadingEventHandler,
  TextureMap,
  TextureState,
  TextureType,
  TimingFunction,
  WebGlCoreCtxTexture,
  WebGlCoreRenderer,
  WebGlShaderProgram,
  clearFontPrefetch,
  closeImageBitmap,
  frameTimeBucketLowerBound,
  getBorderProps,
  getShadowProps,
  isAdvancedShaderProp,
  isTextureError,
  normalizeBoundsMargin,
  prefetchFont,
  resolveShaderProps,
  resolveTargetFPS,
} from '@solidtv/solid';

// @solidtv/solid/primitives (28).
export type {
  AnyFunction,
  ColumnProps,
  FocusHistoryEntry,
  GridItemProps,
  GridProps,
  HoldCallback,
  HoldHandler,
  ImageProps,
  KeyEventLike as PrimitivesKeyEventLike,
  KeyEventTarget as PrimitivesKeyEventTarget,
  KeyHandler as PrimitivesKeyHandler,
  KeyMap as PrimitivesKeyMap,
  MarqueeAnimationProps,
  MarqueeControlProps,
  MarqueeProps,
  MarqueeTextProps,
  NavigableElement,
  NavigableProps,
  NavigableStyleProperties,
  OnSelectedChanged,
  RowProps,
  ScrollableElement,
  Scroller,
  SpeechType,
  SpriteDef,
  UseHoldProps,
  VirtualGridProps,
  VirtualProps,
} from '@solidtv/solid/primitives';

// @solidtv/solid/primitives/router (3).
export type {
  Branch,
  HashRouterProps,
  KeepAliveElement,
} from '@solidtv/solid/primitives/router';

// @solidtv/solid/devtools (1).
export type { HexColorTransformOptions } from '@solidtv/solid/devtools';
