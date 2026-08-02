type CoreSpeechType =
  | string
  | (() => SpeechType)
  | SpeechType[]
  | SpeechSynthesisUtterance;
export type SpeechType = CoreSpeechType | Promise<CoreSpeechType>;

export interface SeriesResult {
  series: Promise<void>;
  readonly active: boolean;
  append: (toSpeak: SpeechType) => void;
  cancel: () => void;
}

export interface SpeechOptions {
  lang: string;
  voice?: string;
}

/**
 * Pluggable text-to-speech backend. Install one with
 * `Announcer.setSpeechEngine()` to route speech through a platform API (webOS
 * Luna, Tizen, a native bridge, ...) instead of the Web Speech API. The
 * Announcer keeps owning the series: flattening, PAUSE- handling, append,
 * cancel and nesting all still work — the engine only speaks one phrase.
 */
export interface SpeechEngine {
  /**
   * Speak a single phrase. Resolve when it has finished so the Announcer knows
   * when to move on; resolve immediately if the platform can't report
   * completion. Reject with an error carrying `error: 'network'` to be retried
   * (3 attempts, backing off), or `error: 'canceled' | 'interrupted'` to end
   * the series quietly. Any other rejection propagates to the caller.
   */
  speak: (phrase: string, options: SpeechOptions) => void | Promise<void>;
  /** Stop whatever is currently being spoken. */
  cancel: VoidFunction;
}

// Aria label
type AriaLabel = { text: string; lang: string };
const ARIA_PARENT_ID = 'aria-parent';
let ariaLabelPhrases: AriaLabel[] = [];

// An Error carrying the structured speech-synthesis error code (e.g.
// "interrupted", "canceled", "network"). We reject with this instead of the
// raw SpeechSynthesisErrorEvent so callers can classify the failure without
// depending on the SpeechSynthesisErrorEvent global, which isn't defined on
// every TV browser.
export interface SpeechError extends Error {
  error?: string;
}

function flattenStrings(series: SpeechType[] = []): SpeechType[] {
  const flattenedSeries = [];

  let i;
  for (i = 0; i < series.length; i++) {
    const s = series[i];
    if (typeof s === 'string' && !s.includes('PAUSE-')) {
      flattenedSeries.push(series[i]);
    } else {
      break;
    }
  }
  // add a "word boundary" to ensure the Announcer doesn't automatically try to
  // interpret strings that look like dates but are not actually dates
  // for example, if "Rising Sun" and "1993" are meant to be two separate lines,
  // when read together, "Sun 1993" is interpretted as "Sunday 1993"
  return ([flattenedSeries.join(',\b ')] as SpeechType[]).concat(
    series.slice(i),
  );
}

function delay(pause: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, pause);
  });
}

/**
 * @description This function is called at the end of the speak series
 * @param Phrase is an object containing the text and the language
 */
function addChildrenToAriaDiv(phrase: AriaLabel) {
  if (phrase?.text?.trim().length === 0) return;
  ariaLabelPhrases.push(phrase);
}

/**
 * @description This function is triggered finally when the speak series is finished and we are to speak the aria labels
 */
function focusElementForAria() {
  // Nothing new to announce (e.g. a canceled series). Leave whatever the live
  // region currently holds in place so an in-progress screen reader isn't cut off.
  if (ariaLabelPhrases.length === 0) {
    return;
  }

  const element = createAriaElement();

  if (!element) {
    console.error(`ARIA div not found: ${ARIA_PARENT_ID}`);
    return;
  }

  // Replace-on-next-write: drop the previous announcement's nodes, then inject
  // the current label. The label stays in the assertive live region until the
  // *next* announcement replaces it — rather than being torn down on a timer —
  // so on-device TV screen readers have time to finish reading it.
  cleanAriaLabelParent();

  for (const object of ariaLabelPhrases) {
    const span = document.createElement('span');

    // TODO: Not sure LG or Samsung support lang attribute on span or switching language
    span.setAttribute('lang', object.lang);
    span.setAttribute('aria-label', object.text);
    element.appendChild(span);
  }

  ariaLabelPhrases = [];
}

/**
 * @description Clean the aria label parent after speaking
 */
function cleanAriaLabelParent(): void {
  const parentTag = document.getElementById(ARIA_PARENT_ID);
  if (parentTag) {
    while (parentTag.firstChild) {
      parentTag.removeChild(parentTag.firstChild);
    }
  }
}

/**
 * @description Create the aria element in the DOM if it doesn't exist
 * @private For xbox, we may need to create a different element each time we wanna use aria
 */
function createAriaElement(): HTMLDivElement | HTMLElement {
  const aria_container = document.getElementById(ARIA_PARENT_ID);

  if (!aria_container) {
    const element = document.createElement('div');
    element.setAttribute('id', ARIA_PARENT_ID);
    element.setAttribute('aria-live', 'assertive');
    element.setAttribute('tabindex', '0');
    document.body.appendChild(element);
    return element;
  }

  return aria_container;
}

/**
 * The default engine — the browser's Web Speech API.
 *
 * @return {Promise<void>} Promise resolved when the utterance has finished speaking, and rejected if there's an error
 */
const webSpeechEngine: SpeechEngine = {
  speak(phrase, { lang, voice: voiceName }) {
    const synth = window.speechSynthesis;

    return new Promise<void>((resolve, reject) => {
      let selectedVoice;
      if (voiceName) {
        const availableVoices = synth.getVoices();
        selectedVoice =
          availableVoices.find((v) => v.name === voiceName) ||
          availableVoices[0];
      }

      const utterance = new SpeechSynthesisUtterance(phrase);
      utterance.lang = lang;
      if (selectedVoice) {
        utterance.voice = selectedVoice;
      }
      utterance.onend = () => {
        resolve();
      };
      utterance.onerror = (e) => {
        const error: SpeechError = new Error(
          `Speech synthesis error: ${e.error}`,
        );
        // Preserve the code so speakSeries can tell benign interruptions
        // ("interrupted"/"canceled") apart from real failures ("network", etc.).
        error.error = e.error;
        reject(error);
      };
      synth.speak(utterance);
    });
  },
  cancel() {
    window.speechSynthesis?.cancel();
  },
};

let speechEngine: SpeechEngine = webSpeechEngine;

/**
 * Install a custom speech engine, or pass nothing to restore the Web Speech
 * API default. Prefer `Announcer.setSpeechEngine()`.
 */
export function setSpeechEngine(engine?: SpeechEngine | null): void {
  speechEngine = engine ?? webSpeechEngine;
}

/**
 * Devices that ship a platform TTS instead of the Web Speech API may not
 * define SpeechSynthesisUtterance at all, where a bare `instanceof` throws.
 */
function isUtterance(phrase: unknown): phrase is SpeechSynthesisUtterance {
  return (
    typeof SpeechSynthesisUtterance !== 'undefined' &&
    phrase instanceof SpeechSynthesisUtterance
  );
}

/**
 * @description Classify a caught speech error and apply back-off.
 * Returns the retries remaining after handling. `interrupted`/`canceled` are
 * benign — a newer announcement cancelled or replaced the in-flight one (see
 * synth.cancel()), which happens constantly during directional navigation — so
 * we stop retrying without surfacing them. `network` errors back off and retry.
 * Anything else is genuinely unexpected and is rethrown.
 */
async function handleSpeechError(
  e: unknown,
  retriesLeft: number,
  totalRetries: number,
): Promise<number> {
  const code = (e as SpeechError | undefined)?.error;

  if (code === 'network') {
    retriesLeft--;
    console.warn(
      `Speech synthesis network error. Retries left: ${retriesLeft}`,
    );
    await delay(500 * (totalRetries - retriesLeft));
    return retriesLeft;
  }

  if (code === 'canceled' || code === 'interrupted') {
    return 0; // benign — stop retrying, don't propagate
  }

  throw e;
}

function speakSeries(
  series: SpeechType,
  aria: boolean,
  lang: string,
  voice?: string,
  root = true,
): SeriesResult {
  const remainingPhrases = flattenStrings(
    Array.isArray(series) ? series : [series],
  );
  const nestedSeriesResults: SeriesResult[] = [];
  let active: boolean = true;

  const seriesChain = (async () => {
    try {
      while (active && remainingPhrases.length) {
        const phrase = await Promise.resolve(remainingPhrases.shift());
        if (!active) {
          break; // Exit if canceled
        }

        if (typeof phrase === 'string' && phrase.includes('PAUSE-')) {
          // Handle pauses
          const pause = Number(phrase.split('PAUSE-')[1]) * 1000;
          if (!isNaN(pause)) {
            await delay(pause);
          }
        } else if (typeof phrase === 'string') {
          if (!phrase) {
            continue; // Skip empty strings
          }
          // Handle regular strings with retry logic
          const totalRetries = 3;
          let retriesLeft = totalRetries;

          while (active && retriesLeft > 0) {
            try {
              if (aria) addChildrenToAriaDiv({ text: phrase, lang });
              else await speechEngine.speak(phrase, { lang, voice });
              retriesLeft = 0; // Exit retry loop on success
            } catch (e) {
              retriesLeft = await handleSpeechError(
                e,
                retriesLeft,
                totalRetries,
              );
            }
          }
        } else if (isUtterance(phrase)) {
          // Handle SpeechSynthesisUtterance objects with retry logic
          const totalRetries = 3;
          let retriesLeft = totalRetries;
          const text = phrase.text;
          const objectLang = phrase?.lang;
          const objectVoice = phrase?.voice;

          while (active && retriesLeft > 0) {
            try {
              if (text) {
                if (aria) addChildrenToAriaDiv({ text, lang: objectLang });
                else
                  await speechEngine.speak(text, {
                    lang: objectLang,
                    voice: objectVoice?.name,
                  });
                retriesLeft = 0; // Exit retry loop on success
              }
            } catch (e) {
              retriesLeft = await handleSpeechError(
                e,
                retriesLeft,
                totalRetries,
              );
            }
          }
        } else if (typeof phrase === 'function') {
          // Handle functions
          const seriesResult = speakSeries(phrase(), aria, lang, voice, false);
          nestedSeriesResults.push(seriesResult);
          await seriesResult.series;
        } else if (Array.isArray(phrase)) {
          // Handle nested arrays
          const seriesResult = speakSeries(phrase, aria, lang, voice, false);
          nestedSeriesResults.push(seriesResult);
          await seriesResult.series;
        }
      }
    } finally {
      active = false;
      // Call completion logic only for the original (root) series
      if (root && aria) {
        focusElementForAria();
      }
    }
  })();

  return {
    series: seriesChain,
    get active() {
      return active;
    },
    append: (toSpeak: SpeechType) => {
      remainingPhrases.push(toSpeak);
    },
    cancel: () => {
      if (!active) {
        return;
      }

      if (root) {
        if (aria) {
          // Replace-on-next-write: don't tear down the live region here. The
          // current label stays until the next announcement replaces it, so the
          // screen reader can finish. Just drop any partially accumulated
          // phrases from this canceled series.
          ariaLabelPhrases = [];
        } else {
          speechEngine.cancel(); // Cancel all ongoing speech
        }
      }
      nestedSeriesResults.forEach((nestedSeriesResult) => {
        nestedSeriesResult.cancel();
      });
      active = false;
    },
  };
}

let currentSeries: SeriesResult | undefined;
export default function (
  toSpeak: SpeechType,
  aria: boolean,
  lang: string = 'en-US',
  voice?: string,
) {
  currentSeries?.cancel();
  currentSeries = speakSeries(toSpeak, aria, lang, voice);
  return currentSeries;
}
