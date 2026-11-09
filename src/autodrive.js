import { TRACK, TREADMILLS } from './config.js'
import { car, manualInput, setControlSource } from './car.js'
import { inputState } from './input.js'
import { setAutoDrive, state, treadmillUnlocked } from './game.js'

// Auto Drive: a small state machine that plays the loop by itself.
//   train  - drive to the best unlocked treadmill and floor it until power
//            reaches the tape that last bounced the car
//   run    - leave the plaza through the gate and drive up the track
//   return - after a bounce (or the finish) the car is sent back to town
// Touching the controls hands the car back to the player (Auto Drive off).
let mode = 'idle'
let stage = 1
let phaseT = 0
let failPower = TRACK.tapes[0].power // power the car must reach before another run
let pads = []
let requestReturn = () => {}

export function initAutoDrive(padList, goHome) {
  pads = padList
  requestReturn = goHome
  setControlSource(control)
}

export function noteBounce(power) {
  failPower = power
  if (state.autoDrive) {
    mode = 'returning'
    phaseT = 0
  }
}
export function noteFinish() {
  failPower = Infinity
  if (state.autoDrive) {
    mode = 'returning'
    phaseT = 0
  }
}

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a))
const manual = () => ({ throttle: inputState.move.z, steer: inputState.move.x, handbrake: inputState.brake })

// Steering toward a point with a target speed that drops near the point and in
// sharp turns (so the car never orbits a waypoint it cannot turn into).
function seek(x, z, vmax = 30) {
  const dx = x - car.position.x
  const dz = z - car.position.z
  const dist = Math.hypot(dx, dz)
  const err = wrap(Math.atan2(dx, dz) - car.yaw)
  const steer = Math.max(-1, Math.min(1, -err * 2.5)) // yaw decreases with positive steer
  let v = Math.min(vmax, 3 + dist * 0.6)
  if (Math.abs(err) > 0.6) v = Math.min(v, 7)
  if (Math.abs(err) > 1.4) v = Math.min(v, 4)
  const throttle = Math.max(-1, Math.min(1, (v - car.speed) * 0.4))
  return { throttle, steer, handbrake: false, dist }
}

function bestPad() {
  let best = null
  for (const p of pads) if (treadmillUnlocked(p.index) && (!best || TREADMILLS[p.index].mult > TREADMILLS[best.index].mult)) best = p
  return best
}

function control(dt = 1 / 60) {
  if (!state.autoDrive) {
    mode = 'idle'
    return manual()
  }
  if (manualInput()) {
    setAutoDrive(false)
    return manual()
  }
  phaseT += dt
  const p = car.position
  const onTrack = p.z < TRACK.startZ + 2

  if (mode === 'idle') {
    mode = onTrack ? 'run' : 'decide'
    phaseT = 0
  }
  if (mode === 'returning') {
    if (phaseT > 1.1) {
      requestReturn()
      mode = 'decide'
      phaseT = 0
    }
    return { throttle: 0, steer: 0, handbrake: true }
  }
  if (mode === 'decide') {
    mode = state.power >= failPower && failPower !== Infinity ? 'toGate' : 'toPad'
    stage = 1
    if (failPower === Infinity) failPower = 0 // finished: next time just keep running
    phaseT = 0
  }
  if (mode === 'toPad') {
    const pad = bestPad()
    if (!pad) return { throttle: 0, steer: 0, handbrake: true }
    if (car.pad === pad) {
      mode = 'train'
      phaseT = 0
    } else {
      // Stage 1: reach a point 11 m before the belt on its axis. Stage 2: drive straight on.
      const ax = Math.sin(pad.axis)
      const az = Math.cos(pad.axis)
      const along = (p.x - pad.x) * ax + (p.z - pad.z) * az
      const across = -(p.x - pad.x) * az + (p.z - pad.z) * ax
      if (stage === 2 && (Math.abs(across) > 3 || along < -pad.hx - 16 || phaseT > 8)) stage = 1
      if (stage === 1) {
        const ex = pad.x - ax * (pad.hx + 11)
        const ez = pad.z - az * (pad.hx + 11)
        const s1 = seek(ex, ez, 22)
        if (s1.dist < 2.5) {
          stage = 2
          phaseT = 0
        }
        return s1
      }
      return seek(pad.x + ax * 30, pad.z + az * 30, 9)
    }
  }
  if (mode === 'train') {
    if (car.pad && state.power >= failPower) {
      mode = 'leavePad'
      phaseT = 0
    } else if (!car.pad && phaseT > 1) {
      mode = 'toPad'
      stage = 1
    }
    return { throttle: 1, steer: 0, handbrake: false }
  }
  if (mode === 'leavePad') {
    if (phaseT < 1.6) return { throttle: -1, steer: 0, handbrake: false }
    mode = 'toGate'
    phaseT = 0
  }
  if (mode === 'toGate') {
    if (onTrack) {
      mode = 'run'
      phaseT = 0
    } else {
      // Via the middle of the plaza (clear of the props by the gate), then through.
      if (p.z > -22 && Math.abs(p.x) > 6) return seek(0, -24)
      return seek(0, TRACK.startZ - 10)
    }
  }
  if (mode === 'run') {
    if (!onTrack && phaseT > 2) {
      mode = 'decide'
      return { throttle: 0, steer: 0, handbrake: false }
    }
    if (car.stun > 0) return { throttle: 0, steer: 0, handbrake: false }
    return seek(0, p.z - 40)
  }
  return { throttle: 0, steer: 0, handbrake: false }
}
