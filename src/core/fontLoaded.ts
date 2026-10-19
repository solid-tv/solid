// A font loaded through loadFonts() (renderer.ts): Solid's text
// measurement (node/postMutation.ts) measures again the texts that waited for
// their font, including those no renderer walk visits (under a hidden or
// out-of-bounds ancestor), which hear no `loaded`. Internal: this module is
// not re-exported, so neither name is part of the package's API.

let listener: (() => void) | undefined;

/** postMutation.ts: what to run when a font has loaded. */
export function onFontLoaded(fn: () => void): void {
  listener = fn;
}

/** renderer.ts: a font passed to loadFonts() has loaded. */
export function fontLoaded(): void {
  if (listener !== undefined) {
    listener();
  }
}

/**
 * renderer.ts: a font passed to loadFonts() failed for good. The texts
 * that waited are measured again (one whose font is still missing waits
 * again; a destroyed one is dropped), and the failure goes on to the caller.
 */
export function fontFailed(error: unknown): never {
  fontLoaded();
  throw error;
}
