// Touch controls, shown on coarse-pointer devices (and whenever a finger touches
// the screen; a mouse click hides them again, so hybrid devices get whichever
// they are using). Everything feeds inputState via input.js:
//   bottom-left steering pad - hold / slide between the two halves to steer left or right
//   bottom-right pedals      - GAS (forward), BRAKE (brakes, then reverses)
//   actions above the pedals - DRIFT (held handbrake), BOOST, FLY (held), HORN, VIEW, day/night
//   anywhere else            - one-finger drag -> look, two-finger pinch -> zoom
import './touch.css'
import { COARSE_POINTER, TOUCH } from './config.js'
import { inputState, requestLock, setTouchBrake, setTouchMove } from './input.js'

const ICONS = {
  day: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1"/></svg>',
  left: '<svg viewBox="0 0 24 24"><path d="M15 4 7 12l8 8"/></svg>',
  right: '<svg viewBox="0 0 24 24"><path d="m9 4 8 8-8 8"/></svg>',
  gas: '<svg viewBox="0 0 24 24"><path d="M12 5v14M6 11l6-6 6 6"/></svg>',
  brake: '<svg viewBox="0 0 24 24"><path d="M12 19V5M6 13l6 6 6-6"/></svg>',
}

function el(tag, className, html = '') {
  const e = document.createElement(tag)
  e.className = className
  e.innerHTML = html
  return e
}

const isFinger = (e) => e.pointerType === 'touch' || e.pointerType === 'pen'

// Keeps a finger's moves on its element even when it slides off. Throws if the
// pointer is already gone; the control still works without capture.
function capture(target, id) {
  try {
    target.setPointerCapture(id)
  } catch {
    // Ignore.
  }
}

// A pointerdown that fires `fn` once (no click delay, no focus, no emulated mouse).
function tapButton(className, html, fn) {
  const b = el('button', `touch-btn ${className}`, html)
  b.type = 'button'
  b.addEventListener('pointerdown', (e) => {
    e.preventDefault()
    e.stopPropagation()
    fn(b)
  })
  return b
}

// A button that is "on" while any finger holds it; fn(on) on every change.
function holdButton(className, html, fn) {
  const b = el('button', `touch-btn ${className}`, html)
  b.type = 'button'
  const ids = new Set()
  const sync = () => {
    const on = ids.size > 0
    if (on === b.classList.contains('on')) return
    b.classList.toggle('on', on)
    fn(on)
  }
  b.addEventListener('pointerdown', (e) => {
    e.preventDefault()
    e.stopPropagation()
    capture(b, e.pointerId)
    ids.add(e.pointerId)
    sync()
  })
  const up = (e) => {
    if (ids.delete(e.pointerId)) sync()
  }
  b.addEventListener('pointerup', up)
  b.addEventListener('pointercancel', up)
  b.addEventListener('lostpointercapture', up)
  b.release = () => {
    ids.clear()
    sync()
  }
  return b
}

// Drive state: steering from the pad, throttle from the pedals.
const drive = { steer: 0, gas: false, brake: false }
function applyDrive() {
  setTouchMove(drive.steer, drive.brake ? -1 : drive.gas ? 1 : 0)
}

// One pad, two halves: each finger steers toward the half it is over and can slide across.
function installSteerPad(pad) {
  const left = el('div', 'steer-half steer-l', ICONS.left)
  const right = el('div', 'steer-half steer-r', ICONS.right)
  pad.append(left, right)
  const fingers = new Map() // pointerId -> -1 | 1
  const sync = () => {
    let x = 0
    for (const s of fingers.values()) x += s
    drive.steer = Math.max(-1, Math.min(1, x))
    const vals = [...fingers.values()]
    left.classList.toggle('on', vals.includes(-1))
    right.classList.toggle('on', vals.includes(1))
    applyDrive()
  }
  const side = (e) => {
    const r = pad.getBoundingClientRect()
    return e.clientX < r.left + r.width / 2 ? -1 : 1
  }
  pad.addEventListener('pointerdown', (e) => {
    e.preventDefault()
    e.stopPropagation()
    capture(pad, e.pointerId)
    fingers.set(e.pointerId, side(e))
    sync()
  })
  pad.addEventListener('pointermove', (e) => {
    if (!fingers.has(e.pointerId)) return
    const s = side(e)
    if (s !== fingers.get(e.pointerId)) {
      fingers.set(e.pointerId, s)
      sync()
    }
  })
  const up = (e) => {
    if (fingers.delete(e.pointerId)) sync()
  }
  pad.addEventListener('pointerup', up)
  pad.addEventListener('pointercancel', up)
  pad.addEventListener('lostpointercapture', up)
  return () => {
    fingers.clear()
    sync()
  }
}

function installLook(zone) {
  const fingers = new Map() // pointerId -> { x, y }
  let pinch = 0 // finger spread last frame, 0 = not pinching

  const spread = () => {
    const [a, b] = fingers.values()
    return Math.hypot(a.x - b.x, a.y - b.y)
  }
  const lift = (e) => {
    fingers.delete(e.pointerId)
    pinch = fingers.size >= 2 ? spread() : 0
  }

  zone.addEventListener('pointerdown', (e) => {
    if (!isFinger(e)) return requestLock()
    e.preventDefault()
    capture(zone, e.pointerId)
    fingers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (fingers.size >= 2) pinch = spread()
  })
  zone.addEventListener('pointermove', (e) => {
    const f = fingers.get(e.pointerId)
    if (!f) return
    const dx = e.clientX - f.x
    const dy = e.clientY - f.y
    f.x = e.clientX
    f.y = e.clientY
    if (fingers.size === 1) {
      inputState.look.dx += dx * TOUCH.lookScale
      inputState.look.dy += dy * TOUCH.lookScale
    } else {
      // Fingers apart = zoom in (negative notches), together = out.
      const now = spread()
      inputState.zoom -= (now - pinch) / TOUCH.pinchPixelsPerNotch
      pinch = now
    }
  })
  zone.addEventListener('pointerup', lift)
  zone.addEventListener('pointercancel', lift)
  zone.addEventListener('lostpointercapture', lift)
}

// actions: { day, horn, view, boost, fly } callbacks (the menu is Boxity's toolbar).
// view() returns true in the cockpit; fly(on) is held.
export function installTouch(actions) {
  const root = el('div', 'touch-root')
  const look = el('div', 'touch-look')
  installLook(look)

  const pad = el('div', 'touch-steer')
  const releaseSteer = installSteerPad(pad)

  const pedals = el('div', 'touch-pedals')
  const brake = holdButton('pedal brake', `${ICONS.brake}<span>BRAKE</span>`, (on) => {
    drive.brake = on
    applyDrive()
  })
  const gas = holdButton('pedal gas', `${ICONS.gas}<span>GAS</span>`, (on) => {
    drive.gas = on
    applyDrive()
  })
  pedals.append(brake, gas)

  // Actions, nearest the gas thumb first (the grid fills from the bottom-right).
  const acts = el('div', 'touch-actions')
  const drift = holdButton('act drift', 'DRIFT', (on) => setTouchBrake(on))
  acts.append(drift)
  // BOOST: rocket.js paints its charge ring (.rk-charge).
  if (actions.boost) acts.append(tapButton('act boost rk-charge', '🚀<br>BOOST', () => actions.boost()))
  // FLY: held; shown only while driving a car that flies (body.rk-canfly).
  let fly = null
  if (actions.fly) {
    fly = holdButton('act fly rk-fuel', 'FLY', (on) => actions.fly(on))
    acts.append(fly)
  }
  if (actions.horn) acts.append(tapButton('act horn', 'HORN', () => actions.horn()))
  if (actions.view) acts.append(tapButton('act view', 'VIEW', (b) => b.classList.toggle('on', !!actions.view())))
  if (actions.day) acts.append(tapButton('act day', ICONS.day, () => actions.day()))

  root.append(look, pad, pedals, acts)
  document.body.appendChild(root)

  const releaseAll = () => {
    releaseSteer()
    for (const b of [brake, gas, drift, fly]) b?.release()
    setTouchMove(0, 0)
  }
  const setVisible = (on) => {
    document.body.classList.toggle('touch-ui', on)
    if (!on) releaseAll()
  }
  // A finger can be lifted while the page is hidden or a window covers the controls.
  window.addEventListener('blur', releaseAll)
  document.addEventListener('visibilitychange', () => document.hidden && releaseAll())

  setVisible(COARSE_POINTER)
  // Whatever the player last used decides which controls are on screen.
  window.addEventListener(
    'pointerdown',
    (e) => {
      if (isFinger(e)) setVisible(true)
      else if (e.pointerType === 'mouse') setVisible(false)
    },
    { capture: true },
  )
}
