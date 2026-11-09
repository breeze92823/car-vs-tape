import { BoxGeometry, CylinderGeometry, DoubleSide, Group, Mesh, MeshStandardMaterial, PlaneGeometry } from 'three'
import { HOUSE_COLORS, TRACK } from './config.js'
import { bake } from './bake.js'
import { brickBox, brickMat } from './world.js'
import { house, tree } from './town.js'
import { label, neon, solidBox } from './propkit.js'
import { mulberry32, toTexture } from './textures.js'
import { paintTape } from './bricktex.js'
import { car, onAfterMove, pushCar } from './car.js'
import { fmt, state } from './game.js'

// The tape track north of the gate: a straight walled road with a row of
// tapes, each needing more power. A strong enough car snaps a tape (halves
// whip back to their posts, confetti, wins); a weaker one stretches it like a
// rubber band until it stops, then gets slingshot back. Tapes come back when
// the car returns to the plaza. A finish arch closes the road.

const HALF = TRACK.width / 2
const rand = mulberry32(4242)
const tapeZ = (i) => TRACK.firstTapeZ - i * TRACK.spacing
export const FINISH_Z = tapeZ(TRACK.tapes.length - 1) - 40
const END_Z = FINISH_Z - 30

// Striped post texture (red / white bands).
function postTexture() {
  const c = document.createElement('canvas')
  c.width = 16
  c.height = 128
  const ctx = c.getContext('2d')
  for (let i = 0; i < 8; i++) {
    ctx.fillStyle = i % 2 ? '#ffffff' : '#ff2a2a'
    ctx.fillRect(0, i * 16, 16, 16)
  }
  return toTexture(c, { srgb: true })
}

export function buildTrack(scene, fx, hooks) {
  const dressing = new Group()
  const live = new Group()
  scene.add(live)

  // --- Walls: alternating red/white brick blocks, neon cap strip ---
  const red = brickMat('#ff2a2a', 'fine')
  const white = brickMat('#f4f6ff', 'fine')
  const start = TRACK.startZ
  const len = start - END_Z
  for (const s of [-1, 1]) {
    for (let z = start, k = 0; z > END_Z; z -= 4, k++) add(dressing, brickBox(1, 1.3, 4, 2), k % 2 ? white : red, s * (HALF + 0.5), 0.65, z - 2)
    solidBox(0.5, 3, len / 2, s * (HALF + 0.5), 3, start - len / 2)
    const strip = new Mesh(new BoxGeometry(0.3, 0.12, len), neon('#2ae8ff', 2.6))
    strip.position.set(s * (HALF + 0.5), 1.36, start - len / 2)
    live.add(strip)
  }
  solidBox(HALF + 1, 4, 1, 0, 4, END_Z - 1)
  add(dressing, brickBox(TRACK.width + 2, 3, 2, 2), red, 0, 1.5, END_Z - 1)
  // Centre dashes.
  const dash = new MeshStandardMaterial({ color: '#f4f6ff', roughness: 0.6 })
  for (let z = start - 4; z > END_Z + 4; z -= 9) add(dressing, new BoxGeometry(0.35, 0.03, 3.6), dash, 0, 0.015, z, false)

  // --- Scenery: houses and pines down both sides ---
  for (const s of [-1, 1]) {
    for (let z = start - 10; z > END_Z; ) {
      const w = 14 + Math.floor(rand() * 3) * 3
      const h = 12 + Math.floor(rand() * 3) * 4
      const hg = house(HOUSE_COLORS[Math.floor(rand() * HOUSE_COLORS.length)], w, h, 14)
      hg.position.set(s * (HALF + 26), 0, z - w / 2)
      hg.rotation.y = -s * Math.PI / 2
      dressing.add(hg)
      const t = tree(0.8 + rand() * 0.4)
      t.position.set(s * (HALF + 8 + rand() * 6), 0, z - w - 1)
      dressing.add(t)
      z -= w + 3 + rand() * 6
    }
  }

  // --- Finish arch ---
  const check = (() => {
    const c = document.createElement('canvas')
    c.width = 128
    c.height = 32
    const ctx = c.getContext('2d')
    for (let x = 0; x < 16; x++) for (let y = 0; y < 4; y++) {
      ctx.fillStyle = (x + y) % 2 ? '#ffffff' : '#111111'
      ctx.fillRect(x * 8, y * 8, 8, 8)
    }
    return toTexture(c, { srgb: true })
  })()
  for (const s of [-1, 1]) add(dressing, brickBox(1.6, 10, 1.6, 2), white, s * (HALF + 0.8), 5, FINISH_Z)
  add(live, new BoxGeometry(TRACK.width + 3.2, 1.6, 1.2), new MeshStandardMaterial({ map: check }), 0, 10.5, FINISH_Z)
  add(live, new PlaneGeometry(TRACK.width, 2.4).rotateX(-Math.PI / 2), new MeshStandardMaterial({ map: check }), 0, 0.02, FINISH_Z, false)
  const finishSign = label('FINISH', 3.2, { color: '#ffffff' })
  finishSign.position.set(0, 13.4, FINISH_Z)
  live.add(finishSign)

  // --- Tapes ---
  const postTex = postTexture()
  const postMat = new MeshStandardMaterial({ map: postTex, roughness: 0.5 })
  const postGeo = new CylinderGeometry(0.32, 0.32, 3.4, 14)
  const capGeo = new CylinderGeometry(0.42, 0.42, 0.3, 14)
  const caps = new Map()
  const lines = new Map()
  const capMat = (c) => caps.get(c) ?? caps.set(c, neon(c, 2.8)).get(c)
  const lineMat = (c) => lines.get(c) ?? lines.set(c, neon(c, 2.4)).get(c)
  const tapes = TRACK.tapes.map((def, i) => {
    const z = tapeZ(i)
    const color = TRACK.tapeColors[i % TRACK.tapeColors.length]
    for (const s of [-1, 1]) {
      add(dressing, postGeo, postMat, s * HALF, 1.7, z)
      add(dressing, capGeo, capMat(color), s * HALF, 3.55, z, false)
    }
    const geo = new PlaneGeometry(TRACK.width, 0.85, 48, 1)
    const base = Float32Array.from(geo.attributes.position.array)
    const mat = new MeshStandardMaterial({ map: toTexture(paintTape(color), { srgb: true }), side: DoubleSide, roughness: 0.45, emissive: color, emissiveIntensity: 0.15 })
    const mesh = new Mesh(geo, mat)
    mesh.position.set(0, 1.0, z)
    mesh.castShadow = true
    live.add(mesh)
    // Glowing line on the road under it.
    const line = new Mesh(new BoxGeometry(TRACK.width, 0.04, 0.35), lineMat(color))
    line.position.set(0, 0.03, z + 0.6)
    live.add(line)
    const sign = label(`${fmt(def.power)} Power\n+${def.wins} Wins`, 2.6, { colors: ['#ffffff', '#ffd21a'] })
    sign.position.set(0, 5.6, z)
    live.add(sign)
    return { i, def, z, color, mesh, geo, base, line, state: 'intact', stretch: 0, stretchV: 0, hitX: 0, t: 0, engaged: false, entry: 0, snapStretch: 0 }
  })

  const baked = bake(dressing, false) // one huge mesh: kept out of the shadow pass
  baked.traverse((o) => {
    if (o.isMesh) o.receiveShadow = true
  })
  scene.add(baked)

  // Tape shape: a car-wide flat bulge at hitX, falling off linearly to the posts.
  const weight = (x, hx) => {
    const w = 1.1
    if (Math.abs(x - hx) <= w) return 1
    if (x < hx) return Math.max(0, (x + HALF) / (hx - w + HALF))
    return Math.max(0, (HALF - x) / (HALF - hx - w))
  }
  function deform(tp) {
    const pos = tp.geo.attributes.position
    const a = pos.array
    const b = tp.base
    if (tp.state === 'intact') {
      for (let k = 0; k < pos.count; k++) {
        const x = b[k * 3]
        a[k * 3] = x
        a[k * 3 + 1] = b[k * 3 + 1]
        a[k * 3 + 2] = -tp.stretch * weight(x, tp.hitX)
      }
    } else {
      // Snapped: each half whips back to its post, flutters and droops.
      const e = 1 - Math.pow(1 - Math.min(1, tp.t / 0.35), 3)
      const flutter = Math.max(0, 1 - tp.t / 1.4)
      for (let k = 0; k < pos.count; k++) {
        const x = b[k * 3]
        const left = x < tp.hitX
        const post = left ? -HALF : HALF
        const along = Math.abs(x - post) / Math.abs(tp.hitX - post || 1) // 0 at the post, 1 at the cut
        const keep = 1 - 0.82 * e
        a[k * 3] = post + (x - post) * keep
        a[k * 3 + 1] = b[k * 3 + 1] - along * e * 0.9 + Math.sin(x * 2.2 + tp.t * 26) * 0.25 * flutter * along
        a[k * 3 + 2] = -tp.snapStretch * weight(x, tp.hitX) * (1 - e) + Math.sin(x * 1.7 + tp.t * 22) * 0.35 * flutter * along
      }
    }
    pos.needsUpdate = true
    tp.geo.computeVertexNormals()
  }

  let finished = false
  const current = () => tapes.find((t) => t.state === 'intact')

  function snap(tp) {
    tp.state = 'snapped'
    tp.t = 0
    tp.snapStretch = Math.max(tp.stretch, 0.8)
    tp.hitX = Math.max(-HALF + 2, Math.min(HALF - 2, car.position.x))
    tp.engaged = false
    tp.line.visible = false
    car.velocity.x *= 0.9
    car.velocity.z *= 0.9
    hooks.onSnap(tp.i, tp.hitX, 1, tp.z, tp.color)
  }

  // Runs right after the car moves (fixed tick).
  onAfterMove((dt) => {
    const p = car.position
    // Back in the plaza: tapes return.
    if (p.z > TRACK.startZ + 6) {
      if (finished || tapes.some((t) => t.state !== 'intact')) reset()
      return
    }
    const fz = Math.cos(car.yaw)
    // The northmost point of the car (the nose, or the tail when reversing / turned round).
    const noseZ = p.z - Math.abs(fz) * 2.1
    if (!finished && noseZ < FINISH_Z) {
      finished = true
      hooks.onFinish()
    }
    const tp = current()
    if (!tp) return
    const pen = tp.z - noseZ
    if (pen > 0 && Math.abs(p.x) < HALF) {
      if (state.power >= tp.def.power) {
        snap(tp)
        return
      }
      if (!tp.engaged) {
        tp.engaged = true
        tp.entry = Math.max(0, -car.velocity.z)
        hooks.onStretch(tp.i)
      }
      tp.stretch = pen
      tp.stretchV = 0
      tp.hitX = p.x
      car.velocity.z += TRACK.stretchK * pen * dt * (1 + pen * 0.5)
      if (car.velocity.z >= 0 || pen > 9) {
        // Fully stretched: slingshot back (nose still points at the tape).
        // Always throw the car back south, whichever way it faces.
        pushCar(Math.max(10, tp.entry * 0.85) * (fz > 0 ? 1 : -1), TRACK.stun)
        tp.engaged = false
        tp.stretchV = -tp.stretch * 6
        hooks.onBounce(tp.i, tp.def.power)
      }
    } else if (tp.engaged) {
      tp.engaged = false
    }
  })

  function reset() {
    finished = false
    for (const tp of tapes) {
      tp.state = 'intact'
      tp.stretch = tp.stretchV = 0
      tp.engaged = false
      tp.line.visible = true
      deform(tp)
    }
  }

  return {
    tapes,
    reset,
    current,
    update(dt) {
      for (const tp of tapes) {
        if (tp.state === 'intact') {
          if (!tp.engaged && (Math.abs(tp.stretch) > 0.001 || Math.abs(tp.stretchV) > 0.001)) {
            // Released: a damped wobble back to straight.
            tp.stretchV += (-160 * tp.stretch - 6 * tp.stretchV) * dt
            tp.stretch += tp.stretchV * dt
            if (Math.abs(tp.stretch) < 0.002 && Math.abs(tp.stretchV) < 0.02) tp.stretch = tp.stretchV = 0
            deform(tp)
          } else if (tp.engaged) deform(tp)
        } else if (tp.t < 1.6) {
          tp.t += dt
          deform(tp)
        }
      }
    },
  }
}

function add(parent, geo, mat, x, y, z, shadows = true) {
  const m = new Mesh(geo, mat)
  m.position.set(x, y, z)
  m.castShadow = shadows
  m.receiveShadow = true
  parent.add(m)
  return m
}
