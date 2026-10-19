import type { TextureOptions } from '@solidtv/renderer';

/**
 * The numeric props an ElementNode keeps in the renderer's store (spec 5.1):
 * what `setNow` writes and what `DEFAULT` holds a value for.
 */
export type StoreProp =
  | 'x'
  | 'y'
  | 'width'
  | 'height'
  | 'alpha'
  | 'scale'
  | 'scaleX'
  | 'scaleY'
  | 'rotation'
  | 'mount'
  | 'mountX'
  | 'mountY'
  | 'pivot'
  | 'pivotX'
  | 'pivotY'
  | 'zIndex'
  | 'color'
  | 'colorTop'
  | 'colorBottom'
  | 'colorLeft'
  | 'colorRight'
  | 'colorTl'
  | 'colorTr'
  | 'colorBl'
  | 'colorBr'
  | 'placeholderColor';

/**
 * The numeric text props (TextState fields), which the renderer's animation
 * setter track writes through `writeProp` and `setNow` lands in the state.
 */
export type TextNumberProp =
  | 'fontSize'
  | 'lineHeight'
  | 'maxWidth'
  | 'maxHeight'
  | 'maxLines'
  | 'letterSpacing'
  | 'offsetY';

// `_set` indexes (spec 5.3): one byte per prop, 1 once the app wrote it
// through its accessor. Store props first, in StoreProp order, then the
// store-backed props that are not numbers. Later props take SET_COUNT and
// bump it.
export const SET_X = 0;
export const SET_Y = 1;
export const SET_WIDTH = 2;
export const SET_HEIGHT = 3;
export const SET_ALPHA = 4;
export const SET_SCALE = 5;
export const SET_SCALE_X = 6;
export const SET_SCALE_Y = 7;
export const SET_ROTATION = 8;
export const SET_MOUNT = 9;
export const SET_MOUNT_X = 10;
export const SET_MOUNT_Y = 11;
export const SET_PIVOT = 12;
export const SET_PIVOT_X = 13;
export const SET_PIVOT_Y = 14;
export const SET_Z_INDEX = 15;
export const SET_COLOR = 16;
export const SET_COLOR_TOP = 17;
export const SET_COLOR_BOTTOM = 18;
export const SET_COLOR_LEFT = 19;
export const SET_COLOR_RIGHT = 20;
export const SET_COLOR_TL = 21;
export const SET_COLOR_TR = 22;
export const SET_COLOR_BL = 23;
export const SET_COLOR_BR = 24;
export const SET_PLACEHOLDER_COLOR = 25;
export const SET_CLIPPING = 26;
export const SET_RTL = 27;
export const SET_DATA = 28;
export const SET_SRC = 29;
export const SET_TEXTURE = 30;
export const SET_TEXTURE_OPTIONS = 31;
// The text props (Task 4), in the order of their accessors.
export const SET_TEXT = 32;
export const SET_FONT_FAMILY = 33;
export const SET_FONT_WEIGHT = 34;
export const SET_FONT_SIZE = 35;
export const SET_FONT_STYLE = 36;
export const SET_LINE_HEIGHT = 37;
export const SET_TEXT_ALIGN = 38;
export const SET_VERTICAL_ALIGN = 39;
export const SET_CONTAIN = 40;
export const SET_MAX_WIDTH = 41;
export const SET_MAX_HEIGHT = 42;
export const SET_MAX_LINES = 43;
export const SET_OVERFLOW_SUFFIX = 44;
export const SET_WORD_BREAK = 45;
export const SET_LETTER_SPACING = 46;
export const SET_OFFSET_Y = 47;
export const SET_FORCE_LOAD = 48;
// The shader props (Task 5), in the order of their accessors. `rounded` is
// the alias of `borderRadius` and shares its byte.
export const SET_BORDER = 49;
export const SET_BORDER_TOP = 50;
export const SET_BORDER_RIGHT = 51;
export const SET_BORDER_BOTTOM = 52;
export const SET_BORDER_LEFT = 53;
export const SET_SHADOW = 54;
export const SET_BORDER_RADIUS = 55;
export const SET_LINEAR_GRADIENT = 56;
export const SET_RADIAL_GRADIENT = 57;
export const SET_HOLE_PUNCH = 58;
export const SET_SHADER = 59;
/** The length of a node's `_set`. */
export const SET_COUNT = 60;

/**
 * What a store prop reads on a destroyed node, and what style undo writes
 * when no theme or style value is left (spec 5.3). The store's own defaults,
 * except `color`: Solid's default is transparent, not the store's white.
 */
export const DEFAULT: Readonly<Record<StoreProp, number>> = Object.freeze({
  x: 0,
  y: 0,
  width: 0,
  height: 0,
  alpha: 1,
  scale: 1,
  scaleX: 1,
  scaleY: 1,
  rotation: 0,
  mount: 0,
  mountX: 0,
  mountY: 0,
  pivot: 0.5,
  pivotX: 0.5,
  pivotY: 0.5,
  zIndex: 0,
  color: 0x00000000,
  colorTop: 0x00000000,
  colorBottom: 0x00000000,
  colorLeft: 0x00000000,
  colorRight: 0x00000000,
  colorTl: 0x00000000,
  colorTr: 0x00000000,
  colorBl: 0x00000000,
  colorBr: 0x00000000,
  placeholderColor: 0x00000000,
});

/**
 * `textureOptions` with none set or on a destroyed node: one shared frozen
 * object, so `node.textureOptions.resizeMode` never throws (the renderer
 * handle's rule).
 */
export const EMPTY_TEXTURE_OPTIONS: TextureOptions = Object.freeze({});
