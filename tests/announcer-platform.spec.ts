import { describe, it, expect, afterEach, vi } from 'vitest';
import { Announcer } from '../src/primitives/announcer/announcer.ts';
import speak, { setSpeechEngine } from '../src/primitives/announcer/speech.ts';
import {
  createWebOSEngine,
  detectSpeechPlatform,
  isTizenVoiceGuideEnabled,
} from '../src/primitives/announcer/platformEngines.ts';

type LunaHandler = (response: Record<string, unknown>) => void;
type LunaCall = {
  uri: string;
  method: string;
  parameters?: Record<string, unknown>;
  onSuccess?: LunaHandler;
  onFailure?: LunaHandler;
};

/** Stand-in for webOSTV.js — records calls and lets a test drive the callbacks. */
function lunaStub() {
  const calls: LunaCall[] = [];
  const canceled: number[] = [];
  const request = vi.fn((uri: string, options: Omit<LunaCall, 'uri'>) => {
    const index = calls.push({ uri, ...options }) - 1;
    return { cancel: () => canceled.push(index) };
  });
  return { calls, canceled, request };
}

function withGlobals(values: Record<string, unknown>) {
  const g = globalThis as Record<string, unknown>;
  for (const [key, value] of Object.entries(values)) {
    g[key] = value;
  }
}

function clearGlobals(...keys: string[]) {
  const g = globalThis as Record<string, unknown>;
  for (const key of keys) {
    delete g[key];
  }
}

describe('webOS Luna speech engine', () => {
  afterEach(() => {
    setSpeechEngine();
  });

  it('speaks through com.webos.service.tts with a subscription', async () => {
    const luna = lunaStub();
    setSpeechEngine(createWebOSEngine(luna.request));

    const series = speak(['Hello there'], false, 'en-GB');
    await Promise.resolve();

    expect(luna.calls.length).toBe(1);
    const call = luna.calls[0]!;
    expect(call.uri).toBe('luna://com.webos.service.tts');
    expect(call.method).toBe('speak');
    expect(call.parameters).toMatchObject({
      text: 'Hello there',
      language: 'en-GB',
      clear: false,
      feedback: true,
      subscribe: true,
    });

    // The initial ack carries no msgStatus and must not end the phrase.
    call.onSuccess!({ returnValue: true, msgID: 'abc123456789' });
    call.onSuccess!({ msgStatus: 'done', msgID: 'abc123456789' });

    await series.series;
    expect(luna.canceled).toContain(0);
  });

  it('passes an appID when configured', async () => {
    const luna = lunaStub();
    setSpeechEngine(
      createWebOSEngine(luna.request, { appID: 'com.example.app' }),
    );

    const series = speak('Hi', false);
    await Promise.resolve();
    luna.calls[0]!.onSuccess!({ msgStatus: 'done' });
    await series.series;

    expect(luna.calls[0]!.parameters!.appID).toBe('com.example.app');
  });

  it('ends the series quietly when the TV reports it stopped', async () => {
    const luna = lunaStub();
    setSpeechEngine(createWebOSEngine(luna.request));

    const series = speak('One', false);
    await Promise.resolve();
    luna.calls[0]!.onSuccess!({ msgStatus: 'stopped' });

    // 'stopped'/'canceled' are classified as benign, so the series resolves
    // instead of rejecting, and the phrase is not retried.
    await expect(series.series).resolves.toBeUndefined();
    expect(luna.calls.filter((c) => c.method === 'speak').length).toBe(1);
  });

  it('warns once and stays quiet when the TTS service is unreachable', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const luna = lunaStub();
    setSpeechEngine(createWebOSEngine(luna.request));

    for (const phrase of ['First', 'Second']) {
      const series = speak(phrase, false);
      await Promise.resolve();
      const call = luna.calls.find((c) => c.parameters?.text === phrase)!;
      call.onFailure!({ returnValue: false, errorText: 'Denied' });
      await expect(series.series).resolves.toBeUndefined();
    }

    // Both phrases failed, but a missing permission should be reported once.
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toContain('com.webos.service.tts');
    warn.mockRestore();
  });

  it('calls stop on cancel', () => {
    const luna = lunaStub();
    setSpeechEngine(createWebOSEngine(luna.request));

    const series = speak(['Interrupt me'], false);
    series.cancel();

    expect(luna.calls.some((c) => c.method === 'stop')).toBe(true);
  });
});

describe('detectSpeechEngine', () => {
  afterEach(() => {
    clearGlobals('webOS', 'tizen', 'webapis');
    setSpeechEngine();
    Announcer.aria = false;
    vi.restoreAllMocks();
  });

  it('installs the Luna engine on LG', async () => {
    const luna = lunaStub();
    withGlobals({ webOS: { service: { request: luna.request } } });

    expect(Announcer.detectSpeechEngine()).toBe('webos');
    expect(Announcer.aria).toBe(false);

    const series = speak('Hello', false);
    await Promise.resolve();
    expect(luna.calls[0]!.method).toBe('speak');
    series.cancel();
  });

  it('switches to aria mode on Samsung', () => {
    withGlobals({ tizen: {} });

    expect(Announcer.detectSpeechEngine()).toBe('tizen');
    expect(Announcer.aria).toBe(true);
  });

  it('warns when Samsung Voice Guide is off', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    withGlobals({
      tizen: {},
      webapis: {
        tvinfo: {
          TvInfoMenuKey: { VOICE_GUIDE_KEY: 'voiceGuide' },
          getMenuValue: () => 'false',
        },
      },
    });

    Announcer.detectSpeechEngine();

    expect(isTizenVoiceGuideEnabled()).toBe(false);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Voice Guide'));
  });

  it('reads Voice Guide as enabled', () => {
    withGlobals({
      webapis: {
        tvinfo: {
          TvInfoMenuKey: { VOICE_GUIDE_KEY: 'voiceGuide' },
          getMenuValue: () => 'true',
        },
      },
    });

    expect(isTizenVoiceGuideEnabled()).toBe(true);
  });

  it('reports undefined Voice Guide state when webapis throws', () => {
    withGlobals({
      tizen: {},
      webapis: {
        tvinfo: {
          TvInfoMenuKey: { VOICE_GUIDE_KEY: 'voiceGuide' },
          getMenuValue: () => {
            throw new Error('not supported');
          },
        },
      },
    });

    expect(isTizenVoiceGuideEnabled()).toBeUndefined();
  });

  it('falls back to the default engine elsewhere', () => {
    expect(detectSpeechPlatform()).toBe('default');
    expect(Announcer.detectSpeechEngine()).toBe('default');
  });

  it('does not install the Luna engine without webOSTV.js', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    withGlobals({ webOS: {} });

    expect(Announcer.detectSpeechEngine()).toBe('default');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('webOSTV.js'));
  });
});
