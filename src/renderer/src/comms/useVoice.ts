import { useCallback, useEffect, useRef, useState } from 'react';

import type { ListenAction } from '../../../shared/api';
import type { AssistantSetup } from '../../../shared/assistant';
import { useEdssi, useLocalDevices } from '../api/context';
import { VoiceRecorder } from './recorder';
import { SpeechPlayer } from './speech';
import { toWav16k } from './to-wav';

export interface Voice {
  /** The microphone is open. */
  listening: boolean;
  /** Starts recording, or stops and sends what was said. For the button in the window. */
  toggle: () => void;
  /** Why the last attempt didn't work — usually the microphone being blocked. */
  problem?: string;
}

/**
 * Whether the microphone is open — reported, not opened.
 *
 * For the VR panels. Push-to-talk and the spoken answer are broadcast to every window, and the VR
 * cockpit's Comms panel is a window of its own: running `useVoice` there gave the commander a
 * second recorder that opened the microphone alongside the first, recorded the same words again
 * and asked the assistant the same question twice, and a second speech player answering over the
 * top of the first. Its `listening` was its own recorder's, which is why the panel's status line
 * disagreed with what was actually happening.
 *
 * The microphone belongs to the window the commander is sitting at. A panel only says what it is
 * doing.
 */
export function useListening(): Voice {
  const edssi = useEdssi();
  const [listening, setListening] = useState(false);

  useEffect(
    () =>
      edssi.assistant.onListen((action: ListenAction) => {
        setListening((current) => {
          if (action === 'start') return true;
          if (action === 'stop') return false;
          return !current;
        });
      }),
    [edssi],
  );

  // Nothing to toggle: there is no pointer in a headset and no recorder here to answer it.
  return { listening, toggle: () => {} };
}

/**
 * Push-to-talk and playback, wired to the main process: a bound key or stick button held anywhere
 * opens the microphone, letting go sends the question, and the answer plays as it is generated.
 *
 * One window only — see `useListening`.
 */
export function useVoice(setup?: AssistantSetup): Voice {
  const edssi = useEdssi();
  const localDevices = useLocalDevices();
  const recorder = useRef<VoiceRecorder>(undefined);
  const player = useRef<SpeechPlayer>(undefined);
  const [listening, setListening] = useState(false);
  const [problem, setProblem] = useState<string>();

  // The setup arrives a moment after the window does; until it has, these are what the settings
  // themselves default to.
  const maxRecordingSeconds = setup?.maxRecordingSeconds ?? 30;
  const keepMicrophoneOpen = setup?.keepMicrophoneOpen ?? true;
  const microphone = setup?.microphone;
  // Read when a recording is sent, which is after the callback that sends it was made.
  const inputFormat = setup?.voiceInputFormat ?? 'opus';
  const format = useRef(inputFormat);
  useEffect(() => {
    format.current = inputFormat;
  }, [inputFormat]);

  recorder.current ??= new VoiceRecorder({ keepOpen: keepMicrophoneOpen, device: microphone });
  // This window owns the audio, so it is the one that can say when the ship has actually stopped
  // talking — the main process only knows when it finished generating the words.
  player.current ??= new SpeechPlayer({
    onPlayback: (utterance, playing) => edssi.assistant.playback(utterance, playing),
  });

  const stopAndSend = useCallback(async () => {
    if (!recorder.current!.recording) return;
    setListening(false);
    const recorded = await recorder.current!.stop();
    // A device that records nothing used to look exactly like a question that was never asked.
    setProblem(recorded.problem);
    if (!recorded.audio) return;
    let audio = recorded.audio;
    if (format.current === 'wav') {
      try {
        audio = await toWav16k(audio);
      } catch (error) {
        console.error('[voice] could not decode the recording', error);
        setProblem('EDSSI could not decode that recording.');
        return;
      }
    }
    await edssi.assistant.askByVoice(audio);
  }, [edssi]);

  // Named so the failure message can say which microphone would not open.
  const start = useCallback(() => {
    if (!localDevices) {
      setProblem('Voice needs EDSSI itself; type your question instead.');
      return;
    }
    if (recorder.current!.recording) return;
    // Talking over the answer stops it: the commander has heard enough.
    player.current!.stop();
    void edssi.assistant.cancel();
    recorder.current!.start().then(
      () => {
        setProblem(undefined);
        setListening(true);
      },
      (error: unknown) => {
        console.error('[voice] could not open the microphone', error);
        // `exact` on the device means this is also how a named microphone that has gone away
        // reports itself, so the name is worth saying.
        const named = microphone === undefined ? 'the microphone' : `"${microphone}"`;
        setProblem(`EDSSI could not open ${named}.`);
      },
    );
  }, [edssi, localDevices, microphone]);

  const toggle = useCallback(() => {
    if (recorder.current!.recording) void stopAndSend();
    else start();
  }, [start, stopAndSend]);

  // The bindings are watched in the main process, so they work while the game has focus.
  useEffect(
    () =>
      edssi.assistant.onListen((action: ListenAction) => {
        if (action === 'start') start();
        else if (action === 'stop') void stopAndSend();
        else toggle();
      }),
    [edssi, start, stopAndSend, toggle],
  );

  useEffect(() => edssi.assistant.onSpeech((chunk) => player.current!.play(chunk)), [edssi]);

  useEffect(
    () =>
      edssi.ui.onCommand((command) => {
        if (command.type === 'acknowledge') player.current!.acknowledge();
      }),
    [edssi],
  );

  /**
   * A binding held down by something heavy — or a key the hook never sees released, because the
   * game swallowed it — shouldn't record until the disk fills.
   */
  useEffect(() => {
    if (!listening) return undefined;
    const timer = setTimeout(() => void stopAndSend(), maxRecordingSeconds * 1000);
    return () => clearTimeout(timer);
  }, [listening, maxRecordingSeconds, stopAndSend]);

  useEffect(() => {
    const current = player.current!;
    // Start the audio device now, so the first answer isn't held up waiting for it.
    if (localDevices) current.warmUp();
    return () => current.close();
  }, [localDevices]);

  // The same for the microphone: opened ahead of time, the first word of a question survives.
  useEffect(() => {
    const current = recorder.current!;
    current.configure({ keepOpen: keepMicrophoneOpen, device: microphone });
    if (localDevices) void current.warmUp();
  }, [keepMicrophoneOpen, localDevices, microphone]);

  useEffect(() => {
    const current = recorder.current!;
    return () => current.close();
  }, []);

  return { listening, toggle, problem };
}
