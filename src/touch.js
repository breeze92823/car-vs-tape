// Touch controls, shown on coarse-pointer devices (and whenever a finger touches
// the screen; a mouse click hides them again, so hybrid devices get whichever
// they are using). Everything feeds inputState via input.js:
//   left/right edges - hold to steer that way (both = straight); any edge finger = gas
//   middle zone - one-finger drag -> look, two-finger pinch -> zoom
//   buttons     - REV, DRIFT (held handbrake), HORN, VIEW (cockpit / chase) and day/night
import './touch.css'
import { COARSE_POINTER, TOUCH } from './config.js'
import { inputState, requestLock, setTouchBrake, setTouchMove } from './input.js'

const ICONS = {
  day: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1"/></svg>',
}

function el(tag, className, html = '') {
  const e = document.createElement(tag)
  e.className = className
  e.innerHTML = html
  return e
}

// A pointerdown that fires `fn` (no click delay, no focus, no emulated mouse).
function button(className, html, fn) {
  const b = el('button', `touch-btn ${className}`, html)
  b.type = 'button'
  b.addEventListener('pointerdown', (e) => {
    e.preventDefault()
    e.stopPropagation()
    fn(b)
  })
  return b
}

const isFinger = (e) => e.pointerType === 'touch' || e.pointerType === 'pen'

// Keeps a finger's moves on its zone even when it slides off. Throws if the
// pointer is already gone; the zone still works without capture.
function capture(zone, id) {
  try {
    zone.setPointerCapture(id)
  } catch {
    // Ignore.
  }
}

function setVisible(on) {
  document.body.classList.toggle('touch-ui', on)
  if (!on) setTouchMove(0, 0)
}

// Edge steering: hold the left edge to turn left, the right edge to turn right, both for
// straight ahead. Any edge finger also means gas; the REV button reverses.
const steer = { l: 0, r: 0, rev: false }
function applySteer() {
  const any = steer.l > 0 || steer.r > 0
  const x = (steer.r > 0 ? 1 : 0) - (steer.l > 0 ? 1 : 0)
  setTouchMove(x, steer.rev ? -1 : any ? 1 : 0)
}

function installSteerEdge(zone, side) {
  const ids = new Set()
  const sync = () => {
    steer[side] = ids.size
    zone.classList.toggle('active', ids.size > 0)
    applySteer()
  }
  zone.appendChild(el('div', 'steer-arrow', side === 'l' ? '&#8249;' : '&#8250;'))
  zone.addEventListener('pointerdown', (e) => {
    if (!isFinger(e)) return requestLock()
    e.preventDefault()
    capture(zone, e.pointerId)
    ids.add(e.pointerId)
    sync()
  })
  const up = (e) => ids.delete(e.pointerId) && sync()
  zone.addEventListener('pointerup', up)
  zone.addEventListener('pointercancel', up)
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
}

// actions: { day, horn, view } callbacks (the menu is Boxity's toolbar). Edge steering drives
// the car (edge fingers = gas + steer, REV reverses); DRIFT is a held handbrake;
// HORN honks; VIEW swaps the chase camera and the cockpit view (view() returns true in the cockpit).
export function installTouch(actions) {
  const root = el('div', 'touch-root')
  const left = el('div', 'touch-zone touch-steer touch-steer-l')
  const right = el('div', 'touch-zone touch-steer touch-steer-r')
  const mid = el('div', 'touch-zone touch-look')
  installSteerEdge(left, 'l')
  installSteerEdge(right, 'r')
  installLook(mid)

  const top = el('div', 'touch-top')
  top.append(button('small', ICONS.day, actions.day))
  const rev = el('button', 'touch-btn small rev', 'REV')
  rev.type = 'button'
  const revHold = (on) => (e) => {
    e.preventDefault()
    e.stopPropagation()
    rev.classList.toggle('on', on)
    steer.rev = on
    applySteer()
  }
  rev.addEventListener('pointerdown', (e) => {
    capture(rev, e.pointerId)
    revHold(true)(e)
  })
  rev.addEventListener('pointerup', revHold(false))
  rev.addEventListener('pointercancel', revHold(false))
  top.append(rev)

  const cluster = el('div', 'touch-cluster')
  const drift = el('button', 'touch-btn jump', 'DRIFT')
  drift.type = 'button'
  const hold = (on) => (e) => {
    e.preventDefault()
    e.stopPropagation()
    drift.classList.toggle('on', on)
    setTouchBrake(on)
  }
  drift.addEventListener('pointerdown', (e) => {
    capture(drift, e.pointerId)
    hold(true)(e)
  })
  drift.addEventListener('pointerup', hold(false))
  drift.addEventListener('pointercancel', hold(false))
  cluster.append(drift)
  // BOOST (rocket.js): the cluster's free left slot; rocket.js paints its charge ring (.rk-charge).
  if (actions.boost) cluster.append(button('sprint boost rk-charge', '🚀<br>BOOST', () => actions.boost()))
  // FLY (rocket.js): held, above BOOST; shown only while driving a car that flies (body.rk-canfly).
  if (actions.fly) {
    const fly = el('button', 'touch-btn fly rk-fuel', 'FLY')
    fly.type = 'button'
    const flyHold = (on) => (e) => {
      e.preventDefault()
      e.stopPropagation()
      actions.fly(on)
    }
    fly.addEventListener('pointerdown', (e) => {
      capture(fly, e.pointerId)
      flyHold(true)(e)
    })
    fly.addEventListener('pointerup', flyHold(false))
    fly.addEventListener('pointercancel', flyHold(false))
    cluster.append(fly)
  }
  if (actions.horn) cluster.append(button('horn', 'HORN', () => actions.horn()))
  if (actions.view) cluster.append(button('mode', 'VIEW', (b) => b.classList.toggle('on', !!actions.view())))

  root.append(mid, left, right, top, cluster)
  document.body.appendChild(root)

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
