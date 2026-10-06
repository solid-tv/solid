// Renderer 1.x bootstrap (arm A): the engines are passed in, and shader
// types register on the stage's shader manager, as solid-demo-app does on 1.9.
import { SdfTextRenderer, WebGlCoreRenderer } from '@solidtv/renderer/webgl';
import {
  HolePunch,
  LinearGradient,
  RadialGradient,
  Rounded,
  RoundedWithBorder,
  RoundedWithBorderAndShadow,
  RoundedWithShadow,
} from '@solidtv/renderer/webgl/shaders';

export const rendererMajor = 1;

export function rendererOptions<T extends object>(base: T): T {
  return {
    ...base,
    renderEngine: WebGlCoreRenderer,
    fontEngines: [SdfTextRenderer],
  };
}

const shaderTypes = {
  rounded: Rounded,
  roundedWithBorder: RoundedWithBorder,
  roundedWithShadow: RoundedWithShadow,
  roundedWithBorderWithShadow: RoundedWithBorderAndShadow,
  radialGradient: RadialGradient,
  linearGradient: LinearGradient,
  holePunch: HolePunch,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function registerShaders(renderer: any): void {
  const shManager = renderer.stage.shManager;
  for (const name in shaderTypes) {
    shManager.registerShaderType(
      name,
      shaderTypes[name as keyof typeof shaderTypes],
    );
  }
}
