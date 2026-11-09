// Other players in the room: each one's car (their equipped model, wheels, brake lights, drift /
// exhaust smoke), their Bloxity avatar in the driver's seat (skin, worn items, proportions, the same
// driving animations as yours) and a name plate, all read from the server's roster (net.js `players`,
// backend PlayerState). Cheap by design: only the nearest few inside the view distance exist on
// screen, far ones skip the avatar animation and particles, nothing adds a light, and a player's avatar
// is only downloaded when they first come into view.
//
//   createRemotes({ scene, fx, preset }) -> { update(dt, camera, elapsed, night), chat(message, THREE) }
import { COARSE_POINTER, FOG } from './config.js'
import { createCarView } from './car.js'
import { label, relabel } from './propkit.js'
import { sfx } from './audio.js'
import { createRocketVisual } from './rocket.js'
import * as game from './game.js'
import { POSE_FLAGS, roster } from './net.js'
import * as bloxity from './bloxity.js'

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a))
const damp = (cur, goal, rate, dt) => cur + (goal - cur) * (1 - Math.exp(-rate * dt))
const parse = (json) => {
  try {
    const v = json ? JSON.parse(json) : null
    return v && typeof v === 'object' ? v : null
  } catch {
    return null
  }
}
const PLATE = { colors: ['#ffffff', '#ffffff'], font: '700 64px Fredoka, Arial, sans-serif', outlineWidth: 10 }
const LEAD = 0.1 // s: the position is shown a little ahead of the last relayed one (dead reckoning)
const SNAP = 30 // m: a bigger jump is a teleport, not a drive
const HIDE_PAST = 0.92 // of the fog end
const FX_RANGE = 45 // m: particles
const DRIVER_RANGE = 55 // m: avatar animation
const HORN_RANGE = 30 // m: you hear their horn
const ROCKET_FULL = 28 // m: rocket smoke + trails at full strength
const ROCKET_SHOCK = 90 // m: the ignition shockwave rings are still drawn (flames always are)

export function createRemotes({ scene, fx, preset }) {
  const maxShown = COARSE_POINTER ? 6 : preset.particles >= 1 ? 18 : 10
  const entries = new Map() // sessionId -> entry

  function make(id) {
    const st = {
      position: { x: 0, y: 0, z: 0 },
      renderPosition: { x: 0, y: 0, z: 0 },
      yaw: 0,
      renderYaw: 0,
      velocity: { x: 0, y: 0, z: 0 },
      speed: 0,
      lateral: 0,
      wheelSpeed: 0,
      steerAngle: 0,
      yawRate: 0,
      grounded: true,
      throttle: 0,
      steer: 0,
      handbrake: false,
      braking: false,
      drifting: false,
      stun: 0,
      pad: null,
      topSpeed: 28,
      bump: 0,
    }
    const look = { equipped: null, props: null, skin: '' }
    const view = createCarView(scene, fx, preset, st, {
      remote: true,
      fxRange: FX_RANGE,
      driverRange: DRIVER_RANGE,
      source: { equipped: () => look.equipped, proportions: () => look.props, skin: () => look.skin },
    })
    const plate = label('', 0.8, PLATE)
    scene.add(plate)
    const rocket = createRocketVisual({ view, st, fx, scene })
    return { id, st, look, view, rocket, rocketOn: false, flying: false, plate, car: null, lookKey: '', propsKey: '', plateText: '', emoteN: null, fresh: true, boosted: false, uid: '', name: '' }
  }

  function drop(e) {
    scene.remove(e.view.root, e.plate)
    e.rocket.dispose()
    e.view.driver.dispose()
    e.view.root.traverse((o) => o.geometry?.dispose?.())
    e.plate.material.map?.dispose()
    e.plate.material.dispose()
    entries.delete(e.id)
  }

  // Copies what the server relays about one player into the car-like state the view animates.
  function sync(e, p, dt) {
    const { st } = e
    const f = p.flags | 0
    st.braking = !!(f & POSE_FLAGS.braking)
    st.drifting = !!(f & POSE_FLAGS.drifting)
    st.handbrake = !!(f & POSE_FLAGS.handbrake)
    st.pad = f & POSE_FLAGS.pad ? (st.pad ?? { accent: '#7dff5a' }) : null
    e.boosted = !!(f & POSE_FLAGS.boosted)
    e.rocketNow = !!(f & POSE_FLAGS.rocket)
    e.flying = !!(f & POSE_FLAGS.flying)
    st.stun = f & POSE_FLAGS.stunned ? 1 : 0
    st.steer = p.steer
    st.throttle = p.thr
    st.wheelSpeed = p.speed
    st.speed = st.pad ? 0 : p.speed // a treadmill holds the car still while the wheels spin

    // Position: shown slightly ahead of the last update, eased, so 10 updates a second look smooth.
    const sin = Math.sin(p.yaw)
    const cos = Math.cos(p.yaw)
    const goal = { x: p.x + sin * st.speed * LEAD, y: p.y, z: p.z + cos * st.speed * LEAD }
    const r = st.renderPosition
    if (e.fresh || Math.hypot(goal.x - r.x, goal.z - r.z) > SNAP) {
      r.x = goal.x
      r.y = goal.y
      r.z = goal.z
      st.renderYaw = p.yaw
      e.fresh = false
    } else {
      const k = 1 - Math.exp(-14 * dt)
      r.x += (goal.x - r.x) * k
      r.y += (goal.y - r.y) * k
      r.z += (goal.z - r.z) * k
    }
    const before = st.renderYaw
    st.renderYaw = wrap(before + wrap(p.yaw - before) * (1 - Math.exp(-12 * dt)))
    st.yaw = p.yaw
    st.yawRate = damp(st.yawRate, dt > 0 ? -wrap(st.renderYaw - before) / dt : 0, 12, dt) // + turning right
    st.steerAngle = damp(st.steerAngle, p.steer * 0.55, 10, dt)
    st.lateral = st.drifting ? Math.sign(st.yawRate || 1) * 3 : 0
    st.velocity.x = sin * st.speed
    st.velocity.z = cos * st.speed
    st.position.x = r.x
    st.position.y = r.y
    st.position.z = r.z

    // Car model.
    if (e.car !== p.car) {
      e.car = p.car
      e.view.setCar(game.carDef(p.car))
    }
    // The driver's look: relayed JSON of what Bloxity says they wear.
    const lookKey = `${p.avatar}|${p.skin}`
    if (lookKey !== e.lookKey) {
      e.lookKey = lookKey
      e.look.equipped = parse(p.avatar)
      e.look.skin = p.skin
      e.look.props = parse(p.props)
      e.propsKey = p.props
      e.view.driver.reload()
    } else if (p.props !== e.propsKey) {
      e.propsKey = p.props
      e.look.props = parse(p.props)
      e.view.driver.refit()
    }
    // Gestures (cheer / wave / honk), not replayed for what happened before we first saw them.
    if (e.emoteN === null) e.emoteN = p.emoteN
    else if (p.emoteN !== e.emoteN) {
      e.emoteN = p.emoteN
      const d = e.view.driver
      if (p.emote === 1) d.cheer()
      else if (p.emote === 2) d.wave()
      else if (p.emote === 3) {
        d.honk()
        e.honk = true
      }
    }
    e.uid = p.uid
    e.name = p.username
    const text = `${p.username || 'Player'}\nLevel ${p.level}`
    if (text !== e.plateText) {
      e.plateText = text
      relabel(e.plate, text, 0.8, PLATE)
    }
  }

  const list = []
  return {
    update(dt, camera, elapsed, night) {
      const players = roster()
      // Who is gone.
      for (const e of [...entries.values()]) if (!players?.has(e.id)) drop(e)
      if (!players) return

      // The nearest few, inside the view distance, are shown.
      list.length = 0
      const cx = camera.position.x
      const cz = camera.position.z
      const reach = FOG.far * HIDE_PAST
      players.forEach((p, id) => {
        if (id === players.self) return
        const e = entries.get(id)
        const x = e ? e.st.renderPosition.x : p.x
        const z = e ? e.st.renderPosition.z : p.z
        const d = Math.hypot(x - cx, z - cz)
        if (d < reach) list.push({ id, p, d })
      })
      list.sort((a, b) => a.d - b.d)
      const shown = new Set()
      for (let i = 0; i < Math.min(list.length, maxShown); i++) shown.add(list[i].id)

      for (const e of entries.values()) {
        if (shown.has(e.id)) continue
        e.view.root.visible = e.plate.visible = false
        e.rocket.hideTrails()
        e.rocketOn = false
      }
      for (let i = 0; i < Math.min(list.length, maxShown); i++) {
        const { id, p, d } = list[i]
        let e = entries.get(id)
        if (!e) entries.set(id, (e = make(id)))
        e.view.root.visible = true
        e.view.setNight(night)
        sync(e, p, dt)
        e.view.update(dt, camera, elapsed, e.boosted)
        // Rocket boost / FLY: flames always, smoke + trails thin out with distance, the ignition shockwave carries far.
        const lod = d < ROCKET_FULL ? 1 : d < FX_RANGE ? 0.5 : 0
        if (e.rocketNow && !e.rocketOn && !e.fresh) {
          if (d < ROCKET_SHOCK) e.rocket.ignite(lod)
          if (d < HORN_RANGE) sfx.rocket?.()
        }
        e.rocketOn = e.rocketNow
        e.rocket.update(dt, elapsed, { burning: e.rocketNow, flying: e.flying, groundY: 0, lod })
        const r = e.st.renderPosition
        e.plate.position.set(r.x, r.y + 3.1, r.z)
        e.plate.visible = d < 90
        if (e.honk) {
          e.honk = false
          if (d < HORN_RANGE) sfx.horn()
        }
      }
    },
    // A portal chat message from another player floats over their car.
    chat(m, THREE) {
      if (!m.userId) return
      for (const e of entries.values()) {
        if (e.uid && (e.uid === String(m.userId) || m.userId === `legion_${e.uid}`)) {
          bloxity.attachChatBubble(THREE, e.view.root, m.text)
          return
        }
      }
    },
  }
}
