import './hud.css'
import { CARS, TRACK } from './config.js'
import { boostLeft, carDef, chest, chestLeft, chestProgress, fmt, levelMult, levelNeed, rebirthCost, rebirthMult, state } from './game.js'
import { getAudioPrefs, setAudioPref } from './audio.js'
import * as bloxity from './bloxity.js'
import { createPanels } from './ui/panels.js'
import { setWindowReserved } from './ui/window.js'

// The DOM HUD over the canvas. Only touches the DOM when a shown value changes.
const ICON = {
  bolt: '<svg viewBox="0 0 48 64"><defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#9ff0ff"/><stop offset="1" stop-color="#1f7bff"/></linearGradient></defs><path d="M30 2L6 36h14l-6 26L42 24H27z" fill="url(#bg)" stroke="#fff" stroke-width="4" stroke-linejoin="round" paint-order="stroke"/><path d="M30 2L6 36h14l-6 26L42 24H27z" fill="url(#bg)" stroke="#0b3a8a" stroke-width="1.5" stroke-linejoin="round"/><path d="M28 9L14 30" stroke="#fff" stroke-opacity=".8" stroke-width="3" stroke-linecap="round"/></svg>',
  trophy: '<svg viewBox="0 0 64 64"><path d="M18 8h28v14a14 14 0 0 1-28 0z" fill="#ffc21a" stroke="#0b1a3a" stroke-width="4"/><path d="M18 14H8c0 10 5 15 12 15M46 14h10c0 10-5 15-12 15" fill="none" stroke="#0b1a3a" stroke-width="5"/><path d="M18 14H8c0 10 5 15 12 15M46 14h10c0 10-5 15-12 15" fill="none" stroke="#ffc21a" stroke-width="2.5"/><rect x="27" y="35" width="10" height="10" fill="#e8a010" stroke="#0b1a3a" stroke-width="4"/><rect x="18" y="45" width="28" height="11" rx="3" fill="#ffc21a" stroke="#0b1a3a" stroke-width="4"/><path d="M24 12v9" stroke="#fff7c0" stroke-width="4" stroke-linecap="round"/></svg>',
  rebirth: '<svg viewBox="0 0 64 64"><circle cx="32" cy="32" r="24" fill="#e04dff" stroke="#0b1a3a" stroke-width="4"/><path d="M20 30a12 12 0 0 1 21-8M44 34a12 12 0 0 1-21 8" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round"/><path d="M42 14v9h-9M22 50v-9h9" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  car: '<svg viewBox="0 0 96 60"><path d="M10 40c0-8 4-12 10-13l9-13c2-3 5-4 8-4h22c3 0 6 1 8 4l9 13c6 1 10 5 10 13v8H10z" fill="#2aa8ff" stroke="#0b1a3a" stroke-width="5" stroke-linejoin="round"/><path d="M31 25l6-9h22l6 9z" fill="#0b1a3a"/><circle cx="26" cy="49" r="9" fill="#0b1a3a"/><circle cx="70" cy="49" r="9" fill="#0b1a3a"/><circle cx="26" cy="49" r="4" fill="#c9ced8"/><circle cx="70" cy="49" r="4" fill="#c9ced8"/><rect x="14" y="34" width="10" height="6" rx="2" fill="#fff"/><rect x="72" y="34" width="10" height="6" rx="2" fill="#fff"/></svg>',
  carRed: '<svg viewBox="0 0 96 60"><path d="M10 40c0-8 4-12 10-13l9-13c2-3 5-4 8-4h22c3 0 6 1 8 4l9 13c6 1 10 5 10 13v8H10z" fill="#ff3b3b" stroke="#0b1a3a" stroke-width="5" stroke-linejoin="round"/><path d="M31 25l6-9h22l6 9z" fill="#0b1a3a"/><circle cx="26" cy="49" r="9" fill="#0b1a3a"/><circle cx="70" cy="49" r="9" fill="#0b1a3a"/><rect x="14" y="34" width="10" height="6" rx="2" fill="#fff"/><rect x="72" y="34" width="10" height="6" rx="2" fill="#fff"/></svg>',
  treadmill: '<svg viewBox="0 0 64 64"><path d="M8 52h48M50 52L42 18h-10" fill="none" stroke="#0b1a3a" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/><path d="M8 52h48M50 52L42 18h-10" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><rect x="6" y="54" width="52" height="6" rx="3" fill="#0b1a3a"/></svg>',
  flag: '<svg viewBox="0 0 64 64"><path d="M14 58V8" stroke="#0b1a3a" stroke-width="7" stroke-linecap="round"/><path d="M14 58V8" stroke="#fff" stroke-width="3" stroke-linecap="round"/><path d="M16 10h36l-8 11 8 11H16z" fill="#fff" stroke="#0b1a3a" stroke-width="4" stroke-linejoin="round"/><path d="M16 10h9v11h-9zM34 10h9v11h-9zM25 21h9v11h-9z" fill="#0b1a3a"/></svg>',
  gear: '<svg viewBox="0 0 64 64"><path d="M27 6h10l2 8 5 2 7-4 7 7-4 7 2 5 8 2v10l-8 2-2 5 4 7-7 7-7-4-5 2-2 8H27l-2-8-5-2-7 4-7-7 4-7-2-5-8-2V27l8-2 2-5-4-7 7-7 7 4 5-2z" transform="translate(0 0) scale(.82) translate(7 7)" fill="#fff" stroke="#0b1a3a" stroke-width="4" stroke-linejoin="round"/><circle cx="32" cy="32" r="8" fill="#5b6480" stroke="#0b1a3a" stroke-width="4"/></svg>',
  sound: '<svg viewBox="0 0 64 64"><path d="M10 24h10l14-12v40L20 40H10z" fill="#fff" stroke="#0b1a3a" stroke-width="4" stroke-linejoin="round"/><path d="M42 22a14 14 0 0 1 0 20M48 16a22 22 0 0 1 0 32" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round"/></svg>',
  gift: '<svg viewBox="0 0 64 64"><rect x="8" y="26" width="48" height="32" rx="4" fill="#ff8a14" stroke="#0b1a3a" stroke-width="4"/><rect x="5" y="18" width="54" height="12" rx="3" fill="#ffb31a" stroke="#0b1a3a" stroke-width="4"/><path d="M32 18v40" stroke="#ffd21a" stroke-width="8"/><path d="M32 18v40" stroke="#0b1a3a" stroke-width="2"/><path d="M32 18c-6-12-20-12-18-3 1 4 10 4 18 3zM32 18c6-12 20-12 18-3-1 4-10 4-18 3z" fill="#ffd21a" stroke="#0b1a3a" stroke-width="4" stroke-linejoin="round"/></svg>',
  mute: '<svg viewBox="0 0 64 64"><path d="M10 24h10l14-12v40L20 40H10z" fill="#fff" stroke="#0b1a3a" stroke-width="4" stroke-linejoin="round"/><path d="M42 24l14 16M56 24L42 40" stroke="#ff4a4a" stroke-width="5" stroke-linecap="round"/></svg>',
}

function el(tag, cls, html = '') {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  e.innerHTML = html
  return e
}

export function createHud(actions) {
  let hudOn = true
  const root = el('div', '')
  root.id = 'hud'
  document.body.appendChild(root)

  const lines = el('canvas', 'speedlines')
  const flash = el('div', 'flash')
  root.append(lines, flash)

  // Top row.
  const top = el('div', 'hud-top')
  const autoBtn = el('button', 'auto-btn ol', 'Auto Drive<span class="tag">OFF</span>')
  autoBtn.type = 'button'
  autoBtn.addEventListener('click', () => actions.onAuto())
  const boost = el('div', 'boost-chip ol', '')
  // Free Boost chest progress (game.chest, counted by the server): always in view, so the hour
  // of play is a goal the player can see filling.
  const chestChip = el('div', 'chest-chip ol', `${ICON.gift}<span></span><i></i>`)
  const chestTxt = chestChip.querySelector('span')
  const chestBar = chestChip.querySelector('i')
  top.append(autoBtn, boost, chestChip)

  // Left column.
  const left = el('div', 'hud-left')
  const wins = el('div', 'counter wins ol', `${ICON.trophy}<span>0</span>`)
  const rebs = el('div', 'counter reb ol', `${ICON.rebirth}<span>0</span>`)
  const tiles = el('div', 'tiles')
  const tile = (cls, icon, text, fn) => {
    const b = el('button', `tile ${cls}`, `${icon}<span class="lbl ol">${text}</span><span class="dot"></span>`)
    b.type = 'button'
    b.addEventListener('click', fn)
    tiles.append(b)
    return b
  }
  const carsTile = tile('cars', ICON.carRed, 'CARS', () => actions.onShop())
  const rebTile = tile('reb', ICON.rebirth, 'REBIRTH', () => actions.onRebirth())
  tile('train', ICON.treadmill, 'TRAIN', () => actions.onTrain())
  tile('track', ICON.flag, 'TRACK', () => actions.onTrack())
  tile('sound', ICON.gear, 'SOUND', () => openSettings())
  left.append(wins, rebs, tiles)

  // Right: next tape.
  const right = el('div', 'hud-right ol')
  right.innerHTML = '<div class="h">NEXT TAPE</div><div class="need"></div><div class="pay"></div><div class="bar"><i></i></div><div class="ready"></div>'
  const needEl = right.querySelector('.need')
  const payEl = right.querySelector('.pay')
  const barEl = right.querySelector('.bar i')
  const readyEl = right.querySelector('.ready')

  // Bottom.
  const bottom = el('div', 'hud-bottom')
  const power = el('div', 'power ol', '0 Power')
  const rate = el('div', 'rate ol', '')
  const level = el('div', 'levelbar', `${ICON.car}<div class="fill"></div><span class="lv ol">Level 1</span><span class="xp ol">0 / 0</span>`)
  const fill = level.querySelector('.fill')
  const lv = level.querySelector('.lv')
  const xp = level.querySelector('.xp')
  const mults = el('div', 'mults ol')
  bottom.append(power, rate, level, mults)

  const prompt = el('button', 'prompt ol', '')
  prompt.type = 'button'
  prompt.addEventListener('click', () => actions.onPrompt())
  const home = el('button', 'home-btn ol', 'Back to Town')
  home.type = 'button'
  home.addEventListener('click', () => actions.onHome())
  const toasts = el('div', 'toasts')
  const banner = el('div', 'banner ol', '')
  const popups = el('div', 'popups')
  root.append(top, left, right, bottom, prompt, home, toasts, banner, popups)

  // Keep clear of Boxity's toolbar + chat (top-left).
  bloxity.onReservedAreas((areas) => {
    setWindowReserved(areas)
    let leftBottom = 0
    let topH = 0
    let topW = 0
    for (const a of areas) {
      if (a.left < 260) leftBottom = Math.max(leftBottom, a.top + a.height)
      if (a.top < 10) {
        topH = Math.max(topH, a.height)
        topW = Math.max(topW, a.left + a.width)
      }
    }
    // On short landscape phones the chat area would push the column off screen: use the toolbar only.
    if (window.innerHeight < 520) leftBottom = Math.min(leftBottom, topH)
    root.style.setProperty('--res-left-top', `${leftBottom}px`)
    root.style.setProperty('--res-top-h', `${topH}px`)
    root.style.setProperty('--res-top-w', `${topW}px`)
  })

  // --- Speed lines -----------------------------------------------------------------
  const lctx = lines.getContext('2d')
  const streaks = Array.from({ length: 70 }, () => ({ a: Math.random() * Math.PI * 2, r: Math.random(), s: 0.5 + Math.random(), w: 1 + Math.random() * 3 }))
  function drawLines(k, dt) {
    lines.style.opacity = k.toFixed(2)
    if (k < 0.02) return
    const w = Math.floor(window.innerWidth / 2)
    const h = Math.floor(window.innerHeight / 2)
    if (lines.width !== w) lines.width = w
    if (lines.height !== h) lines.height = h
    const cx = w / 2
    const cy = h * 0.55
    const R = Math.hypot(w, h) / 2
    lctx.clearRect(0, 0, w, h)
    lctx.strokeStyle = 'rgba(255,255,255,0.55)'
    for (const s of streaks) {
      s.r += dt * s.s * 2.2
      if (s.r > 1) {
        s.r = 0.25 + Math.random() * 0.2
        s.a = Math.random() * Math.PI * 2
      }
      const r0 = R * s.r
      const r1 = r0 + R * 0.18 * s.s
      lctx.lineWidth = s.w
      lctx.beginPath()
      lctx.moveTo(cx + Math.cos(s.a) * r0, cy + Math.sin(s.a) * r0)
      lctx.lineTo(cx + Math.cos(s.a) * r1, cy + Math.sin(s.a) * r1)
      lctx.stroke()
    }
  }

  // --- Windows (lego shell shared with Trains vs Spaghetti: ui/window.js) ---
  const panels = createPanels(
    {
      ...actions,
      onHudVisible(on) {
        hudOn = on
        root.classList.toggle('hud-off', !on)
      },
    },
    { car: ICON.carRed, rebirth: ICON.rebirth, gear: ICON.gear },
  )
  const { openShop, openRebirth, openSettings, close, isOpen } = panels

  // --- Feedback ----------------------------------------------------------------------
  function toast(text, kind = '') {
    const t = el('div', `toast ol ${kind}`, text)
    toasts.append(t)
    while (toasts.children.length > 3) toasts.firstChild.remove()
    setTimeout(() => t.remove(), 2700)
  }
  function showBanner(text, color = '#ffd21a') {
    banner.textContent = text
    banner.style.color = color
    banner.classList.remove('go')
    void banner.offsetWidth
    banner.classList.add('go')
  }
  function popup(text, x, y, kind = 'power') {
    if (popups.children.length > 14) popups.firstChild.remove()
    const p = el('div', `popup ol ${kind}`, kind === 'power' ? `<span class="bolt">${ICON.bolt}</span><b>${text}</b>` : text)
    p.style.setProperty('--tilt', `${(Math.random() - 0.5) * 16}deg`)
    p.style.left = `${x}px`
    p.style.top = `${y}px`
    popups.append(p)
    setTimeout(() => p.remove(), 1700)
  }
  function doFlash() {
    flash.classList.remove('go')
    void flash.offsetWidth
    flash.classList.add('go')
  }

  // --- Per-frame update ---------------------------------------------------------------
  const shown = {}
  const set = (key, value, fn) => {
    if (shown[key] === value) return
    shown[key] = value
    fn(value)
  }
  return {
    toast,
    banner: showBanner,
    popup,
    flash: doFlash,
    openShop,
    openRebirth,
    openSettings,
    close,
    isOpen,
    bumpPower() {
      power.classList.add('bump')
      setTimeout(() => power.classList.remove('bump'), 90)
    },
    update(dt, info) {
      set('power', fmt(state.power), (v) => (power.textContent = `${v} Power`))
      set('rate', info.rate > 0.05 ? `+${fmt(info.rate, 1)}/s` : '', (v) => (rate.textContent = v))
      set('wins', fmt(state.wins), (v) => (wins.querySelector('span').textContent = v))
      set('rebs', state.rebirths, (v) => (rebs.querySelector('span').textContent = v))
      const need = levelNeed()
      set('lv', state.level, (v) => (lv.textContent = `Level ${v}`))
      set('xp', `${Math.floor(state.xp)} / ${need}`, (v) => (xp.textContent = v))
      set('fill', Math.round((state.xp / need) * 200) / 2, (v) => (fill.style.width = `${v}%`))
      set('auto', state.autoDrive, (v) => {
        autoBtn.classList.toggle('on', v)
        autoBtn.querySelector('.tag').textContent = v ? 'ON' : 'OFF'
      })
      const bl = boostLeft()
      set('boost', bl > 0 ? `x2 POWER ${Math.floor(bl / 60)}:${String(Math.floor(bl % 60)).padStart(2, '0')}` : '', (v) => {
        boost.textContent = v
        boost.classList.toggle('show', !!v)
      })
      const cl = chestLeft()
      const chestText = !chest.known ? '' : cl < 0 ? 'Sign in' : cl === 0 ? 'FREE BOOST READY!' : `${Math.floor(cl / 60)}:${String(Math.floor(cl % 60)).padStart(2, '0')}`
      set('chest', chestText, (v) => {
        chestTxt.textContent = v
        chestChip.classList.toggle('show', !!v)
        chestChip.classList.toggle('ready', cl === 0)
        chestChip.classList.toggle('guest', cl < 0)
      })
      set('chestBar', Math.round(chestProgress() * 100), (v) => (chestBar.style.width = `${v}%`))
      // Next tape.
      const i = info.nextTape
      const t = TRACK.tapes[i]
      set('tape', `${i}|${state.bestTape}`, () => {
        needEl.textContent = `#${i + 1}  ${fmt(t.power)}`
        payEl.textContent = `+${t.wins} Wins`
      })
      const k = Math.min(1, state.power / t.power)
      set('tapebar', Math.round(k * 100), (v) => (barEl.style.width = `${v}%`))
      set('ready', k >= 1 ? 'Strong enough!' : 'Train more', (v) => {
        readyEl.textContent = v
        readyEl.style.color = k >= 1 ? '#7dff5a' : '#ffb3c4'
      })
      set('mults', `${carDef().mult}|${state.rebirths}|${state.level}|${info.pad}|${bl > 0}`, () => {
        const chips = [`Car x${carDef().mult}`, `Rebirth x${rebirthMult().toFixed(1)}`, `Level x${levelMult().toFixed(1)}`]
        let html = chips.map((c) => `<span>${c}</span>`).join('')
        if (info.pad) html += `<span class="hot">Treadmill x${info.pad}</span>`
        if (bl > 0) html += '<span class="hot">Boost x2</span>'
        mults.innerHTML = html
      })
      set('prompt', info.prompt ?? '', (v) => {
        prompt.innerHTML = v ? `<kbd>E</kbd>${v}` : ''
        prompt.classList.toggle('show', !!v)
      })
      set('home', !!info.onTrack, (v) => home.classList.toggle('show', v))
      const affordable = CARS.some((c) => !state.owned.includes(c.id) && state.wins >= c.cost)
      set('carDot', affordable, (v) => carsTile.querySelector('.dot').classList.toggle('show', v))
      set('rebDot', state.wins >= rebirthCost(), (v) => rebTile.querySelector('.dot').classList.toggle('show', v))
      drawLines(info.speedLines, dt)
    },
  }
}
