// The driver: the player's own Bloxity avatar (player.glb dressed with their equipped
// cosmetics and proportions, avatar/) sitting in the driver's seat of the car
// (carmodel.js `seat`), config DRIVER. Ported from Trains vs Spaghetti's train driver.
//
// Everything is read off the car's real motion, not timers: a "felt" speed lags the
// real one (DRIVER.inertia), so pulling away pins them back into the seat and braking
// lurches them forward; cornering leans them out of the turn; the hands follow the
// steering wheel; drifting yanks the handbrake; reversing turns them round with an arm
// over the passenger seat; wall hits jolt them; a treadmill hunches them over the
// wheel, buzzing. Game moments: a tape that snaps = fists up, a tape that slingshots
// the car back = whiplash and a dizzy head, a new car / level / rebirth = a wave,
// Parked a while, they look around, drum on the
// wheel and now and then look at the camera.
//
// H / HORN: a punch on the wheel's centre. The cockpit view (carcam.js) sits at eye()
// with setFirstPerson(true) hiding the head and what is worn on it. seatPreview(parts)
// puts a posed copy (one hand on the wheel, the other waving) in another car, for the
// car shop's pictures.
//
//   createDriver(car) -> { mount(body, seat), update(dt, elapsed, camera, boosted), cheer(), wave(),
//                          honk(), eye(target), setFirstPerson(on), seatPreview(parts), whenLoaded, group }
import { Group, Vector3 } from 'three'
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { DRIVER, DRIVER_SEAT } from './config.js'
import { loadBaseCharacter } from './avatar/character.js'
import { applyProportions, attachEquippedAccessories } from './avatar/loader.js'
import { BONE_INDEX, PlayerRig, PoseBuffer } from './avatar/rig.js'
import * as bloxity from './bloxity.js'
import * as game from './game.js'

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v)
const rnd = ([lo, hi]) => lo + Math.random() * (hi - lo)
const damp = (cur, goal, rate, dt) => cur + (goal - cur) * (1 - Math.exp(-rate * dt))
const STEP = 1 / 120 // spring sub-step
const P = DRIVER.pose

// `opts.source` (remote players): { equipped(), proportions(), skin() } read instead of the local Bloxity SDK;
// such a driver reacts to nothing but its own `state` and the cheer() / wave() / honk() calls it is given.
export function createDriver(car, opts = {}) {
  const remote = !!opts.source
  const src = opts.source ?? { equipped: bloxity.getEquippedAvatar, proportions: bloxity.getProportions, skin: bloxity.getSkinTextureUrl }
  const group = new Group() // at the seat: hip height on the cushion, in the car body's frame
  group.name = 'driver'
  const body = new Group() // bounce + buzz
  group.add(body)
  group.visible = false

  let root = null
  let rig = null
  let seat = null
  const pose = new PoseBuffer()
  const v = new Vector3()

  // --- The avatar: sized so the seated body fits the seat's headroom ----------------------
  function fit() {
    if (!root || !seat) return
    applyProportions(root, src.proportions())
    rig.resetToBindPose()
    root.position.set(0, 0, 0)
    root.updateMatrixWorld(true)
    const y = (node) => (node ? node.getWorldPosition(v).y - root.getWorldPosition(new Vector3()).y : 0)
    const hip = y(root.nodes.LegL1) || 0.675
    const crown = y(root.nodes.Neck1_leaf) || 1.8
    const sitting = crown - hip + DRIVER.thigh * hip // (current units)
    const room = seat.roofY - DRIVER_SEAT.clearance - seat.hipY
    const k = Math.min(DRIVER_SEAT.sitHeight, room) / sitting
    root.scale.multiplyScalar(k)
    root.position.set(0, -hip * k + DRIVER.thigh * hip * k, 0) // hip joint half a thigh above the cushion
  }
  let firstPerson = false
  // The head and everything worn on it (hats, hair, masks hang off Neck1).
  function headParts(r, fn) {
    r.traverse((o) => {
      if (!(o.isMesh || o.isSkinnedMesh)) return
      let onNeck = false
      for (let a = o.parent; a && a !== r; a = a.parent) if (a.name === 'Neck1') onNeck = true
      if (onNeck || o.name === 'default_head') fn(o)
    })
  }
  function setFirstPerson(on) {
    firstPerson = on
    if (root) headParts(root, (o) => (o.visible = !on))
  }
  let markLoaded
  const whenLoaded = new Promise((r) => (markLoaded = r))
  let loadId = 0
  async function load() {
    const id = ++loadId
    const next = await loadBaseCharacter()
    if (id !== loadId) return
    const equipped = src.equipped()
    if (equipped) await attachEquippedAccessories(next, equipped, { skinTextureUrl: src.skin() || undefined })
    if (id !== loadId) return
    next.traverse((o) => {
      if (o.isMesh || o.isSkinnedMesh) {
        o.castShadow = true
        o.receiveShadow = true
        o.frustumCulled = false // posed far from its bind bounds; one small avatar
      }
    })
    if (root) body.remove(root)
    root = next
    body.add(root)
    rig = new PlayerRig(root) // still in its bind pose here
    fit()
    setFirstPerson(firstPerson)
    markLoaded()
  }
  load()
  if (!remote) {
    bloxity.onAvatarChanged(() => load()) // may fire twice; the stale load is dropped
    bloxity.onProportionsChanged(() => fit())
  }

  // A new car: move into its seat and refit the headroom.
  function mount(carBody, s) {
    seat = s
    carBody.add(group)
    group.position.set(s.x, s.hipY, s.hipU)
    fit()
  }

  // --- Motion state ----------------------------------------------------------------------
  let felt = 0
  let surge = 0
  let lateral = 0
  let stoppedFor = 10
  let cheerLeft = 0
  let waveLeft = 0
  let honkLeft = 0
  let dizzyLeft = 0
  let lastStun = 0
  let glance = 0
  let glanceGoal = 0
  let glanceCam = false
  let glanceIn = rnd(DRIVER.glance.every)
  // Weights eased toward their targets so every pose change blends.
  const w = { wheel: 1, brake: 0, reverse: 0, relax: 0, cheer: 0, wave: 0, idle: 0, hunch: 0, boost: 0 }
  // Springs: head whiplash (pitch) and seat bounce (y).
  let nod = 0
  let nodV = 0
  let bounce = 0
  let bounceV = 0

  function cheer() {
    cheerLeft = DRIVER.cheerFor
  }
  function wave() {
    waveLeft = DRIVER.waveFor
  }
  function honk() {
    honkLeft = DRIVER.honkFor
    nodV += 3
  }
  if (!remote) {
    game.on('wins', (n) => n > 0 && cheer()) // a tape snapped
    game.on('car', wave)
    game.on('levelup', wave)
    game.on('rebirth', wave)
  }

  const addDef = (def, k) => {
    if (k <= 0.001) return
    for (const bone in def) {
      const r = def[bone]
      pose.add(bone, (r.x ?? 0) * k, (r.y ?? 0) * k, (r.z ?? 0) * k)
    }
  }

  function update(dt, elapsed, camera, boosted) {
    group.visible = !!(root && seat)
    if (!group.visible || !(dt > 0)) return

    // How the car is moving.
    const speed = car.pad ? Math.abs(car.wheelSpeed) : car.speed
    felt = damp(felt, speed, 1 / DRIVER.inertia, dt)
    surge = damp(surge, clamp((speed - felt) / DRIVER.surge, -1, 1), 10, dt) // + pulling away, - braking
    lateral = damp(lateral, clamp((car.yawRate * car.speed) / DRIVER.lateral, -1, 1), 8, dt) // + turning right
    const steer = clamp(car.steerAngle / 0.55, -1, 1)
    const speedK = clamp(Math.abs(car.wheelSpeed) / car.topSpeed, 0, 1)
    if (Math.abs(car.speed) < 0.6 && !car.pad) stoppedFor += dt
    else stoppedFor = 0

    // A tape slingshot (pushCar raises car.stun): whiplash, then a dizzy head.
    if (car.stun > lastStun + 0.05) {
      nodV += 9
      dizzyLeft = DRIVER.dizzyFor
    }
    lastStun = car.stun
    // A wall hit (car.js clears car.bump after this frame's sparks).
    if (car.bump) {
      const k = Math.min(1, car.bump / 20)
      bounceV -= DRIVER.bumpKick * k * Math.sqrt(DRIVER.spring.stiffness)
      nodV += 4 * k
    }
    cheerLeft = Math.max(0, cheerLeft - dt)
    waveLeft = Math.max(0, waveLeft - dt)
    honkLeft = Math.max(0, honkLeft - dt)
    dizzyLeft = Math.max(0, dizzyLeft - dt)

    // What the hands are doing (one thing at a time, blended).
    const reversing = car.speed < -0.8 && car.throttle < -0.05
    const goal = {
      cheer: cheerLeft > 0 ? 1 : 0,
      wave: waveLeft > 0 && cheerLeft <= 0 ? 1 : 0,
      relax: 0,
      reverse: reversing ? 1 : 0,
      brake: car.drifting || (car.handbrake && Math.abs(car.speed) > 3) ? 1 : 0,
      idle: stoppedFor > DRIVER.idleAfter ? 1 : 0,
      hunch: car.pad && car.throttle > 0.1 ? 1 : 0,
      boost: boosted && car.throttle > 0.3 && !car.pad ? 1 : 0,
    }
    for (const k in goal) w[k] = damp(w[k], goal[k], k === 'cheer' || k === 'brake' ? 12 : 6, dt)
    w.wheel = 1 - Math.min(1, w.cheer + w.relax)

    // Glances: round the cabin, or at the camera; while idle mostly, now and then driving.
    glanceIn -= dt
    if (glanceIn <= 0) {
      if (glanceGoal !== 0 || glanceCam) {
        glanceGoal = 0
        glanceCam = false
        glanceIn = rnd(DRIVER.glance.every) * (w.idle > 0.5 ? 1 : 2.5)
      } else {
        glanceCam = Math.random() < DRIVER.lookAtCamera
        glanceGoal = (Math.random() < 0.5 ? -1 : 1) * DRIVER.glance.yaw * (0.4 + Math.random() * 0.6) * (w.idle > 0.5 ? 1 : 0.5)
        glanceIn = rnd(DRIVER.glance.hold)
      }
    }
    // The camera, in the seat's frame: yaw to it (behind = over a shoulder), clamped.
    let camYaw = 0
    if (glanceCam || w.wave > 0.05 || w.cheer > 0.05) {
      group.worldToLocal(v.copy(camera.position))
      camYaw = clamp(Math.atan2(v.x, v.z), -1.25, 1.25)
    }
    const lookCam = Math.max(glanceCam ? 1 : 0, w.wave, w.cheer * 0.7)
    glance = damp(glance, (lookCam > 0.5 ? camYaw : glanceGoal) * (1 - w.reverse), 6, dt)

    // Springs, sub-stepped so a long frame can't blow them up.
    const S = DRIVER.spring
    for (let left = dt; left > 1e-6; left -= STEP) {
      const h = Math.min(STEP, left)
      nodV += (-S.stiffness * nod - 2 * S.damping * Math.sqrt(S.stiffness) * nodV) * h
      nod += nodV * h
      bounceV += (-S.stiffness * bounce - 2 * S.damping * Math.sqrt(S.stiffness) * bounceV) * h
      bounce += bounceV * h
    }

    // --- The pose ---------------------------------------------------------------------
    const W = DRIVER.sway
    const H = DRIVER.hands
    pose.reset()
    addDef(P.sit, 1)
    // Hands: on the wheel (following it), the handbrake, over the seat, behind the head, up.
    const onWheel = w.wheel * (1 - w.wave)
    addDef(P.wheelL, onWheel * (1 - w.brake) * (1 - w.reverse))
    addDef(P.wheelR, w.wheel * (1 - w.wave))
    pose.add('ArmL1', -steer * H.wheel * onWheel * (1 - w.brake), 0, -steer * H.slide * onWheel)
    pose.add('ArmR1', steer * H.wheel * onWheel, 0, -steer * H.slide * onWheel)
    addDef(P.handbrake, w.brake * w.wheel * (1 - w.reverse))
    addDef(P.reverse, w.reverse * w.wheel)
    addDef(P.relaxL, w.relax)
    addDef(P.relaxR, w.relax)
    const pump = Math.sin(elapsed * 13)
    addDef(P.cheerL, w.cheer)
    addDef(P.cheerR, w.cheer)
    pose.add('ArmL1', pump * 0.3 * w.cheer)
    pose.add('ArmR1', -pump * 0.3 * w.cheer)
    addDef(P.wave, w.wave)
    pose.add('ArmR2', 0, 0, Math.sin(elapsed * 10) * 0.45 * w.wave)
    // Horn: the right hand jabs the middle of the wheel (over whatever it was doing).
    const jab = honkLeft > 0 ? Math.sin(Math.min(1, (DRIVER.honkFor - honkLeft) / DRIVER.honkFor) * Math.PI) : 0
    if (jab > 0.001) {
      const now = pose.rotations
      for (const bone of ['ArmR1', 'ArmR2']) {
        const at = BONE_INDEX[bone] * 3
        const r = P.honk[bone]
        for (let i = 0; i < 3; i++) now[at + i] += ((r[['x', 'y', 'z'][i]] ?? 0) - now[at + i]) * jab
      }
    }
    // Drumming fingers on the wheel while parked.
    if (w.idle > 0.05) {
      pose.add('ArmR2', Math.max(0, Math.sin(elapsed * 9)) * 0.12 * w.idle * w.wheel)
      pose.add('ArmL2', Math.max(0, Math.sin(elapsed * 9 + 1.6)) * 0.1 * w.idle * w.wheel)
    }

    // Body: pinned back pulling away / boosting, lurching forward braking, leaning out of
    // corners, hunched over the wheel on a treadmill, breathing.
    const breath = Math.sin(elapsed * 2.2)
    const back = -W.accel * Math.max(0, surge) - W.boost * w.boost + W.brake * Math.max(0, -surge) + W.hunch * w.hunch
    // (-Z leans to the character's left: out of a right-hand turn.)
    pose.add('Spine1', back, 0, -lateral * W.corner * (1 - w.reverse * 0.5))
    pose.add('Spine2', breath * 0.02 + W.hunch * 0.4 * w.hunch, 0, -lateral * W.corner * 0.4)
    // Head: whiplash nod, into the turn, glances, over the shoulder reversing, dizzy circles,
    // a shake at full boost, bob on the treadmill and while cheering.
    const dizzy = dizzyLeft > 0 ? Math.min(1, dizzyLeft / 0.5) : 0
    const neckX = nod * 0.12 + back * 0.5 +Math.sin(elapsed * 7) * 0.15 * dizzy + w.hunch * Math.abs(Math.sin(elapsed * 11)) * 0.12 + w.cheer * pump * 0.12
    const neckY = -steer * 0.32 * (1 - w.reverse) * (1 - w.relax) + glance + w.reverse * 1.25 + Math.cos(elapsed * 7) * 0.3 * dizzy
    const neckZ = lateral * 0.3 +w.boost * Math.sin(elapsed * 31) * 0.04 + Math.sin(elapsed * 5.5) * 0.18 * dizzy
    pose.add('Neck1', neckX, neckY, neckZ)
    rig.applyPose(pose)

    // Placement: seat bounce + engine buzz (the suspension already tilts the whole body).
    const buzz = Math.sin(elapsed * 57) * DRIVER.vibrate * (speedK + w.hunch)
    body.position.set(0, bounce + buzz, 0)
  }

  // The middle of the head, in world space (the cockpit camera). False until seated.
  function eye(target) {
    const neck = root?.nodes.Neck1
    const crown = root?.nodes.Neck1_leaf
    if (!group.visible || !neck || !crown) return false
    neck.getWorldPosition(target)
    crown.getWorldPosition(v)
    target.lerp(v, 0.5)
    return true
  }

  // A posed copy of the avatar in another car's seat (the car shop's pictures): one hand on
  // the wheel, waving with the other, head turned a little toward the picture's camera.
  function seatPreview(parts) {
    if (!root || !parts?.seat) return false
    rig.resetToBindPose() // clone the bind pose (PlayerRig must be built on it)
    const copy = cloneSkinned(root)
    rig.applyPose(pose)
    copy.nodes = {}
    copy.traverse((o) => {
      if (o.name && !copy.nodes[o.name]) copy.nodes[o.name] = o
    })
    headParts(copy, (o) => (o.visible = true))
    const still = new PoseBuffer()
    for (const def of [P.sit, P.wheelL, P.wave]) {
      for (const bone in def) still.add(bone, def[bone].x ?? 0, def[bone].y ?? 0, def[bone].z ?? 0)
    }
    still.add('ArmR2', 0, 0, 0.3)
    still.add('Neck1', 0.05, 0.12, 0)
    new PlayerRig(copy).applyPose(still)
    const at = new Group()
    at.position.set(parts.seat.x, parts.seat.hipY, parts.seat.hipU)
    at.add(copy)
    parts.body.add(at)
    return true
  }

  const api = {
    group,
    mount,
    update,
    cheer,
    wave,
    honk,
    eye,
    setFirstPerson,
    seatPreview,
    whenLoaded,
    reload: load, // remote: the player changed what they wear
    refit: fit, // remote: ... or their proportions
    dispose() {
      loadId++ // a load still in flight is dropped
    },
    get loaded() {
      return !!root
    },
  }
  group.userData.api = api // dev: scene.getObjectByName('driver').userData.api
  return api
}
