/// <reference types="vite/client" />

declare global {
  /** Whether the DOM renderer should be used instead of `@solidtv/renderer` */
  var SOLIDTV_DOM_RENDERING: boolean | undefined;
  /** Whether element shaders should be disabled */
  var SOLIDTV_DISABLE_SHADERS: boolean | undefined;
}

interface ImportMetaEnv {
  readonly __DEV__: boolean;
  readonly DEV: boolean;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

export {};
