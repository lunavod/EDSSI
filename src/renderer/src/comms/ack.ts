/**
 * The chirp the ship makes instead of saying "Done." — a quick rising arpeggio with a sparkle on
 * top and a short echo, synthesised on the spot so there is no sound file to ship.
 */

export interface AckNote {
  /** Seconds after the chirp starts. */
  at: number;
  /** Hz at the start of the note, and where it glides to. */
  from: number;
  to: number;
  /** Seconds until it has faded out. */
  length: number;
  gain: number;
}

/** A rising fifth-and-octave, each note sliding up into the next, with a bright tail. */
export const ACK_NOTES: readonly AckNote[] = [
  { at: 0, from: 740, to: 880, length: 0.07, gain: 0.5 },
  { at: 0.055, from: 1109, to: 1319, length: 0.07, gain: 0.45 },
  { at: 0.11, from: 1661, to: 1760, length: 0.18, gain: 0.4 },
];

/** How long the chirp lasts, echo included. */
export const ACK_SECONDS = 0.55;

const VOLUME = 0.22;
const ECHO_DELAY_S = 0.09;
const ECHO_FEEDBACK = 0.28;

/** Schedules the chirp on `context`, starting at `when` on its clock. */
export function playAck(context: BaseAudioContext, when = context.currentTime): void {
  const master = context.createGain();
  master.gain.value = VOLUME;

  // Takes the edge off the square-ish partials, so it reads as a cockpit tone rather than a buzzer.
  const filter = context.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 5200;
  filter.Q.value = 0.7;
  filter.connect(master);
  master.connect(context.destination);

  const echo = context.createDelay(0.5);
  echo.delayTime.value = ECHO_DELAY_S;
  const feedback = context.createGain();
  feedback.gain.value = ECHO_FEEDBACK;
  filter.connect(echo);
  echo.connect(feedback);
  feedback.connect(echo);
  feedback.connect(master);

  for (const note of ACK_NOTES) {
    const start = when + note.at;
    const end = start + note.length;

    const envelope = context.createGain();
    envelope.gain.setValueAtTime(0.0001, start);
    envelope.gain.exponentialRampToValueAtTime(note.gain, start + 0.006);
    envelope.gain.exponentialRampToValueAtTime(0.0001, end);
    envelope.connect(filter);

    // The body of the note, and an octave above it quietly for the sparkle.
    for (const [type, multiple, level] of [
      ['triangle', 1, 1],
      ['square', 2, 0.12],
    ] as const) {
      const oscillator = context.createOscillator();
      oscillator.type = type;
      oscillator.frequency.setValueAtTime(note.from * multiple, start);
      oscillator.frequency.exponentialRampToValueAtTime(note.to * multiple, start + 0.03);
      const partial = context.createGain();
      partial.gain.value = level;
      oscillator.connect(partial);
      partial.connect(envelope);
      oscillator.start(start);
      oscillator.stop(end + 0.01);
    }
  }

  // Unhooked once the echo has died away, so the graph doesn't keep growing chirp by chirp.
  const cleanup = context.createConstantSource();
  cleanup.offset.value = 0;
  cleanup.connect(context.destination);
  cleanup.addEventListener('ended', () => {
    feedback.disconnect();
    echo.disconnect();
    master.disconnect();
  });
  cleanup.start(when);
  cleanup.stop(when + ACK_SECONDS);
}
