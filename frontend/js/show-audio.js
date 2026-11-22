/* =========================================================================
   ROYAL PALMS LIVE LOTTERY - ORIGINAL GAME-SHOW AUDIO ENGINE (show-audio.js)
   100% Original Royalty-Free Web Audio Synthesis (Zero Copyrighted Tracks)
   - Suspenseful Ambient Pad (ducked below voice frequencies for announcements)
   - Dramatic 3-2-1 Countdown Strikes
   - Fast-Paced Participant Name Selection Ticks
   - Rising Dramatic Flat-Number Reveal Swell
   - Grand Celebration Fanfare + Soft Studio Applause
   - Sound ON/OFF + Separate Music & SFX Volume Controls
   ========================================================================= */

(function () {
  const STORAGE_MUTE = 'rp_show_muted';
  const STORAGE_MUSIC_VOL = 'rp_show_music_vol';
  const STORAGE_SFX_VOL = 'rp_show_sfx_vol';

  let ctx = null;
  let musicBus = null;
  let sfxBus = null;
  let suspenseNodes = null;
  let riserNodes = null;

  let state = {
    muted: localStorage.getItem(STORAGE_MUTE) === 'true',
    musicVolume: parseFloat(localStorage.getItem(STORAGE_MUSIC_VOL) ?? '0.5'),
    sfxVolume: parseFloat(localStorage.getItem(STORAGE_SFX_VOL) ?? '0.8')
  };

  if (Number.isNaN(state.musicVolume)) state.musicVolume = 0.5;
  if (Number.isNaN(state.sfxVolume)) state.sfxVolume = 0.8;

  function ensureContext() {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;
    if (!ctx) {
      ctx = new AudioCtx();
      musicBus = ctx.createGain();
      sfxBus = ctx.createGain();
      musicBus.connect(ctx.destination);
      sfxBus.connect(ctx.destination);
      syncGains();
    }
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
    return ctx;
  }

  function syncGains() {
    if (!ctx || !musicBus || !sfxBus) return;
    const now = ctx.currentTime;
    const mVol = state.muted ? 0 : Math.max(0, Math.min(1, state.musicVolume));
    const sVol = state.muted ? 0 : Math.max(0, Math.min(1, state.sfxVolume));
    musicBus.gain.setTargetAtTime(mVol, now, 0.04);
    sfxBus.gain.setTargetAtTime(sVol, now, 0.04);
  }

  function unlockAudio() {
    ensureContext();
  }

  // Automatically unlock audio on first admin interaction
  ['click', 'keydown', 'pointerdown'].forEach((evt) => {
    window.addEventListener(evt, unlockAudio, { once: true, passive: true });
  });

  function setMuted(muted) {
    state.muted = Boolean(muted);
    localStorage.setItem(STORAGE_MUTE, state.muted ? 'true' : 'false');
    syncGains();
    if (state.muted) {
      stopSuspenseMusic();
      stopRiser();
    }
  }

  function setMusicVolume(val) {
    state.musicVolume = Math.max(0, Math.min(1, Number(val)));
    localStorage.setItem(STORAGE_MUSIC_VOL, String(state.musicVolume));
    syncGains();
  }

  function setSfxVolume(val) {
    state.sfxVolume = Math.max(0, Math.min(1, Number(val)));
    localStorage.setItem(STORAGE_SFX_VOL, String(state.sfxVolume));
    syncGains();
  }

  /**
   * 1. Suspenseful Background Music Pad (Warm low fifths D2 + A2 + E3, low-passed at 420Hz
   *    so it creates rich television suspense without clashing with human speech).
   */
  function startSuspenseMusic() {
    if (state.muted) return;
    const c = ensureContext();
    if (!c) return;
    stopSuspenseMusic();

    const now = c.currentTime;
    const masterGain = c.createGain();
    masterGain.gain.setValueAtTime(0.001, now);
    masterGain.gain.linearRampToValueAtTime(0.18, now + 0.8);

    const filter = c.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(380, now);
    filter.Q.setValueAtTime(2.2, now);

    // Subtle slow LFO breathing on filter
    const lfo = c.createOscillator();
    const lfoGain = c.createGain();
    lfo.frequency.setValueAtTime(0.35, now);
    lfoGain.gain.setValueAtTime(110, now);
    lfo.connect(lfoGain);
    lfoGain.connect(filter.frequency);

    const freqs = [73.42, 110.0, 146.83, 164.81]; // D2, A2, D3, E3 (suspended cinematic tension)
    const oscs = freqs.map((f, idx) => {
      const o = c.createOscillator();
      o.type = idx % 2 === 0 ? 'sawtooth' : 'triangle';
      o.frequency.setValueAtTime(f, now);
      o.detune.setValueAtTime(idx % 2 === 0 ? -4 : 4, now);
      const g = c.createGain();
      g.gain.setValueAtTime(idx < 2 ? 0.35 : 0.18, now);
      o.connect(g);
      g.connect(filter);
      o.start(now);
      return o;
    });

    // Subtle heartbeat pulse every 0.75s
    const pulseTimer = setInterval(() => {
      if (!ctx || state.muted || !suspenseNodes) return;
      const t = ctx.currentTime;
      const thump = ctx.createOscillator();
      const tg = ctx.createGain();
      thump.type = 'sine';
      thump.frequency.setValueAtTime(68, t);
      thump.frequency.exponentialRampToValueAtTime(36, t + 0.18);
      tg.gain.setValueAtTime(0.14, t);
      tg.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
      thump.connect(tg);
      tg.connect(musicBus);
      thump.start(t);
      thump.stop(t + 0.24);
    }, 780);

    filter.connect(masterGain);
    masterGain.connect(musicBus);
    lfo.start(now);

    suspenseNodes = { oscs, lfo, masterGain, pulseTimer };
  }

  function stopSuspenseMusic() {
    if (!suspenseNodes) return;
    const nodes = suspenseNodes;
    suspenseNodes = null;
    clearInterval(nodes.pulseTimer);
    try {
      if (ctx) {
        const now = ctx.currentTime;
        nodes.masterGain.gain.cancelScheduledValues(now);
        nodes.masterGain.gain.setTargetAtTime(0.0001, now, 0.08);
        setTimeout(() => {
          nodes.oscs.forEach((o) => {
            try { o.stop(); } catch (_) {}
          });
          try { nodes.lfo.stop(); } catch (_) {}
        }, 260);
      }
    } catch (_) {}
  }

  /**
   * 2. Dramatic Countdown Strike (3... 2... 1...)
   */
  function playCountdownStrike(numberLeft) {
    if (state.muted) return;
    const c = ensureContext();
    if (!c) return;

    const now = c.currentTime;
    const baseFreq = numberLeft === 1 ? 293.66 : numberLeft === 2 ? 246.94 : 220.0;

    // Deep timpani hit
    const sub = c.createOscillator();
    const subGain = c.createGain();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(130, now);
    sub.frequency.exponentialRampToValueAtTime(42, now + 0.42);
    subGain.gain.setValueAtTime(0.45, now);
    subGain.gain.exponentialRampToValueAtTime(0.001, now + 0.48);
    sub.connect(subGain);
    subGain.connect(sfxBus);
    sub.start(now);
    sub.stop(now + 0.5);

    // Brass chime accent
    const brass = c.createOscillator();
    const brassGain = c.createGain();
    brass.type = 'triangle';
    brass.frequency.setValueAtTime(baseFreq * 2, now);
    brassGain.gain.setValueAtTime(0.24, now);
    brassGain.gain.exponentialRampToValueAtTime(0.001, now + 0.55);
    brass.connect(brassGain);
    brassGain.connect(sfxBus);
    brass.start(now);
    brass.stop(now + 0.58);
  }

  /**
   * 3. Fast-paced Name Selection Tick (progress 0.0 -> 1.0)
   */
  function playSelectionTick(progress = 0) {
    if (state.muted) return;
    const c = ensureContext();
    if (!c) return;

    const now = c.currentTime;
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = 'triangle';
    const freq = 480 + Math.min(1, Math.max(0, progress)) * 340;
    osc.frequency.setValueAtTime(freq, now);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.55, now + 0.045);

    gain.gain.setValueAtTime(0.14, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);

    osc.connect(gain);
    gain.connect(sfxBus);
    osc.start(now);
    osc.stop(now + 0.055);
  }

  /**
   * 4. Participant Revealed Spotlight Chime
   */
  function playParticipantSpotlight() {
    if (state.muted) return;
    const c = ensureContext();
    if (!c) return;

    const now = c.currentTime;
    [440, 554.37, 659.25, 880].forEach((freq, idx) => {
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = 'triangle';
      const t = now + idx * 0.055;
      o.frequency.setValueAtTime(freq, t);
      g.gain.setValueAtTime(0.2, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.65);
      o.connect(g);
      g.connect(sfxBus);
      o.start(t);
      o.stop(t + 0.68);
    });
  }

  /**
   * 5. Rising Dramatic Swell During Flat-Number Reveal
   */
  function startFlatRevealRiser(durationMs = 2200) {
    if (state.muted) return;
    const c = ensureContext();
    if (!c) return;
    stopRiser();

    const durSec = Math.max(0.6, durationMs / 1000);
    const now = c.currentTime;

    const osc1 = c.createOscillator();
    const osc2 = c.createOscillator();
    const filter = c.createBiquadFilter();
    const gain = c.createGain();

    osc1.type = 'sawtooth';
    osc2.type = 'triangle';
    osc1.frequency.setValueAtTime(146.83, now);
    osc1.frequency.exponentialRampToValueAtTime(587.33, now + durSec);
    osc2.frequency.setValueAtTime(220.0, now);
    osc2.frequency.exponentialRampToValueAtTime(880.0, now + durSec);

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(320, now);
    filter.frequency.exponentialRampToValueAtTime(2800, now + durSec);

    gain.gain.setValueAtTime(0.02, now);
    gain.gain.linearRampToValueAtTime(0.22, now + durSec * 0.9);
    gain.gain.exponentialRampToValueAtTime(0.001, now + durSec + 0.12);

    osc1.connect(filter);
    osc2.connect(filter);
    filter.connect(gain);
    gain.connect(sfxBus);

    osc1.start(now);
    osc2.start(now);
    osc1.stop(now + durSec + 0.15);
    osc2.stop(now + durSec + 0.15);

    riserNodes = { osc1, osc2, gain };
  }

  function stopRiser() {
    if (!riserNodes) return;
    try {
      riserNodes.osc1.stop();
      riserNodes.osc2.stop();
    } catch (_) {}
    riserNodes = null;
  }

  /**
   * 6. Grand Celebration Fanfare + Energetic Crowd Clapping + Firecracker Bursts
   */
  function playCelebrationFanfare() {
    stopSuspenseMusic();
    stopRiser();
    if (state.muted) return;
    const c = ensureContext();
    if (!c) return;

    const now = c.currentTime;

    // Regal Brass & Chime Fanfare (D Major -> G Major -> A Major -> D Major Add9)
    const notes = [
      { f: 293.66, t: 0.0, d: 0.22, v: 0.26 },
      { f: 440.0, t: 0.14, d: 0.22, v: 0.26 },
      { f: 587.33, t: 0.28, d: 0.3, v: 0.28 },
      { f: 659.25, t: 0.46, d: 0.28, v: 0.26 },
      { f: 739.99, t: 0.64, d: 1.45, v: 0.32 },
      { f: 1174.66, t: 0.66, d: 1.55, v: 0.22 }
    ];

    notes.forEach((n) => {
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = 'triangle';
      o.frequency.setValueAtTime(n.f, now + n.t);
      g.gain.setValueAtTime(n.v, now + n.t);
      g.gain.exponentialRampToValueAtTime(0.001, now + n.t + n.d);
      o.connect(g);
      g.connect(musicBus);
      o.start(now + n.t);
      o.stop(now + n.t + n.d + 0.04);
    });

    // Warm Sustain Chord Underneath
    [293.66, 369.99, 440.0].forEach((cf) => {
      const pad = c.createOscillator();
      const pg = c.createGain();
      pad.type = 'sine';
      pad.frequency.setValueAtTime(cf, now + 0.64);
      pg.gain.setValueAtTime(0.14, now + 0.64);
      pg.gain.exponentialRampToValueAtTime(0.001, now + 2.5);
      pad.connect(pg);
      pg.connect(musicBus);
      pad.start(now + 0.64);
      pad.stop(now + 2.55);
    });

    // Energetic Multi-Layered Crowd Hand-Clapping & Applause
    playCrowdClapping(c, now + 0.1, 4.0);

    // Festive Firecracker Pops, Aerial Booms & Sparkle Crackles
    playFirecrackerBursts(c, now + 0.05);
  }

  /**
   * Synthesizes realistic, distinct hand-claps + lively auditorium crowd applause.
   */
  function playCrowdClapping(c, startTime, durationSec = 3.8) {
    try {
      const sampleRate = c.sampleRate;

      // A. 55 Distinct Individual Stereo Hand-Clap Transients (crisp palm impacts)
      const clapCount = 55;
      for (let k = 0; k < clapCount; k++) {
        const offset = Math.pow(Math.random(), 1.15) * (durationSec - 0.35);
        const clapTime = startTime + offset;
        const clapDur = 0.065 + Math.random() * 0.045;
        const len = Math.floor(sampleRate * clapDur);
        const buf = c.createBuffer(1, len, sampleRate);
        const chData = buf.getChannelData(0);

        // Double/triple micro-burst envelope characteristic of human hand claps
        for (let i = 0; i < len; i++) {
          const tNorm = i / len;
          const microSlap =
            Math.exp(-tNorm * 26) +
            0.65 * Math.exp(-Math.max(0, tNorm - 0.14) * 32) +
            0.35 * Math.exp(-Math.max(0, tNorm - 0.28) * 40);
          chData[i] = (Math.random() * 2 - 1) * microSlap;
        }

        const src = c.createBufferSource();
        src.buffer = buf;

        const bp = c.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.setValueAtTime(1100 + Math.random() * 1400, clapTime);
        bp.Q.setValueAtTime(1.4 + Math.random() * 1.2, clapTime);

        const g = c.createGain();
        // Fade out gently in the final second
        const fadeOut = offset > durationSec * 0.68 ? 1 - (offset - durationSec * 0.68) / (durationSec * 0.32) : 1;
        const peak = (0.22 + Math.random() * 0.25) * Math.max(0.15, fadeOut);
        g.gain.setValueAtTime(peak, clapTime);
        g.gain.exponentialRampToValueAtTime(0.001, clapTime + clapDur);

        src.connect(bp);
        bp.connect(g);

        if (typeof c.createStereoPanner === 'function') {
          const pan = c.createStereoPanner();
          pan.pan.setValueAtTime(Math.random() * 1.6 - 0.8, clapTime);
          g.connect(pan);
          pan.connect(sfxBus);
        } else {
          g.connect(sfxBus);
        }

        src.start(clapTime);
        src.stop(clapTime + clapDur + 0.01);
      }

      // B. Full Auditorium Applause Bed
      const length = Math.floor(sampleRate * durationSec);
      const buffer = c.createBuffer(2, length, sampleRate);

      for (let ch = 0; ch < 2; ch++) {
        const data = buffer.getChannelData(ch);
        let env = 0;
        for (let i = 0; i < length; i++) {
          if (i % Math.floor(sampleRate * 0.011) === 0) {
            env = 0.35 + Math.random() * 0.65;
          }
          env *= 0.9991;
          data[i] = (Math.random() * 2 - 1) * env;
        }
      }

      const noise = c.createBufferSource();
      noise.buffer = buffer;

      const bandpass = c.createBiquadFilter();
      bandpass.type = 'bandpass';
      bandpass.frequency.setValueAtTime(1350, startTime);
      bandpass.Q.setValueAtTime(0.75, startTime);

      const gain = c.createGain();
      gain.gain.setValueAtTime(0.001, startTime);
      gain.gain.linearRampToValueAtTime(0.32, startTime + 0.25);
      gain.gain.setValueAtTime(0.3, startTime + durationSec * 0.6);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + durationSec);

      noise.connect(bandpass);
      bandpass.connect(gain);
      gain.connect(sfxBus);

      noise.start(startTime);
      noise.stop(startTime + durationSec + 0.05);
    } catch (_) {}
  }

  /**
   * Synthesizes festive firecracker pops, aerial shells & sparkling ladi crackles.
   */
  function playFirecrackerBursts(c, startTime) {
    try {
      const sampleRate = c.sampleRate;

      // 4 Major Aerial Firework Shells (deep thump + sparkle crackle shower)
      const shellTimes = [0.0, 0.48, 1.05, 1.65];
      shellTimes.forEach((delay, idx) => {
        const t = startTime + delay;

        // Aerial shell bass boom
        const boom = c.createOscillator();
        const boomGain = c.createGain();
        boom.type = 'sine';
        boom.frequency.setValueAtTime(125 - idx * 10, t);
        boom.frequency.exponentialRampToValueAtTime(32, t + 0.28);
        boomGain.gain.setValueAtTime(0.42, t);
        boomGain.gain.exponentialRampToValueAtTime(0.001, t + 0.32);
        boom.connect(boomGain);
        boomGain.connect(sfxBus);
        boom.start(t);
        boom.stop(t + 0.34);

        // High-energy firecracker snap at burst
        const snapLen = Math.floor(sampleRate * 0.14);
        const snapBuf = c.createBuffer(1, snapLen, sampleRate);
        const sd = snapBuf.getChannelData(0);
        for (let i = 0; i < snapLen; i++) {
          sd[i] = (Math.random() * 2 - 1) * Math.exp((-i / snapLen) * 8);
        }
        const snapSrc = c.createBufferSource();
        snapSrc.buffer = snapBuf;
        const hp = c.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.setValueAtTime(900, t);
        const sg = c.createGain();
        sg.gain.setValueAtTime(0.38, t);
        sg.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
        snapSrc.connect(hp);
        hp.connect(sg);
        sg.connect(sfxBus);
        snapSrc.start(t);
        snapSrc.stop(t + 0.15);
      });

      // Rapid Firecracker "Ladi" Crackle Pops (18 sharp festive pops across 2.4s)
      for (let p = 0; p < 18; p++) {
        const popTime = startTime + 0.15 + p * 0.12 + Math.random() * 0.05;
        const popDur = 0.045;
        const len = Math.floor(sampleRate * popDur);
        const buf = c.createBuffer(1, len, sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < len; i++) {
          d[i] = (Math.random() * 2 - 1) * Math.exp((-i / len) * 14);
        }
        const src = c.createBufferSource();
        src.buffer = buf;

        const bp = c.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.setValueAtTime(2200 + Math.random() * 2600, popTime);
        bp.Q.setValueAtTime(1.8, popTime);

        const g = c.createGain();
        g.gain.setValueAtTime(0.24 + Math.random() * 0.14, popTime);
        g.gain.exponentialRampToValueAtTime(0.001, popTime + popDur);

        src.connect(bp);
        bp.connect(g);
        g.connect(sfxBus);
        src.start(popTime);
        src.stop(popTime + popDur + 0.01);
      }
    } catch (_) {}
  }

  function playClapAndFirecrackers() {
    if (state.muted) return;
    const c = ensureContext();
    if (!c) return;
    const now = c.currentTime;
    playCrowdClapping(c, now, 3.4);
    playFirecrackerBursts(c, now);
  }

  window.RPShowAudio = {
    unlock: unlockAudio,
    isMuted: () => state.muted,
    setMuted,
    getMusicVolume: () => state.musicVolume,
    setMusicVolume,
    getSfxVolume: () => state.sfxVolume,
    setSfxVolume,
    startSuspenseMusic,
    stopSuspenseMusic,
    playCountdownStrike,
    playSelectionTick,
    playParticipantSpotlight,
    startFlatRevealRiser,
    stopRiser,
    playCelebrationFanfare,
    playClapAndFirecrackers
  };
})();
