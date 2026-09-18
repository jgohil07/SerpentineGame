/**
 * Chiptune sound effects synthesized with WebAudio, so there are no audio
 * files to load. The AudioContext is created lazily inside a user gesture
 * (browsers refuse to start audio otherwise).
 */

const MASTER_VOLUME = 0.16;

function semitones(freq, steps) {
  return freq * 2 ** (steps / 12);
}

export function createAudio() {
  let ctx = null;
  let master = null;
  let muted = false;

  function context() {
    // Before the first real gesture (a swipe's pointermove doesn't count)
    // browsers refuse to start audio and log a warning; stay silent instead.
    const activation = navigator.userActivation;
    if (activation && !activation.hasBeenActive) {
      return null;
    }
    if (!ctx) {
      const AudioCtor = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtor) {
        return null;
      }
      try {
        ctx = new AudioCtor();
      } catch {
        return null;
      }
      master = ctx.createGain();
      master.gain.value = MASTER_VOLUME;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
    return ctx;
  }

  function blip(c, { freq, to = freq, dur = 0.08, type = 'square', vol = 0.5, at = 0 }) {
    const t0 = c.currentTime + at;
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (to !== freq) {
      osc.frequency.exponentialRampToValueAtTime(to, t0 + dur);
    }
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain).connect(master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  const sounds = {
    start(c) {
      [0, 4, 7].forEach((step, i) => blip(c, { freq: semitones(330, step), dur: 0.07, at: i * 0.06, vol: 0.35 }));
    },
    eat(c, combo = 1) {
      // Pitch climbs with the combo so a streak sounds like a streak.
      const base = semitones(440, (combo - 1) * 2);
      blip(c, { freq: base, to: base * 2, dur: 0.07, vol: 0.4 });
    },
    bonus(c) {
      [0, 4, 7, 12].forEach((step, i) => blip(c, { freq: semitones(660, step), dur: 0.06, at: i * 0.045, type: 'triangle', vol: 0.5 }));
    },
    spawn(c) {
      blip(c, { freq: 1320, to: 1760, dur: 0.05, type: 'sine', vol: 0.18 });
    },
    expire(c) {
      blip(c, { freq: 520, to: 260, dur: 0.12, type: 'triangle', vol: 0.2 });
    },
    die(c) {
      blip(c, { freq: 240, to: 40, dur: 0.45, type: 'sawtooth', vol: 0.45 });
      blip(c, { freq: 120, to: 30, dur: 0.5, type: 'square', vol: 0.25, at: 0.04 });
    },
    win(c) {
      [0, 4, 7, 12, 16, 19, 24].forEach((step, i) => blip(c, { freq: semitones(392, step), dur: 0.09, at: i * 0.07, type: 'triangle', vol: 0.45 }));
    },
    pause(c) {
      blip(c, { freq: 880, to: 440, dur: 0.06, type: 'sine', vol: 0.25 });
    },
    resume(c) {
      blip(c, { freq: 440, to: 880, dur: 0.06, type: 'sine', vol: 0.25 });
    },
    toggle(c) {
      blip(c, { freq: 1200, dur: 0.03, type: 'square', vol: 0.15 });
    },
  };

  return {
    /** Call from inside a user gesture so later sounds are allowed to play. */
    unlock() {
      if (!muted) {
        context();
      }
    },
    play(name, arg) {
      if (muted || !sounds[name]) {
        return;
      }
      const c = context();
      if (c) {
        sounds[name](c, arg);
      }
    },
    setMuted(value) {
      muted = Boolean(value);
    },
    get muted() {
      return muted;
    },
  };
}
