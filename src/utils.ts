import { isInteger, type Styles } from './core/index.js';
import { Accessor, createMemo } from 'solid-js';

const WEBGL_CONTEXT_IDS = [
  'webgl2',
  'webgl',
  'experimental-webgl2',
  'experimental-webgl',
];
// WebGL support never changes during a page's lifetime, so each distinct id
// list is probed exactly once and the result is cached forever. This is
// load-bearing on embedded TV boxes: every probe call creates a real WebGL
// context, and those boxes cap live contexts very low. Probing repeatedly (the
// old behavior bypassed the cache for any non-default argument) creates a new
// context each time, blows the page's context budget, and evicts the oldest
// context — the live render context — which then fails every createTexture.
const supportedWebglVersions = new Map<string, string[]>();

/**
 * Converts a color string to a color number value.
 */
export function hexColor(color: string | number = ''): number {
  if (isInteger(color)) {
    return color;
  }

  if (typeof color === 'string') {
    // Renderer expects RGBA values
    let hex: string;
    if (color.charCodeAt(0) === 35 /* '#' */) {
      hex = color.length === 7 ? color.slice(1) + 'ff' : color.slice(1);
    } else if (
      color.charCodeAt(0) === 48 &&
      color.charCodeAt(1) === 120 /* '0x' */
    ) {
      hex = color.slice(2);
    } else {
      hex = color.length === 6 ? color + 'ff' : color;
    }
    return parseInt(hex, 16);
  }

  return 0x00000000;
}

export function combineStyles<T extends Styles>(
  style1: T | undefined,
  style2: T | undefined,
): T {
  if (!style1) {
    return style2!;
  }

  if (!style2) {
    return style1;
  }

  return {
    ...style2,
    ...style1,
  };
}

export function combineStylesMemo<T extends Styles>(
  style1: T | undefined,
  style2: T | undefined,
): Accessor<T> {
  if (!style1) {
    return () => style2!;
  }

  if (!style2) {
    return () => style1;
  }

  return createMemo(() => ({
    ...style2,
    ...style1,
  }));
}

export const clamp = (value: number, min: number, max: number) =>
  min < max
    ? Math.min(Math.max(value, min), max)
    : Math.min(Math.max(value, max), min);

export function mod(n: number, m: number): number {
  if (m === 0) return 0;
  return ((n % m) + m) % m;
}

/**
 * Identifies which versions of WebGL are supported, based on the input list of WebGL context IDs.
 * @param webglContextIds List of WebGL context IDs to check. Some common values are "webgl", "webgl2", "experimental-webgl", "experimental-webgl2".
 * @returns List of WebGL context IDs that are supported by the client.
 */
export function getWebglSupportedVersions(
  webglContextIds: string[] = WEBGL_CONTEXT_IDS,
): string[] {
  // Cache per distinct id list. The previous version only cached the default
  // list, so any caller passing its own array re-probed (and re-created a
  // context) on every call — see the comment on `supportedWebglVersions`.
  const cacheKey = webglContextIds.join('|');
  const cached = supportedWebglVersions.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  const cv = document.createElement('canvas');
  // A canvas locks to the first context type it hands out, so probing several
  // ids on one canvas yields at most one live context. Capture it so we can
  // release it below.
  let probeContext: RenderingContext | null = null;
  const supports = webglContextIds.filter((id) => {
    try {
      const context = cv.getContext(id);
      if (context !== null && probeContext === null) {
        probeContext = context;
      }
      return !!(
        context &&
        (context instanceof WebGLRenderingContext ||
          context instanceof WebGL2RenderingContext ||
          ('getParameter' in context &&
            typeof context.getParameter === 'function'))
      );
    } catch {
      return false;
    }
  });

  // Free the probe context immediately instead of leaking it until GC. Embedded
  // TV browsers cap live WebGL contexts very low; a lingering probe burns one of
  // those scarce slots and can trigger "too many active webgl contexts" — which
  // evicts the oldest context (potentially the live render context). Guard with
  // isContextLost(): if the browser already evicted this probe, loseContext()
  // throws INVALID_OPERATION ("context already lost") and spams the console.
  const probe = probeContext as RenderingContext | null;
  if (
    probe !== null &&
    'getExtension' in probe &&
    (probe as WebGLRenderingContext).isContextLost() === false
  ) {
    (probe as WebGLRenderingContext)
      .getExtension('WEBGL_lose_context')
      ?.loseContext();
  }

  supportedWebglVersions.set(cacheKey, supports);

  return supports;
}

export const supportsWebGL = (webGLSupportedVersion: string[]): boolean =>
  ['webgl', 'experimental-webgl', 'webgl2'].some((ver) =>
    webGLSupportedVersion.includes(ver),
  );

export const supportsWebGL2 = (webGLSupportedVersion: string[]): boolean =>
  webGLSupportedVersion.includes('webgl2');

export const supportsOnlyWebGL2 = (webGLSupportedVersion: string[]): boolean =>
  webGLSupportedVersion.includes('webgl2') &&
  !webGLSupportedVersion.includes('webgl') &&
  !webGLSupportedVersion.includes('experimental-webgl');
