/// <reference types="vite/client" />

declare global {
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
