import { inputState } from './input.js'
import { player } from './player.js'
import { segmentClear } from './physics.js'
import { isFirstPerson, onModeChanged, setMode } from './modes.js'
import { CAMERA, PHYSICS } from './config.js'

// One camera, two modes (modes.js). Character mode is a third-person chase cam
// (ported from Clean Leaves for Loot): it owns its own yaw/pitch and orbits the
// player, ONE smoothing stage on the followed point, eased wheel zoom, sprint
// FOV, and a ray against static colliders pulls the boom in so it never sits
// inside a wall. Player mode puts the camera at eye height looking along
// yaw/pitch. Wheel in past minDistance -> player mode; wheel out -> character.
const state = { yaw: 0, pitch: CAMERA.startPitch }
const TELEPORT_DISTANCE = 15 // a same-frame jump bigger than this is a respawn: snap

// Driven by the Bloxity `camera_sensitivity` setting.
let sensitivity = 1
export function setCameraSensitivity(value) {
  sensitivity = value
}
export const getCameraSensitivity = () => sensitivity

const followed = { x: 0, y: 0, z: 0 } // smoothed feet position
const lastPlayerPos = { x: 0, y: 0, z: 0 }
const look = { x: 0, y: 0, z: 0 }
let initialised = false
let zoomTarget = CAMERA.distance
let zoomEased = CAMERA.distance
let rush = 0 // eased 0..1 sprint factor
let clearance = 1 // 0..1 of the boom the walls allow, eased back out

export const getYaw = () => state.yaw
export const getPitch = () => state.pitch

// Snaps the orbit to sit directly behind the player.
export function syncYawToPlayer() {
  state.yaw = player.facing + Math.PI
}

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v)

// Entering first person keeps the view direction; leaving it backs the boom out
// a little so a single wheel notch doesn't flip straight back in. (The
// listener also runs once at registration; that call keeps the resting boom.)
let modeSeen = false
onModeChanged((mode) => {
  const first = !modeSeen
  modeSeen = true
  if (first) return
  if (mode === 'player') {
    state.pitch = clamp(state.pitch * 0.5, -CAMERA.firstPersonPitch, CAMERA.firstPersonPitch) // + = looking down in both modes
  } else {
    state.pitch = CAMERA.startPitch
    zoomTarget = zoomEased = CAMERA.minDistance + 2
  }
})

export function update(camera, dt) {
  state.yaw -= inputState.look.dx * CAMERA.lookSensitivity * sensitivity
  state.pitch += inputState.look.dy * CAMERA.lookSensitivity * sensitivity
  inputState.look.dx = 0
  inputState.look.dy = 0
  const fp = isFirstPerson()
  state.pitch = fp ? clamp(state.pitch, -CAMERA.firstPersonPitch, CAMERA.firstPersonPitch) : clamp(state.pitch, CAMERA.minPitch, CAMERA.maxPitch)

  // Wheel: zoom the boom, or cross between the two modes at its inner end.
  if (inputState.zoom !== 0) {
    if (fp) {
      if (inputState.zoom > 0) setMode('character')
    } else {
      const next = zoomTarget + inputState.zoom * CAMERA.zoomStep
      if (next < CAMERA.minDistance && inputState.zoom < 0) setMode('player')
      else zoomTarget = clamp(next, CAMERA.minDistance, CAMERA.maxDistance)
    }
    inputState.zoom = 0
  }

  const p = player.renderPosition
  const jump = Math.hypot(p.x - lastPlayerPos.x, p.y - lastPlayerPos.y, p.z - lastPlayerPos.z)
  const teleported = initialised && jump > TELEPORT_DISTANCE
  lastPlayerPos.x = p.x
  lastPlayerPos.y = p.y
  lastPlayerPos.z = p.z
  if (teleported) {
    state.yaw = player.facing + Math.PI
    state.pitch = fp ? 0 : CAMERA.startPitch
  }

  if (!initialised || teleported) {
    followed.x = p.x
    followed.y = p.y
    followed.z = p.z
    clearance = 1
    initialised = true
  } else if (fp) {
    // First person: no horizontal lag (it reads as input delay); only steps are eased.
    followed.x = p.x
    followed.z = p.z
    followed.y += (p.y - followed.y) * (1 - Math.exp(-25 * dt))
  } else {
    const t = dt > 0 ? 1 - Math.exp(-CAMERA.followLerp * dt) : 1
    followed.x += (p.x - followed.x) * t
    followed.y += (p.y - followed.y) * t
    followed.z += (p.z - followed.z) * t
  }

  // Sprint framing: FOV widens a little at speed.
  const speed = Math.hypot(player.velocity.x, player.velocity.z)
  const targetRush = clamp((speed - PHYSICS.walkSpeed) / (PHYSICS.sprintSpeed - PHYSICS.walkSpeed), 0, 1)
  rush += (targetRush - rush) * (1 - Math.exp(-CAMERA.speedEase * dt))
  const fov = CAMERA.fov + CAMERA.speedFov * rush
  if (Math.abs(camera.fov - fov) > 0.01) {
    camera.fov = fov
    camera.updateProjectionMatrix()
  }

  if (fp) {
    const eyeY = followed.y + player.dims.height * CAMERA.eyeHeight
    const cp = Math.cos(state.pitch)
    camera.position.set(followed.x, eyeY, followed.z)
    camera.lookAt(followed.x - Math.sin(state.yaw) * cp, eyeY - Math.sin(state.pitch), followed.z - Math.cos(state.yaw) * cp)
    return
  }

  zoomEased += (zoomTarget - zoomEased) * (1 - Math.exp(-CAMERA.zoomEase * dt))
  const distance = Math.max(1, zoomEased)

  look.x = followed.x
  look.y = followed.y + player.dims.height * CAMERA.targetHeight
  look.z = followed.z

  const cp = Math.cos(state.pitch)
  const px = look.x + Math.sin(state.yaw) * cp * distance
  const py = look.y + Math.sin(state.pitch) * distance
  const pz = look.z + Math.cos(state.yaw) * cp * distance

  // Never inside a solid: pull in to the first static collider between the
  // player and the camera at once, and ease back out once it is clear.
  const hit = segmentClear(look.x, look.y, look.z, px, py, pz)
  const want = hit < 1 ? Math.max(0.08, hit - 0.05) : 1
  clearance = want < clearance ? want : clearance + (want - clearance) * (1 - Math.exp(-CAMERA.clearEase * dt))

  camera.position.set(look.x + (px - look.x) * clearance, look.y + (py - look.y) * clearance, look.z + (pz - look.z) * clearance)
  camera.lookAt(look.x, look.y, look.z)
}
