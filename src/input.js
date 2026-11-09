// Keyboard + mouse. WASD/arrows move (camera-relative, consumed by player.js),
// mouse look while pointer-locked (click grabs, Esc releases; drag where it is
// refused or not yet granted) and wheel
// zoom (consumed by camera.js), edge-triggered actions cleared by their consumer.
// Touch controls (touch.js) write look/zoom/jump directly and move/sprint via
// setTouchMove/setTouchSprint, which are merged with the keys here.
export const inputState = {
  move: { x: 0, z: 0 }, // x = strafe (+ right), z = forward (+ forward)
  look: { dx: 0, dy: 0 }, // raw pixels since the camera last read them
  zoom: 0, // wheel notches since the camera last read them (+ = away)
  sprint: false,
  jump: false, // edge: cleared by player.js
  brake: false, // handbrake held (Space / touch DRIFT)
  spaceFly: false, // rocket.js: the car flies on Space (FLY), so Space is no handbrake
}

// One wheel notch per WheelEvent.deltaMode (pixels, lines, pages), so a trackpad
// and a mouse zoom at the same rate.
const NOTCH_PER_DELTA = [1 / 100, 1 / 3, 1]

const held = new Set()
const keyActions = new Map() // code -> fn, for one-shot keys (mode toggle, day/night...)
let orbiting = false // right-drag fallback where pointer lock is refused
let canvas = null
const touch = { x: 0, z: 0, sprint: false, brake: false }

export const isLocked = () => !!canvas && document.pointerLockElement === canvas
// Pointer lock can reject (sandboxed frame, post-Escape cooldown); that is not a fault.
export function requestLock() {
  if (!canvas || isLocked()) return
  const r = canvas.requestPointerLock?.()
  if (r instanceof Promise) r.catch(() => {})
}

// Registers a one-shot key (fires on keydown, never on auto-repeat).
export function onKey(code, fn) {
  keyActions.set(code, fn)
}

function recomputeMove() {
  let x = 0
  let z = 0
  if (held.has('KeyW') || held.has('ArrowUp')) z += 1
  if (held.has('KeyS') || held.has('ArrowDown')) z -= 1
  if (held.has('KeyD') || held.has('ArrowRight')) x += 1
  if (held.has('KeyA') || held.has('ArrowLeft')) x -= 1
  inputState.move.x = Math.max(-1, Math.min(1, x + touch.x))
  inputState.move.z = Math.max(-1, Math.min(1, z + touch.z))
  inputState.sprint = held.has('ShiftLeft') || held.has('ShiftRight') || touch.sprint
  inputState.brake = (held.has('Space') && !inputState.spaceFly) || touch.brake
}

export function setTouchBrake(on) {
  touch.brake = on
  recomputeMove()
}

// Joystick vector, each axis -1..1 (analog: a half tilt walks at half speed).
export function setTouchMove(x, z) {
  touch.x = x
  touch.z = z
  recomputeMove()
}

export function setTouchSprint(on) {
  touch.sprint = on
  recomputeMove()
}

export function install(showMenu, canvasEl) {
  canvas = canvasEl
  document.addEventListener('pointerlockchange', () => {
    if (isLocked()) orbiting = false
  })
  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement) return
    if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault()
    if (e.repeat) return
    if (e.code === 'Escape') {
      showMenu()
      return
    }
    held.add(e.code)
    if (e.code === 'Space') inputState.jump = true
    keyActions.get(e.code)?.()
    recomputeMove()
  })
  window.addEventListener('keyup', (e) => {
    held.delete(e.code)
    recomputeMove()
  })
  window.addEventListener('pointerdown', (e) => {
    const onWorld = e.target === canvas
    if (e.button === 2 && !isLocked()) orbiting = true
    if (e.button === 0 && onWorld && e.pointerType === 'mouse') {
      // A click on the world takes the cursor (Esc gives it back; never on touch: there is no
      // cursor), also mid-race, where the click is a boost tap too. Until the lock lands (or where
      // it is refused) the drag turns the camera instead.
      requestLock()
      if (!isLocked()) orbiting = true
    }
  })
  window.addEventListener('pointerup', (e) => {
    if (e.button === 0 || e.button === 2) orbiting = false
  })
  window.addEventListener('pointermove', (e) => {
    if (!orbiting && !isLocked()) return
    inputState.look.dx += e.movementX || 0
    inputState.look.dy += e.movementY || 0
  })
  // Only the game world zooms: a wheel over a HUD panel must not also move the camera.
  window.addEventListener(
    'wheel',
    (e) => {
      if (e.target !== canvas) return
      e.preventDefault()
      inputState.zoom += e.deltaY * (NOTCH_PER_DELTA[e.deltaMode] ?? NOTCH_PER_DELTA[0])
    },
    { passive: false },
  )
  window.addEventListener('contextmenu', (e) => e.preventDefault())
  window.addEventListener('blur', () => {
    held.clear()
    orbiting = false
    inputState.jump = false
    recomputeMove()
  })
}
