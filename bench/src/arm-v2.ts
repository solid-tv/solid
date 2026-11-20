// Renderer 2.x bootstrap (arms B and C): WebGL and SDF text only, and shader
// types register on the renderer, as solid-demo-app-2.0.patch does.
import {
  HolePunch,
  LinearGradient,
  RadialGradient,
  Rounded,
  RoundedWithBorder,
  RoundedWithBorderAndShadow,
  RoundedWithShadow,
} from '@solidtv/renderer/webgl/shaders';

export const rendererMajor = 2;

export function rendererOptions<T extends object>(base: T): T {
  return base;
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
  for (const name in shaderTypes) {
    renderer.registerShaderType(
      name,
      shaderTypes[name as keyof typeof shaderTypes],
    );
  }
}
