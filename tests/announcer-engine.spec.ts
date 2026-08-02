import { describe, it, expect, afterEach } from 'vitest';
import speak, {
  setSpeechEngine,
  type SpeechOptions,
} from '../src/primitives/announcer/speech.ts';

type Spoken = { phrase: string; options: SpeechOptions };

function recordingEngine() {
  const spoken: Spoken[] = [];
  let canceled = 0;
  return {
    spoken,
    get canceled() {
      return canceled;
    },
    engine: {
      speak: (phrase: string, options: SpeechOptions) => {
        spoken.push({ phrase, options });
      },
      cancel: () => {
        canceled++;
      },
    },
  };
}

describe('Announcer custom speech engine', () => {
  afterEach(() => {
    setSpeechEngine();
  });

  it('routes phrases through the installed engine', async () => {
    const recorder = recordingEngine();
    setSpeechEngine(recorder.engine);

    await speak(['Hello', 'button'], false, 'pt-BR').series;

    expect(recorder.spoken.length).toBe(1);
    expect(recorder.spoken[0]!.phrase).toContain('Hello');
    expect(recorder.spoken[0]!.phrase).toContain('button');
    expect(recorder.spoken[0]!.options.lang).toBe('pt-BR');
  });

  it('still honors PAUSE- entries and series ordering', async () => {
    const recorder = recordingEngine();
    setSpeechEngine(recorder.engine);

    await speak(['First', 'PAUSE-0', 'Second'], false).series;

    expect(recorder.spoken.map((s) => s.phrase)).toEqual(['First', 'Second']);
  });

  it('passes the configured voice through', async () => {
    const recorder = recordingEngine();
    setSpeechEngine(recorder.engine);

    await speak('Solo', false, 'en-US', 'Custom Voice').series;

    expect(recorder.spoken[0]!.options.voice).toBe('Custom Voice');
  });

  it('waits for an async engine before speaking the next phrase', async () => {
    const order: string[] = [];
    setSpeechEngine({
      speak: (phrase: string) => {
        order.push(`start:${phrase}`);
        return new Promise<void>((resolve) =>
          setTimeout(() => {
            order.push(`end:${phrase}`);
            resolve();
          }, 10),
        );
      },
      cancel: () => {},
    });

    await speak(['One', ['Two']], false).series;

    expect(order).toEqual(['start:One', 'end:One', 'start:Two', 'end:Two']);
  });

  it('cancels through the engine', async () => {
    const recorder = recordingEngine();
    setSpeechEngine(recorder.engine);

    const series = speak(['Interrupt me'], false);
    series.cancel();
    await series.series;

    expect(recorder.canceled).toBe(1);
  });

  it('restores the default engine when unset', async () => {
    const recorder = recordingEngine();
    setSpeechEngine(recorder.engine);
    setSpeechEngine();

    await speak(['Back to default'], true).series;

    expect(recorder.spoken.length).toBe(0);
  });
});
