import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, DoubleSide, DynamicDrawUsage, Group, Mesh, PointLight, ShaderMaterial, SpotLight, Vector3 } from 'three'
import { inputState } from './input.js'
import { RAPIER, alpha, onTick, world } from './physics.js'
import { CAR, DRIVER_SEAT, PHYSICS, SPAWN, SPAWN_FACING } from './config.js'
import { buildCar } from './carmodel.js'
import { setNeonLevel } from './propkit.js'
import { createDriver } from './driver.js'

// The driven car: a kinematic Rapier capsule (lying along the car) moved by
// Rapier's KinematicCharacterController, with arcade handling on top:
// throttle/brake/reverse, speed-scaled steering, lateral grip that lets go
// under the handbrake (drift), wall hits that bleed speed, gravity and
// autostep for curbs. Treadmills hold the car in place while the wheels spin
// (the "virtual" wheel speed is what trains power).

const TAU = Math.PI * 2
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a))

export const car = {
  position: { x: 0, y: 0, z: 0 },
  renderPosition: { x: 0, y: 0, z: 0 },
  yaw: SPAWN_FACING,
  renderYaw: SPAWN_FACING,
  velocity: { x: 0, y: 0, z: 0 },
  speed: 0, // signed, along the car's nose
  lateral: 0,
  wheelSpeed: 0, // what the wheels do (= speed, except on a treadmill)
  steerAngle: 0,
  yawRate: 0,
  grounded: true,
  throttle: 0,
  steer: 0,
  handbrake: false,
  braking: false,
  drifting: false,
  stun: 0,
  pad: null, // treadmill under the car (only when aligned and driving onto it)
  topSpeed: 28,
  frozen: false, // true while a window is open in front of the game
}

// Who drives: the keyboard/touch by default; setControlSource can swap in another.
let controlSource = () => ({ throttle: inputState.move.z, steer: inputState.move.x, handbrake: inputState.brake })
export function setControlSource(fn) {
  controlSource = fn
}
export const manualInput = () => Math.abs(inputState.move.z) > 0.1 || Math.abs(inputState.move.x) > 0.1 || inputState.brake

const afterMove = []
export function onAfterMove(fn) {
  afterMove.push(fn)
}

let pads = [] // { x, z, hx, hz, axis (yaw toward the console), mult, index, unlocked() }
export function setPads(list) {
  pads = list
}

const prev = { x: 0, y: 0, z: 0, yaw: 0 }
let body = null
let collider = null
let controller = null
const HALF = CAR.length / 2 - CAR.radius

export function createCarBody() {
  body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(SPAWN.x, SPAWN.y, SPAWN.z))
  // Capsule along local Z (Rapier capsules run along Y): rotate 90 degrees about X.
  const q = { x: Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 }
  collider = world.createCollider(RAPIER.ColliderDesc.capsule(HALF, CAR.radius).setTranslation(0, CAR.radius + 0.06, 0).setRotation(q).setFriction(0), body)
  controller = world.createCharacterController(0.03)
  controller.setUp({ x: 0, y: 1, z: 0 })
  controller.enableAutostep(CAR.stepHeight, 0.3, false)
  controller.enableSnapToGround(0.6)
  controller.setMaxSlopeClimbAngle((42 * Math.PI) / 180)
  controller.setMinSlopeSlideAngle((50 * Math.PI) / 180)
  controller.setSlideEnabled(true)
  resetCar()
  onTick(step)
}

export function resetCar(spawn = SPAWN, yaw = SPAWN_FACING) {
  for (const o of [car.position, car.renderPosition, prev]) {
    o.x = spawn.x
    o.y = spawn.y
    o.z = spawn.z
  }
  car.yaw = car.renderYaw = prev.yaw = yaw
  car.velocity.x = car.velocity.y = car.velocity.z = 0
  car.speed = car.lateral = car.wheelSpeed = car.yawRate = 0
  car.stun = 0
  car.pad = null
  body?.setTranslation({ x: spawn.x, y: spawn.y, z: spawn.z }, true)
  body?.setNextKinematicTranslation({ x: spawn.x, y: spawn.y, z: spawn.z })
  setRotation(yaw, true)
}

function setRotation(yaw, now = false) {
  const q = { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }
  if (now) body?.setRotation(q, true)
  body?.setNextKinematicRotation(q)
}

// Pushes the car along its nose axis (tapes use this to slingshot it back).
export function pushCar(speed, stun = 0) {
  const fx = Math.sin(car.yaw)
  const fz = Math.cos(car.yaw)
  car.velocity.x = fx * speed
  car.velocity.z = fz * speed
  car.speed = car.wheelSpeed = speed
  car.lateral = 0
  car.stun = Math.max(car.stun, stun)
}

const approach = (v, target, rate) => (v < target ? Math.min(target, v + rate) : Math.max(target, v - rate))

function findPad(x, z, fx, fz) {
  for (const p of pads) {
    const dx = x - p.x
    const dz = z - p.z
    // Pad rectangle in its own frame (axis = along the belt).
    const ax = Math.sin(p.axis)
    const az = Math.cos(p.axis)
    const along = dx * ax + dz * az
    const across = -dx * az + dz * ax
    if (Math.abs(along) > p.hx || Math.abs(across) > p.hz) continue
    const aligned = fx * ax + fz * az > 0.75
    return { pad: p, aligned, across }
  }
  return null
}

function step(dt) {
  prev.x = car.position.x
  prev.y = car.position.y
  prev.z = car.position.z
  prev.yaw = car.yaw

  const ctrl = car.frozen ? { throttle: 0, steer: 0, handbrake: true } : controlSource()
  let throttle = Math.max(-1, Math.min(1, ctrl.throttle))
  const steer = Math.max(-1, Math.min(1, ctrl.steer))
  const handbrake = !!ctrl.handbrake
  if (car.stun > 0) {
    car.stun -= dt
    throttle = 0
  }
  // On a treadmill the car trains by itself; S / handbrake still lets you off.
  if (car.pad && car.stun <= 0 && !handbrake && throttle > -0.05) throttle = 1
  car.throttle = throttle
  car.steer = steer
  car.handbrake = handbrake

  // Steering: wheel angle eases to the input; yaw rate scales with speed.
  car.steerAngle += (steer * 0.55 - car.steerAngle) * Math.min(1, dt * 10)
  const top = car.topSpeed
  const sp = car.wheelSpeed
  const speedK = Math.min(1, Math.abs(car.speed) / CAR.steerSpeedRef)
  const highSpeedDamp = 1 - 0.35 * Math.min(1, Math.abs(car.speed) / top)
  const drift = handbrake && Math.abs(car.speed) > 6
  car.yawRate = (car.steerAngle / 0.55) * CAR.steerRate * speedK * highSpeedDamp * Math.sign(car.speed || 1) * (drift ? CAR.driftSteer : 1)
  if (car.pad) car.yawRate *= 0.25 // the belt holds the wheels
  car.yaw = wrap(car.yaw - car.yawRate * dt)

  // Re-split the world velocity in the new heading: speed (nose) + lateral (slip).
  const fx = Math.sin(car.yaw)
  const fz = Math.cos(car.yaw)
  const rx = -fz
  const rz = fx
  const v = car.velocity
  let speed = car.pad ? car.wheelSpeed : v.x * fx + v.z * fz
  let lateral = v.x * rx + v.z * rz

  // Pedals.
  car.braking = false
  if (throttle > 0.05) {
    if (speed < -0.5) {
      speed = approach(speed, 0, CAR.brake * throttle * dt)
      car.braking = true
    } else speed += CAR.accel * throttle * Math.max(0, 1 - speed / top) * dt + (speed < 4 ? 6 * throttle * dt : 0)
  } else if (throttle < -0.05) {
    if (speed > 0.5) {
      speed = approach(speed, 0, CAR.brake * -throttle * dt)
      car.braking = true
    } else speed = Math.max(-CAR.reverseSpeed, speed + CAR.accel * 0.6 * throttle * dt)
  } else speed = approach(speed, 0, CAR.coast * dt)
  if (handbrake) {
    speed = approach(speed, 0, (drift ? 6 : 30) * dt)
    car.braking = true
  }

  // Grip: the slip dies out fast, slowly under the handbrake.
  lateral *= Math.exp(-(drift ? CAR.driftGrip : CAR.grip) * dt)
  car.drifting = drift && Math.abs(lateral) > 2.5

  // Treadmill: aligned and rolling forward onto an unlocked belt holds the car.
  const hit = findPad(car.position.x, car.position.z, fx, fz)
  const onBelt = hit && hit.aligned && hit.pad.unlocked() && (speed > 0.5 || car.pad)
  car.pad = onBelt && throttle >= -0.05 ? hit.pad : null
  car.padHit = hit && !hit.pad.unlocked() ? hit.pad : null
  car.wheelSpeed = speed

  let vx, vz
  if (car.pad) {
    // The belt carries the car back as fast as the wheels drive it forward; it
    // drifts to the belt's centre line.
    const p = car.pad
    const ax = Math.sin(p.axis)
    const az = Math.cos(p.axis)
    const along = (car.position.x - p.x) * ax + (car.position.z - p.z) * az
    const pull = -along * 3 // settle on the middle of the belt
    vx = -hit.across * -az * 2 + ax * pull
    vz = -hit.across * ax * 2 + az * pull
    lateral = 0
    // Ease the heading onto the belt axis.
    car.yaw = wrap(car.yaw + wrap(p.axis - car.yaw) * Math.min(1, dt * 3))
  } else {
    vx = fx * speed + rx * lateral
    vz = fz * speed + rz * lateral
  }

  // Gravity.
  v.y += CAR.gravity * dt
  if (car.grounded && v.y < -2) v.y = -2

  const desired = { x: vx * dt, y: v.y * dt, z: vz * dt }
  controller.computeColliderMovement(collider, desired, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS)
  const moved = controller.computedMovement()
  car.grounded = controller.computedGrounded()
  if (car.grounded && v.y < 0) v.y = -2

  // Wall contact: the velocity becomes what actually happened (slides along walls).
  const dh = Math.hypot(desired.x, desired.z)
  const mh = Math.hypot(moved.x, moved.z)
  if (!car.pad && dh > 0.02 && mh < dh * 0.8) {
    const loss = 1 - mh / dh
    if (Math.abs(speed) > 7 && loss > 0.3) car.bump = Math.max(car.bump ?? 0, Math.abs(speed) * loss)
    vx = (moved.x / dt) * (1 - CAR.bumpLoss * loss * 0.5)
    vz = (moved.z / dt) * (1 - CAR.bumpLoss * loss * 0.5)
  }
  v.x = car.pad ? 0 : vx
  v.z = car.pad ? 0 : vz
  if (!car.pad) car.wheelSpeed = v.x * fx + v.z * fz
  car.speed = car.pad ? 0 : car.wheelSpeed
  car.lateral = v.x * rx + v.z * rz

  const t = body.translation()
  const next = { x: t.x + moved.x, y: t.y + moved.y, z: t.z + moved.z }

  // Never sink: ray down from above the car at the nose, middle and tail; if the
  // ground is higher than the car's feet, lift the car onto it.
  let groundTop = -Infinity
  for (const o of [-HALF, 0, HALF]) {
    const rx0 = next.x + Math.sin(car.yaw) * o
    const rz0 = next.z + Math.cos(car.yaw) * o
    const ray = new RAPIER.Ray({ x: rx0, y: next.y + 2, z: rz0 }, { x: 0, y: -1, z: 0 })
    const hit = world.castRay(ray, 6, true, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, undefined, collider)
    if (hit) groundTop = Math.max(groundTop, next.y + 2 - hit.timeOfImpact)
  }
  if (groundTop > next.y + 0.001 && groundTop - next.y < 1.5) {
    next.y = groundTop
    if (v.y < 0) v.y = 0
    car.grounded = true
  }
  body.setNextKinematicTranslation(next)
  setRotation(car.yaw)
  car.position.x = next.x
  car.position.y = next.y
  car.position.z = next.z

  for (const fn of afterMove) fn(dt)

  if (car.position.y < PHYSICS.killY) resetCar()
}

export function interpolate() {
  const r = car.renderPosition
  const p = car.position
  r.x = prev.x + (p.x - prev.x) * alpha
  r.y = prev.y + (p.y - prev.y) * alpha
  r.z = prev.z + (p.z - prev.z) * alpha
  car.renderYaw = prev.yaw + wrap(car.yaw - prev.yaw) * alpha
}

// Teleports the car (keeps it on its body).
export function teleportCar(x, y, z, yaw) {
  resetCar({ x, y, z }, yaw)
}

// --- Light trail: a ribbon of neon drawn from a point on the car, in world space ---------
// A ring of samples (newest first); the head follows the point every frame and a new sample is
// laid down every `spacing` metres. Each sample fades out over `life` seconds, and the ribbon
// tapers toward its tail. Allocation-free per frame.
const TRAIL_VERT = /* glsl */ `
  attribute float aFade;
  varying float vFade;
  varying float vEdge;
  void main() {
    vFade = aFade;
    vEdge = mod(float(gl_VertexID), 2.0);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`
const TRAIL_FRAG = /* glsl */ `
  uniform vec3 uColor;
  varying float vFade;
  varying float vEdge;
  void main() {
    float across = 1.0 - abs(vEdge * 2.0 - 1.0); // 0 at the ribbon's edges, 1 down its middle
    gl_FragColor = vec4(uColor * (1.4 + vFade * 2.0), vFade * (0.55 + 0.45 * across));
  }`
function makeTrail(scene, n = 44) {
  const pos = new Float32Array(n * 2 * 3)
  const fade = new Float32Array(n * 2)
  const index = []
  for (let i = 0; i < n - 1; i++) {
    const a = i * 2
    index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
  }
  const geo = new BufferGeometry()
  geo.setAttribute('position', new BufferAttribute(pos, 3).setUsage(DynamicDrawUsage))
  geo.setAttribute('aFade', new BufferAttribute(fade, 1).setUsage(DynamicDrawUsage))
  geo.setIndex(index)
  const mat = new ShaderMaterial({ uniforms: { uColor: { value: new Color() } }, vertexShader: TRAIL_VERT, fragmentShader: TRAIL_FRAG, transparent: true, depthWrite: false, blending: AdditiveBlending, side: DoubleSide })
  const mesh = new Mesh(geo, mat)
  mesh.frustumCulled = false
  mesh.renderOrder = 6
  mesh.visible = false
  scene.add(mesh)
  // Samples: x, y, z, right-vector x/z, time laid down.
  const sx = new Float32Array(n)
  const sy = new Float32Array(n)
  const sz = new Float32Array(n)
  const rx = new Float32Array(n)
  const rz = new Float32Array(n)
  const st = new Float32Array(n)
  let count = 0
  const shift = () => {
    for (const a of [sx, sy, sz, rx, rz, st]) a.copyWithin(1, 0, n - 1)
    count = Math.min(n, count + 1)
  }
  return {
    mesh,
    setColor: (c) => mat.uniforms.uColor.value.set(c),
    clear: () => (count = 0),
    // (x, y, z) = the point now; (rxv, rzv) = the car's right vector; on = still laying trail.
    update(x, y, z, rxv, rzv, time, on, width = 0.16, life = 0.45, spacing = 0.35) {
      const jump = count && Math.hypot(x - sx[0], z - sz[0]) > 6 // teleported
      if (jump) count = 0
      if (on) {
        if (count < 2 || Math.hypot(sx[0] - sx[1], sz[0] - sz[1]) > spacing) shift()
        sx[0] = x
        sy[0] = y
        sz[0] = z
        rx[0] = rxv
        rz[0] = rzv
        st[0] = time
      }
      let live = 0
      for (let i = 0; i < count; i++) {
        const age = (on && i === 0 ? 0 : time - st[i]) / life
        const f = Math.max(0, 1 - age) * (1 - i / n)
        if (f > 0) live = i + 1
        const w = width * (0.35 + 0.65 * f)
        const k = i * 6
        pos[k] = sx[i] - rx[i] * w
        pos[k + 1] = sy[i]
        pos[k + 2] = sz[i] - rz[i] * w
        pos[k + 3] = sx[i] + rx[i] * w
        pos[k + 4] = sy[i]
        pos[k + 5] = sz[i] + rz[i] * w
        fade[i * 2] = fade[i * 2 + 1] = f
      }
      count = live
      mesh.visible = count > 1
      if (mesh.visible) {
        geo.setDrawRange(0, (count - 1) * 6)
        geo.attributes.position.needsUpdate = true
        geo.attributes.aFade.needsUpdate = true
      }
    },
  }
}

// --- Visuals: the model, suspension, wheels, lamps and particles ----------------
// `st` = the car state it follows (the local `car`, or a remote player's look-alike, remotes.js).
// `opts.remote` = no lights (they would change every material's shader) and an avatar read from
// `opts.source` (driver.js); `opts.fxRange` limits the particles to cars near the camera.
export function createCarView(scene, fx, preset, st = car, opts = {}) {
  const root = new Group()
  scene.add(root)
  let parts = null
  let def = null
  const driver = createDriver(st, opts) // the player's avatar in the driver's seat (driver.js)

  // Headlight beam + underglow light (one each, on every preset but Low).
  const lightsOn = !opts.remote && preset.particles >= 0.5
  const beam = lightsOn ? new SpotLight('#eaf4ff', 0, 40, 0.5, 0.6, 1.2) : null
  const glowLight = lightsOn ? new PointLight('#ffffff', 0, 7, 1.6) : null
  if (beam) {
    beam.position.set(0, 0.8, 1.8)
    beam.target.position.set(0, 0, 14)
    root.add(beam, beam.target)
  }
  if (glowLight) {
    glowLight.position.set(0, 0.35, 0)
    root.add(glowLight)
  }
  // Performance-kit cars: afterburner glow on the road behind the jets + neon light trails
  // from the tail lamps at speed. Always in the scene (a light appearing would recompile every
  // material); dark and hidden on cars without the kit.
  const jetLight = lightsOn ? new PointLight('#ff7a1a', 0, 6, 1.8) : null
  if (jetLight) root.add(jetLight)
  const trails = !opts.remote && preset.particles >= 0.5 ? [makeTrail(scene), makeTrail(scene)] : []
  let jetHeat = 0
  let jetT = 0

  function setCar(d) {
    if (parts) root.remove(parts.root)
    def = d
    parts = buildCar(d, { lights: true })
    root.add(parts.root)
    driver.mount(parts.body, parts.seat)
    st.topSpeed = d.speed
    if (glowLight) glowLight.color.set(parts.glowColor)
    parts.under.material.color.set(parts.glowColor)
    if (jetLight) {
      jetLight.color.set(parts.flameColor)
      jetLight.intensity = 0
      jetLight.position.set(0, parts.jets[0]?.y ?? 0.5, (parts.jets[0]?.z ?? 0) - 0.9)
    }
    for (const tr of trails) {
      tr.setColor(parts.accent)
      tr.clear()
    }
  }

  let pitch = 0
  let roll = 0
  let pitchV = 0
  let rollV = 0
  let lastSpeed = 0
  let smokeT = 0
  let tyreT = 0
  let padT = 0
  let night = 0
  const camDir = new Vector3()
  const tmp = new Vector3()
  const white = new Color('#ffffff')

  return {
    root,
    setCar,
    driver,
    get parts() {
      return parts
    },
    setNight(n) {
      night = n
    },
    update(dt, camera, elapsed, boosted) {
      const p = st.renderPosition
      root.position.set(p.x, p.y, p.z)
      root.rotation.y = st.renderYaw
      if (!parts) return

      // Suspension: squat under acceleration, dive under braking, lean in turns.
      const accel = dt > 0 ? (st.wheelSpeed - lastSpeed) / dt : 0
      lastSpeed = st.wheelSpeed
      const pitchTarget = Math.max(-0.06, Math.min(0.06, -accel * 0.0028))
      const rollTarget = Math.max(-0.07, Math.min(0.07, st.yawRate * Math.abs(st.speed) * 0.0035 + (st.drifting ? Math.sign(st.lateral) * 0.02 : 0)))
      // Damped springs.
      pitchV += ((pitchTarget - pitch) * 90 - pitchV * 12) * dt
      rollV += ((rollTarget - roll) * 90 - rollV * 12) * dt
      pitch += pitchV * dt
      roll += rollV * dt
      const rumble = st.pad ? Math.sin(elapsed * 60) * 0.008 : 0
      parts.body.rotation.set(pitch, 0, roll)
      parts.body.position.y = rumble + (st.pad ? 0.02 : 0)

      // Wheels.
      for (const w of parts.wheels) {
        w.spin.rotation.x += (st.wheelSpeed * dt) / parts.dims.wheelR
        if (w.front) w.pivot.rotation.y = -st.steerAngle
      }
      if (parts.steering) parts.steering.spin.rotation.z = st.steerAngle * DRIVER_SEAT.wheelTurn
      setNeonLevel(parts.dashMat, 1.6 + night * 2.4)
      // (a far remote car keeps its last pose: the avatar is the costly part)
      if (!opts.driverRange || Math.hypot(camera.position.x - p.x, camera.position.z - p.z) < opts.driverRange) driver.update(dt, elapsed, camera, boosted) // reads the car state bump before the sparks below clear it

      // Lamps: brake lights flare, headlight flares face the camera only from the front.
      setNeonLevel(parts.tailMat, st.braking ? 6 : 2.2)
      camDir.set(camera.position.x - p.x, 0, camera.position.z - p.z).normalize()
      const fwdDot = camDir.x * Math.sin(st.renderYaw) + camDir.z * Math.cos(st.renderYaw)
      const flareK = 0.6 + night * 0.6
      for (const f of parts.flares) f.material.opacity = Math.max(0, fwdDot) * flareK
      for (const f of parts.flares.tail ?? []) f.material.opacity = Math.max(0, -fwdDot) * (st.braking ? 1 : 0.45) * (0.7 + night * 0.5)
      if (beam) beam.intensity = 4 + night * 60
      if (glowLight) glowLight.intensity = 2 + night * 10 + (boosted ? 4 : 0)
      parts.under.material.opacity = 0.35 + night * 0.4 + (boosted ? 0.25 : 0)

      // --- Particles, in world space ---
      if (opts.fxRange && Math.hypot(camera.position.x - p.x, camera.position.z - p.z) > opts.fxRange) {
        st.bump = 0
        return
      }
      const yaw = st.renderYaw
      const sin = Math.sin(yaw)
      const cos = Math.cos(yaw)
      const toWorld = (lx, ly, lz) => tmp.set(p.x + lx * cos + lz * sin, p.y + ly, p.z - lx * sin + lz * cos)
      const busy = Math.abs(st.wheelSpeed) / st.topSpeed

      // Jets (performance kit): the afterburner grows with the throttle (full on a treadmill,
      // longer and hotter boosted), throws embers and lights the road behind the car.
      const jetting = parts.jets.length > 0
      if (jetting) {
        const thr = Math.max(0, st.throttle)
        const target = thr + (boosted && thr > 0.1 ? 0.7 : 0)
        jetHeat += (target - jetHeat) * Math.min(1, dt * (target > jetHeat ? 8 : 4))
        const len = 0.3 + jetHeat * 1.25 + (parts.kit - 1) * 0.15 * jetHeat
        const wide = 0.85 + Math.min(1, jetHeat) * 0.25
        for (const j of parts.jets) j.flame?.userData.set(elapsed, 0.45 + Math.min(1, jetHeat) * 0.55 + (jetHeat > 1 ? 0.3 : 0), len * (0.9 + Math.random() * 0.2), wide)
        setNeonLevel(parts.accentMat, 2.8 + night * 1.2 + (boosted ? 1.2 + Math.sin(elapsed * 9) * 0.8 : 0))
        if (jetLight) jetLight.intensity = (0.6 + jetHeat * 5) * (1 + night * 1.5)
        jetT -= dt
        if (jetT <= 0 && jetHeat > 0.25) {
          jetT = 0.035
          for (const j of parts.jets) {
            toWorld(j.x, j.y, j.z - 0.2 - Math.random() * len * 0.5)
            const back = 9 + jetHeat * 9
            fx.glow({ x: tmp.x, y: tmp.y, z: tmp.z, vx: st.velocity.x - sin * back + (Math.random() - 0.5) * 2, vy: (Math.random() - 0.3) * 1.5, vz: st.velocity.z - cos * back + (Math.random() - 0.5) * 2, life: 0.2 + Math.random() * 0.15, size: j.r * 4.5, sizeEnd: 0.05, color: Math.random() < 0.35 ? parts.accent : parts.flameColor, drag: 3 })
            if (jetHeat > 0.9 && Math.random() < 0.5) fx.glow({ x: tmp.x, y: tmp.y, z: tmp.z, vx: st.velocity.x - sin * back * 0.6 + (Math.random() - 0.5) * 4, vy: 1 + Math.random() * 3, vz: st.velocity.z - cos * back * 0.6 + (Math.random() - 0.5) * 4, life: 0.5, size: 0.22, sizeEnd: 0.02, color: '#ffffff', drag: 1.5, gravity: -9 })
          }
        }
      } else if (jetLight) jetLight.intensity = 0

      // Light trails from the tail lamps (kit 2+), above ~45% of top speed.
      const trailOn = parts.kit >= 2 && Math.abs(st.speed) > st.topSpeed * 0.45
      for (let i = 0; i < trails.length; i++) {
        const tp = parts.trailPoints[i]
        if (!tp) continue
        toWorld(tp[0] * 1.02, tp[1] - 0.08, tp[2] + 0.05)
        trails[i].update(tmp.x, tmp.y, tmp.z, -cos, sin, elapsed, trailOn, boosted ? 0.13 : 0.09)
      }

      // Exhaust: puffs scale with throttle; flames while boosted.
      smokeT -= dt
      if (smokeT <= 0) {
        smokeT = 0.05 + (1 - Math.abs(st.throttle)) * 0.08
        for (const tip of parts.exhaustTips) {
          toWorld(tip.x, tip.y, tip.z)
          const back = 1.5 + Math.abs(st.throttle) * 2
          fx.smoke({ x: tmp.x, y: tmp.y, z: tmp.z, vx: -sin * back + (Math.random() - 0.5) * 0.4, vy: 0.5 + Math.random() * 0.4, vz: -cos * back + (Math.random() - 0.5) * 0.4, life: 0.9, size: 0.25, sizeEnd: 1.1, color: '#c9ccd6', alpha: (0.06 + Math.abs(st.throttle) * 0.12) * (jetting ? 0.5 : 1), drag: 1.6 })
          if (boosted && st.throttle > 0.1 && !jetting) {
            fx.glow({ x: tmp.x, y: tmp.y, z: tmp.z, vx: -sin * 6, vy: 0.2, vz: -cos * 6, life: 0.22, size: 0.7, sizeEnd: 0.1, color: Math.random() < 0.5 ? '#5fd0ff' : '#ff9a2a', drag: 4 })
          }
        }
      }

      // Tyre smoke: drifting, burnouts on a treadmill, hard launches.
      tyreT -= dt
      const burn = st.pad && st.throttle > 0.1
      if ((st.drifting || burn || (st.throttle > 0.5 && Math.abs(st.speed) < 4 && busy > 0.1)) && tyreT <= 0) {
        tyreT = burn ? 0.08 : 0.03
        for (const w of parts.wheels) {
          if (w.front && !st.drifting) continue
          const wp = w.pivot.position
          toWorld(wp.x, 0.15, wp.z - 0.2)
          fx.smoke({ x: tmp.x, y: tmp.y, z: tmp.z, vx: (Math.random() - 0.5) * 1.5 - (burn ? sin * 5 : 0), vy: 0.6 + Math.random(), vz: (Math.random() - 0.5) * 1.5 - (burn ? cos * 5 : 0), life: 1.1, size: 0.5, sizeEnd: 2.2, color: '#eef0f6', alpha: burn ? 0.18 : 0.32, drag: 1.2 })
        }
      }

      // Treadmill: sparkles thrown off the belt in the pad colour, speed streaks.
      if (st.pad) {
        padT -= dt
        if (padT <= 0) {
          padT = 0.03
          const c = st.pad.accent
          toWorld((Math.random() - 0.5) * 2.4, 0.1, -parts.dims.front * 0.4 - Math.random() * 2)
          fx.glow({ x: tmp.x, y: tmp.y, z: tmp.z, vx: -sin * (6 + busy * 8) + (Math.random() - 0.5) * 2, vy: 1 + Math.random() * 3, vz: -cos * (6 + busy * 8) + (Math.random() - 0.5) * 2, life: 0.7, size: 0.45, sizeEnd: 0.05, color: Math.random() < 0.3 ? white : c, drag: 1.5, gravity: -6 })
        }
      }

      // Wall bump: sparks and a ring.
      if (st.bump) {
        const k = Math.min(1, st.bump / 20)
        toWorld(0, 0.6, parts.dims.front)
        fx.sparks(tmp.x, tmp.y, tmp.z, Math.round(10 + 20 * k), ['#ffd76a', '#ffffff', '#ff9a2a'], 7, 0.5, 0.35)
        st.bump = 0
      }
    },
  }
}

export { TAU }
