import './rocket.css'
import { Euler, Quaternion, Vector3 } from 'three'
import { CAR, FLIGHT, ROCKET, TRACK } from './config.js'
import { car } from './car.js'
import { RAPIER, onTick, world } from './physics.js'
import { inputState } from './input.js'
import { makeFlame } from './carmodel.js'
import { makeTrail } from './trail.js'
import { setFovKick, shakeCamera } from './carcam.js'
import { sfx } from './audio.js'

// Rocket boost + FLY.
//
// BOOST (config ROCKET; Shift, the BOOST dial or the touch BOOST button): a charged burst past
// the car's top speed. Two red light trails stream from the tail lamps and a thick white smoke
// trail pours out of the back; the Tesla Roadster's hidden rear thrusters (carmodel `thrusters`)
// light blue-white, jet cars' afterburners roar out, other cars get rocket flames at their exhausts.
//
// FLY (config FLIGHT; Space held, the FLY dial or the touch FLY button, on cars with `thrusters`):
// four hover thrusters under the floor fire blue-white plumes at the road, the car climbs to
// `height` m and holds there while the fuel lasts, a white smoke cloud billows over the ground
// below, the red trails stream behind. Space is no handbrake on such a car (input.js spaceFly).
//
// Physics runs on the tick after the car's own step (push / lift via car.velocity); visuals run
// after carView.update each frame (they override car.js's flame sizes). The dials (bottom right,
// with an MPH speedometer) and the touch buttons share their rings through CSS vars.
const MPH = 2.23694
const rnd = (k = 1) => (Math.random() - 0.5) * 2 * k

export function createRocket({ carView, fx, scene }) {
  let charge = 1 // boost, 0..1
  let burn = 0 // seconds of boost push left
  let fuel = 1 // FLY tank, 0..1
  let flyHeld = false // key / touch
  let flying = false
  let canFly = false
  let groundY = 0
  let wasHeld = false
  let partsSeen = null
  const ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 })
  const visual = createRocketVisual({ view: carView, st: car, fx, scene }) // the flames / trails / smoke (shared with the other players' cars)

  // --- HUD: BOOST + FLY dials and the speedometer (mouse / keyboard; touch uses the cluster) ---
  const hud = document.createElement('div')
  hud.className = 'rk-hud'
  hud.innerHTML = `
    <div class="rk-slot"><button type="button" class="rk-dial rk-charge" data-act="boost" aria-label="Boost"><svg viewBox="0 0 24 24"><path d="M6 6l6 6-6 6M12 6l6 6-6 6"/></svg></button>
      <div class="rk-cap"><b>SHIFT</b>BOOST</div></div>
    <div class="rk-slot rk-flyslot"><button type="button" class="rk-dial rk-fuel" data-act="fly" aria-label="Fly"><svg viewBox="0 0 24 24"><path d="M3 10h18M7 14h10M12 10v8M9 18h6"/></svg></button>
      <div class="rk-cap"><b>${FLIGHT.label}</b>FLY</div></div>
    <div class="rk-speedo"><svg viewBox="0 0 100 100"><circle class="rk-track" cx="50" cy="50" r="44"/><circle class="rk-arc" cx="50" cy="50" r="44"/></svg>
      <span class="rk-num">0</span><span class="rk-unit">MPH</span><span class="rk-gear"><i>R</i><i>N</i><i>D</i></span></div>`
  document.body.appendChild(hud)
  const flySlot = hud.querySelector('.rk-flyslot')
  const num = hud.querySelector('.rk-num')
  const arc = hud.querySelector('.rk-arc')
  const gears = hud.querySelectorAll('.rk-gear i')
  const stop = (e) => {
    e.preventDefault()
    e.stopPropagation()
  }
  hud.querySelector('[data-act=boost]').addEventListener('pointerdown', (e) => {
    stop(e)
    fire()
  })
  const flyBtn = hud.querySelector('[data-act=fly]')
  flyBtn.addEventListener('pointerdown', (e) => {
    stop(e)
    flyBtn.setPointerCapture?.(e.pointerId)
    setFly(true)
  })
  for (const ev of ['pointerup', 'pointercancel']) flyBtn.addEventListener(ev, () => setFly(false))
  // The FLY key is held, so it is read here (input.js only knows one-shot keys).
  window.addEventListener('keydown', (e) => {
    if (e.code === FLIGHT.key && !e.repeat && !(e.target instanceof HTMLInputElement) && canFly) setFly(true)
  })
  window.addEventListener('keyup', (e) => e.code === FLIGHT.key && setFly(false))
  window.addEventListener('blur', () => setFly(false))

  function setFly(on) {
    flyHeld = on && canFly
  }

  let shown = ''
  function paintHud() {
    const b = Math.round((burn > 0 ? burn / ROCKET.duration : charge) * 100) / 100
    const f = Math.round(fuel * 100) / 100
    const key = `${b}|${f}|${burn > 0}|${flying}|${canFly}`
    if (key === shown) return
    shown = key
    for (const el of document.querySelectorAll('.rk-charge')) {
      el.style.setProperty('--rk', b)
      el.classList.toggle('ready', charge >= 1 && burn <= 0)
      el.classList.toggle('burning', burn > 0)
    }
    for (const el of document.querySelectorAll('.rk-fuel')) {
      el.style.setProperty('--rk', f)
      el.classList.toggle('ready', fuel > 0.2 && !flying)
      el.classList.toggle('burning', flying)
    }
    flySlot.hidden = !canFly
    document.body.classList.toggle('rk-canfly', canFly)
  }
  let shownSpeed = -1
  let shownGear = -1
  function paintSpeedo() {
    const mph = Math.round(Math.abs(car.speed) * MPH)
    if (mph !== shownSpeed) {
      shownSpeed = mph
      num.textContent = mph
      const k = Math.min(1, Math.abs(car.speed) / (car.topSpeed * ROCKET.over))
      arc.style.strokeDasharray = `${(207.4 * k).toFixed(1)} 276.5` // a 270-degree gauge (rocket.css)
    }
    const g = car.speed < -0.5 ? 0 : Math.abs(car.speed) < 0.5 && Math.abs(car.throttle) < 0.05 ? 1 : 2
    if (g !== shownGear) {
      shownGear = g
      gears.forEach((el, i) => el.classList.toggle('on', i === g))
    }
  }

  function fire() {
    if (charge < 1 || burn > 0 || car.frozen || car.pad || car.stun > 0) {
      if (charge < 1 && !car.frozen) {
        for (const el of document.querySelectorAll('.rk-charge')) el.classList.add('nope')
        setTimeout(() => document.querySelectorAll('.rk-charge').forEach((el) => el.classList.remove('nope')), 300)
      }
      return false
    }
    charge = 0
    burn = ROCKET.duration
    const fxv = Math.sin(car.yaw)
    const fzv = Math.cos(car.yaw)
    car.velocity.x += fxv * ROCKET.kick
    car.velocity.z += fzv * ROCKET.kick
    sfx.rocket?.()
    shakeCamera(0.55)
    visual.ignite(1) // ignition: a white shockwave and smoke burst behind the car
    return true
  }

  // Ground height under the car: fixed colliders only (never the car's own capsule or other movers).
  const solidGround = (c) => {
    const b = c.parent()
    return !b || b.isFixed()
  }
  function ground() {
    ray.origin.x = car.position.x
    ray.origin.y = car.position.y - 0.02
    ray.origin.z = car.position.z
    const hit = world.castRay(ray, 40, true, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, undefined, undefined, undefined, solidGround)
    return hit ? ray.origin.y - hit.timeOfImpact : car.position.y - 40
  }

  // --- Physics: boost push / over-speed bleed, flight lift ---
  onTick((dt) => {
    const fxv = Math.sin(car.yaw)
    const fzv = Math.cos(car.yaw)
    const v = car.velocity
    const sp = v.x * fxv + v.z * fzv
    if (burn > 0) {
      burn = Math.max(0, burn - dt)
      const max = car.topSpeed * ROCKET.over
      if (!car.pad && car.stun <= 0 && sp < max) {
        const add = Math.min(ROCKET.push * dt, max - sp)
        v.x += fxv * add
        v.z += fzv * add
      }
    } else {
      charge = Math.min(1, charge + dt / ROCKET.recharge)
      if (sp > car.topSpeed) {
        const cut = Math.min(sp - car.topSpeed, ROCKET.bleed * dt)
        v.x -= fxv * cut
        v.z -= fzv * cut
      }
    }
    if (car.stun > 0) burn = 0 // a tape slingshot puts it out

    // FLY: no flying on the tape track or a treadmill, or with the window open.
    const allowed = canFly && !car.frozen && !car.pad && car.stun <= 0 && car.position.z >= TRACK.startZ
    const wasFlying = flying
    flying = allowed && flyHeld && fuel > 0
    if (flying || car.position.y - groundY > 0.3) groundY = ground()
    if (flying) {
      fuel = Math.max(0, fuel - dt / FLIGHT.fuel)
      const h = car.position.y - groundY
      const want = Math.max(-4, Math.min(FLIGHT.climb, (FLIGHT.height - h) * 2.4))
      // car.js adds gravity at the start of its next step: pre-compensate so the car gets `want`.
      v.y += (want - v.y) * Math.min(1, dt * 7)
      v.y -= CAR.gravity * dt
      if (!wasFlying) v.y = Math.max(v.y, 3.5) // break free of the ground snap
    } else {
      if (!flyHeld) fuel = Math.min(1, fuel + dt / FLIGHT.recharge)
      if (v.y < -FLIGHT.maxFall) v.y = -FLIGHT.maxFall
    }
  })

  return {
    fire,
    setFly,
    get burning() {
      return burn > 0
    },
    get flying() {
      return flying
    },
    // After carView.update each frame.
    update(dt, elapsed) {
      const held = inputState.sprint
      if (held && !wasHeld) fire()
      wasHeld = held

      const parts = carView.parts
      if (!parts) return
      if (parts !== partsSeen) {
        partsSeen = parts
        canFly = (parts.thrusters?.down.length ?? 0) > 0
        inputState.spaceFly = canFly && FLIGHT.key === 'Space'
        if (!canFly) flyHeld = false
      }
      paintHud()
      paintSpeedo()
      visual.update(dt, elapsed, { burning: burn > 0, flying, groundY, lod: 1 })
      setFovKick(visual.heat * ROCKET.fov)
    },
  }
}

// The rocket look of one car view (flames, red trails, smoke, hover plumes, ignition shockwave).
// The local car and every other player's car share it: `st` = the car-like state it follows
// (renderPosition / renderYaw / velocity). `update` runs after view.update (it overrides the flame sizes).
// `lod` keeps other players cheap: 1 = everything, 0.5 = fewer smoke puffs, 0 = flames only (no
// particles, trails fade out). Trail meshes are only built the first time they are needed.
export function createRocketVisual({ view, st, fx, scene }) {
  let heat = 0 // eased boost visual 0..1
  let lift = 0 // eased flight visual 0..1
  let partsSeen = null
  let extra = [] // rocket flames at the exhaust tips of cars with neither jets nor thrusters
  let smokeT = 0
  let groundT = 0
  let was = false
  let trails = null
  let bank = 0 // eased roll into the turn while flying / boosting
  let pitchUp = 0
  let lastYaw = null
  let tilted = false // the wheels are carrying the bank / pitch (restore them once it is gone)
  const tiltE = new Euler()
  const tiltQ = new Quaternion()
  const steerQ = new Quaternion()
  const UP = new Vector3(0, 1, 0)
  const tmp = new Vector3()

  // Per tail lamp: an upright ribbon + a flat one, so the trail reads as a thick glowing tube from any angle.
  const ensureTrails = () => (trails ??= scene ? [0, 1, 2, 3].map(() => makeTrail(scene, { gain: 2 })) : [])

  return {
    get heat() {
      return heat
    },
    get lift() {
      return lift
    },
    // The ignition burst: a white shockwave behind the car and a cyan ring round it (smoke + sparks only up close).
    ignite(lod = 1) {
      const parts = view.parts
      const yaw = st.renderYaw
      const fxv = Math.sin(yaw)
      const fzv = Math.cos(yaw)
      const p = st.renderPosition
      const back = (parts?.dims.back ?? -2.3) - 0.4
      const bx = p.x + fxv * back
      const bz = p.z + fzv * back
      fx.ring(bx, p.y + 0.5, bz, '#ffffff', 5, 0.5, false)
      fx.ring(p.x, p.y + 0.1, p.z, '#9fe6ff', 8, 0.6, true)
      if (lod <= 0) return
      for (let i = 0; i < 14 * lod; i++) fx.smoke({ x: bx + rnd(0.5), y: p.y + 0.5, z: bz + rnd(0.5), vx: -fxv * 4 + rnd(3), vy: rnd(1) + 1, vz: -fzv * 4 + rnd(3), life: 2, size: 1, sizeEnd: 4, color: '#f4f6fa', alpha: 0.5, drag: 2 })
      fx.sparks(bx, p.y + 0.5, bz, Math.round(40 * lod), ['#ffffff', '#9fe6ff', '#ff2a3a'], 10, 0.6, 0.4, -6)
    },
    // Frees the world-space trail meshes (a car that is no longer shown must not leave one hanging).
    hideTrails() {
      if (!trails) return
      for (const tr of trails) {
        scene.remove(tr.mesh)
        tr.mesh.geometry.dispose()
        tr.mesh.material.dispose()
      }
      trails = null
    },
    dispose() {
      for (const f of extra) f.parent?.remove(f)
      extra = []
      this.hideTrails()
    },
    update(dt, elapsed, { burning, flying, groundY, lod = 1 }) {
      const parts = view.parts
      if (!parts) return
      if (parts !== partsSeen) {
        partsSeen = parts
        const th = parts.thrusters ?? { rear: [], down: [] }
        // Cars with neither jets nor thrusters: rocket flames at the exhaust tips, hidden until a boost.
        extra = parts.jets.length || th.rear.length
          ? []
          : parts.exhaustTips.map((tip) => {
              const f = makeFlame(0.19, '#ffffff', '#5fd0ff')
              f.position.set(tip.x, tip.y, tip.z + 0.08)
              f.visible = false
              parts.body.add(f)
              return f
            })
        if (trails) for (const tr of trails) tr.clear()
      }
      heat += ((burning ? 1 : 0) - heat) * Math.min(1, dt * (burning ? 10 : 2.5))
      lift += ((flying ? 1 : 0) - lift) * Math.min(1, dt * (flying ? 8 : 3))
      // Turn rate from the rendered heading (works for remote cars too, which have no yawRate).
      const yawNow = st.renderYaw
      const turn = lastYaw === null || dt <= 0 ? 0 : Math.atan2(Math.sin(yawNow - lastYaw), Math.cos(yawNow - lastYaw)) / dt
      lastYaw = yawNow
      const active = heat > 0.01 || lift > 0.01 || Math.abs(bank) > 0.005
      if (!active && !was) return // nothing burning and everything already switched off
      was = active

      // Bank into the turn like a plane while flying (hard, up to ~45 degrees), a little while
      // boosting on the road; nose up while climbing. On top of car.js's suspension pose.
      const bankK = Math.max(lift, heat * 0.35)
      const bankTarget = Math.max(-0.8, Math.min(0.8, -turn * 0.38)) * bankK
      bank += (bankTarget - bank) * Math.min(1, dt * 5)
      const vy = st.velocity?.y ?? 0
      pitchUp += (Math.max(-0.12, Math.min(0.22, vy * 0.05)) * lift - pitchUp) * Math.min(1, dt * 4)
      parts.body.rotation.z += bank
      parts.body.rotation.x -= pitchUp
      parts.body.position.y += Math.abs(bank) * 0.25 // roll about the middle, not the floor
      // The wheels hang off the car root, not the body: give them the same bank / pitch about the
      // body's origin so they stay in their arches (steering kept, spin untouched). One more pass
      // after the tilt is gone puts them back exactly.
      const tilt = Math.abs(bank) > 0.004 || Math.abs(pitchUp) > 0.004
      if (tilt || tilted) {
        tiltE.set(tilt ? -pitchUp : 0, 0, tilt ? bank : 0)
        tiltQ.setFromEuler(tiltE)
        const rise = tilt ? Math.abs(bank) * 0.25 : 0
        for (const w of parts.wheels) {
          w.base ??= w.pivot.position.clone()
          w.pivot.position.copy(w.base).applyQuaternion(tiltQ)
          w.pivot.position.y += rise
          steerQ.setFromAxisAngle(UP, w.front ? -(st.steerAngle ?? 0) : 0)
          w.pivot.quaternion.copy(tiltQ).multiply(steerQ)
        }
        tilted = tilt
      }

      const th = parts.thrusters ?? { rear: [], down: [] }
      const flick = 0.88 + Math.random() * 0.24
      parts.body.updateWorldMatrix(true, false)

      // Boost flames.
      if (heat > 0.01) {
        for (const j of parts.jets) j.flame?.userData.set(elapsed, 1.1 + heat * 0.7, (1.6 + heat * 3.2) * flick, 1 + heat * 0.45)
        parts.under.material.opacity = Math.max(parts.under.material.opacity, 0.5 + heat * 0.5)
      }
      const rearK = Math.max(heat, lift * 0.55) // the rear thrusters push the car along in flight too
      for (const n of th.rear) {
        if (!n.flame) continue
        n.flame.visible = rearK > 0.02
        if (n.flame.visible) n.flame.userData.set(elapsed, 0.8 + rearK, (0.4 + rearK * 2.2) * flick, 0.9 + rearK * 0.4)
      }
      for (const f of extra) {
        f.visible = heat > 0.02
        if (f.visible) f.userData.set(elapsed, 0.6 + heat * 0.9, (0.8 + heat * 2.4) * flick, 0.9 + heat * 0.5)
      }
      // Hover thrusters: plumes at the road, longer the higher the car rides.
      const p = st.renderPosition
      const h = Math.max(0, p.y - groundY)
      for (const n of th.down) {
        if (!n.flame) continue
        n.flame.visible = lift > 0.02
        if (n.flame.visible) n.flame.userData.set(elapsed, 0.7 + lift * 0.8, (0.5 + lift * Math.min(2.6, h + 0.6)) * flick, 1.1 + lift * 0.5)
      }

      // Red light trails from the tail lamps while boosting or flying (not built for far cars).
      const yaw = st.renderYaw
      const trailOn = lod > 0 && (heat > 0.3 || lift > 0.3)
      if (trailOn || trails) {
        const rx = Math.cos(yaw)
        const rz = -Math.sin(yaw)
        const tr = ensureTrails()
        for (let i = 0; i < tr.length; i++) {
          const tp = parts.trailPoints?.[i % 2]
          if (!tp) continue
          parts.body.localToWorld(tmp.set(tp[0] * 0.98, tp[1], tp[2] + 0.04))
          tr[i].update(tmp.x, tmp.y, tmp.z, rx, rz, elapsed, trailOn, { width: 0.13, life: 2, spacing: 0.5, vertical: i < 2 })
        }
      }
      if (lod <= 0) return

      // White smoke trail out of the back while boosting.
      const v = st.velocity
      const fxv = Math.sin(yaw)
      const fzv = Math.cos(yaw)
      smokeT -= dt
      // Smoke while boosting, and out of the rear thrusters while flying at speed.
      const cruise = th.rear.length ? lift * Math.min(1, Math.max(0, (Math.hypot(v.x, v.z) - 6) / 10)) : 0
      const smokeK = Math.max(heat, cruise * 0.75)
      if (smokeK > 0.05 && smokeT <= 0) {
        smokeT = 0.02 / lod
        const nozzles = parts.jets.length ? parts.jets : th.rear.length ? th.rear : parts.exhaustTips.length ? parts.exhaustTips : [{ x: 0, y: 0.4, z: parts.dims.back }]
        for (const n of nozzles) {
          parts.body.localToWorld(tmp.set(n.x, n.y, n.z - 0.7 - Math.random() * 0.9))
          for (let k = 0; k < (nozzles.length > 1 ? 1 : 2); k++) fx.smoke({ x: tmp.x + rnd(0.15), y: tmp.y, z: tmp.z + rnd(0.15), vx: v.x * 0.15 - fxv * 2 + rnd(0.8), vy: 0.3 + Math.random() * 0.5, vz: v.z * 0.15 - fzv * 2 + rnd(0.8), life: 2.4, size: 0.9, sizeEnd: 4.6, color: '#f4f6fa', alpha: 0.55 * smokeK, drag: 2 })
          if (Math.random() < 0.5 * lod) fx.glow({ x: tmp.x, y: tmp.y, z: tmp.z, vx: v.x * 0.5 - fxv * 10 + rnd(1.5), vy: rnd(0.8), vz: v.z * 0.5 - fzv * 10 + rnd(1.5), life: 0.25, size: 0.3 * heat, sizeEnd: 0.05, color: Math.random() < 0.5 ? '#ffffff' : parts.jets.length ? parts.flameColor : '#9fe6ff', drag: 3 })
        }
      }

      // Hover: blue-white sparks off each plume and a white smoke cloud billowing over the ground.
      groundT -= dt
      if (lift > 0.05 && groundT <= 0) {
        groundT = 0.03 / lod
        for (const n of th.down) {
          parts.body.localToWorld(tmp.set(n.x, n.y - 0.15, n.z))
          if (Math.random() < 0.6 * lod) fx.glow({ x: tmp.x, y: tmp.y, z: tmp.z, vx: v.x * 0.6 + rnd(0.8), vy: -8 - Math.random() * 4, vz: v.z * 0.6 + rnd(0.8), life: 0.2, size: 0.45 * lift, sizeEnd: 0.05, color: Math.random() < 0.5 ? '#ffffff' : '#7fd8ff', drag: 2 })
        }
        const k = lift * Math.max(0.25, 1 - h / 9) // thinner the higher it flies
        for (let i = 0; i < 3; i++) {
          const a = Math.random() * Math.PI * 2
          const r = Math.random() * 1.2
          const out = 3 + Math.random() * 4
          fx.smoke({ x: p.x + Math.cos(a) * r, y: groundY + 0.25, z: p.z + Math.sin(a) * r, vx: Math.cos(a) * out + v.x * 0.2, vy: 0.4 + Math.random() * 0.8, vz: Math.sin(a) * out + v.z * 0.2, life: 1.8, size: 1.2, sizeEnd: 5, color: '#f2f4f8', alpha: 0.48 * k, drag: 1.6 })
        }
      }
    },
  }
}
