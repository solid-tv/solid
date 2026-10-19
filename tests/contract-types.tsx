// Contract tests: the public types apps augment, and the type-only export
// names of every entry point.
//
// Type-level only: never executed, not a vitest file. `pnpm tsc` checks it
// through tests/tsconfig.contract.json. A failure here is a type error.
import type {
  ElementNode,
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
// signatures on NodeProps and KeyMap would accept the valid use even without
// the augmentation; the invalid one only fails if it merged. (ElementNode has
// no index signature: an unknown member is an error, see below.)

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
    // demo app styles.ts: app-specific states
    contractActive?: NodeStyles;
  }
  interface TextStyles {
    contractTextStyle?: number;
    // demo app styles.ts: app-specific states
    contractActive?: TextStyles;
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

// --- ElementNode: declared members only ------------------------------------
//
// The class has no index signature (its props types do, for an app's own
// data prop), and the 1.x names the store-direct binding removed are gone.

export function elementNodeSurface(el: ElementNode) {
  const width: number = el.width;
  const alpha: number = el.alpha;
  const shadow = el.shadow?.blur;
  // @ts-expect-error -- no index signature: an unknown member is an error
  const unknown = el.notAMember;
  // @ts-expect-error -- `w` is `width`
  const w = el.w;
  // @ts-expect-error -- `h` is `height`
  const h = el.h;
  // @ts-expect-error -- `lng` is gone: the node is the renderer handle
  const lng = el.lng;
  // @ts-expect-error -- `effects` is gone: write the direct keys
  const effects = el.effects;
  // @ts-expect-error -- one of the 11 forwarded names that never reached the renderer
  const worldX = el.worldX;
  // @ts-expect-error -- shadow takes the shadow shader's props
  el.shadow = { blur: 'big' };
  return [width, alpha, shadow, unknown, w, h, lng, effects, worldX];
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

export function styleStatesAugmentation() {
  const node = {
    alpha: 1,
    contractActive: { alpha: 0.5 },
  } satisfies NodeStyles;
  const text = {
    fontSize: 20,
    contractActive: { fontSize: 30 },
  } satisfies TextStyles;
  // @ts-expect-error -- contractActive is a style object
  const bad: NodeStyles = { contractActive: 1 };
  // @ts-expect-error -- contractActive is a style object
  const badText: TextStyles = { contractActive: 1 };
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

// @solidtv/solid: Solid's own types (59; 2.0 dropped the DOM renderer's
// IEventEmitter, ExtractProps and IRenderer* names, SdfFontType, the
// `effects` types (Effects, StyleEffects) and RenderedNode, which every
// node is now). The Intrinsic* aliases are gone too. Six of
// them, the Shader*Props
// names and WebGlShader, are re-exported by src/core/shaders.ts as aliases
// of @solidtv/renderer types (the renderer does not export these names, so
// they are not in the next list).
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
  ElementText,
  EventHandlers,
  FocusNode,
  FontLoadOptions,
  ForwardFocusHandler,
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
  RendererNode,
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
  Styles,
  TextProps,
  TextStyles,
  Vec4,
  WebGlShader,
} from '@solidtv/solid';

// @solidtv/solid: the renderer's names, via `export type * from
// '@solidtv/renderer'` in src/core/index.ts: 103 on the installed
// @solidtv/renderer 2.0 (AnimationSettings, FontLoadOptions, TextNode and
// TextProps are Solid's own). The node handle types (INode, INodeProps,
// ITextNode, ITextNodeProps, Node) moved to '@solidtv/renderer/node' in
// 2.1 and are re-exported from there. Some are values in the renderer
// but type-only here. A renderer-side rename or removal is a break inherited
// from the renderer.
export type {
  AdvancedProp,
  AnimateProps,
  AnimationControllerState,
  BlurProps,
  BorderProps,
  BoundsMargin,
  ClippingValue,
  ColorTexture,
  ColorTextureProps,
  CoreNodeRenderState,
  CoreSettings,
  Dimensions,
  EdgeFadeProps,
  EventEmitter,
  FRAME_TIME_BUCKET_COUNT,
  FRAME_TIME_COARSE_MS,
  FRAME_TIME_FINE_MS,
  FRAME_TIME_MAX_MS,
  FRAME_TIME_SPLIT_MS,
  FontMetrics,
  FontPrefetchOptions,
  FpsUpdatePayload,
  FrameTickPayload,
  HolePunchProps,
  IAnimationController,
  INode,
  INodeProps,
  ITextNode,
  ITextNodeProps,
  ImageTexture,
  ImageTextureProps,
  ImageType,
  Inspector,
  InspectorOptions,
  LinearGradientProps,
  MemoryInfo,
  Node,
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
  NoiseTexture,
  NoiseTextureProps,
  PassHooks,
  Platform,
  PlatformConstructor,
  RadialGradientProps,
  RadialProgressProps,
  RenderStateValue,
  RenderUpdatePayload,
  Renderer,
  RendererCapabilities,
  RendererCore,
  RendererMain,
  RendererMainSettings,
  RendererRuntimeSettings,
  RendererSettings,
  RoundedProps,
  RoundedWithBorderAndShadowProps,
  RoundedWithBorderProps,
  RoundedWithShadowProps,
  ShaderClock,
  ShaderContext,
  ShaderNode,
  ShaderSource,
  ShaderType,
  ShadowProps,
  SubTexture,
  SubTextureProps,
  TextAlign,
  TextBaselineMode,
  TextContain,
  TextFontStyle,
  TextVerticalAlign,
  TextWordBreak,
  Texture,
  TextureError,
  TextureErrorCode,
  TextureMap,
  TextureMemorySettings,
  TextureOptions,
  TextureResizeMode,
  TextureState,
  TextureType,
  TimingFunction,
  UniformWriter,
  UpdateNode,
  Viewport,
  WebGlShaderType,
  clearFontPrefetch,
  frameTimeBucketIndex,
  frameTimeBucketLowerBound,
  isTextureError,
  normalizeBoundsMargin,
  prefetchFont,
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
  HashRouterConfig,
  KeepAliveElement,
} from '@solidtv/solid/primitives/router';

// @solidtv/solid/devtools (1).
export type { HexColorTransformOptions } from '@solidtv/solid/devtools';
