import { describe, it, expect, beforeEach } from 'vitest';
import speak from '../src/primitives/announcer/speech.ts';

const ARIA_PARENT_ID = 'aria-parent';

function ariaParent(): HTMLElement | null {
  return document.getElementById(ARIA_PARENT_ID);
}

function ariaLabels(): string[] {
  const parent = ariaParent();
  if (!parent) return [];
  return Array.from(parent.querySelectorAll('span')).map(
    (span) => span.getAttribute('aria-label') ?? '',
  );
}

describe('Announcer aria mode (replace-on-next-write)', () => {
  beforeEach(() => {
    // Start each test from a clean DOM. The aria region is a module-level
    // singleton appended to <body>, so reset it explicitly.
    ariaParent()?.remove();
  });

  it('injects the label into the assertive live region', async () => {
    await speak(['Hello', 'button'], true).series;

    const parent = ariaParent();
    expect(parent).toBeTruthy();
    expect(parent!.getAttribute('aria-live')).toBe('assertive');

    const labels = ariaLabels();
    expect(labels.length).toBe(1);
    expect(labels[0]).toContain('Hello');
    expect(labels[0]).toContain('button');
  });

  it('leaves the label in place well past the old 100ms teardown window', async () => {
    await speak(['Persisted label'], true).series;
    expect(ariaLabels()[0]).toContain('Persisted label');

    // The previous implementation deleted the nodes after 100ms, so an
    // on-device screen reader never got to read them. Verify they survive.
    await new Promise((resolve) => setTimeout(resolve, 150));

    expect(ariaLabels().length).toBe(1);
    expect(ariaLabels()[0]).toContain('Persisted label');
  });

  it('replaces the previous label on the next announcement', async () => {
    await speak(['First message'], true).series;
    expect(ariaLabels()[0]).toContain('First message');

    await speak(['Second message'], true).series;

    const labels = ariaLabels();
    expect(labels.length).toBe(1);
    expect(labels[0]).toContain('Second message');
    expect(labels[0]).not.toContain('First message');
  });

  it('does not wipe the live region when a follow-up series is canceled', async () => {
    await speak(['Keep me'], true).series;
    expect(ariaLabels()[0]).toContain('Keep me');

    const next = speak(['Should not appear'], true);
    next.cancel();
    await next.series;

    // The canceled series must not blank out the region; the prior label stays
    // until a real announcement replaces it.
    const labels = ariaLabels();
    expect(labels.length).toBe(1);
    expect(labels[0]).toContain('Keep me');
    expect(labels[0]).not.toContain('Should not appear');
  });
});
