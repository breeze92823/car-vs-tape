// Touch controls, shown on coarse-pointer devices (and whenever a finger touches
// the screen; a mouse click hides them again, so hybrid devices get whichever
// they are using). Everything feeds inputState via input.js:
//   left zone   - floating joystick (appears under the thumb) -> move, analog
//   right zone  - one-finger drag -> look, two-finger pinch -> zoom
//   buttons     - DRIFT (held handbrake), HORN, VIEW (cockpit / chase) and day/night
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

function installJoystick(zone) {
  const base = el('div', 'joy-base')
  const knob = el('div', 'joy-knob')
  base.appendChild(knob)
  zone.appendChild(base)

  let id = null
  let cx = 0
  let cy = 0
  let radius = 1

  const release = () => {
    id = null
    base.classList.remove('active')
    base.style.left = base.style.top = '' // back to its resting spot
    knob.style.transform = ''
    setTouchMove(0, 0)
  }

  zone.addEventListener('pointerdown', (e) => {
    if (!isFinger(e)) return requestLock()
    if (id !== null) return
    e.preventDefault()
    id = e.pointerId
    capture(zone, id)
    const zr = zone.getBoundingClientRect()
    radius = base.offsetWidth / 2
    cx = e.clientX
    cy = e.clientY
    base.style.left = `${cx - zr.left}px`
    base.style.top = `${cy - zr.top}px`
    base.classList.add('active')
  })
  zone.addEventListener('pointermove', (e) => {
    if (e.pointerId !== id) return
    let dx = e.clientX - cx
    let dy = e.clientY - cy
    const len = Math.hypot(dx, dy)
    if (len > radius) {
      dx *= radius / len
      dy *= radius / len
    }
    knob.style.transform = `translate(${dx}px, ${dy}px)`
    const mag = Math.min(len / radius, 1)
    const live = mag < TOUCH.deadZone ? 0 : (mag - TOUCH.deadZone) / (1 - TOUCH.deadZone)
    const k = len > 0 ? live / Math.min(len, radius) : 0
    setTouchMove(dx * k, -dy * k)
  })
  zone.addEventListener('pointerup', (e) => e.pointerId === id && release())
  zone.addEventListener('pointercancel', (e) => e.pointerId === id && release())
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

// actions: { day, horn, view } callbacks (the menu is Boxity's toolbar). The joystick drives
// the car (up = throttle, down = brake/reverse, sideways = steer); DRIFT is a held handbrake;
// HORN honks; VIEW swaps the chase camera and the cockpit view (view() returns true in the cockpit).
export function installTouch(actions) {
  const root = el('div', 'touch-root')
  const left = el('div', 'touch-zone touch-left')
  const right = el('div', 'touch-zone touch-right')
  installJoystick(left)
  installLook(right)

  const top = el('div', 'touch-top')
  top.append(button('small', ICONS.day, actions.day))

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

  root.append(left, right, top, cluster)
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
