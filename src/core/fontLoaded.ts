// A font loaded through loadFonts() (lightningInit.ts): Solid's text
// measurement (elementNode.ts) measures again the texts that waited for
// their font, including those no renderer walk visits (under a hidden or
// out-of-bounds ancestor), which hear no `loaded`. Internal: this module is
// not re-exported, so neither name is part of the package's API.

let listener: (() => void) | undefined;

/** elementNode.ts: what to run when a font has loaded. */
export function onFontLoaded(fn: () => void): void {
  listener = fn;
}

/** lightningInit.ts: a font passed to loadFonts() has loaded. */
export function fontLoaded(): void {
  if (listener !== undefined) {
    listener();
  }
}
