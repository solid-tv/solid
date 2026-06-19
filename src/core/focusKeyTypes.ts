import { ElementNode } from './elementNode.js';

// Focus + KeyHandling Types
export interface FocusNode {
  onFocus?: (
    this: ElementNode,
    currentFocusedElm: ElementNode,
    prevFocusedElm: ElementNode | undefined,
    nodeWithCallback: ElementNode,
  ) => void;
  onFocusChanged?: (
    this: ElementNode,
    hasFocus: boolean,
    currentFocusedElm: ElementNode,
    prevFocusedElm: ElementNode | undefined,
    nodeWithCallback: ElementNode,
  ) => void;
  onBlur?: (
    this: ElementNode,
    currentFocusedElm: ElementNode,
    prevFocusedElm: ElementNode,
    nodeWithCallback: ElementNode,
  ) => void;
  onKeyPress?: (
    this: ElementNode,
    e: KeyboardEvent,
    mappedKeyEvent: string | undefined,
    handlerElm: ElementNode,
    currentFocusedElm: ElementNode,
  ) => KeyHandlerReturn;
  onKeyHold?: (
    this: ElementNode,
    e: KeyboardEvent,
    mappedKeyEvent: string | undefined,
    handlerElm: ElementNode,
    currentFocusedElm: ElementNode,
  ) => KeyHandlerReturn;
}

export type KeyNameOrKeyCode = string | number;

export interface DefaultKeyMap {
  Left: KeyNameOrKeyCode | KeyNameOrKeyCode[] | null;
  Right: KeyNameOrKeyCode | KeyNameOrKeyCode[] | null;
  Up: KeyNameOrKeyCode | KeyNameOrKeyCode[] | null;
  Down: KeyNameOrKeyCode | KeyNameOrKeyCode[] | null;
  Enter: KeyNameOrKeyCode | KeyNameOrKeyCode[] | null;
  Last: KeyNameOrKeyCode | KeyNameOrKeyCode[] | null;
}

export interface KeyMap extends DefaultKeyMap {
  [key: string]: KeyNameOrKeyCode | KeyNameOrKeyCode[] | null;
}

export interface DefaultKeyHoldMap {
  EnterHold: KeyNameOrKeyCode | KeyNameOrKeyCode[] | null;
}

export type EventHandlers<Map> = {
  [K in keyof Map as `on${Capitalize<string & K>}`]?: KeyHandler;
} & {
  [K in keyof Map as `on${Capitalize<string & K>}Release`]?: KeyHandler;
} & {
  [K in keyof Map as `onCapture${Capitalize<string & K>}`]?: KeyHandler;
} & {
  onCaptureKey?: KeyHandler;
  onCaptureKeyRelease?: KeyHandler;
};

export interface KeyHoldMap extends DefaultKeyHoldMap {}

export type KeyHandlerReturn = boolean | void;

export type KeyHandler = (
  this: ElementNode,
  e: KeyboardEvent,
  target: ElementNode,
  handlerElm: ElementNode,
  mappedEvent?: string,
) => KeyHandlerReturn;

export type ForwardFocusHandler = (
  this: ElementNode,
  elm: ElementNode,
) => boolean | void;

export type KeyHoldOptions = {
  userKeyHoldMap: Partial<KeyHoldMap>;
  holdThreshold?: number;
};
