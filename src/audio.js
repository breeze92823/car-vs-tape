// Synthesised audio (no sound files): an engine drone whose pitch follows the
// wheel speed, a tyre hiss for drifts/burnouts, and one-shot effects (tape
// stretch twang, snap, win chime, level-up arpeggio, bump, boost whoosh,
// purchase). The context starts on the first user gesture; M mutes.
let ctx = null
let master = null
let engine = null
const SAVE_KEY = 'cvt_audio_v1'
const MUSIC_VOL = 0.08 // music at slider 100%: sits well under the effects
const SFX_VOL = 0.55
const prefs = { music: true, sfx: true, musicVol: 1, sfxVol: 1 } // vols are 0..1 slider values
try {
  Object.assign(prefs, JSON.parse(localStorage.getItem(SAVE_KEY) || '{}'))
} catch {}
let musicEl = null
let noiseBuf = null

function init() {
  if (ctx) return
  const AC = window.AudioContext || window.webkitAudioContext
  if (!AC) return
  ctx = new AC()
  master = ctx.createGain()
  master.gain.value = sfxLevel()
  master.connect(ctx.destination)
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate)
  const d = noiseBuf.getChannelData(0)
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
  // Engine: saw + square an octave down, through a lowpass that opens with throttle.
  const saw = ctx.createOscillator()
  saw.type = 'sawtooth'
  const sq = ctx.createOscillator()
  sq.type = 'square'
  const lp = ctx.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.value = 500
  lp.Q.value = 3
  const g = ctx.createGain()
  g.gain.value = 0
  const sqGain = ctx.createGain()
  sqGain.gain.value = 0.5
  saw.connect(lp)
  sq.connect(sqGain).connect(lp)
  lp.connect(g).connect(master)
  // Tyre hiss: looped noise through a bandpass.
  const hiss = ctx.createBufferSource()
  hiss.buffer = noiseBuf
  hiss.loop = true
  const bp = ctx.createBiquadFilter()
  bp.type = 'bandpass'
  bp.frequency.value = 1800
  bp.Q.value = 0.8
  const hg = ctx.createGain()
  hg.gain.value = 0
  hiss.connect(bp).connect(hg).connect(master)
  saw.start()
  sq.start()
  hiss.start()
  engine = { saw, sq, lp, g, hg }
}

const sfxLevel = () => (prefs.sfx ? SFX_VOL * prefs.sfxVol : 0)

function applyPrefs() {
  if (master) master.gain.value = sfxLevel()
  if (musicEl) {
    musicEl.volume = MUSIC_VOL * prefs.musicVol
    if (prefs.music) musicEl.play?.().catch(() => {})
    else musicEl.pause()
  }
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(prefs))
  } catch {}
}

function startMusic() {
  if (!musicEl) {
    musicEl = new Audio(`${import.meta.env.BASE_URL}sound/music_back.mp3`)
    musicEl.loop = true
    musicEl.volume = MUSIC_VOL * prefs.musicVol
  }
  if (prefs.music && musicEl.paused) musicEl.play().catch(() => {})
}

export function installAudio() {
  const start = () => {
    init()
    ctx?.resume?.()
    startMusic()
  }
  window.addEventListener('pointerdown', start, { capture: true })
  window.addEventListener('keydown', start, { capture: true })
}

export const getAudioPrefs = () => ({ ...prefs })
export function setAudioPref(key, on) {
  prefs[key] = !!on
  applyPrefs()
}
// key: 'musicVol' | 'sfxVol', v 0..1. Dragging the slider up un-mutes that channel.
export function setAudioVolume(key, v) {
  prefs[key] = Math.min(1, Math.max(0, v))
  if (key === 'musicVol' && v > 0) prefs.music = true
  if (key === 'sfxVol' && v > 0) prefs.sfx = true
  applyPrefs()
}
// M key: silence everything, or bring everything back.
export function toggleMute() {
  const next = !(prefs.music || prefs.sfx)
  prefs.music = prefs.sfx = next
  applyPrefs()
  return !next
}
export const isMuted = () => !prefs.music && !prefs.sfx

// speedK 0..1, throttle -1..1, skid 0..1
export function updateEngine(speedK, throttle, skid) {
  if (!engine) return
  const t = ctx.currentTime
  // A fake 4-gear sweep: pitch climbs within each gear, drops at the shift.
  const gears = 4
  const g = Math.min(gears - 1, Math.floor(speedK * gears))
  const inGear = speedK * gears - g
  const f = 55 + inGear * 70 + g * 12 + Math.abs(throttle) * 8
  engine.saw.frequency.setTargetAtTime(f, t, 0.05)
  engine.sq.frequency.setTargetAtTime(f / 2, t, 0.05)
  engine.lp.frequency.setTargetAtTime(380 + Math.abs(throttle) * 900 + speedK * 600, t, 0.08)
  engine.g.gain.setTargetAtTime(0.05 + Math.abs(throttle) * 0.07 + speedK * 0.04, t, 0.1)
  engine.hg.gain.setTargetAtTime(skid * 0.12, t, 0.08)
}

function tone(freq, dur, { type = 'sine', gain = 0.2, slide = 0, delay = 0 } = {}) {
  if (!ctx) return
  const t = ctx.currentTime + delay
  const o = ctx.createOscillator()
  o.type = type
  o.frequency.setValueAtTime(freq, t)
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), t + dur)
  const g = ctx.createGain()
  g.gain.setValueAtTime(0, t)
  g.gain.linearRampToValueAtTime(gain, t + 0.01)
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  o.connect(g).connect(master)
  o.start(t)
  o.stop(t + dur + 0.05)
}

function noise(dur, { freq = 1200, q = 1, gain = 0.3, type = 'bandpass', delay = 0 } = {}) {
  if (!ctx) return
  const t = ctx.currentTime + delay
  const s = ctx.createBufferSource()
  s.buffer = noiseBuf
  const f = ctx.createBiquadFilter()
  f.type = type
  f.frequency.value = freq
  f.Q.value = q
  const g = ctx.createGain()
  g.gain.setValueAtTime(gain, t)
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  s.connect(f).connect(g).connect(master)
  s.start(t, Math.random() * 0.5)
  s.stop(t + dur + 0.05)
}

export const sfx = {
  snap() {
    noise(0.25, { freq: 2500, q: 0.7, gain: 0.5 })
    tone(900, 0.25, { type: 'triangle', gain: 0.18, slide: 0.3 })
    tone(220, 0.35, { type: 'sine', gain: 0.25, slide: 0.5 })
  },
  stretch() {
    tone(120, 0.6, { type: 'sawtooth', gain: 0.08, slide: 2.4 })
  },
  twang() {
    tone(160, 0.5, { type: 'triangle', gain: 0.22, slide: 0.45 })
    tone(240, 0.35, { type: 'square', gain: 0.06, slide: 0.5 })
  },
  win() {
    ;[880, 1175, 1568].forEach((f, i) => tone(f, 0.18, { type: 'triangle', gain: 0.12, delay: i * 0.06 }))
  },
  levelUp() {
    ;[523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.25, { type: 'square', gain: 0.06, delay: i * 0.07 }))
  },
  bump(k = 1) {
    tone(70, 0.2, { gain: 0.3 * k, slide: 0.6 })
    noise(0.12, { freq: 400, gain: 0.25 * k, type: 'lowpass' })
  },
  boost() {
    noise(0.8, { freq: 600, q: 0.5, gain: 0.3 })
    tone(200, 0.8, { type: 'sawtooth', gain: 0.06, slide: 4 })
  },
  // Rocket boost ignition: a low roar that sweeps up, a hiss and a thump.
  rocket() {
    noise(1.6, { freq: 700, q: 0.4, gain: 0.5, type: 'lowpass' })
    noise(0.9, { freq: 2600, q: 0.8, gain: 0.22 })
    tone(70, 1.4, { type: 'sawtooth', gain: 0.1, slide: 3.2 })
    tone(55, 0.3, { type: 'sine', gain: 0.35, slide: 0.5 })
  },
  buy() {
    ;[660, 990].forEach((f, i) => tone(f, 0.15, { type: 'triangle', gain: 0.14, delay: i * 0.08 }))
  },
  error() {
    tone(180, 0.18, { type: 'square', gain: 0.08 })
    tone(140, 0.2, { type: 'square', gain: 0.08, delay: 0.1 })
  },
  click() {
    tone(1200, 0.05, { type: 'triangle', gain: 0.06 })
  },
  // Two-note car horn (a major third), held with a quick attack and release.
  horn(dur = 0.42) {
    if (!ctx) return
    const t = ctx.currentTime
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 1700
    lp.Q.value = 2
    const g = ctx.createGain()
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(0.11, t + 0.02)
    g.gain.setValueAtTime(0.11, t + dur - 0.06)
    g.gain.linearRampToValueAtTime(0, t + dur)
    lp.connect(g).connect(master)
    for (const f of [392, 494]) {
      const o = ctx.createOscillator()
      o.type = 'square'
      o.frequency.setValueAtTime(f, t)
      o.connect(lp)
      o.start(t)
      o.stop(t + dur + 0.02)
    }
  },
}
