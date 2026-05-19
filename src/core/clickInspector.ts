import { Config, isDev } from './config.js';
import { isElementNode } from './utils.js';
import type { ElementNode } from './elementNode.js';
import { IRendererNode } from './dom-renderer/domRendererTypes.js';

let installed = false;

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
      const cx = (child.lng.absX as number) || 0;
      const cy = (child.lng.absY as number) || 0;
      const cw = child.width || 0;
      const ch = child.height || 0;
      if (px < cx || px > cx + cw || py < cy || py > cy + ch) continue;
      const z = child.zIndex ?? -1;
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
  if (!event.altKey) return;
  let target = event.target as HTMLElement | null;
  while (target && !target.element) {
    target = target.parentElement;
  }
  const hit = target?.element;
  if (!hit) return;
  let root = hit;
  while (root.parent) root = root.parent;
  const el = findDeepestAtPosition(root, event.clientX, event.clientY);
  event.preventDefault();
  event.stopPropagation();
  const lng = el.lng as IRendererNode;
  const label = el.componentName || el._type;
  const loc = el.componentLocation ? ` @ ${el.componentLocation}` : '';
  console.log(
    `%c[SolidTV Inspector] %c${label}${loc}`,
    'color: magenta; font-weight: bold;',
    'color: inherit; font-weight: normal;',
    {
      element: el,
      div: lng.div,
      lng,
      states: el._states ? Array.from(el._states) : [],
      position: { x: lng?.x, y: lng?.y, w: lng?.w, h: lng?.h },
      parent: el.parent,
      children: el.children,
    },
  );
  (globalThis as any).$el = el;
  console.log('Pinned to $el — try $el.parent, $el.setFocus()');
}

export function initClickInspector(): void {
  if (installed || !isDev || typeof document === 'undefined') return;
  installed = true;
  document.addEventListener('click', handleClick, true);
}
