// Design 3.6.5: TextNode has no class fields. The package's tsconfig
// targets ESNext, where a class field is emitted as a native field (define
// semantics), which an app's bundler lowers to a `_defineProperty` call per
// field for its Chrome 47 build. Constructor assignments stay plain stores.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TextNode } from '../src/core/nodeTypes.js';

describe('TextNode', () => {
  it('is emitted without class fields', () => {
    // TypeScript 7 has no in-process transpile API, so emit this one file
    // with the tsc CLI (no type check, imports left unresolved).
    const outDir = mkdtempSync(join(tmpdir(), 'nodeTypes-'));
    try {
      execFileSync(process.execPath, [
        resolve(__dirname, '../node_modules/typescript/bin/tsc'),
        resolve(__dirname, '../src/core/nodeTypes.ts'),
        '--ignoreConfig',
        '--target',
        'esnext',
        '--noCheck',
        '--noResolve',
        '--rootDir',
        resolve(__dirname, '../src/core'),
        '--outDir',
        outDir,
      ]);
      const outputText = readFileSync(join(outDir, 'nodeTypes.js'), 'utf8');
      const body = outputText.slice(outputText.indexOf('class TextNode'));
      expect(body).not.toMatch(/^\s+(_type|parent|text)\s*(=|;)/m);
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it('has its three fields, in order, set in the constructor', () => {
    const node = new TextNode('a');
    expect(Object.keys(node)).toEqual(['_type', 'parent', 'text']);
    expect(node._type).toBe('text');
    expect(node.parent).toBeUndefined();
    expect(node.text).toBe('a');
  });
});
