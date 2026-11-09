import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  NormalBlending,
  Object3D,
  PlaneGeometry,
  Points,
  RingGeometry,
  ShaderMaterial,
} from 'three'
import { paintSoftDot, paintSparkle } from './textures.js'

// All particle effects, pooled and allocation-free per frame:
//  - `glow`  additive point sprites (sparkles, flames, sparks, motes): HDR-bright
//            so they bloom on High/Ultra
//  - `smoke` normally blended soft puffs (exhaust, tyre smoke, dust)
//  - confetti: an InstancedMesh of tumbling paper bits
//  - rings: expanding additive shockwaves
// `quality` (graphics preset .particles, 0..1) thins out every spawn.

const VERT = /* glsl */ `
  attribute float aSize;
  attribute float aAlpha;
  attribute vec3 aColor;
  varying float vAlpha;
  varying vec3 vColor;
  uniform float uScale;
  void main() {
    vAlpha = aAlpha;
    vColor = aColor;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * uScale / max(0.1, -mv.z);
    gl_Position = projectionMatrix * mv;
  }`
const FRAG = /* glsl */ `
  uniform sampler2D uMap;
  uniform float uBoost;
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    vec4 t = texture2D(uMap, gl_PointCoord);
    gl_FragColor = vec4(vColor * uBoost, t.a * vAlpha);
    if (gl_FragColor.a < 0.004) discard;
  }`

function makePool(count, map, additive) {
  const geo = new BufferGeometry()
  const pos = new Float32Array(count * 3)
  const col = new Float32Array(count * 3)
  const alpha = new Float32Array(count)
  const size = new Float32Array(count)
  const attr = (a, n) => new BufferAttribute(a, n).setUsage(DynamicDrawUsage)
  geo.setAttribute('position', attr(pos, 3))
  geo.setAttribute('aColor', attr(col, 3))
  geo.setAttribute('aAlpha', attr(alpha, 1))
  geo.setAttribute('aSize', attr(size, 1))
  const tex = new CanvasTexture(map)
  const mat = new ShaderMaterial({
    uniforms: { uMap: { value: tex }, uScale: { value: 400 }, uBoost: { value: 1 } },
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    blending: additive ? AdditiveBlending : NormalBlending,
  })
  const points = new Points(geo, mat)
  points.frustumCulled = false
  points.renderOrder = additive ? 5 : 4
  return {
    points,
    count,
    next: 0,
    live: 0,
    pos,
    col,
    alpha,
    size,
    vel: new Float32Array(count * 3),
    life: new Float32Array(count),
    maxLife: new Float32Array(count),
    s0: new Float32Array(count),
    s1: new Float32Array(count),
    a0: new Float32Array(count),
    drag: new Float32Array(count),
    grav: new Float32Array(count),
  }
}

const tmpColor = new Color()

export function createFx(scene, quality = 1) {
  const glow = makePool(2400, paintSparkle(64), true)
  const smoke = makePool(1400, paintSoftDot(64), false)
  scene.add(glow.points, smoke.points)
  let q = quality
  let boost = 1

  // --- Confetti --------------------------------------------------------------
  const CONF = 500
  const confetti = new InstancedMesh(new PlaneGeometry(0.34, 0.2), new MeshBasicMaterial({ side: DoubleSide, toneMapped: false }), CONF)
  confetti.instanceMatrix.setUsage(DynamicDrawUsage)
  confetti.frustumCulled = false
  const cPos = new Float32Array(CONF * 3)
  const cVel = new Float32Array(CONF * 3)
  const cRot = new Float32Array(CONF * 3)
  const cSpin = new Float32Array(CONF * 3)
  const cLife = new Float32Array(CONF)
  let cNext = 0
  const zero = new Matrix4().makeScale(0, 0, 0)
  for (let i = 0; i < CONF; i++) {
    confetti.setMatrixAt(i, zero)
    confetti.setColorAt(i, tmpColor.set('#ffffff'))
  }
  scene.add(confetti)
  const dummy = new Object3D()

  // --- Shockwave rings -------------------------------------------------------
  const ringGeo = new RingGeometry(0.82, 1, 64)
  const rings = []
  for (let i = 0; i < 10; i++) {
    const m = new Mesh(ringGeo, new MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false, side: DoubleSide, toneMapped: false }))
    m.visible = false
    m.renderOrder = 6
    scene.add(m)
    rings.push({ mesh: m, t: 0, dur: 1, size: 1, flat: true, base: new Color() })
  }
  let ringNext = 0

  // --- Spawning ---------------------------------------------------------------
  // o: { x, y, z, vx, vy, vz, life, size, sizeEnd, color, alpha, drag, gravity }
  function emit(pool, o) {
    const i = pool.next
    pool.next = (pool.next + 1) % pool.count
    const i3 = i * 3
    pool.pos[i3] = o.x
    pool.pos[i3 + 1] = o.y
    pool.pos[i3 + 2] = o.z
    pool.vel[i3] = o.vx ?? 0
    pool.vel[i3 + 1] = o.vy ?? 0
    pool.vel[i3 + 2] = o.vz ?? 0
    pool.life[i] = pool.maxLife[i] = o.life ?? 1
    pool.s0[i] = o.size ?? 1
    pool.s1[i] = o.sizeEnd ?? o.size ?? 1
    pool.a0[i] = o.alpha ?? 1
    pool.drag[i] = o.drag ?? 0
    pool.grav[i] = o.gravity ?? 0
    tmpColor.set(o.color ?? '#ffffff')
    pool.col[i3] = tmpColor.r
    pool.col[i3 + 1] = tmpColor.g
    pool.col[i3 + 2] = tmpColor.b
  }
  const keep = () => Math.random() < q

  function updatePool(pool, dt) {
    let live = 0
    for (let i = 0; i < pool.count; i++) {
      if (pool.life[i] <= 0) {
        pool.alpha[i] = 0
        continue
      }
      live++
      pool.life[i] -= dt
      const i3 = i * 3
      const d = Math.exp(-pool.drag[i] * dt)
      pool.vel[i3] *= d
      pool.vel[i3 + 1] = pool.vel[i3 + 1] * d + pool.grav[i] * dt
      pool.vel[i3 + 2] *= d
      pool.pos[i3] += pool.vel[i3] * dt
      pool.pos[i3 + 1] += pool.vel[i3 + 1] * dt
      pool.pos[i3 + 2] += pool.vel[i3 + 2] * dt
      const t = 1 - Math.max(0, pool.life[i]) / pool.maxLife[i] // 0 -> 1 over the life
      pool.size[i] = pool.s0[i] + (pool.s1[i] - pool.s0[i]) * t
      // Quick fade in, long fade out.
      pool.alpha[i] = pool.a0[i] * Math.min(1, t * 8) * (1 - t * t)
    }
    pool.live = live
    const g = pool.points.geometry
    g.attributes.position.needsUpdate = true
    g.attributes.aAlpha.needsUpdate = true
    g.attributes.aSize.needsUpdate = true
    g.attributes.aColor.needsUpdate = true
  }

  const api = {
    setQuality(v) {
      q = v
    },
    // Additive particles are pushed above the bloom threshold when bloom is on.
    setBloom(on) {
      boost = on ? 2.6 : 1.15
      glow.points.material.uniforms.uBoost.value = boost
    },
    glow: (o) => keep() && emit(glow, o),
    smoke: (o) => keep() && emit(smoke, o),

    // A burst of n additive sparks flying out of a point.
    sparks(x, y, z, n, color, speed = 8, life = 0.8, size = 0.5, gravity = -12) {
      for (let k = 0; k < n; k++) {
        if (!keep()) continue
        const a = Math.random() * Math.PI * 2
        const e = (Math.random() - 0.2) * Math.PI * 0.6
        const s = speed * (0.4 + Math.random() * 0.6)
        emit(glow, {
          x, y, z,
          vx: Math.cos(a) * Math.cos(e) * s,
          vy: Math.sin(e) * s + speed * 0.3,
          vz: Math.sin(a) * Math.cos(e) * s,
          life: life * (0.6 + Math.random() * 0.6),
          size: size * (0.6 + Math.random() * 0.8),
          sizeEnd: 0.05,
          color: Array.isArray(color) ? color[k % color.length] : color,
          drag: 1.5,
          gravity,
        })
      }
    },

    // n confetti bits from a point, thrown upward and outward.
    confetti(x, y, z, n, colors, speed = 9) {
      for (let k = 0; k < n; k++) {
        if (!keep()) continue
        const i = cNext
        cNext = (cNext + 1) % CONF
        const a = Math.random() * Math.PI * 2
        const s = speed * (0.3 + Math.random() * 0.7)
        cPos[i * 3] = x + (Math.random() - 0.5)
        cPos[i * 3 + 1] = y
        cPos[i * 3 + 2] = z + (Math.random() - 0.5)
        cVel[i * 3] = Math.cos(a) * s
        cVel[i * 3 + 1] = speed * (0.6 + Math.random() * 0.8)
        cVel[i * 3 + 2] = Math.sin(a) * s
        for (let j = 0; j < 3; j++) {
          cRot[i * 3 + j] = Math.random() * 6
          cSpin[i * 3 + j] = (Math.random() - 0.5) * 16
        }
        cLife[i] = 2.4 + Math.random() * 1.4
        confetti.setColorAt(i, tmpColor.set(colors[k % colors.length]))
      }
      confetti.instanceColor.needsUpdate = true
    },

    // Expanding ring: flat on the ground, or upright facing the camera.
    ring(x, y, z, color, size = 6, dur = 0.7, flat = true) {
      const r = rings[ringNext]
      ringNext = (ringNext + 1) % rings.length
      r.mesh.position.set(x, y, z)
      r.mesh.material.color.set(color).multiplyScalar(boost > 1.5 ? 3 : 1.2)
      r.t = 0
      r.dur = dur
      r.size = size
      r.flat = flat
      r.mesh.visible = true
    },

    update(dt, camera, viewportHeight) {
      const scale = viewportHeight / (2 * Math.tan((camera.fov * Math.PI) / 360))
      glow.points.material.uniforms.uScale.value = scale
      smoke.points.material.uniforms.uScale.value = scale
      updatePool(glow, dt)
      updatePool(smoke, dt)

      let any = false
      for (let i = 0; i < CONF; i++) {
        if (cLife[i] <= 0) continue
        any = true
        cLife[i] -= dt
        const i3 = i * 3
        // Paper flutters: strong drag, slow fall, a little sideways sway.
        const d = Math.exp(-2.2 * dt)
        cVel[i3] *= d
        cVel[i3 + 2] *= d
        cVel[i3 + 1] = Math.max(cVel[i3 + 1] * d - 14 * dt, -2.2)
        cPos[i3] += cVel[i3] * dt + Math.sin(cLife[i] * 7 + i) * dt * 0.6
        cPos[i3 + 1] += cVel[i3 + 1] * dt
        cPos[i3 + 2] += cVel[i3 + 2] * dt
        if (cPos[i3 + 1] < 0.05) {
          cPos[i3 + 1] = 0.05
          cVel[i3] = cVel[i3 + 1] = cVel[i3 + 2] = 0
        }
        for (let j = 0; j < 3; j++) cRot[i3 + j] += cSpin[i3 + j] * dt * (cPos[i3 + 1] > 0.06 ? 1 : 0)
        const s = cLife[i] > 0 ? Math.min(1, cLife[i] * 2) : 0
        dummy.position.set(cPos[i3], cPos[i3 + 1], cPos[i3 + 2])
        dummy.rotation.set(cRot[i3], cRot[i3 + 1], cRot[i3 + 2])
        dummy.scale.setScalar(s)
        dummy.updateMatrix()
        confetti.setMatrixAt(i, dummy.matrix)
      }
      if (any) confetti.instanceMatrix.needsUpdate = true

      for (const r of rings) {
        if (!r.mesh.visible) continue
        r.t += dt
        const t = r.t / r.dur
        if (t >= 1) {
          r.mesh.visible = false
          continue
        }
        const e = 1 - Math.pow(1 - t, 3)
        r.mesh.scale.setScalar(0.3 + e * r.size)
        r.mesh.material.opacity = (1 - t) * 0.9
        if (r.flat) r.mesh.rotation.set(-Math.PI / 2, 0, 0)
        else r.mesh.quaternion.copy(camera.quaternion)
      }
    },
    stats: () => ({ glow: glow.live, smoke: smoke.live }),
  }
  api.setBloom(false)
  return api
}
