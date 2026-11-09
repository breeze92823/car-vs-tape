// Rapier physics world. Steps at a fixed rate (PHYSICS.fixedStep) from an
// accumulator; every dynamic body bound to a mesh keeps its previous and
// current transform so rendering interpolates between ticks (smooth at any
// refresh rate). Static geometry registers fixed colliders through the add*
// helpers; the player's kinematic capsule lives in player.js.
import RAPIER from '@dimforge/rapier3d-compat'
import { Quaternion, Vector3 } from 'three'
import { PHYSICS } from './config.js'

export { RAPIER }
export let world = null

const synced = [] // { body, mesh, prev: {p, q}, curr: {p, q} }
const tickListeners = []
let accumulator = 0
export let alpha = 0 // 0..1 of the way from the last tick to the next one

export async function initPhysics() {
  await RAPIER.init()
  world = new RAPIER.World({ x: 0, y: PHYSICS.gravity, z: 0 })
  world.timestep = PHYSICS.fixedStep
  return world
}

// fn(dt) runs before every physics tick (the player controller moves here).
export function onTick(fn) {
  tickListeners.push(fn)
}

// Advances the simulation by real frame time; returns the number of ticks run.
export function stepPhysics(frameDt) {
  accumulator = Math.min(accumulator + frameDt, PHYSICS.fixedStep * PHYSICS.maxSubSteps)
  let ticks = 0
  while (accumulator >= PHYSICS.fixedStep) {
    for (const s of synced) {
      s.prev.p.copy(s.curr.p)
      s.prev.q.copy(s.curr.q)
    }
    for (const fn of tickListeners) fn(PHYSICS.fixedStep)
    world.step()
    for (const s of synced) readBody(s.body, s.curr)
    accumulator -= PHYSICS.fixedStep
    ticks++
  }
  alpha = accumulator / PHYSICS.fixedStep
  for (const s of synced) {
    s.mesh.position.lerpVectors(s.prev.p, s.curr.p, alpha)
    s.mesh.quaternion.slerpQuaternions(s.prev.q, s.curr.q, alpha)
  }
  return ticks
}

function readBody(body, out) {
  const t = body.translation()
  const r = body.rotation()
  out.p.set(t.x, t.y, t.z)
  out.q.set(r.x, r.y, r.z, r.w)
}

// --- Builders ----------------------------------------------------------------

// Binds a mesh to a body so the mesh follows it (interpolated).
export function bindMesh(body, mesh) {
  const s = { body, mesh, prev: { p: new Vector3(), q: new Quaternion() }, curr: { p: new Vector3(), q: new Quaternion() } }
  readBody(body, s.curr)
  s.prev.p.copy(s.curr.p)
  s.prev.q.copy(s.curr.q)
  mesh.position.copy(s.curr.p)
  mesh.quaternion.copy(s.curr.q)
  synced.push(s)
  return s
}

export function unbindMesh(mesh) {
  const i = synced.findIndex((s) => s.mesh === mesh)
  if (i >= 0) synced.splice(i, 1)
}

// Dynamic body + collider for a mesh, placed where the mesh currently is.
// `shape` is a Rapier ColliderDesc; material props tune feel per object.
export function addDynamic(mesh, shape, { density = 1, friction = 0.6, restitution = 0.1, linearDamping = 0.05, angularDamping = 0.1, ccd = false } = {}) {
  const q = mesh.quaternion
  const desc = RAPIER.RigidBodyDesc.dynamic()
    .setTranslation(mesh.position.x, mesh.position.y, mesh.position.z)
    .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
    .setLinearDamping(linearDamping)
    .setAngularDamping(angularDamping)
    .setCcdEnabled(ccd)
  const body = world.createRigidBody(desc)
  world.createCollider(shape.setDensity(density).setFriction(friction).setRestitution(restitution), body)
  bindMesh(body, mesh)
  return body
}

// Fixed collider at a world transform (no body needed for static geometry).
export function addFixed(shape, position, rotation = null, { friction = 0.8, restitution = 0 } = {}) {
  shape.setTranslation(position.x, position.y, position.z).setFriction(friction).setRestitution(restitution)
  if (rotation) shape.setRotation({ x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w })
  return world.createCollider(shape)
}

// Fixed box matching a BoxGeometry mesh (uses the mesh's world position/rotation and geometry size).
export function addFixedBoxFor(mesh, opts) {
  const p = mesh.geometry.parameters
  const s = mesh.scale
  return addFixed(RAPIER.ColliderDesc.cuboid((p.width * s.x) / 2, (p.height * s.y) / 2, (p.depth * s.z) / 2), mesh.position, mesh.quaternion, opts)
}

export function removeBody(body) {
  world.removeRigidBody(body)
}

// First fixed collider hit between two points, as a 0..1 fraction of the
// segment (1 = clear). Crates, balls and the player never block it.
const STATIC_ONLY = () => RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC | RAPIER.QueryFilterFlags.EXCLUDE_KINEMATIC | RAPIER.QueryFilterFlags.EXCLUDE_SENSORS
export function segmentClear(ax, ay, az, bx, by, bz) {
  if (!world) return 1
  const dx = bx - ax
  const dy = by - ay
  const dz = bz - az
  const len = Math.hypot(dx, dy, dz)
  if (len < 1e-4) return 1
  const r = new RAPIER.Ray({ x: ax, y: ay, z: az }, { x: dx / len, y: dy / len, z: dz / len })
  const hit = world.castRay(r, len, true, STATIC_ONLY())
  if (!hit) return 1
  return (hit.timeOfImpact ?? hit.toi) / len
}

export const bodyCount = () => (world ? world.bodies.len() : 0)
