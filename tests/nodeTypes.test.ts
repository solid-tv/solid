// Design 3.6.5: TextNode has no class fields. The package's tsconfig
// targets ESNext, where a class field is emitted as a native field (define
// semantics), which an app's bundler lowers to a `_defineProperty` call per
// field for its Chrome 47 build. Constructor assignments stay plain stores.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { TextNode } from '../src/core/nodeTypes.js';

describe('TextNode', () => {
  it('is emitted without class fields', () => {
    const file = resolve(__dirname, '../src/core/nodeTypes.ts');
    const { outputText } = ts.transpileModule(readFileSync(file, 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ESNext },
    });
    const body = outputText.slice(outputText.indexOf('class TextNode'));
    expect(body).not.toMatch(/^\s+(_type|parent|text)\s*(=|;)/m);
  });

  it('has its three fields, in order, set in the constructor', () => {
    const node = new TextNode('a');
    expect(Object.keys(node)).toEqual(['_type', 'parent', 'text']);
    expect(node._type).toBe('text');
    expect(node.parent).toBeUndefined();
    expect(node.text).toBe('a');
  });
});
