import {
  AdditiveBlending,
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  ExtrudeGeometry,
  Float32BufferAttribute,
  Group,
  LatheGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Path,
  PlaneGeometry,
  RepeatWrapping,
  Shape,
  ShapeGeometry,
  ShaderMaterial,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  TorusGeometry,
  Vector2,
} from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { neon } from './propkit.js'
import { bake } from './bake.js'
import { DRIVER_SEAT } from './config.js'
import { paintSoftDot } from './textures.js'

// Procedural cars. A body is a side profile (u = metres along the car, + =
// front; v = height) with rounded corners and wheel arches cut in, extruded
// across the width and then sculpted: the nose and tail round off in plan, the
// rocker tucks under, the shoulder rolls in and (on the sports cars) the hips
// swell over the wheels. The cabin is a narrower extrusion that leans in
// (tumblehome) with the side windows cut through it, so the seats, dash and
// wheel show through tinted glass. Lamps, grille and plates are fitted to the
// angle of the bodywork they sit on. Local frame: +Z forward, origin on the
// ground midway between the axles.

const TYPES = {
  hatch: {
    width: 1.86, wheelR: 0.36, tyreW: 0.27, rearAxle: -1.25, frontAxle: 1.3, bottom: 0.3, round: 0.24, endK: 0.13, hips: 0,
    body: [[2.0, 0.3], [2.08, 0.44], [2.1, 0.62], [2.05, 0.8], [1.88, 0.94], [0.85, 1.05], [-1.85, 1.09], [-2.03, 0.98], [-2.08, 0.62], [-2.05, 0.36], [-1.98, 0.3]],
    cabin: [[0.92, 1.0], [-0.02, 1.5], [-1.5, 1.53], [-1.93, 1.1], [-1.91, 1.0]],
    cabinW: 0.86,
    head: { v: 0.83, w: 0.44, h: 0.17, x: 0.6, style: 'twin' },
    grille: { v: 0.66, w: 0.78, h: 0.15, style: 'slats' },
    intake: { v: 0.45, w: 1.3, h: 0.13 },
    tail: { v: 0.86, w: 0.32, h: 0.26, x: 0.66, style: 'cluster' },
    exhaust: { v: 0.38, xs: [0.42, 0.58], r: 0.055 },
    plateF: { v: 0.53 },
    plateR: { v: 0.62 },
    spoiler: 'roof', antenna: true, flares: 'black', spokes: 'five', rim: '#d6dae4', seats: 'four',
  },
  coupe: {
    width: 1.92, wheelR: 0.37, tyreW: 0.29, rearAxle: -1.4, frontAxle: 1.35, bottom: 0.27, round: 0.3, endK: 0.15, hips: 0.02,
    body: [[2.2, 0.27], [2.28, 0.42], [2.3, 0.58], [2.22, 0.75], [1.95, 0.91], [0.7, 1.0], [-1.9, 1.03], [-2.2, 0.97], [-2.29, 0.7], [-2.26, 0.4], [-2.18, 0.27]],
    cabin: [[0.78, 0.97], [-0.28, 1.37], [-1.0, 1.39], [-1.92, 1.02]],
    cabinW: 0.84, deck: 6,
    head: { v: 0.78, w: 0.5, h: 0.12, x: 0.64, style: 'slim' },
    grille: { v: 0.57, w: 0.94, h: 0.17, style: 'mesh' },
    intake: { v: 0.38, w: 1.45, h: 0.1 },
    tail: { v: 0.85, w: 0.52, h: 0.12, x: 0.58, style: 'slim' },
    exhaust: { v: 0.36, xs: [-0.56, 0.56], r: 0.07 },
    plateF: { v: 0.44 },
    plateR: { v: 0.58 },
    spoiler: 'lip', flares: 'paint', spokes: 'multi', rim: '#e2e5ec', seats: 'four',
  },
  super: {
    width: 2.0, wheelR: 0.37, tyreW: 0.31, rearAxle: -1.45, frontAxle: 1.4, bottom: 0.2, round: 0.32, endK: 0.2, hips: 0.05,
    body: [[2.3, 0.2], [2.37, 0.36], [2.3, 0.56], [1.9, 0.86], [1.35, 0.97], [0.75, 0.94], [-1.4, 0.99], [-2.15, 0.95], [-2.32, 0.68], [-2.3, 0.3], [-2.22, 0.2]],
    cabin: [[0.8, 0.9], [-0.2, 1.24], [-0.95, 1.25], [-1.9, 0.97]],
    cabinW: 0.8, deck: 6,
    head: { v: 0.66, w: 0.5, h: 0.09, x: 0.64, style: 'led' },
    intake: { v: 0.33, w: 1.6, h: 0.17 },
    tail: { v: 0.84, w: 1.82, h: 0.07, style: 'bar' },
    exhaust: { v: 0.34, xs: [-0.18, 0.18], r: 0.075 },
    plateR: { v: 0.52 },
    spoiler: 'wing', sideIntake: true, flares: 'paint', spokes: 'y', rim: '#2a2d35', caliper: '#ff2a2a', seats: 'two', rearMesh: true,
  },
  hyper: {
    width: 2.06, wheelR: 0.38, tyreW: 0.33, rearAxle: -1.5, frontAxle: 1.45, bottom: 0.18, round: 0.32, endK: 0.22, hips: 0.07,
    body: [[2.4, 0.18], [2.46, 0.32], [2.36, 0.52], [1.95, 0.84], [1.42, 0.98], [0.75, 0.93], [-1.5, 0.99], [-2.25, 0.95], [-2.45, 0.66], [-2.42, 0.3], [-2.32, 0.18]],
    cabin: [[0.75, 0.88], [-0.15, 1.17], [-0.9, 1.19], [-1.85, 0.95]],
    cabinW: 0.76, deck: 6,
    head: { v: 0.6, w: 0.46, h: 0.08, x: 0.68, style: 'led' },
    intake: { v: 0.31, w: 1.7, h: 0.18 },
    tail: { v: 0.83, w: 1.9, h: 0.06, style: 'bar' },
    exhaust: { v: 0.46, xs: [-0.14, 0.14], r: 0.09 },
    plateR: { v: 0.56 },
    spoiler: 'bigwing', sideIntake: true, fins: true, flares: 'paint', spokes: 'turbine', rim: '#18191e', caliper: '#ffd21a', seats: 'two', rearMesh: true,
  },
}

const BEVEL = 0.06
// Level of detail for the car being built: parked (static) cars use fewer segments.
let LO = false
const seg = (hi, lo) => (LO ? lo : hi)
const ARCH_GAP = 0.12 // arch radius over the tyre radius (before the bevel eats into it)

// --- Shared textures + materials --------------------------------------------------
function canvasTex(w, h, draw, repeat = false) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  draw(c.getContext('2d'), w, h)
  const t = new CanvasTexture(c)
  t.colorSpace = SRGBColorSpace
  if (repeat) t.wrapS = t.wrapT = RepeatWrapping
  return t
}
let tex = null
function textures() {
  if (tex) return tex
  tex = {
    // Honeycomb grille mesh.
    mesh: canvasTex(64, 64, (ctx) => {
      ctx.fillStyle = '#2a2d36'
      ctx.fillRect(0, 0, 64, 64)
      ctx.fillStyle = '#07080b'
      for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
        const cx = x * 16 + (y % 2) * 8 + 8
        const cy = y * 16 + 8
        ctx.beginPath()
        for (let k = 0; k < 6; k++) {
          const a = (k / 6) * Math.PI * 2 + Math.PI / 6
          ctx.lineTo(cx + Math.cos(a) * 6.5, cy + Math.sin(a) * 6.5)
        }
        ctx.fill()
      }
    }, true),
    plate: canvasTex(128, 40, (ctx) => {
      ctx.fillStyle = '#f5f6fa'
      ctx.fillRect(0, 0, 128, 40)
      ctx.strokeStyle = '#1a2a6a'
      ctx.lineWidth = 3
      ctx.strokeRect(2, 2, 124, 36)
      ctx.fillStyle = '#1e4fd6'
      ctx.fillRect(4, 4, 14, 32)
      ctx.fillStyle = '#1a2a6a'
      ctx.font = '700 24px Fredoka, Arial, sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('CVT 01', 70, 21)
    }),
    // Tyre sidewall: a lighter ring of lettering-like dashes on rubber.
    flare: new CanvasTexture(paintSoftDot(128)),
    // Carbon fibre: a 2x2 twill of light/dark tows.
    carbon: canvasTex(32, 32, (ctx) => {
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
        const up = (x + y) % 4 < 2
        const g = ctx.createLinearGradient(x * 4, y * 4, x * 4 + (up ? 0 : 4), y * 4 + (up ? 4 : 0))
        g.addColorStop(0, '#16171c')
        g.addColorStop(0.5, up ? '#3a3d48' : '#2a2c34')
        g.addColorStop(1, '#101115')
        ctx.fillStyle = g
        ctx.fillRect(x * 4, y * 4, 4, 4)
      }
    }, true),
  }
  tex.carbon.repeat.set(5, 5)
  return tex
}

// --- Jet afterburner flame -------------------------------------------------------------
// Two additive cones (a hot core inside a coloured plume), bright where the surface faces the
// eye so the edges stay soft, with travelling shock diamonds and a flicker. The group's z scale
// is the flame's length (1 = 1 m); car.js drives it from the throttle via userData.set.
const FLAME_VERT = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vN;
  varying vec3 vV;
  void main() {
    vUv = uv;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vN = normalMatrix * normal;
    vV = -mv.xyz;
    gl_Position = projectionMatrix * mv;
  }`
const FLAME_FRAG = /* glsl */ `
  uniform float uTime;
  uniform float uPower;
  uniform vec3 uHot;
  uniform vec3 uCool;
  uniform float uGain;
  varying vec2 vUv;
  varying vec3 vN;
  varying vec3 vV;
  void main() {
    // pow() of a negative is NaN, which the bloom pass would smear into black blocks: clamp.
    float t = clamp(vUv.y, 0.0, 1.0); // 1 at the nozzle, 0 at the tip
    float face = pow(clamp(abs(dot(normalize(vN), normalize(vV))), 0.0, 1.0), 1.3);
    float shock = 0.72 + 0.28 * sin((1.0 - t) * 26.0 - uTime * 48.0);
    float flick = 0.86 + 0.14 * sin(uTime * 71.0 + vUv.x * 37.7);
    float a = pow(t, 1.5) * face * shock * flick * uPower;
    vec3 col = mix(uCool, uHot, smoothstep(0.55, 1.0, t)) * uGain;
    gl_FragColor = vec4(col, a);
  }`
function makeFlame(r, hot, cool) {
  const shared = { uTime: { value: 0 }, uPower: { value: 0.75 } }
  const g = new Group()
  for (const [rad, len, a, b, gain] of [[r, 1, hot, cool, 1.25], [r * 0.45, 0.5, '#ffffff', hot, 1.5]]) {
    const geo = new CylinderGeometry(rad, rad * 0.12, len, 16, 1, true)
    geo.translate(0, -len / 2, 0)
    geo.rotateX(Math.PI / 2) // nozzle at z = 0, tip toward -z
    const mat = new ShaderMaterial({
      uniforms: { ...shared, uHot: { value: new Color(a) }, uCool: { value: new Color(b) }, uGain: { value: gain } },
      vertexShader: FLAME_VERT,
      fragmentShader: FLAME_FRAG,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      side: DoubleSide,
    })
    mat.userData.noShadow = true
    const m = new Mesh(geo, mat)
    m.renderOrder = 6
    m.frustumCulled = false
    g.add(m)
  }
  g.scale.set(1, 1, 0.9)
  g.userData.keep = true // kept out of the bake
  g.userData.set = (time, power, len, width) => {
    shared.uTime.value = time
    shared.uPower.value = power
    g.scale.set(width, width, len)
  }
  return g
}

const M = {
  glass: new MeshPhysicalMaterial({ color: '#3f97d8', roughness: 0.03, metalness: 0.2, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 1.6 }),
  window: new MeshPhysicalMaterial({ color: '#58b4f0', roughness: 0.03, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.02, transparent: true, opacity: 0.42, side: DoubleSide, depthWrite: false, envMapIntensity: 1.8 }),
  // Windshield + rear glass: clearer than the side windows so the driver reads from the chase camera.
  screen: new MeshPhysicalMaterial({ color: '#86ccf5', roughness: 0.05, metalness: 0, clearcoat: 0.4, clearcoatRoughness: 0.05, transparent: true, opacity: 0.2, depthWrite: false, envMapIntensity: 0.7 }),
  cockpit: new MeshStandardMaterial({ color: '#25272f', roughness: 0.85 }),
  seat: new MeshStandardMaterial({ color: '#191b22', roughness: 0.7 }),
  black: new MeshStandardMaterial({ color: '#111216', roughness: 0.55 }),
  trim: new MeshStandardMaterial({ color: '#1c1e25', roughness: 0.35, metalness: 0.4 }),
  chrome: new MeshStandardMaterial({ color: '#eef1f7', roughness: 0.1, metalness: 1 }),
  tyre: new MeshStandardMaterial({ color: '#16171b', roughness: 0.9 }),
  well: new MeshStandardMaterial({ color: '#0c0d10', roughness: 0.95, side: DoubleSide }),
  disc: new MeshStandardMaterial({ color: '#8d919c', roughness: 0.35, metalness: 0.9 }),
  head: neon('#f4fbff', 4),
  drl: neon('#e6f4ff', 5),
  reverse: neon('#ffffff', 1.1),
  amber: neon('#ffa21a', 2),
  jet: new MeshStandardMaterial({ color: '#3b3f4a', roughness: 0.3, metalness: 0.9 }),
  // Heat-tinted titanium round the nozzle exits.
  titanium: new MeshStandardMaterial({ color: '#8f86c4', roughness: 0.22, metalness: 1 }),
}
let carbonMat = null
// Glass casts no shadow: the cabin stays lit, so the driver is never left in the dark.
M.window.userData.noShadow = true
M.screen.userData.noShadow = true
let gridMat = null
let plateMat = null
let shadowMat = null
let sharedTail = null
const cache = new Map()
const cachedMat = (key, make) => cache.get(key) ?? cache.set(key, make()).get(key)

// --- Profile helpers ------------------------------------------------------------------
const smooth = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

// Follows pts with every interior corner rounded (quadratic) by up to r.
function roundedRun(s, pts, r) {
  for (let i = 1; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i - 1]
    const [bx, by] = pts[i]
    const [cx, cy] = pts[i + 1]
    const l1 = Math.hypot(ax - bx, ay - by)
    const l2 = Math.hypot(cx - bx, cy - by)
    const rr = typeof r === 'function' ? r(i) : r
    const d1 = Math.min(rr, l1 * 0.45)
    const d2 = Math.min(rr, l2 * 0.45)
    s.lineTo(bx + ((ax - bx) / l1) * d1, by + ((ay - by) / l1) * d1)
    s.quadraticCurveTo(bx, by, bx + ((cx - bx) / l2) * d2, by + ((cy - by) / l2) * d2)
  }
  s.lineTo(...pts[pts.length - 1])
}

// Height of the body's top outline at u (straight between the profile points).
function topAt(t, u) {
  const p = t.body
  for (let i = 0; i + 1 < p.length; i++) {
    const [au, av] = p[i]
    const [bu, bv] = p[i + 1]
    if (au >= u && bu <= u && au !== bu) return av + ((u - au) / (bu - au)) * (bv - av)
  }
  return p[0][1]
}

// Body side profile: bottom edge rear -> front with the arches, then the outline front -> rear.
// `cut` = { front, back, floor }: the cockpit, a square notch down to `floor` between u = back
// and u = front (sharp corners); the sides are filled back in by slabs, so it only opens
// the middle of the car between the cabin walls.
function bodyShape(t, cut = null) {
  const s = new Shape()
  const b = t.bottom
  const R = t.wheelR + ARCH_GAP
  const cy = t.wheelR + 0.02
  const rearEnd = t.body[t.body.length - 1]
  s.moveTo(rearEnd[0], b)
  for (const ax of [t.rearAxle, t.frontAxle]) {
    s.lineTo(ax - R, b)
    s.lineTo(ax - R, cy)
    s.absarc(ax, cy, R, Math.PI, 0, true)
    s.lineTo(ax + R, b)
  }
  const run = [[t.frontAxle + R, b], ...t.body]
  const pts = []
  const sharp = new Set()
  for (let i = 0; i < run.length; i++) {
    const p = run[i]
    if (cut && i > 1 && p[0] < cut.front && p[0] > cut.back) continue
    pts.push(p)
    const q = run[i + 1]
    if (cut && i > 1 && q && p[0] >= cut.front && q[0] < cut.front) {
      for (const n of [[cut.front, topAt(t, cut.front)], [cut.front, cut.floor], [cut.back, cut.floor], [cut.back, topAt(t, cut.back)]]) {
        sharp.add(pts.length)
        pts.push(n)
      }
    }
  }
  roundedRun(s, pts, (i) => (sharp.has(i) ? 0.004 : t.round))
  s.closePath()
  return s
}

// Closed polygon with rounded corners; corners on the lowest edge stay sharp (they sit on the body).
function roundedClosed(pts, r, target = new Shape()) {
  const n = pts.length
  const minV = Math.min(...pts.map((p) => p[1]))
  const start = [(pts[0][0] + pts[1][0]) / 2, (pts[0][1] + pts[1][1]) / 2]
  target.moveTo(...start)
  const ring = [start]
  for (let k = 1; k <= n; k++) ring.push(pts[k % n])
  ring.push(start)
  roundedRun(target, ring, (i) => (ring[i][1] <= minV + 0.001 ? 0.02 : r))
  return target
}

function polyShape(points, target = new Shape()) {
  points.forEach(([u, v], i) => (i ? target.lineTo(u, v) : target.moveTo(u, v)))
  target.closePath()
  return target
}

// Clips a polygon to u >= lo (keep = 1) or u <= hi (keep = -1) at the line u = k.
function clipU(poly, k, keep) {
  const out = []
  const inside = (p) => (keep > 0 ? p[0] >= k : p[0] <= k)
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    if (inside(a)) out.push(a)
    if (inside(a) !== inside(b)) {
      const t = (k - a[0]) / (b[0] - a[0])
      out.push([k, a[1] + (b[1] - a[1]) * t])
    }
  }
  return out
}

function shrink(points, ku, kv, liftBottom) {
  let cu = 0
  let cv = 0
  for (const [u, v] of points) {
    cu += u
    cv += v
  }
  cu /= points.length
  cv /= points.length
  const minV = Math.min(...points.map((p) => p[1]))
  return points.map(([u, v]) => [cu + (u - cu) * ku, v === minV ? v + liftBottom : cv + (v - cv) * kv])
}

// Extrudes a (u, v) shape across `width`, centred on x = 0, u -> +Z.
function extrudeAcross(shape, width, bevel) {
  const depth = Math.max(0.01, width - bevel * 2)
  const g = new ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: seg(3, 2), curveSegments: seg(10, 5) })
  g.rotateY(-Math.PI / 2) // shape x (u) -> +Z, extrusion -> -X
  g.translate(depth / 2, 0, 0)
  return g
}

// Plan-view sculpting as a width factor at (height y, length z).
function sculptor(t) {
  const front = Math.max(...t.body.map((p) => p[0]))
  const back = Math.min(...t.body.map((p) => p[0]))
  const belt = Math.min(...t.cabin.map((p) => p[1]))
  const bump = (z, a) => Math.max(0, 1 - ((z - a) / 0.95) ** 2)
  return (y, z) => {
    const ef = smooth(front - 0.9, front + 0.1, z)
    const er = smooth(back + 0.8, back - 0.1, z)
    let f = 1 - t.endK * (ef * ef + er * er * 0.85)
    f *= 1 - 0.075 * (1 - smooth(t.bottom, t.bottom + 0.38, y)) // rocker tuck
    f *= 1 - 0.05 * smooth(belt - 0.28, belt + 0.08, y) // shoulder roll
    if (t.hips) {
      const over = Math.max(bump(z, t.rearAxle), bump(z, t.frontAxle) * 0.6)
      f *= 1 + t.hips * over * smooth(t.bottom + 0.1, 0.55, y) * (1 - smooth(belt - 0.15, belt + 0.05, y))
    }
    return f
  }
}

// Scales x by fn(y, z). Normals go through the warp's inverse transpose (not
// recomputed), so big flat cap triangles shade as the smooth surface they stand for.
function warpX(g, fn) {
  const p = g.attributes.position
  const n = g.attributes.normal
  const e = 0.01
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i)
    const y = p.getY(i)
    const z = p.getZ(i)
    const f = fn(y, z)
    const fy = (fn(y + e, z) - fn(y - e, z)) / (2 * e)
    const fz = (fn(y, z + e) - fn(y, z - e)) / (2 * e)
    p.setX(i, x * f)
    if (n) {
      const nx = n.getX(i)
      const ax = nx / f
      const ay = n.getY(i) - (x * fy * nx) / f
      const az = n.getZ(i) - (x * fz * nx) / f
      const l = Math.hypot(ax, ay, az) || 1
      n.setXYZ(i, ax / l, ay / l, az / l)
    }
  }
  return g
}

// Where the front (or rear) face of the profile crosses height v: { u, ny, nz } (outward normal).
function faceAt(t, v, front) {
  const pts = t.body
  if (front) {
    for (let i = 0; i + 1 < pts.length && pts[i + 1][0] > 0.3; i++) {
      const a = pts[i]
      const b = pts[i + 1]
      if ((v - a[1]) * (v - b[1]) <= 0 && a[1] !== b[1]) {
        const k = (v - a[1]) / (b[1] - a[1])
        const du = b[0] - a[0]
        const dv = b[1] - a[1]
        const l = Math.hypot(du, dv)
        return { u: a[0] + du * k, nz: dv / l, ny: -du / l }
      }
    }
  } else {
    for (let j = pts.length - 1; j > 0 && pts[j - 1][0] < -0.3; j--) {
      const a = pts[j]
      const b = pts[j - 1]
      if ((v - a[1]) * (v - b[1]) <= 0 && a[1] !== b[1]) {
        const k = (v - a[1]) / (b[1] - a[1])
        const du = b[0] - a[0]
        const dv = b[1] - a[1]
        const l = Math.hypot(du, dv)
        return { u: a[0] + du * k, nz: -dv / l, ny: du / l }
      }
    }
  }
  return { u: front ? pts[1][0] : pts[pts.length - 2][0], nz: front ? 1 : -1, ny: 0 }
}

// The line between profile points a -> b moved `lift` out of the cabin skin (upward normal).
function liftedLine(a, b, lift) {
  const du = b[0] - a[0]
  const dv = b[1] - a[1]
  const len = Math.hypot(du, dv)
  let nu = dv / len
  let nv = -du / len
  if (nv < 0) {
    nu = -nu
    nv = -nv
  }
  return { A: [a[0] + nu * lift, a[1] + nv * lift], B: [b[0] + nu * lift, b[1] + nv * lift], d: [du / len, dv / len], n: [nu, nv] }
}
// Indexed geometry from (x, v, u) corners, wound so its front faces look out along n.
function outward(pos, index, n) {
  const p = (i) => [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]]
  const [a, b, c] = [p(index[0]), p(index[1]), p(index[2])]
  const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
  const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]
  const ny = e1[2] * e2[0] - e1[0] * e2[2]
  const nz = e1[0] * e2[1] - e1[1] * e2[0]
  if (ny * n[1] + nz * n[0] < 0) for (let i = 0; i < index.length; i += 3) [index[i + 1], index[i + 2]] = [index[i + 2], index[i + 1]]
  const g = new BufferGeometry()
  g.setAttribute('position', new Float32BufferAttribute(pos, 3))
  g.setIndex(index)
  g.computeVertexNormals()
  return g
}
// Glass quad between profile points a -> b, `hw` half width; lifted off the cabin skin.
function glassQuad(a, b, hw, lift = BEVEL + 0.012) {
  const { A, B, n } = liftedLine(a, b, lift)
  return outward([-hw, A[1], A[0], hw, A[1], A[0], hw, B[1], B[0], -hw, B[1], B[0]], [0, 1, 2, 0, 2, 3], n)
}
// The seal round a glass quad: a ring `border` wide inside the quad's outline.
function glassSeal(a, b, hw, border, lift) {
  const { A, B, d, n } = liftedLine(a, b, lift)
  const ring = (w, e) => [-w, A[1] + d[1] * e, A[0] + d[0] * e, w, A[1] + d[1] * e, A[0] + d[0] * e, w, B[1] - d[1] * e, B[0] - d[0] * e, -w, B[1] - d[1] * e, B[0] - d[0] * e]
  const index = []
  for (let k = 0; k < 4; k++) {
    const m = (k + 1) % 4
    index.push(k, m, 4 + m, k, 4 + m, 4 + k)
  }
  return outward([...ring(hw, 0), ...ring(hw - border, border)], index, n)
}
// Height of the lifted line a -> b at u.
function lineV(a, b, u, lift) {
  const { A, B } = liftedLine(a, b, lift)
  return A[1] + ((u - A[0]) / (B[0] - A[0])) * (B[1] - A[1])
}

function taper(g, y0, y1, k) {
  if (!g.attributes.normal) g.computeVertexNormals()
  return warpX(g, (y) => 1 - k * Math.max(0, Math.min(1, (y - y0) / (y1 - y0))))
}

function box(parent, w, h, d, mat, x, y, z, rounded = 0) {
  const g = rounded > 0 && !LO ? new RoundedBoxGeometry(w, h, d, 2, rounded) : new BoxGeometry(w, h, d)
  const m = new Mesh(g, mat)
  m.position.set(x, y, z)
  m.castShadow = true
  parent.add(m)
  return m
}

// A part fitted to the front/rear face at height v: tilted to the face, `proud` metres out of the skin.
function onFace(parent, t, v, front, geo, mat, x, proud = 0.025, depth = 0.1) {
  const f = faceAt(t, v, front)
  const m = new Mesh(geo, mat)
  const out = BEVEL + proud - depth / 2
  m.position.set(x, v + f.ny * out, f.u + f.nz * out)
  if (front) m.rotation.x = Math.atan2(-f.ny, f.nz)
  else m.rotation.set(Math.atan2(f.ny, -f.nz), Math.PI, 0)
  m.castShadow = true
  parent.add(m)
  return m
}
const rbox = (w, h, d, r) => (LO ? new BoxGeometry(w, h, d) : new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001)))

// --- Wheels -------------------------------------------------------------------------------
function makeWheel(t, side, rimMat, caliperMat, glowMat = null) {
  const r = t.wheelR
  const w = t.tyreW
  const pivot = new Group()
  const spin = new Group()
  pivot.add(spin)
  const prof = [
    new Vector2(r * 0.66, -w / 2),
    new Vector2(r * 0.88, -w / 2 - 0.012),
    new Vector2(r * 0.975, -w / 2 + 0.03),
    new Vector2(r, -w * 0.2),
    new Vector2(r, w * 0.2),
    new Vector2(r * 0.975, w / 2 - 0.03),
    new Vector2(r * 0.88, w / 2 + 0.012),
    new Vector2(r * 0.66, w / 2),
  ]
  const tyreGeo = new LatheGeometry(prof, seg(30, 16))
  tyreGeo.rotateZ(Math.PI / 2)
  const tyre = new Mesh(tyreGeo, M.tyre)
  tyre.castShadow = true
  spin.add(tyre)

  const face = side * w * 0.34
  const rr = r * 0.66
  const barrelGeo = new CylinderGeometry(rr, rr, w * 0.7, seg(24, 12), 1, true)
  barrelGeo.rotateZ(Math.PI / 2)
  spin.add(new Mesh(barrelGeo, M.trim))
  const backGeo = new CylinderGeometry(rr * 0.98, rr * 0.98, 0.02, seg(24, 12))
  backGeo.rotateZ(Math.PI / 2)
  const back = new Mesh(backGeo, M.black)
  back.position.x = -side * w * 0.15
  spin.add(back)
  // Rim lip.
  const lipGeo = new TorusGeometry(rr, 0.022, seg(6, 3), seg(32, 14))
  lipGeo.rotateY(Math.PI / 2)
  const lip = new Mesh(lipGeo, rimMat)
  lip.position.x = face
  spin.add(lip)
  // Performance kit: a neon ring just inside the rim lip.
  if (glowMat) {
    const ringGeo = new TorusGeometry(rr * 0.9, 0.013, 4, seg(36, 16))
    ringGeo.rotateY(Math.PI / 2)
    const ring = new Mesh(ringGeo, glowMat)
    ring.position.x = face - side * 0.004
    spin.add(ring)
  }

  const spoke = (a, len, wide, thick, offset = 0, twist = 0) => {
    const g = new BoxGeometry(thick, len, wide)
    g.translate(0, rr * 0.18 + len / 2, 0)
    const m = new Mesh(g, rimMat)
    m.position.x = face - side * 0.01
    m.rotation.set(-a, twist, 0)
    m.rotation.x = -a + offset
    spin.add(m)
  }
  const len = rr * 0.8
  if (t.spokes === 'five') for (let i = 0; i < 5; i++) spoke((i / 5) * Math.PI * 2, len, 0.11, 0.04)
  else if (t.spokes === 'multi') for (let i = 0; i < 10; i++) spoke((i / 10) * Math.PI * 2, len, 0.045, 0.035)
  else if (t.spokes === 'y') {
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2
      spoke(a, len * 0.55, 0.07, 0.04)
      spoke(a + 0.16, len * 0.62, 0.04, 0.035, 0)
      spoke(a - 0.16, len * 0.62, 0.04, 0.035, 0)
    }
  } else {
    // Turbine: many thin, twisted blades.
    for (let i = 0; i < 14; i++) spoke((i / 14) * Math.PI * 2, len, 0.05, 0.02, 0, side * 0.5)
  }
  const capGeo = new CylinderGeometry(rr * 0.2, rr * 0.24, 0.07, 14)
  capGeo.rotateZ(Math.PI / 2)
  const cap = new Mesh(capGeo, t.spokes === 'turbine' ? M.chrome : rimMat)
  cap.position.x = face
  spin.add(cap)
  if (t.spokes !== 'turbine' && !LO) {
    const nutGeo = new CylinderGeometry(0.014, 0.014, 0.03, 6)
    nutGeo.rotateZ(Math.PI / 2)
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + 0.6
      const n = new Mesh(nutGeo, M.chrome)
      n.position.set(face + side * 0.02, Math.cos(a) * rr * 0.12, Math.sin(a) * rr * 0.12)
      spin.add(n)
    }
  }

  // Disc + caliper do not roll.
  const discGeo = new CylinderGeometry(rr * 0.8, rr * 0.8, 0.03, seg(24, 10))
  discGeo.rotateZ(Math.PI / 2)
  const disc = new Mesh(discGeo, M.disc)
  disc.position.x = -side * 0.03
  pivot.add(disc)
  const cal = new Mesh(rbox(0.08, 0.2, 0.26, 0.03), caliperMat ?? M.trim)
  cal.position.set(side * 0.0, rr * 0.55, -rr * 0.45)
  cal.rotation.x = 0.7
  pivot.add(cal)
  return { pivot, spin }
}

// =============================================================================
// Builds a car. opts.lights: flares + underglow for the driven car; opts.static: bake everything.
export function buildCar(def, opts = {}) {
  LO = !!opts.static
  const t = TYPES[def.type] ?? TYPES.hatch
  const W = t.width
  const half = W / 2
  const root = new Group()
  const body = new Group()
  root.add(body)
  const sculpt = sculptor(t)
  const sideX = (y, z) => half * sculpt(y, z)
  const T = textures()

  const paint = new MeshPhysicalMaterial({ color: def.color, metalness: 0.4, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.05 })
  const rimMat = cachedMat(`rim${t.rim}`, () => new MeshStandardMaterial({ color: t.rim, roughness: 0.28, metalness: 0.85 }))
  const caliperMat = t.caliper ? cachedMat(`cal${t.caliper}`, () => new MeshStandardMaterial({ color: t.caliper, roughness: 0.35, metalness: 0.2 })) : null
  const tailMat = opts.lights ? neon('#ff1a2a', 2.2) : (sharedTail ??= neon('#ff1a2a', 2.2))
  gridMat ??= new MeshStandardMaterial({ map: T.mesh, roughness: 0.6, metalness: 0.3 })
  plateMat ??= new MeshStandardMaterial({ map: T.plate, roughness: 0.5 })
  const flareMat = t.flares === 'black' ? M.black : paint
  // Performance kit (config CARS kit 1..3): carbon aero, neon accents, jets.
  const kit = def.kit ?? 0
  const accent = def.accent ?? def.color
  const [flameHot, flameCool] = def.flame ?? ['#bfeeff', '#ff7a1a']
  const accentMat = kit ? (opts.lights ? neon(accent, 2.8) : cachedMat(`acc${accent}`, () => neon(accent, 2.8))) : null
  carbonMat ??= new MeshPhysicalMaterial({ map: T.carbon, roughness: 0.35, metalness: 0.3, clearcoat: 1, clearcoatRoughness: 0.08 })
  const aero = kit ? carbonMat : M.black // splitter, skirts, diffuser, wing

  // --- Cockpit layout ---
  // The cabin is hollow: two side walls (the pillars and window frames) under one glass
  // canopy (windshield, roof, rear glass), and the body has a cockpit cut into it between
  // the walls, deep enough that a driver DRIVER_SEAT.sitHeight tall (cushion to crown)
  // sits just under the roof line. So the driver shows from the chase camera, through the
  // roof and rear glass. The driver's seat is on the -X side (the car's right).
  const c = t.cabin
  const cw = W * t.cabinW
  const beltY = Math.min(...c.map((p) => p[1]))
  const roofY = Math.max(...c.map((p) => p[1]))
  const lean = (g) => taper(g, beltY, roofY + 0.08, 0.18)
  const leanK = (y) => 1 - 0.18 * Math.max(0, Math.min(1, (y - beltY) / (roofY + 0.08 - beltY)))
  const roofMidU = (c[1][0] + c[2][0]) / 2
  const pillarU = roofMidU - 0.15
  const CB = 0.045 // cabin wall bevel
  const GL = CB + 0.011 // the canopy glass, this far out of the cabin outline (over the wall tops)
  const roofLine = Math.min(c[1][1], c[2][1]) + GL // the underside of the glass roof
  const S = DRIVER_SEAT
  const archR = t.wheelR + ARCH_GAP
  const hipU = c[1][0] - 0.35
  const floor = Math.max(t.bottom + 0.06, roofLine - S.clearance - S.sitHeight - S.cushion - BEVEL)
  const floorTop = floor + BEVEL // the cut's floor once the bevel has grown it
  const hipY = floorTop + S.cushion
  const wheelU = hipU + S.reach
  const cut = {
    front: Math.min(t.frontAxle - archR - 0.12, c[0][0] - 0.12),
    back: Math.max(t.rearAxle + archR + 0.12, hipU - 0.32),
    floor,
  }
  const shellAt = (u) => topAt(t, u) + BEVEL // the body's top surface

  // --- Shell (with the cockpit cut) + side slabs that fill the cut back in outside the cabin ---
  const shell = new Mesh(warpX(extrudeAcross(bodyShape(t, cut), W, BEVEL), sculpt), paint)
  shell.castShadow = true
  shell.receiveShadow = true
  body.add(shell)
  // Slab tops sit 4 mm under the shell's so the bevels that overlap at the seams never flicker.
  const slabT = half - (cw / 2 - 0.13)
  const slabShape = polyShape([[cut.back, cut.floor], [cut.front, cut.floor], [cut.front, topAt(t, cut.front) - 0.004], [cut.back, topAt(t, cut.back) - 0.004]])
  for (const s of [-1, 1]) {
    const g = extrudeAcross(slabShape, slabT, BEVEL)
    g.translate(s * (half - slabT / 2), 0, 0)
    const slab = new Mesh(warpX(g, sculpt), paint)
    slab.castShadow = true
    body.add(slab)
  }

  // --- Cabin: side walls with the windows cut through (front and rear panes, split at the B-pillar) + roof ---
  const win = shrink(c, 0.84, 0.66, 0.08)
  const panes = t.seats === 'two' ? [win] : [clipU(win, pillarU + 0.07, 1), clipU(win, pillarU - 0.07, -1)]
  const outline = roundedClosed(c, 0.16)
  for (const p of panes) outline.holes.push(polyShape(p, new Path()))
  for (const s of [-1, 1]) {
    const g = extrudeAcross(outline, 0.1, CB)
    g.translate(s * (cw / 2 - 0.05), 0, 0)
    const wall = new Mesh(lean(g), paint)
    wall.castShadow = true
    body.add(wall)
  }
  for (const s of [-1, 1]) {
    for (const p of panes) {
      const g = new ShapeGeometry(polyShape(p))
      g.rotateY(-Math.PI / 2)
      g.translate(s * (cw / 2 - 0.035), 0, 0)
      body.add(new Mesh(lean(g), M.window))
    }
  }
  // Glass canopy between the walls: windshield, roof and rear glass, each with a slim black seal.
  const hw = cw / 2 - 0.04
  for (const [a, b] of [[c[0], c[1]], [c[1], c[2]], [c[c.length - 1], c[2]]]) {
    body.add(new Mesh(lean(glassSeal(a, b, hw + 0.03, 0.045, GL - 0.004)), M.black))
    body.add(new Mesh(lean(glassQuad(a, b, hw, GL)), M.screen))
  }

  // --- Interior ---
  const tubW = 2 * (half - slabT) * 0.94 // between the slabs (the sculpt pulls them in a little)
  const seatX = (cw / 2 - 0.12) * 0.5
  // Floor and rear bulkhead.
  box(body, tubW, 0.02, cut.front - cut.back, M.cockpit, 0, floorTop + 0.01, (cut.front + cut.back) / 2)
  const bulkTop = shellAt(cut.back) - 0.006
  box(body, tubW, bulkTop - floorTop, 0.05, M.cockpit, 0, (bulkTop + floorTop) / 2, cut.back + BEVEL + 0.02)
  // Rear deck behind the seats (the body top under the rear glass), back until it would meet the glass.
  const rg = (u) => lineV(c[c.length - 1], c[2], u, GL)
  const deckFront = cut.back + BEVEL + 0.045
  let deckBack = deckFront - 0.04
  const deckTop = (u) => Math.max(shellAt(u), shellAt(deckFront)) + 0.012
  while (deckBack > c[c.length - 1][0] && rg(deckBack - 0.02) > deckTop(deckBack - 0.02) + 0.03) deckBack -= 0.02
  const deckY = deckTop(deckBack)
  box(body, 2 * ((cw / 2 - 0.1) * leanK(deckY) - 0.01), 0.06, deckFront - deckBack, M.cockpit, 0, deckY - 0.03, (deckFront + deckBack) / 2)
  // Dash: from just ahead of the wheel down to the floor and on into the cut's front wall; its
  // top stays a little over the wheel so the driver shows through the windshield. Where it
  // stands above the body it runs forward until it would meet the glass.
  const ws = (u) => lineV(c[0], c[1], u, GL)
  const dashBack = wheelU + 0.12
  const dashTop = Math.min(hipY + S.wheelHeight + S.wheelR + 0.1, ws(dashBack) - 0.05, shellAt(cut.front) + 0.05)
  let dashFront = cut.front + 0.04
  while (dashTop > shellAt(dashFront) && dashFront < c[0][0] && ws(dashFront + 0.02) > dashTop + 0.03) dashFront += 0.02
  box(body, tubW, dashTop - floorTop, dashFront - dashBack, M.cockpit, 0, (dashTop + floorTop) / 2, (dashFront + dashBack) / 2, 0.03)
  // Glow strip in the car's colour along the dash (car.js brightens it at night) + the gauge screen.
  const dashMat = opts.lights ? neon(def.color, 1.6) : cachedMat(`dash${def.color}`, () => neon(def.color, 1.6))
  box(body, tubW * 0.9, 0.014, 0.02, dashMat, 0, dashTop + 0.002, dashBack + 0.012)
  box(body, 0.17, 0.08, 0.012, cachedMat('gauge', () => neon('#8fe9ff', 1.3)), -seatX, dashTop - 0.07, dashBack - 0.004)
  // Centre console.
  const conTop = hipY + 0.06
  box(body, 0.16, conTop - floorTop, dashBack - hipU, M.trim, 0, (conTop + floorTop) / 2, (dashBack + hipU) / 2, 0.02)
  // Bucket seats: the backs stop under the driver's shoulders so the head shows from behind.
  for (const s of [-1, 1]) {
    const x = s * seatX
    box(body, 0.4, S.cushion, 0.44, M.seat, x, floorTop + S.cushion / 2, hipU + 0.08, 0.03)
    const back = new Group()
    back.position.set(x, hipY, hipU - 0.13)
    back.rotation.x = -0.16
    body.add(back)
    box(back, 0.42, S.back, 0.1, M.seat, 0, S.back / 2, 0, 0.04)
    box(back, 0.09, S.back * 0.8, 0.012, paint, 0, S.back * 0.5, 0.052) // stripe in the car's colour
    for (const k of [-1, 1]) box(back, 0.07, S.back * 0.75, 0.14, M.seat, k * 0.2, S.back * 0.4, 0.04, 0.03) // bolsters
  }
  // Steering wheel: its own pivot (tilted toward the driver) and spin (turned by car.js).
  const steering = { pivot: new Group(), spin: new Group() }
  steering.pivot.position.set(-seatX, hipY + S.wheelHeight, wheelU)
  steering.pivot.rotation.x = -0.35
  steering.pivot.add(steering.spin)
  body.add(steering.pivot)
  steering.spin.add(new Mesh(new TorusGeometry(S.wheelR, 0.02, seg(8, 4), seg(24, 12)), M.seat))
  const hubGeo = new CylinderGeometry(0.04, 0.04, 0.04, 14)
  hubGeo.rotateX(Math.PI / 2)
  steering.spin.add(new Mesh(hubGeo, M.trim))
  for (const a of [0, Math.PI, -Math.PI / 2]) {
    const g = new BoxGeometry(S.wheelR - 0.03, 0.022, 0.014)
    g.translate((S.wheelR - 0.03) / 2 + 0.02, 0, 0)
    const sp = new Mesh(g, M.trim)
    sp.rotation.z = a
    steering.spin.add(sp)
  }
  box(steering.spin, 0.03, 0.024, 0.028, paint, 0, S.wheelR, 0) // top mark: shows the wheel turning
  const colGeo = new CylinderGeometry(0.022, 0.026, 0.34, 10)
  colGeo.rotateX(Math.PI / 2)
  colGeo.translate(0, 0, 0.19)
  steering.pivot.add(new Mesh(colGeo, M.trim))
  // Where the driver goes (driver.js), in the body's frame.
  const seat = {
    x: -seatX,
    hipY,
    hipU,
    floorY: floorTop,
    roofY: roofLine, // the glass roof's underside: the head stays DRIVER_SEAT.clearance under it
    headroom: roofLine - hipY,
    shellY: shellAt(hipU), // the body's top beside the driver: below it they are hidden from the side
    backU: hipU - 0.08, // front face of the seat back at the cushion
    wheel: { x: -seatX, y: hipY + S.wheelHeight, u: wheelU, r: S.wheelR, tilt: -0.35 },
  }

  // --- Front: lamps, grille, intake, plate, badge ---
  const h = t.head
  const headPos = []
  for (const s of [-1, 1]) {
    const f = faceAt(t, h.v, true)
    const x = s * Math.min(h.x, sideX(h.v, f.u) - h.w / 2 - 0.04)
    onFace(body, t, h.v, true, rbox(h.w + 0.05, h.h + 0.05, 0.1, 0.03), M.trim, x, 0.012)
    if (h.style === 'twin') {
      onFace(body, t, h.v, true, rbox(h.w - 0.02, h.h - 0.02, 0.1, 0.02), M.chrome, x, 0.018)
      for (const k of [-1, 1]) {
        const lens = new CylinderGeometry(h.h * 0.36, h.h * 0.36, 0.1, 14)
        lens.rotateX(Math.PI / 2)
        onFace(body, t, h.v, true, lens, M.head, x + k * h.w * 0.24, 0.03)
      }
    } else if (h.style === 'slim') {
      onFace(body, t, h.v, true, rbox(h.w - 0.03, h.h - 0.03, 0.1, 0.02), M.head, x, 0.022)
      onFace(body, t, h.v - h.h * 0.62, true, rbox(h.w * 0.9, 0.022, 0.1, 0.008), M.drl, x, 0.02)
    } else {
      onFace(body, t, h.v, true, rbox(h.w - 0.02, h.h - 0.025, 0.1, 0.015), M.head, x, 0.022)
      // LED arrow DRL above.
      const drl = onFace(body, t, h.v + h.h * 0.75, true, rbox(h.w * 0.75, 0.02, 0.1, 0.008), M.drl, x - s * h.w * 0.1, 0.02)
      drl.rotation.z = s * 0.12
    }
    onFace(body, t, h.v - (h.style === 'twin' ? h.h * 0.85 : -h.h * 0.1), true, rbox(0.09, 0.04, 0.1, 0.01), M.amber, s * (Math.abs(x) + h.w / 2 - 0.05), 0.03)
    const fp = faceAt(t, h.v, true)
    headPos.push([x, h.v, fp.u + BEVEL + 0.15])
  }
  if (kit) {
    // Light bar joining the headlamps across the nose.
    const inner = Math.abs(headPos[0][0]) - h.w / 2 - 0.04
    onFace(body, t, h.v + h.h * 0.2, true, rbox(inner * 2, 0.024, 0.1, 0.01), accentMat, 0, 0.022)
    // Hood vents on the bonnet slope.
    const [a, b] = [t.body[3], t.body[4]]
    if (a[0] > b[0] + 0.2) {
      const u = (a[0] + b[0]) / 2
      const tilt = Math.atan2(b[1] - a[1], a[0] - b[0])
      const y = lineV(a, b, u, BEVEL)
      for (const s of [-1, 1]) {
        for (const [w, mat, dy] of [[0.3, aero, 0.006], [0.24, gridMat, 0.016]]) {
          const v = box(body, w, 0.02, (a[0] - b[0]) * (w === 0.3 ? 0.62 : 0.52), mat, s * 0.36, y + dy, u, 0.008)
          v.rotation.x = tilt
        }
        const edge = box(body, 0.24, 0.012, 0.012, accentMat, s * 0.36, lineV(a, b, u + (a[0] - b[0]) * 0.26, BEVEL) + 0.02, u + (a[0] - b[0]) * 0.26)
        edge.rotation.x = tilt
      }
    }
  }
  if (t.grille) {
    const g = t.grille
    onFace(body, t, g.v, true, rbox(g.w + 0.06, g.h + 0.06, 0.1, 0.035), M.trim, 0, 0.012)
    onFace(body, t, g.v, true, rbox(g.w, g.h, 0.1, 0.03), g.style === 'mesh' ? gridMat : M.black, 0, 0.018)
    if (g.style === 'slats') for (let i = 0; i < 3; i++) onFace(body, t, g.v - g.h / 2 + ((i + 1) * g.h) / 4, true, new BoxGeometry(g.w * 0.92, 0.014, 0.1), M.chrome, 0, 0.026)
    const badge = new CylinderGeometry(0.05, 0.05, 0.1, 16)
    badge.rotateX(Math.PI / 2)
    onFace(body, t, g.v, true, badge, M.chrome, 0, 0.035)
  }
  if (t.intake) {
    const g = t.intake
    onFace(body, t, g.v, true, rbox(g.w, g.h, 0.1, 0.04), gridMat, 0, 0.01)
    onFace(body, t, g.v - g.h * 0.62, true, rbox(g.w * 1.04, 0.025, 0.14, 0.01), M.trim, 0, 0.05) // splitter
  }
  if (t.plateF) onFace(body, t, t.plateF.v, true, new BoxGeometry(0.5, 0.12, 0.1), plateMat, 0, 0.022)
  onFace(body, t, t.plateR.v, false, new BoxGeometry(0.52, 0.13, 0.1), plateMat, 0, 0.022)

  // --- Rear: tail lamps, reverse lamps, rear mesh, exhausts, diffuser ---
  const tl = t.tail
  const tailPos = []
  if (tl.style === 'bar') {
    const f = faceAt(t, tl.v, false)
    const bw = Math.min(tl.w, sideX(tl.v, f.u) * 2 - 0.12)
    onFace(body, t, tl.v, false, rbox(bw + 0.04, tl.h + 0.05, 0.1, 0.02), M.trim, 0, 0.012)
    onFace(body, t, tl.v, false, rbox(bw, tl.h, 0.1, 0.02), tailMat, 0, 0.022)
    for (const s of [-1, 1]) {
      onFace(body, t, tl.v - 0.06, false, rbox(0.3, tl.h * 2.2, 0.1, 0.02), tailMat, s * (bw / 2 - 0.16), 0.02)
      tailPos.push([s * (bw / 2 - 0.16), tl.v, f.u - BEVEL - 0.12])
    }
    if (t.rearMesh && !kit) onFace(body, t, tl.v - 0.2, false, rbox(bw * 0.62, 0.2, 0.1, 0.03), gridMat, 0, 0.012)
  } else {
    for (const s of [-1, 1]) {
      const f = faceAt(t, tl.v, false)
      const x = s * Math.min(tl.x, sideX(tl.v, f.u) - tl.w / 2 - 0.03)
      onFace(body, t, tl.v, false, rbox(tl.w + 0.05, tl.h + 0.05, 0.1, 0.03), M.trim, x, 0.012)
      onFace(body, t, tl.v, false, rbox(tl.w, tl.h, 0.1, 0.025), tailMat, x, 0.022)
      if (tl.style === 'cluster') {
        onFace(body, t, tl.v - tl.h * 0.22, false, rbox(tl.w * 0.42, tl.h * 0.32, 0.1, 0.01), M.reverse, x - s * tl.w * 0.2, 0.03)
        onFace(body, t, tl.v + tl.h * 0.28, false, rbox(tl.w * 0.9, 0.03, 0.1, 0.01), M.amber, x, 0.03)
      } else onFace(body, t, tl.v, false, rbox(tl.w * 0.3, tl.h * 0.5, 0.1, 0.01), M.reverse, x - s * tl.w * 0.3, 0.03)
      tailPos.push([x, tl.v, f.u - BEVEL - 0.12])
    }
    if (tl.style === 'slim') onFace(body, t, tl.v, false, new BoxGeometry(Math.abs(tailPos[0][0]) * 2 - tl.w, 0.02, 0.1), tailMat, 0, 0.018)
  }
  const exhaustTips = []
  const jets = [] // { x, y, z (nozzle exit), r, flame }
  if (kit) {
    // Twin jet nozzles set into a carbon panel in the tail, in place of the exhausts.
    const r = [0, 0.15, 0.175, 0.2][kit]
    const jy = Math.max(t.exhaust.v, t.bottom + r + 0.14)
    const fj = faceAt(t, jy, false)
    const jx = Math.min(0.52, sideX(jy, fj.u) - r - 0.2)
    onFace(body, t, jy, false, rbox(2 * (jx + r) + 0.16, 2 * r + 0.14, 0.1, 0.07), aero, 0, 0.012)
    const L = 0.6
    const exitZ = fj.u - BEVEL - 0.22
    const shellGeo = new CylinderGeometry(r * 1.1, r, L, seg(28, 14), 1, true)
    shellGeo.rotateX(Math.PI / 2) // wide end forward (inside the body), nozzle to the rear
    const wallGeo = new CylinderGeometry(r * 0.8, r * 0.8, 0.3, seg(20, 10), 1, true)
    wallGeo.rotateX(Math.PI / 2)
    const lipGeo = new TorusGeometry(r * 0.9, r * 0.11, seg(8, 4), seg(28, 14))
    const heatGeo = new TorusGeometry(r * 0.79, 0.012, 4, seg(28, 14))
    const bandGeo = new TorusGeometry(r * 1.04, 0.018, 4, seg(28, 14))
    const coreGeo = new CylinderGeometry(r * 0.8, r * 0.8, 0.01, seg(20, 10))
    coreGeo.rotateX(Math.PI / 2)
    const spinGeo = new ConeGeometry(r * 0.26, 0.14, 14)
    spinGeo.rotateX(-Math.PI / 2) // point to the rear
    const bladeGeo = new BoxGeometry(0.018, r * 0.56, 0.05)
    bladeGeo.translate(0, r * 0.22 + r * 0.28, 0)
    const coreMat = opts.lights ? neon(flameHot, 3.2) : cachedMat(`core${flameHot}`, () => neon(flameHot, 3.2))
    const heatMat = cachedMat(`heat${flameCool}`, () => neon(flameCool, 2.4))
    for (const s of [-1, 1]) {
      const x = s * jx
      const at = (geo, mat, z) => {
        const m = new Mesh(geo, mat)
        m.position.set(x, jy, z)
        body.add(m)
        return m
      }
      at(shellGeo, M.jet, exitZ + L / 2).castShadow = true
      at(wallGeo, M.well, exitZ + 0.15)
      at(lipGeo, M.titanium, exitZ)
      at(heatGeo, heatMat, exitZ - 0.004)
      at(bandGeo, paint, exitZ + 0.16)
      if (kit >= 2) at(bandGeo, accentMat, exitZ + 0.26)
      at(coreGeo, coreMat, exitZ + 0.28)
      at(spinGeo, M.chrome, exitZ + 0.18)
      // Turbine blades in front of the glowing core, so it shows through the gaps.
      for (let i = 0; i < seg(11, 7); i++) {
        const b = at(bladeGeo, M.trim, exitZ + 0.22)
        b.rotation.order = 'ZYX'
        b.rotation.set(0, 0.55, (i / seg(11, 7)) * Math.PI * 2)
      }
      let flame = null
      if (!opts.static) {
        flame = makeFlame(r * 0.82, flameHot, flameCool)
        flame.position.set(x, jy, exitZ - 0.01)
        body.add(flame)
      }
      jets.push({ x, y: jy, z: exitZ, r, flame })
      exhaustTips.push({ x, y: jy, z: exitZ - 0.08 })
    }
  } else {
    const ex = t.exhaust
    const fe = faceAt(t, ex.v, false)
    const pipe = new CylinderGeometry(ex.r, ex.r * 0.92, 0.26, 18, 1, true)
    pipe.rotateX(Math.PI / 2)
    const pipeIn = new CylinderGeometry(ex.r * 0.78, ex.r * 0.78, 0.02, 14)
    pipeIn.rotateX(Math.PI / 2)
    for (const x of ex.xs) {
      const z = fe.u - BEVEL - 0.02
      const p = new Mesh(pipe, M.chrome)
      p.position.set(x, ex.v, z)
      body.add(p)
      const d = new Mesh(pipeIn, M.black)
      d.position.set(x, ex.v, z - 0.1)
      body.add(d)
      exhaustTips.push({ x, y: ex.v, z: z - 0.16 })
    }
  }
  const rearU = t.body[t.body.length - 2][0]
  box(body, W * 0.78, 0.08, 0.34, aero, 0, t.bottom + 0.05, rearU + 0.1)
  if (t.fins) for (let i = -2; i <= 2; i++) box(body, 0.025, 0.2, 0.4, M.trim, i * 0.22, t.bottom + 0.12, rearU + 0.1)
  // Front lip under the nose.
  const frontU = t.body[1][0]
  box(body, W * 0.8 * (1 - t.endK * 0.6), 0.04, 0.3, kit ? aero : M.trim, 0, t.bottom + 0.02, frontU - 0.12)
  if (kit) {
    // Splitter edge light + canards on the front corners.
    box(body, W * 0.8 * (1 - t.endK * 0.6) * 0.96, 0.014, 0.014, accentMat, 0, t.bottom + 0.035, frontU + 0.03)
    for (const s of [-1, 1]) {
      const v = 0.42
      const f = faceAt(t, v, true)
      const can = box(body, 0.22, 0.025, 0.2, aero, s * (sideX(v, f.u - 0.15) - 0.02), v, f.u - 0.08, 0.008)
      can.rotation.set(0, s * 0.35, s * 0.18)
    }
  }

  // --- Sides: arch flares, skirts, seams, handles, mirrors, intakes ---
  const R = t.wheelR + ARCH_GAP - BEVEL
  const cy = t.wheelR + 0.02
  const archGeo = new TorusGeometry(R + 0.02, 0.045, seg(6, 3), seg(22, 10), Math.PI)
  archGeo.rotateY(Math.PI / 2)
  for (const ax of [t.rearAxle, t.frontAxle]) {
    // Dark wheel-well liner (upper half cylinder across the car).
    const wellW = 2 * sideX(cy + R * 0.6, ax) - 0.03
    const well = new CylinderGeometry(R - 0.005, R - 0.005, wellW, seg(18, 8), 1, true, 0, Math.PI)
    well.rotateZ(Math.PI / 2)
    const wm = new Mesh(well, M.well)
    wm.position.set(0, cy, ax)
    body.add(wm)
    for (const s of [-1, 1]) {
      const a = new Mesh(archGeo, flareMat)
      a.position.set(s * (sideX(cy + R * 0.7, ax) + 0.015), cy, ax)
      a.castShadow = true
      body.add(a)
    }
  }
  const skirtA = t.rearAxle + t.wheelR + ARCH_GAP
  const skirtB = t.frontAxle - t.wheelR - ARCH_GAP
  const skirtY = t.bottom + 0.07
  const doorFront = c[0][0] - 0.02
  const doorBack = t.seats === 'two' ? c[c.length - 1][0] + 0.45 : pillarU - 0.85
  for (const s of [-1, 1]) {
    const mid = (skirtA + skirtB) / 2
    box(body, 0.06, 0.1, skirtB - skirtA, aero, s * (sideX(skirtY, mid) + 0.025), skirtY, mid, 0.02)
    if (kit) box(body, 0.016, 0.022, (skirtB - skirtA) * 0.9, accentMat, s * (sideX(skirtY, mid) + 0.058), skirtY + 0.018, mid)
    // Door seams + handle, laid on the side surface.
    for (const z of [doorFront, doorBack]) box(body, 0.012, beltY - t.bottom - 0.3, 0.014, M.trim, s * (sideX(0.7, z) + BEVEL * 0.8), (beltY + t.bottom) / 2 + 0.04, z)
    box(body, 0.016, beltY - 0.06 - (t.bottom + 0.18), 0.014, M.trim, s * (sideX(0.7, (doorFront + doorBack) / 2) + BEVEL * 0.8), (beltY + t.bottom) / 2 + 0.04, t.seats === 'two' ? doorBack - 0.01 : pillarU + 0.02)
    box(body, 0.03, 0.035, 0.17, M.chrome, s * (sideX(beltY - 0.15, doorBack + 0.3) + BEVEL), beltY - 0.15, (t.seats === 'two' ? doorBack : pillarU) + 0.25, 0.012)
    // Mirror: stalk + body-coloured housing + glass.
    const mz = c[0][0] - 0.2
    box(body, 0.18, 0.03, 0.06, M.trim, s * (cw / 2 + 0.06), beltY + 0.06, mz)
    box(body, 0.11, 0.14, 0.2, paint, s * (cw / 2 + 0.19), beltY + 0.11, mz - 0.02, 0.045)
    box(body, 0.09, 0.11, 0.01, M.glass, s * (cw / 2 + 0.19), beltY + 0.11, mz - 0.125)
    if (t.sideIntake) {
      const z = t.rearAxle + t.wheelR + ARCH_GAP + 0.38
      const si = box(body, 0.1, 0.28, 0.62, gridMat, s * (sideX(0.55, z) + 0.01), t.bottom + 0.4, z, 0.04)
      si.rotation.y = s * 0.14
    }
  }

  // --- Spoilers, wings, roof bits ---
  if (t.spoiler === 'roof') {
    const top = c[2]
    const sp = box(body, cw * 0.78, 0.06, 0.32, paint, 0, top[1] + 0.02, top[0] - 0.12, 0.025)
    sp.rotation.x = -0.2
    box(body, 0.16, 0.03, 0.04, neon('#ff1a2a', 2), 0, top[1] + 0.06, top[0] - 0.28) // third brake light
  } else if (t.spoiler === 'lip') {
    const d = t.body[t.deck]
    box(body, W * 0.74, 0.05, 0.22, paint, 0, d[1] + BEVEL + 0.02, d[0] - 0.14, 0.02)
  } else if (t.spoiler === 'wing' || t.spoiler === 'bigwing') {
    const big = t.spoiler === 'bigwing'
    const deck = t.body[t.deck]
    const rearTop = t.body[t.deck + 1]
    const wz = rearTop[0] + 0.32
    const deckY = deck[1] + (rearTop[1] - deck[1]) * 0.8 + BEVEL
    const wy = deckY + (big ? 0.34 : 0.28) + (kit ? 0.06 : 0)
    const span = W * (big ? 0.9 : 0.82)
    const chord = big ? 0.36 : 0.3
    const wing = box(body, span, 0.05, chord, big || kit ? aero : paint, 0, wy, wz, 0.02)
    wing.rotation.x = -0.12
    if (kit) {
      // Gurney flap in the body colour + a neon trailing edge.
      box(wing, span * 0.98, 0.07, 0.025, paint, 0, 0.05, -chord / 2 + 0.012)
      box(wing, span * 0.94, 0.016, 0.016, accentMat, 0, 0.09, -chord / 2 + 0.012)
    }
    for (const s of [-1, 1]) {
      // Swan-neck struts stand inboard of the jets on kit cars.
      box(body, 0.05, wy - deckY + 0.04, 0.12, M.black, s * W * (kit ? 0.16 : 0.27), (wy + deckY) / 2, wz + 0.04)
      if (big || kit) box(body, 0.03, 0.22, chord + 0.08, paint, s * span * 0.5, wy + 0.03, wz, 0.01)
      if (kit >= 2) box(body, 0.012, 0.012, chord + 0.04, accentMat, s * (span * 0.5 + 0.016), wy + 0.13, wz)
    }
  }
  if (t.fins) {
    box(body, 0.3, 0.12, 0.42, gridMat, 0, c[2][1] + 0.1, c[2][0] - 0.12, 0.05) // roof scoop, behind the driver's head
    box(body, 0.03, 0.17, 0.9, paint, 0, c[2][1] - 0.02, c[2][0] - 0.55, 0.01)
    if (kit >= 3) box(body, 0.036, 0.016, 0.86, accentMat, 0, c[2][1] + 0.07, c[2][0] - 0.55)
  }
  if (t.antenna) {
    const ant = box(body, 0.012, 0.32, 0.012, M.black, 0, c[2][1] + 0.18, c[2][0] - 0.05)
    ant.rotation.x = -0.4
  }

  // --- Contact shadow ---
  shadowMat ??= new MeshBasicMaterial({ map: T.flare, color: '#000000', transparent: true, opacity: 0.55, depthWrite: false })
  shadowMat.userData.noShadow = true
  const shadowGeo = new PlaneGeometry(W * 1.35, (frontU - rearU) * 1.15)
  shadowGeo.rotateX(-Math.PI / 2)
  const shadow = new Mesh(shadowGeo, shadowMat)
  shadow.position.y = 0.015
  shadow.renderOrder = 1
  root.add(shadow)

  // --- Wheels ---
  const wheels = []
  const wx = half - t.tyreW / 2 + 0.03
  for (const [z, front] of [[t.frontAxle, true], [t.rearAxle, false]]) {
    for (const s of [-1, 1]) {
      const wh = makeWheel(t, s, rimMat, caliperMat, kit >= 2 ? accentMat : null)
      wh.pivot.position.set(s * wx, t.wheelR, z)
      root.add(wh.pivot)
      wheels.push({ ...wh, front, side: s })
    }
  }

  // --- Flares (driven car) ---
  const flares = []
  if (opts.lights) {
    for (const [x, y, z] of headPos) {
      const f = new Sprite(new SpriteMaterial({ map: T.flare, color: '#dff1ff', blending: AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.9 }))
      f.scale.set(1.3, 1.3, 1)
      f.position.set(x, y, z)
      f.renderOrder = 7
      body.add(f)
      flares.push(f)
    }
    flares.tail = tailPos.map(([x, y, z]) => {
      const f = new Sprite(new SpriteMaterial({ map: T.flare, color: '#ff2233', blending: AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.6 }))
      f.scale.set(0.9, 0.9, 1)
      f.position.set(x, y, z)
      f.renderOrder = 7
      body.add(f)
      return f
    })
  }
  let under = null
  const glowColor = def.glow ?? (kit ? accent : def.color)
  if (!opts.static) {
    under = new Mesh(new PlaneGeometry(W * 1.9, 5.6), new MeshBasicMaterial({ map: T.flare, color: glowColor, blending: AdditiveBlending, transparent: true, depthWrite: false, opacity: opts.lights ? 0.55 : 0.35, toneMapped: false }))
    under.rotation.x = -Math.PI / 2
    under.position.y = 0.04
    under.renderOrder = 3
  }

  // Merge into one mesh per material: a static car bakes whole; a driven one
  // keeps its body (sprites aside) and each wheel's rolling part apart.
  const noShadow = (g) => g.traverse((o) => o.isMesh && o.material.userData?.noShadow && (o.castShadow = false))
  if (opts.static) {
    const merged = bake(root, true)
    root.clear()
    for (const m of [...merged.children]) root.add(m)
    root.traverse((o) => o.isMesh && (o.receiveShadow = true))
  } else {
    const keep = body.children.filter((o) => o.isSprite || o.userData.keep) // flares, jet flames
    for (const o of keep) body.remove(o)
    body.remove(steering.pivot) // turns: kept out of the bake
    const merged = bake(body, true)
    body.clear()
    for (const m of [...merged.children]) body.add(m)
    for (const o of keep) body.add(o)
    body.add(steering.pivot)
    for (const w of wheels) {
      const mw = bake(w.spin, true)
      w.spin.clear()
      for (const m of [...mw.children]) w.spin.add(m)
    }
    root.add(under)
  }
  noShadow(root)
  root.userData.seat = seat
  root.userData.kind = def.type

  return {
    root,
    body,
    wheels,
    tailMat,
    flares,
    under,
    exhaustTips,
    jets,
    kit,
    accent,
    accentMat,
    glowColor,
    flameColor: flameCool,
    trailPoints: tailPos,
    paint,
    dashMat,
    steering: opts.static ? null : steering,
    seat,
    dims: { width: W, front: frontU, back: rearU, wheelR: t.wheelR, height: roofY },
  }
}

export const carTypes = TYPES
