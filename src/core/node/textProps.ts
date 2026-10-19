import {
  NULL,
  reboxText,
  relayoutText,
  textStateOf,
  TextState,
  type TextAlign,
  type TextContain,
  type TextFontStyle,
  type TextProps,
  type TextVerticalAlign,
  type TextWordBreak,
} from '@solidtv/renderer';
import { Config } from '../config.js';
import { NodeType } from '../nodeTypes.js';
import type { ElementNode } from './ElementNode.js';
import {
  SET_CONTAIN,
  SET_FONT_FAMILY,
  SET_FONT_SIZE,
  SET_FONT_STYLE,
  SET_FONT_WEIGHT,
  SET_FORCE_LOAD,
  SET_LETTER_SPACING,
  SET_LINE_HEIGHT,
  SET_MAX_HEIGHT,
  SET_MAX_LINES,
  SET_MAX_WIDTH,
  SET_OFFSET_Y,
  SET_OVERFLOW_SUFFIX,
  SET_TEXT,
  SET_TEXT_ALIGN,
  SET_VERTICAL_ALIGN,
  SET_WORD_BREAK,
  SET_HEIGHT,
  SET_WIDTH,
  type TextNumberProp,
} from './defaults.js';

// The text props (spec 5.1). On a `<text>` each accessor writes the
// renderer's TextState (`core.nodes.texts[slot]`) and tells the renderer what
// the write changes: `relayoutText` for a prop the layout reads, `reboxText`
// for a prop that only places the block (contain, verticalAlign, offsetY).
// On a `<view>` they land in `_textProps` and draw nothing (B20). Every
// setter returns on a destroyed node and records the write in `_set`, on
// both kinds. An `undefined` write is the renderer's default for the prop,
// as the renderer's TextNode setters have it (a style undo writes it).
//
// Written out, one accessor per prop, for the same reason as accessors.ts:
// each keeps its own inline cache and no keyed store goes through one site.

/** The TextState defaults: what a view reads for a text prop it never set. */
const DEFAULTS = new TextState();

/** A text prop of a `<view>`: what was written, else the default. */
function viewGet<K extends keyof TextProps>(
  node: ElementNode,
  key: K,
): TextProps[K] {
  const bag = node._textProps;
  if (bag !== undefined) {
    const v = bag[key];
    if (v !== undefined) {
      // _textProps holds what viewSet stored under this key: a TextProps[K].
      return v as TextProps[K];
    }
  }
  return DEFAULTS[key];
}

/** Write a text prop of a `<view>`; the first write makes the bag. */
function viewSet(node: ElementNode, key: string, v: unknown): void {
  let bag = node._textProps;
  if (bag === undefined) {
    bag = {};
    node._textProps = bag;
  }
  bag[key] = v;
}

/**
 * The family text with the template's weight, for a text that sets no
 * family of its own: `Config.fontSettings`' family and weight.
 */
export function templateFontFamily(): string | undefined {
  const fs = Config.fontSettings;
  return fs.fontFamily === undefined
    ? undefined
    : `${fs.fontFamily}${fs.fontWeight || ''}`;
}

/**
 * The renderer's family name from `fontFamily` and `fontWeight`, resolved in
 * one place so either JSX order gives the same name (B17). A weight makes
 * `<family or the template's><weight, aliased by Config.fontWeightAlias>`;
 * with none, the family as written. With neither family nor weight, an
 * attached text takes the template's family; one not attached yet keeps the
 * renderer's default, for attach to fill in.
 */
function writeFontFamily(node: ElementNode): void {
  const nodes = node.core.nodes;
  const s = node.slot;
  const weight = node._fontWeight;
  let family: string | undefined;
  if (weight === undefined) {
    family = node._fontFamily;
    if (family === undefined && node.rendered) {
      family = templateFontFamily();
    }
  } else {
    const alias = Config.fontWeightAlias;
    const aliased =
      alias !== undefined && alias !== null ? alias[weight] : undefined;
    const own = node._fontFamily;
    const fs = Config.fontSettings;
    family = `${own || fs.fontFamily}${aliased === undefined ? weight : aliased}`;
  }
  if (family === undefined) {
    family = DEFAULTS.fontFamily;
  }
  const t = textStateOf(nodes, s);
  if (t.fontFamily === family) {
    return;
  }
  t.fontFamily = family;
  relayoutText(nodes, s);
}

/**
 * Write a numeric text prop now: what the animation's setter track writes
 * through `writeProp` and `setNow` lands here. Only a `<text>` has a state to
 * write; no `_set` byte, no transition.
 */
export function writeTextNumber(
  node: ElementNode,
  name: TextNumberProp,
  value: number,
): void {
  const s = node.slot;
  if (s === NULL || node._type !== NodeType.TextNode) {
    return;
  }
  const nodes = node.core.nodes;
  const t = textStateOf(nodes, s);
  switch (name) {
    case 'fontSize':
      t.fontSize = value;
      break;
    case 'lineHeight':
      t.lineHeight = value;
      break;
    case 'maxWidth':
      t.maxWidth = value;
      break;
    case 'maxHeight':
      t.maxHeight = value;
      break;
    case 'maxLines':
      t.maxLines = value;
      break;
    case 'letterSpacing':
      t.letterSpacing = value;
      break;
    case 'offsetY':
      t.offsetY = value;
      reboxText(nodes, s);
      return;
  }
  relayoutText(nodes, s);
}

/**
 * Attach's step for the size a `<text>` was given before it was attached:
 * `width` and `height` written then were stored as the node's own size
 * (writeTextWidth); this makes them `maxWidth` and `maxHeight`, which is what
 * they mean on an attached text. Call it once, before the node's `rendered`
 * is set.
 */
export function applyTextSizeAtAttach(node: ElementNode): void {
  const s = node.slot;
  if (s === NULL) {
    return;
  }
  const nodes = node.core.nodes;
  const t = textStateOf(nodes, s);
  const set = node._set;
  let changed = false;
  if (set[SET_WIDTH] === 1) {
    const w = node.width;
    if (w !== 0 && t.maxWidth !== w) {
      t.maxWidth = w;
      changed = true;
    }
  }
  if (set[SET_HEIGHT] === 1) {
    const h = node.height;
    if (h !== 0 && t.maxHeight !== h) {
      t.maxHeight = h;
      changed = true;
    }
  }
  if (changed) {
    relayoutText(nodes, s);
  }
}

/**
 * Install the text accessors on `proto` (ElementNode.prototype), and
 * `measureText`/`getText`.
 */
export function installTextAccessors(proto: ElementNode): void {
  Object.defineProperties(proto, {
    text: {
      get(this: ElementNode): string {
        return this._type === NodeType.TextNode
          ? textStateOf(this.core.nodes, this.slot).text
          : viewGet(this, 'text');
      },
      set(this: ElementNode, v: string | undefined) {
        const s = this.slot;
        if (s === NULL) {
          return;
        }
        this._set[SET_TEXT] = 1;
        if (this._type !== NodeType.TextNode) {
          viewSet(this, 'text', v);
          return;
        }
        const nodes = this.core.nodes;
        const t = textStateOf(nodes, s);
        if (v === undefined) {
          v = DEFAULTS.text;
        }
        if (t.text === v) {
          return;
        }
        t.text = v;
        relayoutText(nodes, s);
      },
    },

    fontSize: {
      get(this: ElementNode): number {
        return this._type === NodeType.TextNode
          ? textStateOf(this.core.nodes, this.slot).fontSize
          : viewGet(this, 'fontSize');
      },
      set(this: ElementNode, v: number | undefined) {
        const s = this.slot;
        if (s === NULL) {
          return;
        }
        this._set[SET_FONT_SIZE] = 1;
        if (this._type !== NodeType.TextNode) {
          viewSet(this, 'fontSize', v);
          return;
        }
        const nodes = this.core.nodes;
        const t = textStateOf(nodes, s);
        if (v === undefined) {
          v = DEFAULTS.fontSize;
        }
        if (t.fontSize === v) {
          return;
        }
        t.fontSize = v;
        relayoutText(nodes, s);
      },
    },

    fontStyle: {
      get(this: ElementNode): TextFontStyle {
        return this._type === NodeType.TextNode
          ? textStateOf(this.core.nodes, this.slot).fontStyle
          : viewGet(this, 'fontStyle');
      },
      set(this: ElementNode, v: TextFontStyle | undefined) {
        const s = this.slot;
        if (s === NULL) {
          return;
        }
        this._set[SET_FONT_STYLE] = 1;
        if (this._type !== NodeType.TextNode) {
          viewSet(this, 'fontStyle', v);
          return;
        }
        const nodes = this.core.nodes;
        const t = textStateOf(nodes, s);
        if (v === undefined) {
          v = DEFAULTS.fontStyle;
        }
        if (t.fontStyle === v) {
          return;
        }
        t.fontStyle = v;
        relayoutText(nodes, s);
      },
    },

    lineHeight: {
      get(this: ElementNode): number {
        return this._type === NodeType.TextNode
          ? textStateOf(this.core.nodes, this.slot).lineHeight
          : viewGet(this, 'lineHeight');
      },
      set(this: ElementNode, v: number | undefined) {
        const s = this.slot;
        if (s === NULL) {
          return;
        }
        this._set[SET_LINE_HEIGHT] = 1;
        if (this._type !== NodeType.TextNode) {
          viewSet(this, 'lineHeight', v);
          return;
        }
        const nodes = this.core.nodes;
        const t = textStateOf(nodes, s);
        if (v === undefined) {
          v = DEFAULTS.lineHeight;
        }
        if (t.lineHeight === v) {
          return;
        }
        t.lineHeight = v;
        relayoutText(nodes, s);
      },
    },

    textAlign: {
      get(this: ElementNode): TextAlign {
        return this._type === NodeType.TextNode
          ? textStateOf(this.core.nodes, this.slot).textAlign
          : viewGet(this, 'textAlign');
      },
      set(this: ElementNode, v: TextAlign | undefined) {
        const s = this.slot;
        if (s === NULL) {
          return;
        }
        this._set[SET_TEXT_ALIGN] = 1;
        if (this._type !== NodeType.TextNode) {
          viewSet(this, 'textAlign', v);
          return;
        }
        const nodes = this.core.nodes;
        const t = textStateOf(nodes, s);
        if (v === undefined) {
          v = DEFAULTS.textAlign;
        }
        if (t.textAlign === v) {
          return;
        }
        t.textAlign = v;
        relayoutText(nodes, s);
      },
    },

    verticalAlign: {
      get(this: ElementNode): TextVerticalAlign {
        return this._type === NodeType.TextNode
          ? textStateOf(this.core.nodes, this.slot).verticalAlign
          : viewGet(this, 'verticalAlign');
      },
      set(this: ElementNode, v: TextVerticalAlign | undefined) {
        const s = this.slot;
        if (s === NULL) {
          return;
        }
        this._set[SET_VERTICAL_ALIGN] = 1;
        if (this._type !== NodeType.TextNode) {
          viewSet(this, 'verticalAlign', v);
          return;
        }
        const nodes = this.core.nodes;
        const t = textStateOf(nodes, s);
        if (v === undefined) {
          v = DEFAULTS.verticalAlign;
        }
        if (t.verticalAlign === v) {
          return;
        }
        t.verticalAlign = v;
        reboxText(nodes, s);
      },
    },

    contain: {
      get(this: ElementNode): TextContain {
        return this._type === NodeType.TextNode
          ? textStateOf(this.core.nodes, this.slot).contain
          : viewGet(this, 'contain');
      },
      set(this: ElementNode, v: TextContain | undefined) {
        const s = this.slot;
        if (s === NULL) {
          return;
        }
        this._set[SET_CONTAIN] = 1;
        if (this._type !== NodeType.TextNode) {
          viewSet(this, 'contain', v);
          return;
        }
        const nodes = this.core.nodes;
        const t = textStateOf(nodes, s);
        if (v === undefined) {
          v = DEFAULTS.contain;
        }
        if (t.contain === v) {
          return;
        }
        t.contain = v;
        reboxText(nodes, s);
      },
    },

    maxWidth: {
      get(this: ElementNode): number {
        return this._type === NodeType.TextNode
          ? textStateOf(this.core.nodes, this.slot).maxWidth
          : viewGet(this, 'maxWidth');
      },
      set(this: ElementNode, v: number | undefined) {
        const s = this.slot;
        if (s === NULL) {
          return;
        }
        this._set[SET_MAX_WIDTH] = 1;
        if (this._type !== NodeType.TextNode) {
          viewSet(this, 'maxWidth', v);
          return;
        }
        const nodes = this.core.nodes;
        const t = textStateOf(nodes, s);
        if (v === undefined) {
          v = DEFAULTS.maxWidth;
        }
        if (t.maxWidth === v) {
          return;
        }
        t.maxWidth = v;
        relayoutText(nodes, s);
      },
    },

    maxHeight: {
      get(this: ElementNode): number {
        return this._type === NodeType.TextNode
          ? textStateOf(this.core.nodes, this.slot).maxHeight
          : viewGet(this, 'maxHeight');
      },
      set(this: ElementNode, v: number | undefined) {
        const s = this.slot;
        if (s === NULL) {
          return;
        }
        this._set[SET_MAX_HEIGHT] = 1;
        if (this._type !== NodeType.TextNode) {
          viewSet(this, 'maxHeight', v);
          return;
        }
        const nodes = this.core.nodes;
        const t = textStateOf(nodes, s);
        if (v === undefined) {
          v = DEFAULTS.maxHeight;
        }
        if (t.maxHeight === v) {
          return;
        }
        t.maxHeight = v;
        relayoutText(nodes, s);
      },
    },

    maxLines: {
      get(this: ElementNode): number {
        return this._type === NodeType.TextNode
          ? textStateOf(this.core.nodes, this.slot).maxLines
          : viewGet(this, 'maxLines');
      },
      set(this: ElementNode, v: number | undefined) {
        const s = this.slot;
        if (s === NULL) {
          return;
        }
        this._set[SET_MAX_LINES] = 1;
        if (this._type !== NodeType.TextNode) {
          viewSet(this, 'maxLines', v);
          return;
        }
        const nodes = this.core.nodes;
        const t = textStateOf(nodes, s);
        if (v === undefined) {
          v = DEFAULTS.maxLines;
        }
        if (t.maxLines === v) {
          return;
        }
        t.maxLines = v;
        relayoutText(nodes, s);
      },
    },

    overflowSuffix: {
      get(this: ElementNode): string {
        return this._type === NodeType.TextNode
          ? textStateOf(this.core.nodes, this.slot).overflowSuffix
          : viewGet(this, 'overflowSuffix');
      },
      set(this: ElementNode, v: string | undefined) {
        const s = this.slot;
        if (s === NULL) {
          return;
        }
        this._set[SET_OVERFLOW_SUFFIX] = 1;
        if (this._type !== NodeType.TextNode) {
          viewSet(this, 'overflowSuffix', v);
          return;
        }
        const nodes = this.core.nodes;
        const t = textStateOf(nodes, s);
        if (v === undefined) {
          v = DEFAULTS.overflowSuffix;
        }
        if (t.overflowSuffix === v) {
          return;
        }
        t.overflowSuffix = v;
        relayoutText(nodes, s);
      },
    },

    wordBreak: {
      get(this: ElementNode): TextWordBreak {
        return this._type === NodeType.TextNode
          ? textStateOf(this.core.nodes, this.slot).wordBreak
          : viewGet(this, 'wordBreak');
      },
      set(this: ElementNode, v: TextWordBreak | undefined) {
        const s = this.slot;
        if (s === NULL) {
          return;
        }
        this._set[SET_WORD_BREAK] = 1;
        if (this._type !== NodeType.TextNode) {
          viewSet(this, 'wordBreak', v);
          return;
        }
        const nodes = this.core.nodes;
        const t = textStateOf(nodes, s);
        if (v === undefined) {
          v = DEFAULTS.wordBreak;
        }
        if (t.wordBreak === v) {
          return;
        }
        t.wordBreak = v;
        relayoutText(nodes, s);
      },
    },

    letterSpacing: {
      get(this: ElementNode): number {
        return this._type === NodeType.TextNode
          ? textStateOf(this.core.nodes, this.slot).letterSpacing
          : viewGet(this, 'letterSpacing');
      },
      set(this: ElementNode, v: number | undefined) {
        const s = this.slot;
        if (s === NULL) {
          return;
        }
        this._set[SET_LETTER_SPACING] = 1;
        if (this._type !== NodeType.TextNode) {
          viewSet(this, 'letterSpacing', v);
          return;
        }
        const nodes = this.core.nodes;
        const t = textStateOf(nodes, s);
        if (v === undefined) {
          v = DEFAULTS.letterSpacing;
        }
        if (t.letterSpacing === v) {
          return;
        }
        t.letterSpacing = v;
        relayoutText(nodes, s);
      },
    },

    offsetY: {
      get(this: ElementNode): number {
        return this._type === NodeType.TextNode
          ? textStateOf(this.core.nodes, this.slot).offsetY
          : viewGet(this, 'offsetY');
      },
      set(this: ElementNode, v: number | undefined) {
        const s = this.slot;
        if (s === NULL) {
          return;
        }
        this._set[SET_OFFSET_Y] = 1;
        if (this._type !== NodeType.TextNode) {
          viewSet(this, 'offsetY', v);
          return;
        }
        const nodes = this.core.nodes;
        const t = textStateOf(nodes, s);
        if (v === undefined) {
          v = DEFAULTS.offsetY;
        }
        if (t.offsetY === v) {
          return;
        }
        t.offsetY = v;
        reboxText(nodes, s);
      },
    },

    // The family and weight are kept as written (`_fontFamily`,
    // `_fontWeight`) and the state's family is derived from both, so the
    // order of the two writes does not matter (B17).
    fontFamily: {
      get(this: ElementNode): string | undefined {
        return this._fontFamily;
      },
      set(this: ElementNode, v: string | undefined) {
        if (this.slot === NULL) {
          return;
        }
        this._set[SET_FONT_FAMILY] = 1;
        this._fontFamily = v;
        if (this._type === NodeType.TextNode) {
          writeFontFamily(this);
        } else {
          viewSet(this, 'fontFamily', v);
        }
      },
    },
    fontWeight: {
      get(this: ElementNode): number | string | undefined {
        return this._fontWeight;
      },
      set(this: ElementNode, v: number | string | undefined) {
        if (this.slot === NULL) {
          return;
        }
        this._set[SET_FONT_WEIGHT] = 1;
        if (this._fontWeight === v) {
          return;
        }
        this._fontWeight = v;
        if (this._type === NodeType.TextNode) {
          writeFontFamily(this);
        } else {
          viewSet(this, 'fontWeight', v);
        }
      },
    },
    forceLoad: {
      get(this: ElementNode): boolean {
        return this._type === NodeType.TextNode
          ? textStateOf(this.core.nodes, this.slot).forceLoad
          : viewGet(this, 'forceLoad');
      },
      set(this: ElementNode, v: boolean | undefined) {
        const s = this.slot;
        if (s === NULL) {
          return;
        }
        this._set[SET_FORCE_LOAD] = 1;
        if (this._type !== NodeType.TextNode) {
          viewSet(this, 'forceLoad', v);
          return;
        }
        const nodes = this.core.nodes;
        const t = textStateOf(nodes, s);
        const on = v === true;
        if (t.forceLoad === on) {
          return;
        }
        t.forceLoad = on;
        // On, the text lays out wherever it is (TextNodes' forced list).
        this.core.textNodes.force(s, on);
        if (on) {
          reboxText(nodes, s);
        }
      },
    },
  });
}
