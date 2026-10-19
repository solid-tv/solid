// Renderer 2.x bootstrap (both arms): the renderer picks its engines itself
// and the shaders are the framework's own (src/core/shaders.ts), so there is
// nothing to pass in or register.
export const rendererMajor = 2;

export function rendererOptions<T extends object>(base: T): T {
  return base;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars
export function registerShaders(_renderer: any): void {}
