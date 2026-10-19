import { Config } from './config.js';
import { isElementNode } from './utils.js';
import { isDev } from './env.js';
import type { ElementNode } from './node/ElementNode.js';

let installed = false;
/** The attached tree's root, the walk's start. */
let inspectorRoot: ElementNode | undefined;

function findDeepestAtPosition(
  root: ElementNode,
  x: number,
  y: number,
): ElementNode {
  const precision = Config.rendererOptions?.deviceLogicalPixelRatio || 1;
  const px = x / precision;
  const py = y / precision;

  let current = root;
  while (true) {
    let best: ElementNode | undefined;
    let bestZ = -Infinity;
    for (const child of current.children) {
      if (!isElementNode(child) || child.alpha === 0) continue;
      const cx = child.absX;
      const cy = child.absY;
      const cw = child.width || 0;
      const ch = child.height || 0;
      if (px < cx || px > cx + cw || py < cy || py > cy + ch) continue;
      const z = child.zIndex;
      if (z >= bestZ) {
        bestZ = z;
        best = child;
      }
    }
    if (!best) return current;
    current = best;
  }
}

function handleClick(event: MouseEvent) {
  if (!event.altKey || inspectorRoot === undefined) return;
  const el = findDeepestAtPosition(inspectorRoot, event.clientX, event.clientY);
  event.preventDefault();
  event.stopPropagation();
  const label = el.componentName || el._type;
  const loc = el.componentLocation ? ` @ ${el.componentLocation}` : '';
  console.log(
    `%c[SolidTV Inspector] %c${label}${loc}`,
    'color: magenta; font-weight: bold;',
    'color: inherit; font-weight: normal;',
    {
      element: el,
      states: el._states ? Array.from(el._states) : [],
      position: { x: el.x, y: el.y, width: el.width, height: el.height },
      parent: el.parent,
      children: el.children,
    },
  );
  (globalThis as { $el?: ElementNode }).$el = el;
  console.log('Pinned to $el — try $el.parent, $el.setFocus()');
}

/** Alt+click logs the deepest element under the pointer (dev only). */
export function initClickInspector(root: ElementNode): void {
  inspectorRoot = root;
  if (installed || !isDev || typeof document === 'undefined') return;
  installed = true;
  document.addEventListener('click', handleClick, true);
}
