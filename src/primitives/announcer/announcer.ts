import type { ElementNode } from '@solidtv/solid';
import { untrack } from 'solid-js';
import speakSeries, {
  setSpeechEngine,
  type SeriesResult,
  type SpeechEngine,
  type SpeechType,
} from './speech.js';
import {
  createWebOSEngine,
  detectSpeechPlatform,
  isTizenVoiceGuideEnabled,
  isWebOS,
  webOSLunaRequest,
  type SpeechPlatform,
} from './platformEngines.js';
import { debounce } from '@solid-primitives/scheduled';
import { focusPath } from '../useFocusManager.js';

type DebounceWithFlushFunction<T> = {
  (newValue: T): void;
  flush(): void;
  clear: VoidFunction;
};

declare module '@solidtv/solid' {
  /**
   * Augment the existing ElementNode interface with our own
   * Announcer-specific properties.
   */
  interface ElementNode {
    announce?: SpeechType;
    announceContext?: SpeechType;
    title?: SpeechType;
    loading?: boolean;
  }
}

let resetFocusPathTimer: DebounceWithFlushFunction<void>;
let prevFocusPath: ElementNode[] = [];
let currentlySpeaking: SeriesResult | undefined;
let voiceOutDisabled = false;
const fiveMinutes = 300000;

function debounceWithFlush<T>(
  callback: (newValue: T) => void,
  time?: number,
): DebounceWithFlushFunction<T> {
  const trigger = debounce(callback, time);
  let scopedValue: T;

  const debounced = (newValue: T) => {
    scopedValue = newValue;
    trigger(newValue);
  };

  debounced.flush = () => {
    trigger.clear();
    callback(scopedValue);
  };

  debounced.clear = trigger.clear;

  return debounced;
}

function getElmName(elm: ElementNode): string {
  return (elm.id || elm.name) as string;
}

function onFocusChangeCore(focusPath: ElementNode[] = []) {
  if (!Announcer.onFocusChange || !Announcer.enabled) {
    return;
  }

  const loaded = focusPath.every((elm) => !elm.loading);
  const focusDiff = focusPath.filter((elm) => !prevFocusPath.includes(elm));

  resetFocusPathTimer();

  if (!loaded && Announcer.onFocusChange) {
    Announcer.onFocusChange([]);
    return;
  }

  prevFocusPath = focusPath.slice(0);

  const toAnnounceText: SpeechType[] = [];
  const toAnnounce = focusDiff
    .reverse()
    .reduce((acc: [string, string, SpeechType][], elm) => {
      if (elm.announce) {
        acc.push([getElmName(elm), 'Announce', elm.announce]);
        toAnnounceText.push(elm.announce);
      } else if (elm.title) {
        acc.push([getElmName(elm), 'Title', elm.title]);
        toAnnounceText.push(elm.title);
      } else {
        acc.push([getElmName(elm), 'No Announce', '']);
      }
      return acc;
    }, []);

  focusDiff.reverse().reduce((acc, elm) => {
    if (elm.announceContext) {
      acc.push([getElmName(elm), 'Context', elm.announceContext]);
      toAnnounceText.push(elm.announceContext);
    } else {
      acc.push([getElmName(elm), 'No Context', '']);
    }
    return acc;
  }, toAnnounce);

  if (Announcer.debug) {
    console.table(toAnnounce);
  }

  if (toAnnounceText.length) {
    return Announcer.speak(
      toAnnounceText.reduce((acc: SpeechType[], val) => acc.concat(val), []),
    );
  }
}

function textToSpeech(
  toSpeak: SpeechType,
  aria: boolean,
  lang: string,
  voice?: string,
) {
  if (voiceOutDisabled) {
    return;
  }

  return (currentlySpeaking = speakSeries(toSpeak, aria, lang, voice));
}

export interface Announcer {
  debug: boolean;
  enabled: boolean;
  lang: string;
  aria: boolean;
  voice?: string;
  cancel: VoidFunction;
  clearPrevFocus: (depth?: number) => void;
  speak: (
    text: SpeechType,
    options?: { append?: boolean; notification?: boolean },
  ) => SeriesResult;
  setupTimers: (options?: {
    focusDebounce?: number;
    focusChangeTimeout?: number;
  }) => void;
  /**
   * Replace the text-to-speech backend — for platforms with their own TTS
   * (webOS Luna, Tizen, a native bridge) instead of the Web Speech API.
   * Call with no argument to restore the default. Has no effect while
   * `Announcer.aria` is true, since that path writes to an aria live region
   * rather than speaking.
   */
  setSpeechEngine: (engine?: SpeechEngine | null) => void;
  /**
   * Detects the TV platform and switches the Announcer to that device's own
   * speech output, returning what it picked. Safe to call anywhere — it reads
   * globals, it doesn't speak.
   *
   * - LG (`webos`) — installs an engine driving the Luna TTS service, and
   *   clears `aria`.
   * - Samsung (`tizen`) — turns `aria` on. Samsung has no speak API; its Voice
   *   Guide screen reader is the TTS and it reads the live region instead.
   * - Anything else (`default`) — restores the Web Speech API engine and leaves
   *   `aria` as configured.
   */
  detectSpeechEngine: () => SpeechPlatform;
  onFocusChange?: DebounceWithFlushFunction<ElementNode[]>;
  refresh: (depth?: number) => void;
}

export const Announcer: Announcer = {
  debug: false,
  enabled: true,
  lang: 'en-US',
  aria: false,
  cancel: function () {
    currentlySpeaking?.cancel();
  },
  clearPrevFocus: function (depth = 0) {
    prevFocusPath = prevFocusPath.slice(0, depth);
    resetFocusPathTimer();
  },
  speak: function (text, { append = false, notification = false } = {}) {
    if (Announcer.onFocusChange && Announcer.enabled) {
      if (append && currentlySpeaking && currentlySpeaking.active) {
        currentlySpeaking.append(text);
      } else {
        Announcer.cancel();
        textToSpeech(text, Announcer.aria, Announcer.lang, Announcer.voice);
      }

      if (notification) {
        voiceOutDisabled = true;
        currentlySpeaking?.series
          .finally(() => {
            voiceOutDisabled = false;
            Announcer.refresh();
          })
          .catch(console.error);
      }
    }

    return currentlySpeaking as SeriesResult;
  },
  refresh: function (depth = 0) {
    Announcer.clearPrevFocus(depth);
    if (Announcer.onFocusChange) {
      Announcer.onFocusChange(untrack(() => focusPath()));
    }
  },
  setSpeechEngine: setSpeechEngine,
  detectSpeechEngine: function () {
    const platform = detectSpeechPlatform();

    if (platform === 'tizen') {
      // Samsung's Voice Guide is the only TTS available to an app, and it
      // reads the DOM rather than accepting strings.
      setSpeechEngine();
      Announcer.aria = true;

      if (isTizenVoiceGuideEnabled() === false) {
        console.warn(
          'Announcer: Voice Guide is off in the TV settings, so announcements will be silent.',
        );
      }
      return platform;
    }

    if (platform === 'webos') {
      setSpeechEngine(createWebOSEngine(webOSLunaRequest()!));
      Announcer.aria = false;
      return platform;
    }

    if (isWebOS()) {
      console.warn(
        'Announcer: webOS detected but webOS.service.request is unavailable — include webOSTV.js to use the Luna TTS engine. Falling back to speechSynthesis.',
      );
    }

    setSpeechEngine();
    return platform;
  },
  setupTimers: function ({
    focusDebounce = 400,
    focusChangeTimeout = fiveMinutes,
  } = {}) {
    Announcer.onFocusChange = debounceWithFlush(
      onFocusChangeCore,
      focusDebounce,
    );

    resetFocusPathTimer = debounceWithFlush(() => {
      // Reset focus path for full announce
      prevFocusPath = [];
    }, focusChangeTimeout);
  },
};
