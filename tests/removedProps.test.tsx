import { describe, expect, it, vi } from 'vitest';
import nodeOpts from '../src/solidOpts.js';
import './setup.js';

describe('removed 1.x prop names', () => {
  it('w, h and effects warn once per name in dev', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const node = nodeOpts.createElement('view');
      nodeOpts.setProperty(node, 'w', 10);
      nodeOpts.setProperty(node, 'w', 20);
      nodeOpts.setProperty(node, 'h', 10);
      nodeOpts.setProperty(node, 'effects', {});
      nodeOpts.setProperty(node, 'width', 10);
      expect(warn).toHaveBeenCalledTimes(3);
      expect(String(warn.mock.calls[0]![0])).toContain('`width`');
      expect(String(warn.mock.calls[1]![0])).toContain('`height`');
      expect(String(warn.mock.calls[2]![0])).toContain('direct keys');
    } finally {
      warn.mockRestore();
    }
  });
});
