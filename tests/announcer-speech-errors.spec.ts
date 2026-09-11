import { describe, it, expect, afterEach, vi } from 'vitest';
import speak from '../src/primitives/announcer/speech.ts';

// These tests cover the two production crash classes reported from real TV
// hardware:
//
//  A. webOS (Chrome 53) ships no Web Speech API at all, so touching the bare
//     `SpeechSynthesisUtterance` global throws a ReferenceError — even on the
//     aria code path that never intends to speak. jsdom happens to model this
//     platform exactly: it declares neither global, so the "absent API" tests
//     below need no setup.
//  B. Xumo (Safari 11) and Tizen routinely report device-level synthesis
//     failures ("synthesis-failed", "not-allowed", or no code at all). These
//     must not escape as unhandled rejections, because callers hold
//     `SeriesResult.series` without awaiting it.

const ARIA_PARENT_ID = 'aria-parent';

function ariaLabels(): string[] {
  const parent = document.getElementById(ARIA_PARENT_ID);
  if (!parent) return [];
  return Array.from(parent.querySelectorAll('span')).map(
    (span) => span.getAttribute('aria-label') ?? '',
  );
}

type FakeErrorEvent = { error?: string };

class FakeUtterance {
  text: string;
  lang = '';
  voice: unknown = null;
  onend: (() => void) | null = null;
  onerror: ((e: FakeErrorEvent) => void) | null = null;

  constructor(text: string) {
    this.text = text;
  }
}

/**
 * Stand in for a platform that *does* expose the Web Speech API. `onSpeak`
 * decides how the fake engine responds; it receives the utterance and the
 * 1-based attempt number so retry behaviour can be asserted.
 */
function installSpeechEngine(
  onSpeak: (utterance: FakeUtterance, attempt: number) => void,
): FakeUtterance[] {
  const spoken: FakeUtterance[] = [];

  const synth = {
    speak(utterance: FakeUtterance) {
      spoken.push(utterance);
      onSpeak(utterance, spoken.length);
    },
    cancel() {},
    getVoices() {
      return [];
    },
  };

  (globalThis as unknown as Record<string, unknown>).SpeechSynthesisUtterance =
    FakeUtterance;
  (window as unknown as Record<string, unknown>).speechSynthesis = synth;

  return spoken;
}

function failWith(code: string | undefined) {
  return (utterance: FakeUtterance) => {
    if (utterance.onerror) utterance.onerror({ error: code });
  };
}

afterEach(() => {
  // vitest runs with `isolate: false`, so a leaked global would follow us into
  // every other spec file. Put the environment back to a bare webOS-like one.
  delete (globalThis as unknown as Record<string, unknown>)
    .SpeechSynthesisUtterance;
  delete (window as unknown as Record<string, unknown>).speechSynthesis;
  document.getElementById(ARIA_PARENT_ID)?.remove();
  vi.restoreAllMocks();
});

describe('Announcer on a platform without the Web Speech API', () => {
  it('has no Web Speech globals to begin with (the webOS case)', () => {
    expect(
      (globalThis as unknown as Record<string, unknown>)
        .SpeechSynthesisUtterance,
    ).toBeUndefined();
    expect(
      (window as unknown as Record<string, unknown>).speechSynthesis,
    ).toBeUndefined();
  });

  it('runs an aria series containing a non-string phrase to completion', async () => {
    // A function or nested-array phrase reaches the `instanceof
    // SpeechSynthesisUtterance` branch of the dispatch chain. Evaluating that
    // bare global threw a ReferenceError on webOS, taking down the whole
    // announcement even though aria mode never speaks.
    const result = speak([() => ['Nested label'], 'Tail label'], true);

    await expect(result.series).resolves.toBeUndefined();
    expect(ariaLabels()).toEqual(['Nested label', 'Tail label']);
  });

  it('runs a non-aria series to completion, degrading to silence', async () => {
    const result = speak(['No engine here'], false);

    await expect(result.series).resolves.toBeUndefined();
  });

  it('cancels the previous series without throwing into app code', async () => {
    const first = speak(['One'], false);

    // The default export cancels the in-flight series synchronously, which hits
    // `synth.cancel()` on a `window.speechSynthesis` that does not exist.
    expect(() => speak(['Two'], false)).not.toThrow();

    await expect(first.series).resolves.toBeUndefined();
  });
});

describe('Announcer speech error classification', () => {
  it.each(['synthesis-failed', 'not-allowed', undefined])(
    'treats a %s error as benign instead of rejecting',
    async (code) => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const spoken = installSpeechEngine(failWith(code));

      const result = speak(['Hello there'], false);

      await expect(result.series).resolves.toBeUndefined();
      // A refused engine will not change its mind, so no retries.
      expect(spoken.length).toBe(1);
      expect(warn).toHaveBeenCalledTimes(1);
    },
  );

  it.each(['canceled', 'interrupted'])(
    'treats a %s error as benign and silent',
    async (code) => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const spoken = installSpeechEngine(failWith(code));

      const result = speak(['Interrupted phrase'], false);

      await expect(result.series).resolves.toBeUndefined();
      expect(spoken.length).toBe(1);
      expect(warn).not.toHaveBeenCalled();
    },
  );

  it('retries a network error with backoff, then stops', async () => {
    vi.useFakeTimers();
    try {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const spoken = installSpeechEngine(failWith('network'));

      let settled = 'pending';
      const result = speak(['Flaky phrase'], false);
      void result.series.then(
        () => {
          settled = 'resolved';
        },
        () => {
          settled = 'rejected';
        },
      );

      // Backoff is 500ms, 1000ms, 1500ms across the three attempts.
      await vi.advanceTimersByTimeAsync(4000);

      expect(spoken.length).toBe(3);
      expect(settled).toBe('resolved');
      expect(warn).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps speaking the rest of the series after a failed phrase', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const spoken = installSpeechEngine((utterance, attempt) => {
      if (attempt === 1) {
        failWith('synthesis-failed')(utterance);
      } else if (utterance.onend) {
        utterance.onend();
      }
    });

    const result = speak([() => 'First', () => 'Second'], false);

    await expect(result.series).resolves.toBeUndefined();
    expect(spoken.map((utterance) => utterance.text)).toEqual([
      'First',
      'Second',
    ]);
  });

  it('still speaks SpeechSynthesisUtterance phrases where the API exists', async () => {
    const spoken = installSpeechEngine((utterance) => {
      if (utterance.onend) utterance.onend();
    });

    const utterance = new FakeUtterance('From utterance');
    utterance.lang = 'en-GB';

    const result = speak(
      [utterance as unknown as SpeechSynthesisUtterance],
      false,
    );

    await expect(result.series).resolves.toBeUndefined();
    expect(spoken.map((u) => u.text)).toEqual(['From utterance']);
    expect(spoken[0]!.lang).toBe('en-GB');
  });
});
