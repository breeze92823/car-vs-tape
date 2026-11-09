import { Vector3 } from 'three'
import { inputState } from './input.js'
import { segmentClear } from './physics.js'
import { car } from './car.js'
import { CAR_CAM } from './config.js'
import * as game from './game.js'

// Chase camera for the car: sits behind the nose and swings back behind it
// after the player orbits it (mouse drag / pointer lock / touch drag), eased
// wheel zoom, FOV that widens with speed, a short shake for impacts, and a ray
// against static colliders so the boom never ends inside a wall.
// On spawn and on every new car an intro swing (CAR_CAM.intro) starts off the
// front corner on the driver's side and sweeps round behind, showing the driver.
// toggleCockpit() (V / VIEW) puts the camera at the driver's eyes instead
// (driver.js `eye`, head hidden), drag looks around and recentres.
const state = { yaw: 0, pitch: CAR_CAM.pitch, dist: CAR_CAM.distance, zoom: CAR_CAM.distance }
let sensitivity = 1
let idle = 99 // s since the player last orbited
let shake = 0
let clearance = 1
let ready = false
let spawned = false
let intro = 0 // s left of the intro swing
let introWait = 0 // s the first intro has waited for the avatar
let cockpit = false
let driver = null
const look = { yaw: 0, pitch: 0 } // cockpit: head turn from straight ahead
const follow = { x: 0, y: 0, z: 0 }
const eye = new Vector3()
const fwd = new Vector3()

export function setCameraSensitivity(v) {
  sensitivity = v
}
export function shakeCamera(amount) {
  shake = Math.max(shake, amount)
}
export function snapCamera() {
  ready = false
}
// The driver (driver.js) the cockpit view sits in.
export function setCameraDriver(d) {
  driver = d
}
export function playIntro() {
  intro = CAR_CAM.intro.duration
}
export function toggleCockpit() {
  cockpit = !cockpit
  look.yaw = look.pitch = 0
  idle = 99
  intro = 0
  driver?.setFirstPerson(cockpit)
  return cockpit
}
export const isCockpit = () => cockpit
game.on('car', playIntro)

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v)
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a))
const smooth = (t) => t * t * (3 - 2 * t)

function setFov(camera, fov, dt) {
  if (Math.abs(camera.fov - fov) > 0.01) {
    camera.fov += (fov - camera.fov) * (1 - Math.exp(-4 * dt))
    camera.updateProjectionMatrix()
  }
}

function updateCockpit(camera, dt, mouse, speedK) {
  const C = CAR_CAM.cockpit
  if (mouse) {
    look.yaw = clamp(look.yaw - mouse.dx * CAR_CAM.lookSensitivity * sensitivity, -C.maxYaw, C.maxYaw)
    look.pitch = clamp(look.pitch - mouse.dy * CAR_CAM.lookSensitivity * sensitivity, -C.maxPitch, C.maxPitch)
  } else if (idle > CAR_CAM.orbitHold) {
    const k = 1 - Math.exp(-3 * dt)
    look.yaw -= look.yaw * k
    look.pitch -= look.pitch * k
  }
  setFov(camera, C.fov + C.speedFov * speedK * speedK, dt)
  const yaw = car.renderYaw + look.yaw
  const pitch = C.pitch + look.pitch
  fwd.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch))
  const s = shake * shake * 0.15
  const t = performance.now() * 0.05
  camera.position.copy(eye).addScaledVector(fwd, C.forward)
  camera.position.x += Math.sin(t * 1.3) * s
  camera.position.y += Math.sin(t * 1.7) * s
  camera.lookAt(camera.position.x + fwd.x, camera.position.y + fwd.y, camera.position.z + fwd.z)
}

export function updateCamera(camera, dt) {
  const input = inputState.look
  let mouse = null
  if (input.dx || input.dy) {
    mouse = { dx: input.dx, dy: input.dy }
    input.dx = input.dy = 0
    idle = 0
    intro = 0 // looking around takes the camera back
  } else idle += dt
  shake = Math.max(0, shake - dt * 2.5)
  const speedK = clamp(Math.abs(car.wheelSpeed) / car.topSpeed, 0, 1)

  // Cockpit: the zoom wheel / pinch zooms back out to the chase view.
  if (cockpit && inputState.zoom > 0.5) toggleCockpit()
  if (cockpit && driver?.eye(eye)) {
    inputState.zoom = 0
    ready = false // back in the chase view, start behind the car
    return updateCockpit(camera, dt, mouse, speedK)
  }

  if (mouse) {
    state.yaw -= mouse.dx * CAR_CAM.lookSensitivity * sensitivity
    state.pitch = clamp(state.pitch + mouse.dy * CAR_CAM.lookSensitivity * sensitivity, CAR_CAM.minPitch, CAR_CAM.maxPitch)
  }
  if (inputState.zoom) {
    state.zoom = clamp(state.zoom + inputState.zoom * CAR_CAM.zoomStep, CAR_CAM.minDistance, CAR_CAM.maxDistance)
    inputState.zoom = 0
  }

  const p = car.renderPosition
  const behind = car.renderYaw + Math.PI // camera yaw that sits behind the nose
  if (!ready) {
    state.yaw = behind
    follow.x = p.x
    follow.y = p.y
    follow.z = p.z
    ready = true
    if (!spawned) {
      spawned = true
      playIntro()
    }
  }

  // Swing back behind the car once the player stops orbiting (faster at speed).
  if (idle > CAR_CAM.orbitHold) {
    const moving = Math.min(1, Math.abs(car.wheelSpeed) / 6) // reversing keeps the view forward too
    const k = 1 - Math.exp(-CAR_CAM.followYaw * (0.25 + moving) * dt)
    state.yaw += wrap(behind - state.yaw) * k
    state.pitch += (CAR_CAM.pitch - state.pitch) * (1 - Math.exp(-1.5 * dt))
  }

  const f = 1 - Math.exp(-16 * dt)
  follow.x += (p.x - follow.x) * f
  follow.y += (p.y - follow.y) * (1 - Math.exp(-8 * dt))
  follow.z += (p.z - follow.z) * f

  state.dist += (state.zoom - state.dist) * (1 - Math.exp(-10 * dt))
  setFov(camera, CAR_CAM.fov + CAR_CAM.speedFov * speedK * speedK, dt)

  let yaw = state.yaw
  let pitch = state.pitch
  let d = state.dist * (1 + speedK * 0.12)
  let height = CAR_CAM.height
  let lift = 0.6
  if (intro > 0) {
    // 0 -> 1 over the swing; the chase spot takes over smoothly at the end.
    const I = CAR_CAM.intro
    // Hold the first shot until the avatar is in the seat (it loads after the first frame).
    if (driver && !driver.loaded && introWait < 2) introWait += dt
    else intro = Math.max(0, intro - dt)
    const e = smooth(1 - intro / I.duration)
    yaw = behind + I.yaw * (1 - e)
    state.yaw = yaw
    pitch = I.pitch + (pitch - I.pitch) * e
    const fit = Math.min(1.8, Math.max(1, 0.9 / camera.aspect)) // a portrait screen needs to stand back
    d = I.distance * fit + (d - I.distance * fit) * e
    height = I.height + (height - I.height) * e
    lift *= e
  }

  const lx = follow.x
  const ly = follow.y + height
  const lz = follow.z
  const cp = Math.cos(pitch)
  const px = lx + Math.sin(yaw) * cp * d
  const py = ly + Math.sin(pitch) * d + lift
  const pz = lz + Math.cos(yaw) * cp * d

  const hit = segmentClear(lx, ly, lz, px, py, pz)
  const want = hit < 1 ? Math.max(0.1, hit - 0.04) : 1
  clearance = want < clearance ? want : clearance + (want - clearance) * (1 - Math.exp(-5 * dt))

  const s = shake * shake
  const t = performance.now() * 0.05
  camera.position.set(lx + (px - lx) * clearance + Math.sin(t * 1.3) * s * 0.5, Math.max(0.5, ly + (py - ly) * clearance) + Math.sin(t * 1.7) * s * 0.4, lz + (pz - lz) * clearance + Math.cos(t * 1.1) * s * 0.5)
  camera.lookAt(lx, ly + 0.4 * (intro > 0 ? 1 - intro / CAR_CAM.intro.duration : 1), lz)
}
