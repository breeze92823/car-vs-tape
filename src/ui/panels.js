// The three lego windows (Car Shop, Rebirth, Settings), built on the shared window shell
// (window.js / window.css, copied from Trains vs Spaghetti so both games share one layout).
import './panels.css'
import './panels-shop.css'
import { CARS, TREADMILLS } from '../config.js'
import { fmt, rebirthCost, rebirthMult, state } from '../game.js'
import { getAudioPrefs, setAudioPref, setAudioVolume } from '../audio.js'
import { createWindow, legoButton, olText, replay } from './window.js'
import { fitText, fontsReady } from './fitText.js'

const ARROW =
  '<svg viewBox="0 0 60 70" aria-hidden="true"><path d="M8 6 L54 35 L8 64 Z" fill="#141016" stroke="#141016" stroke-width="10" stroke-linejoin="round"/><path d="M8 6 L54 35 L8 64 Z" fill="#fff" stroke="#fff" stroke-width="2" stroke-linejoin="round"/><path d="M8 40 L54 35 L8 64 Z" fill="#d6dce6"/></svg>'
const div = (cls, html = '') => {
  const d = document.createElement('div')
  d.className = cls
  d.innerHTML = html
  return d
}

export function createPanels(actions, icons) {
  const onOpen = () => actions.onWindow(true)
  const onClose = () => {
    if (!all.some((w) => w.isOpen())) actions.onWindow(false)
  }

  // --- Car Shop ---
  let thumbs = null
  const shop = createWindow({
    title: 'Car Shop',
    icon: icons.car,
    color: '#18a6e0',
    closeColor: '#ff1a8c',
    className: 'cs-window',
    onOpen: () => {
      onOpen()
      renderShop()
      loadThumbs()
    },
    onClose,
  })
  shop.body.classList.add('cs-body')
  const strip = div('cs-strip')
  shop.body.append(strip)
  strip.addEventListener(
    'wheel',
    (e) => {
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        strip.scrollLeft += e.deltaY
        e.preventDefault()
      }
    },
    { passive: false },
  )
  const cards = CARS.map((def) => {
    const card = div('cs-card')
    const name = olText(def.name, 'cs-name')
    const pic = div('cs-pic')
    const buyText = olText('', 'cs-buy-text')
    const buy = legoButton('gw-green cs-buy', '', () => {
      const had = state.owned.includes(def.id)
      actions.onBuy(def.id)
      replay(buy, !had && !state.owned.includes(def.id) ? 'gw-shake' : 'gw-bump')
      renderShop()
    })
    buy.append(buyText)
    card.append(name, olText(`x${def.mult} Power`, 'cs-mult'), pic, olText(`Top speed ${(def.speed * 3.6) | 0} km/h`, 'cs-speed'), buy)
    // Legendary cars (CARS `legend`): a gold card shown first in the strip (CSS order, so the card
    // list keeps CARS' order for shopview.js, which adds the badge, sweep and live picture).
    if (def.legend) card.classList.add('cs-legend')
    strip.append(card)
    return { def, card, name, pic, buy, buyText }
  })
  fontsReady.then(() => {
    for (const k of cards) k.name.style.setProperty('--fs', fitText(k.def.name, 410, 60, { max: 46 }).size)
  })
  function renderShop() {
    if (!shop.isOpen()) return
    for (const k of cards) {
      const owned = state.owned.includes(k.def.id)
      const sel = state.car === k.def.id
      k.card.classList.toggle('sel', sel)
      if (thumbs?.[k.def.id] && !k.pic.firstChild) k.pic.innerHTML = `<img alt="" src="${thumbs[k.def.id]}">`
      const color = sel ? 'gw-white' : owned ? 'gw-blue' : state.wins >= k.def.cost ? 'gw-green' : 'gw-white disabled'
      k.buy.className = `gw-btn gw-lego cs-buy ${color}`
      k.buyText.textContent = sel ? 'Driving' : owned ? 'Drive' : `${fmt(k.def.cost)} Wins`
    }
  }
  function loadThumbs() {
    if (thumbs) return
    actions.thumbnails().then((t) => {
      thumbs = t
      renderShop()
    })
  }

  // --- Rebirth ---
  const reb = createWindow({
    title: 'Rebirth',
    icon: icons.rebirth,
    color: '#e8202a',
    closeColor: '#ff1aa0',
    className: 'rb-window',
    onOpen: () => {
      onOpen()
      renderReb()
    },
    onClose,
  })
  const rb = reb.body
  rb.classList.add('rb-body')
  rb.innerHTML = `
    <div class="rb-cols">
      <div class="rb-col"><span class="gw-ol rb-label" data-f="from"></span><div class="gw-lego rb-plate"><span class="gw-ol rb-mult" data-f="fromMult"></span></div></div>
      <div class="rb-arrow">${ARROW}</div>
      <div class="rb-col"><span class="gw-ol rb-label" data-f="to"></span><div class="gw-lego rb-plate"><span class="gw-ol rb-mult" data-f="toMult"></span></div></div>
    </div>
    <p class="gw-ol rb-rules" data-f="rules"></p>
    <div class="rb-need">
      <span class="gw-ol rb-need-text" data-f="need"></span>
      <div class="rb-bar"><div class="gw-lego rb-fill"></div><span class="gw-ol rb-bar-text" data-f="bar"></span></div>
    </div>
    <div class="rb-btns"></div>`
  const f = {}
  for (const e of rb.querySelectorAll('[data-f]')) f[e.dataset.f] = e
  const need = rb.querySelector('.rb-need')
  const fill = rb.querySelector('.rb-fill')
  const rebBtn = legoButton('gw-yellow rb-btn', '', () => {
    if (state.wins < rebirthCost()) {
      replay(need, 'gw-shake')
      reb.toast(`Need ${fmt(rebirthCost() - state.wins)} more Wins!`)
      return
    }
    for (const e of rb.querySelectorAll('.rb-plate')) replay(e, 'gw-bump')
    actions.onDoRebirth()
    renderReb()
  })
  rebBtn.append(olText('Rebirth', 'rb-btn-text'))
  rb.querySelector('.rb-btns').append(rebBtn)
  function renderReb() {
    if (!reb.isOpen()) return
    const n = state.rebirths
    const cost = rebirthCost()
    const ready = state.wins >= cost
    const next = TREADMILLS.find((t) => t.rebirths > n)
    f.from.textContent = `Rebirth ${n}`
    f.to.textContent = `Rebirth ${n + 1}`
    f.fromMult.textContent = `x${rebirthMult(n).toFixed(1)}`
    f.toMult.textContent = `x${rebirthMult(n + 1).toFixed(1)}`
    f.rules.innerHTML = `Rebirth resets your Power to 0 and spends the Wins.<br>Cars, level and best tape stay.${next ? ` Unlocks the ${next.mult}x treadmill at ${next.rebirths}.` : ''}`
    f.need.textContent = ready ? 'Ready to rebirth!' : `Needs ${fmt(cost)} Wins to rebirth`
    f.bar.textContent = `${fmt(Math.min(state.wins, cost))} / ${fmt(cost)}`
    fill.style.width = `${Math.min(1, state.wins / cost) * 100}%`
    need.classList.toggle('ready', ready)
  }

  // --- Settings ---
  const HUD_KEY = 'cvt_hud_v1'
  let hudOn = true
  try {
    hudOn = localStorage.getItem(HUD_KEY) !== '0'
  } catch {}
  actions.onHudVisible(hudOn)
  const settings = createWindow({
    title: 'Sound & HUD',
    icon: icons.gear,
    color: '#8d8d93',
    closeColor: '#ff1a8c',
    className: 'st-window',
    onOpen: () => {
      onOpen()
      renderSet()
    },
    onClose,
  })
  const list = div('st-list')
  settings.body.append(list)
  const defs = [
    ['Music', () => getAudioPrefs().music, (v) => setAudioPref('music', v), 'musicVol'],
    ['Sound Effects', () => getAudioPrefs().sfx, (v) => setAudioPref('sfx', v), 'sfxVol'],
    [
      'HUD',
      () => hudOn,
      (v) => {
        hudOn = v
        try {
          localStorage.setItem(HUD_KEY, v ? '1' : '0')
        } catch {}
        actions.onHudVisible(v)
      },
    ],
  ]
  const rows = defs.map(([label, get, set, volKey]) => {
    const row = div('gw-row st-row')
    const btn = legoButton('gw-green st-toggle', '', () => {
      set(!get())
      replay(btn, 'gw-bump')
      actions.onClick?.()
      renderSet()
    })
    const text = olText('ON', 'st-toggle-text')
    btn.append(text)
    row.append(olText(label, 'st-label'), btn)
    let slider = null
    if (volKey) {
      row.classList.add('st-has-vol')
      slider = document.createElement('input')
      slider.type = 'range'
      slider.min = '0'
      slider.max = '100'
      slider.className = 'st-vol'
      slider.setAttribute('aria-label', `${label} volume`)
      slider.value = String(Math.round(getAudioPrefs()[volKey] * 100))
      slider.addEventListener('input', () => {
        setAudioVolume(volKey, slider.value / 100)
        renderSet()
      })
      row.append(slider)
    }
    list.append(row)
    return { get, btn, text, slider, volKey }
  })
  function renderSet() {
    if (!settings.isOpen()) return
    for (const r of rows) {
      const on = !!r.get()
      r.text.textContent = on ? 'ON' : 'OFF'
      r.btn.classList.toggle('gw-green', on)
      r.btn.classList.toggle('gw-red', !on)
      r.btn.setAttribute('aria-pressed', String(on))
      if (r.slider) r.slider.value = String(Math.round(getAudioPrefs()[r.volKey] * 100))
    }
  }

  const all = [shop, reb, settings]
  return {
    openShop: () => shop.open(),
    openRebirth: () => reb.open(),
    openSettings: () => settings.open(),
    close: () => all.forEach((w) => w.close()),
    isOpen: () => all.some((w) => w.isOpen()),
  }
}
