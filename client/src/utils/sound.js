// Zero-asset Web Audio API Arcade SFX engine for Finnival

let audioCtx = null;
let lastEmojiSoundTime = 0;
const EMOJI_AUDIO_THROTTLE_MS = 300;

function getContext() {
  if (typeof window === 'undefined') return null;
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) {
      audioCtx = new AudioContextClass();
    }
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

// Ensure audio context resumes on first user interaction
if (typeof window !== 'undefined') {
  const unlockAudio = () => {
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {});
    }
  };
  window.addEventListener('click', unlockAudio, { once: true, passive: true });
  window.addEventListener('touchstart', unlockAudio, { once: true, passive: true });
  window.addEventListener('keydown', unlockAudio, { once: true, passive: true });
}

export function isMuted() {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem('finnival_muted') === 'true';
}

export function setMuted(muted) {
  if (typeof window === 'undefined') return;
  localStorage.setItem('finnival_muted', String(muted));
  window.dispatchEvent(new CustomEvent('finnival_mute_change', { detail: { muted } }));
}

export function toggleMute() {
  const next = !isMuted();
  setMuted(next);
  return next;
}

// --- Sound Generators ---

export function playTick(isUrgent = false) {
  if (isMuted()) return;
  const ctx = getContext();
  if (!ctx) return;

  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = 'triangle';
  osc.frequency.setValueAtTime(isUrgent ? 880 : 440, now);

  gain.gain.setValueAtTime(0.12, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);

  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.start(now);
  osc.stop(now + 0.07);
}

export function playSubmit() {
  if (isMuted()) return;
  const ctx = getContext();
  if (!ctx) return;

  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = 'sine';
  osc.frequency.setValueAtTime(320, now);
  osc.frequency.exponentialRampToValueAtTime(640, now + 0.08);

  gain.gain.setValueAtTime(0.18, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);

  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.start(now);
  osc.stop(now + 0.1);
}

export function playFreeze() {
  if (isMuted()) return;
  const ctx = getContext();
  if (!ctx) return;

  const now = ctx.currentTime;
  [1200, 1750].forEach((freq) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, now);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.7, now + 0.28);

    gain.gain.setValueAtTime(0.12, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.32);
  });
}

export function playHeist() {
  if (isMuted()) return;
  const ctx = getContext();
  if (!ctx) return;

  const now = ctx.currentTime;
  const notes = [988, 1318]; // B5 -> E6
  notes.forEach((freq, i) => {
    const noteStart = now + i * 0.07;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, noteStart);

    gain.gain.setValueAtTime(0.18, noteStart);
    gain.gain.exponentialRampToValueAtTime(0.001, noteStart + 0.15);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(noteStart);
    osc.stop(noteStart + 0.16);
  });
}

export function playScramble() {
  if (isMuted()) return;
  const ctx = getContext();
  if (!ctx) return;

  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(750, now);
  osc.frequency.exponentialRampToValueAtTime(180, now + 0.38);

  gain.gain.setValueAtTime(0.15, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);

  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.start(now);
  osc.stop(now + 0.42);
}

export function playOracle() {
  if (isMuted()) return;
  const ctx = getContext();
  if (!ctx) return;

  const now = ctx.currentTime;
  const notes = [1046, 1318, 1568]; // C6, E6, G6
  notes.forEach((freq, i) => {
    const noteStart = now + i * 0.08;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, noteStart);

    gain.gain.setValueAtTime(0.16, noteStart);
    gain.gain.exponentialRampToValueAtTime(0.001, noteStart + 0.22);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(noteStart);
    osc.stop(noteStart + 0.24);
  });
}

export function playDoublePoints() {
  if (isMuted()) return;
  const ctx = getContext();
  if (!ctx) return;

  const now = ctx.currentTime;
  const chord = [523, 659, 784, 1046]; // C5, E5, G5, C6 (Hype Brass)
  chord.forEach((freq) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, now);

    gain.gain.setValueAtTime(0.16, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.65);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.7);
  });
}

export function playPodium() {
  if (isMuted()) return;
  const ctx = getContext();
  if (!ctx) return;

  const now = ctx.currentTime;
  const arpeggio = [523, 659, 784, 1046];
  arpeggio.forEach((freq, i) => {
    const noteStart = now + i * 0.12;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, noteStart);

    gain.gain.setValueAtTime(0.18, noteStart);
    gain.gain.exponentialRampToValueAtTime(0.001, noteStart + 0.35);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(noteStart);
    osc.stop(noteStart + 0.38);
  });
}

export function playChatPop() {
  if (isMuted()) return;
  const ctx = getContext();
  if (!ctx) return;

  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = 'sine';
  osc.frequency.setValueAtTime(400, now);
  osc.frequency.exponentialRampToValueAtTime(600, now + 0.05);

  gain.gain.setValueAtTime(0.08, now); // Soft volume
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);

  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.start(now);
  osc.stop(now + 0.07);
}

export function playEmojiSound(emoji) {
  if (isMuted()) return;
  const nowMs = Date.now();
  if (nowMs - lastEmojiSoundTime < EMOJI_AUDIO_THROTTLE_MS) {
    return; // 300ms global throttle
  }
  lastEmojiSoundTime = nowMs;

  const ctx = getContext();
  if (!ctx) return;

  const now = ctx.currentTime;
  // ±10% random pitch jitter
  const jitter = 0.9 + Math.random() * 0.2;

  switch (emoji) {
    case '🔥': {
      // Sizzle / whoosh
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(300 * jitter, now);
      osc.frequency.exponentialRampToValueAtTime(100, now + 0.25);
      gain.gain.setValueAtTime(0.14, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.26);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.28);
      break;
    }
    case '💀': {
      // Comical hollow bonk
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(160 * jitter, now);
      osc.frequency.exponentialRampToValueAtTime(80, now + 0.18);
      gain.gain.setValueAtTime(0.2, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.22);
      break;
    }
    case '😭': {
      // Descending cartoon whine
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(450 * jitter, now);
      osc.frequency.exponentialRampToValueAtTime(180, now + 0.32);
      gain.gain.setValueAtTime(0.15, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.34);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.35);
      break;
    }
    case '😂': {
      // Bouncy giggle blips
      [540 * jitter, 720 * jitter].forEach((freq, idx) => {
        const start = now + idx * 0.08;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, start);
        gain.gain.setValueAtTime(0.15, start);
        gain.gain.exponentialRampToValueAtTime(0.001, start + 0.07);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(start);
        osc.stop(start + 0.08);
      });
      break;
    }
    case '👑': {
      // Triumphant royal bell
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(880 * jitter, now);
      gain.gain.setValueAtTime(0.18, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.48);
      break;
    }
    case '🪝': {
      // Metallic zip / hook whoosh
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(280 * jitter, now);
      osc.frequency.exponentialRampToValueAtTime(1200 * jitter, now + 0.14);
      gain.gain.setValueAtTime(0.15, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.18);
      break;
    }
    default:
      playSubmit();
  }
}
