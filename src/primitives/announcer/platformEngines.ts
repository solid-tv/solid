import type { SpeechEngine, SpeechError } from './speech.js';

/**
 * The speech channel a device uses.
 *
 * - `webos` — LG. The Luna TTS service (`com.webos.service.tts`) speaks on our
 *   behalf, so we drive it directly with a {@link SpeechEngine}.
 * - `tizen` — Samsung. There is no API for an app to speak a string; the
 *   built-in Voice Guide screen reader is the TTS, and it only reads the DOM.
 *   The Announcer's `aria` mode exists for exactly this, so we switch to it.
 * - `default` — anything else, including desktop browsers: Web Speech API.
 */
export type SpeechPlatform = 'webos' | 'tizen' | 'default';

const TTS_URI = 'luna://com.webos.service.tts';

interface LunaResponse {
  returnValue?: boolean;
  msgStatus?: 'done' | 'stopped' | 'canceled' | 'error';
  msgID?: string;
  errorCode?: number;
  errorText?: string;
}

interface LunaRequest {
  cancel: VoidFunction;
}

interface LunaRequestOptions {
  method: string;
  parameters?: Record<string, unknown>;
  subscribe?: boolean;
  onSuccess?: (response: LunaResponse) => void;
  onFailure?: (response: LunaResponse) => void;
}

export type LunaRequestFn = (
  uri: string,
  options: LunaRequestOptions,
) => LunaRequest;

interface WebOSGlobal {
  service?: { request?: LunaRequestFn };
}

interface TizenTVInfo {
  getMenuValue: (key: unknown) => unknown;
  TvInfoMenuKey: { VOICE_GUIDE_KEY: unknown };
}

interface DeviceGlobals {
  webOS?: WebOSGlobal;
  tizen?: object;
  webapis?: { tvinfo?: TizenTVInfo };
}

function globals(): DeviceGlobals {
  return globalThis as DeviceGlobals;
}

function userAgent(): string {
  return typeof navigator === 'undefined' ? '' : navigator.userAgent;
}

function speechError(code: string, message: string): SpeechError {
  const error: SpeechError = new Error(message);
  error.error = code;
  return error;
}

/**
 * The Luna call the webOS engine is built on, or undefined when it isn't
 * reachable. This is a capability test rather than a user-agent match: the app
 * must have loaded webOSTV.js for `webOS.service.request` to exist, and without
 * it there is no way to reach the TTS service.
 */
export function webOSLunaRequest(): LunaRequestFn | undefined {
  const service = globals().webOS?.service;
  return typeof service?.request === 'function'
    ? service.request.bind(service)
    : undefined;
}

/**
 * True on LG TVs. Only tells us which device we are on — reaching the TTS
 * service still needs {@link webOSLunaRequest}.
 */
export function isWebOS(): boolean {
  // "Web0S" (with a zero) is what LG's TV user agent actually reports.
  return /web0s|webos/i.test(userAgent()) || !!globals().webOS;
}

/**
 * True on Samsung TVs. `tizen`/`webapis` are injected by the platform; the
 * user-agent check covers the window before `webapis.js` has loaded.
 */
export function isTizen(): boolean {
  const { tizen, webapis } = globals();
  return !!tizen || !!webapis || /tizen/i.test(userAgent());
}

/**
 * Whether Samsung's Voice Guide is switched on in TV settings, or undefined
 * when it can't be read. Nothing an app announces through `aria` mode is
 * audible while this is off — it is a system setting, not something the app
 * can enable.
 */
export function isTizenVoiceGuideEnabled(): boolean | undefined {
  try {
    const tvinfo = globals().webapis?.tvinfo;
    if (!tvinfo) {
      return undefined;
    }
    const value = tvinfo.getMenuValue(tvinfo.TvInfoMenuKey.VOICE_GUIDE_KEY);
    // Reported as the string "true"/"false" on current firmware, but older
    // models have returned a boolean or 1/0.
    return value === 'true' || value === true || value === 1;
  } catch {
    return undefined;
  }
}

/**
 * A {@link SpeechEngine} backed by LG's Luna TTS service — the same engine
 * that powers webOS Audio Guidance.
 *
 * Each phrase subscribes for feedback so the returned promise settles when the
 * TV has actually finished speaking it, which keeps a `PAUSE-` in the middle of
 * a series accurate. Requires webOSTV.js and the `com.webos.service.tts`
 * permission in `appinfo.json`.
 */
export function createWebOSEngine(
  request: LunaRequestFn,
  options: { appID?: string } = {},
): SpeechEngine {
  const { appID } = options;
  let warnedUnavailable = false;

  return {
    speak(phrase, { lang }) {
      return new Promise<void>((resolve, reject) => {
        // Held on an object so `settle` can reach the request handle without
        // touching a binding that is still in its temporal dead zone if the
        // service answers before `request` returns.
        const pending: { handle?: LunaRequest; settled: boolean } = {
          settled: false,
        };

        const settle = (finish: VoidFunction) => {
          pending.settled = true;
          pending.handle?.cancel();
          finish();
        };

        pending.handle = request(TTS_URI, {
          method: 'speak',
          parameters: {
            text: phrase,
            language: lang,
            // The Announcer cancels before it starts a new series, so never
            // discard what is already queued for this one.
            clear: false,
            feedback: true,
            subscribe: true,
            ...(appID ? { appID } : {}),
          },
          subscribe: true,
          onSuccess: (response) => {
            switch (response.msgStatus) {
              case 'done':
                settle(resolve);
                break;
              case 'stopped':
              case 'canceled':
                // Someone cancelled us — benign, and classified so the series
                // ends quietly instead of retrying.
                settle(() =>
                  reject(speechError('canceled', 'webOS TTS canceled')),
                );
                break;
              case 'error':
                settle(() =>
                  reject(
                    speechError(
                      'synthesis-failed',
                      `webOS TTS error: ${response.errorText ?? 'unknown'}`,
                    ),
                  ),
                );
                break;
              default:
                // The initial acknowledgement carries no msgStatus. Keep the
                // subscription open and wait for the real one.
                break;
            }
          },
          onFailure: (response) => {
            // The request never reached the service — most often a missing
            // com.webos.service.tts permission in appinfo.json, which fails for
            // every phrase. Warn once and resolve: rejecting here would turn a
            // one-line config mistake into an unhandled rejection per phrase.
            if (!warnedUnavailable) {
              warnedUnavailable = true;
              console.warn(
                `Announcer: webOS TTS unavailable (${response.errorText ?? 'unknown error'}). Check that com.webos.service.tts is in the appinfo.json permissions.`,
              );
            }
            settle(resolve);
          },
        });

        // A response that arrived before `request` returned couldn't cancel the
        // subscription, so clean it up here.
        if (pending.settled) {
          pending.handle.cancel();
        }
      });
    },
    cancel() {
      request(TTS_URI, { method: 'stop', parameters: {} });
    },
  };
}

/**
 * Which speech channel this device wants, without changing anything.
 */
export function detectSpeechPlatform(): SpeechPlatform {
  if (isTizen()) {
    return 'tizen';
  }
  if (webOSLunaRequest()) {
    return 'webos';
  }
  return 'default';
}
