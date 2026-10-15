// Sound notifications (Web Audio, synthesised: no audio files). Browsers only allow sound after one click or key
// press on the page; until then a small hint is shown. ?sound=0 mutes, ?volume=0..1 sets the volume.
// Kiosk/beamer PC: start Chrome with --autoplay-policy=no-user-gesture-required to skip the click.
const qs = new URLSearchParams(location.search);
const ENABLED = qs.get('sound') !== '0';
const VOLUME = Math.max(0, Math.min(1, Number(qs.get('volume') ?? 0.6)));
let ac: AudioContext | null = null;
let last = 0;

function hint(show: boolean) {
  let el = document.getElementById('snd');
  if (!el && show) {
    el = document.createElement('div'); el.id = 'snd';
    el.textContent = '🔈 Klik op de projectie om geluid aan te zetten';
    el.style.cssText = 'position:fixed;right:18px;bottom:18px;z-index:20;font:600 15px system-ui,Segoe UI,Arial;color:#fff;background:rgba(16,26,32,0.6);padding:8px 14px;border-radius:999px;pointer-events:none';
    document.body.appendChild(el);
  }
  if (el) el.style.display = show ? 'block' : 'none';
}
function ctx() {
  if (!ENABLED) return null;
  if (!ac) {
    try { ac = new AudioContext(); } catch { return null; }
    const unlock = () => { void ac!.resume().then(() => { if (ac!.state === 'running') hint(false); }); };
    window.addEventListener('pointerdown', unlock); window.addEventListener('keydown', unlock);
  }
  return ac;
}
/** call once at start: creates the audio context and shows the hint when the browser blocks sound */
export function initSound() {
  const a = ctx(); if (!a) return;
  void a.resume().catch(() => {}).finally(() => { if (a.state !== 'running') hint(true); });
}

function tone(a: AudioContext, at: number, freq: number, dur: number, type: OscillatorType, gain: number) {
  const o = a.createOscillator(), g = a.createGain(), f = a.createBiquadFilter();
  o.type = type; o.frequency.value = freq;
  f.type = 'lowpass'; f.frequency.value = 2400;
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(gain * VOLUME, at + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  o.connect(f); f.connect(g); g.connect(a.destination);
  o.start(at); o.stop(at + dur + 0.05);
}

/** 'incident': soft two-tone chime; 'crisis': three urgent pulses and a low tone */
export function playNotification(kind: 'incident' | 'crisis') {
  const a = ctx(); if (!a) return;
  const now = performance.now();
  if (now - last < (kind === 'crisis' ? 300 : 1500)) return; // a burst of tasks gives one chime
  last = now;
  if (a.state !== 'running') { hint(true); void a.resume().catch(() => {}); if ((a.state as string) !== 'running') return; }
  const t = a.currentTime + 0.02;
  if (kind === 'incident') {
    tone(a, t, 784, 0.35, 'sine', 0.35); tone(a, t, 1568, 0.25, 'sine', 0.06);
    tone(a, t + 0.18, 1047, 0.55, 'sine', 0.35); tone(a, t + 0.18, 2094, 0.3, 'sine', 0.05);
  } else {
    for (let i = 0; i < 3; i++) tone(a, t + i * 0.22, 523, 0.16, 'square', 0.18);
    tone(a, t + 0.7, 392, 0.6, 'triangle', 0.3);
  }
}

// ------------------------------------------------------------------ ambience (birds by day, crickets at night, wind)
// Quiet background layer, synthesised. Enabled by the game master (/admin, Projectie) and with ?ambience=0 off.
const AMB_OFF = qs.get('ambience') === '0';
let amb: { wind: GainNode; rain: GainNode; next: number; nextQuack: number } | null = null;
function noiseBuffer(a: AudioContext) {
  const b = a.createBuffer(1, a.sampleRate * 2, a.sampleRate), d = b.getChannelData(0);
  let last = 0;
  for (let i = 0; i < d.length; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = last * 3.5; } // brown-ish noise
  return b;
}
function chirp(a: AudioContext, at: number, f0: number, f1: number, dur: number, gain: number) {
  const o = a.createOscillator(), g = a.createGain();
  o.type = 'sine'; o.frequency.setValueAtTime(f0, at); o.frequency.exponentialRampToValueAtTime(f1, at + dur);
  g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(gain, at + dur * 0.25); g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  o.connect(g); g.connect(a.destination); o.start(at); o.stop(at + dur + 0.02);
}
/** call about twice a second with the current settings; dark 0 (day) .. 1 (night) */
export function ambienceTick(enabled: boolean, dark: number, weather = 'zon') {
  const a = ac;
  if (!a || a.state !== 'running' || AMB_OFF || !ENABLED) return;
  const vol = VOLUME * 0.35;
  if (!amb) {
    const src = a.createBufferSource(); src.buffer = noiseBuffer(a); src.loop = true;
    const f = a.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 380;
    const g = a.createGain(); g.gain.value = 0;
    src.connect(f); f.connect(g); g.connect(a.destination); src.start();
    // rain: white-ish noise through a band-pass (hiss of drops), only audible when it rains
    const rs = a.createBufferSource(); rs.buffer = whiteNoise(a); rs.loop = true;
    const rf = a.createBiquadFilter(); rf.type = 'bandpass'; rf.frequency.value = 2600; rf.Q.value = 0.6;
    const rg = a.createGain(); rg.gain.value = 0;
    rs.connect(rf); rf.connect(rg); rg.connect(a.destination); rs.start();
    amb = { wind: g, rain: rg, next: a.currentTime + 1, nextQuack: a.currentTime + 15 };
  }
  const t = a.currentTime;
  // wind: slow swell
  const wet = weather === 'onweer' ? 1 : weather === 'regen' ? 0.6 : 0;
  const windy = weather === 'onweer' ? 2.2 : weather === 'regen' ? 1.5 : 1;
  amb.wind.gain.setTargetAtTime(enabled ? vol * windy * (0.05 + 0.03 * Math.sin(t / 7)) : 0, t, 1.5);
  amb.rain.gain.setTargetAtTime(enabled ? vol * 0.12 * wet : 0, t, 2);
  if (wet > 0) { if (enabled && t >= amb.next) amb.next = t + 2; return; } // no birds or crickets in the rain
  if (!enabled || t < amb.next) return;
  if (dark < 0.5) {
    // a bird: 2-5 quick chirps
    const n = 2 + Math.floor(Math.random() * 4), base = 2600 + Math.random() * 2200, g = vol * (0.05 + Math.random() * 0.05);
    for (let i = 0; i < n; i++) chirp(a, t + i * (0.09 + Math.random() * 0.05), base * (1 + Math.random() * 0.2), base * (0.75 + Math.random() * 0.5), 0.07 + Math.random() * 0.05, g);
    amb.next = t + 1.2 + Math.random() * 4.5;
    if (t > amb.nextQuack) { // the ducks on the pond
      for (let i = 0; i < 2 + Math.floor(Math.random() * 2); i++) {
        const at = t + 0.6 + i * 0.28, o = a.createOscillator(), f = a.createBiquadFilter(), gq = a.createGain();
        o.type = 'sawtooth'; o.frequency.setValueAtTime(320, at); o.frequency.linearRampToValueAtTime(240, at + 0.16);
        f.type = 'bandpass'; f.frequency.value = 1100; f.Q.value = 3;
        gq.gain.setValueAtTime(0.0001, at); gq.gain.exponentialRampToValueAtTime(vol * 0.12, at + 0.02); gq.gain.exponentialRampToValueAtTime(0.0001, at + 0.18);
        o.connect(f); f.connect(gq); gq.connect(a.destination); o.start(at); o.stop(at + 0.2);
      }
      amb.nextQuack = t + 25 + Math.random() * 40;
    }
  } else {
    // crickets: a train of short high pulses
    const f0 = 4300 + Math.random() * 500, g = vol * 0.035;
    for (let i = 0; i < 6; i++) chirp(a, t + i * 0.055, f0, f0 * 0.98, 0.035, g);
    amb.next = t + 0.6 + Math.random() * 1.4;
  }
}

function whiteNoise(a: AudioContext) {
  const b = a.createBuffer(1, a.sampleRate * 2, a.sampleRate), d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return b;
}
/** a rumble of thunder (after a lightning flash on the projector) */
export function playThunder() {
  const a = ac;
  if (!a || a.state !== 'running' || AMB_OFF || !ENABLED) return;
  const at = a.currentTime + 0.6 + Math.random() * 1.2; // sound arrives a moment after the flash
  const src = a.createBufferSource(); src.buffer = noiseBuffer(a);
  const f = a.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(900, at); f.frequency.exponentialRampToValueAtTime(120, at + 2.5);
  const g = a.createGain(); g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(VOLUME * 0.9, at + 0.08); g.gain.exponentialRampToValueAtTime(0.0001, at + 3.2);
  src.connect(f); f.connect(g); g.connect(a.destination); src.start(at); src.stop(at + 3.4);
}
