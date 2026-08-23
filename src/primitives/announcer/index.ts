import { Announcer } from './announcer.js';
import { focusPath } from '../useFocusManager.js';
import { createEffectOn } from '../utils/createEffectOn.js';

let doOnce = false;
export const useAnnouncer = (options?: {
  focusDebounce?: number;
  focusChangeTimeout?: number;
}) => {
  if (doOnce) {
    return Announcer;
  }
  doOnce = true;
  Announcer.setupTimers(options);
  createEffectOn(focusPath, Announcer.onFocusChange!, { defer: true });

  return Announcer;
};

export { Announcer };
