import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, DoubleSide, DynamicDrawUsage, Mesh, ShaderMaterial } from 'three'

// A neon light trail in world space: a ribbon laid down behind a moving point (newest sample
// first). The head follows the point every frame, a new sample is laid every `spacing` m, each
// sample fades over `life` s and the ribbon tapers to its tail. `vertical` stands the ribbon on
// edge (reads as a glowing line from any angle) instead of flat. Allocation-free per frame.
const VERT = /* glsl */ `
  attribute float aFade;
  varying float vFade;
  varying float vEdge;
  void main() {
    vFade = aFade;
    vEdge = mod(float(gl_VertexID), 2.0);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`
const FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uGain;
  varying float vFade;
  varying float vEdge;
  void main() {
    float across = 1.0 - abs(vEdge * 2.0 - 1.0); // 0 at the edges, 1 down the middle
    float core = smoothstep(0.55, 1.0, across);
    vec3 col = mix(uColor, vec3(1.0), core * 0.55) * uGain * (1.0 + vFade);
    gl_FragColor = vec4(col, clamp(vFade * (0.25 + 0.75 * across), 0.0, 1.0));
  }`

export function makeTrail(scene, { color = '#ff2a3a', n = 64, gain = 1.6 } = {}) {
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
  const mat = new ShaderMaterial({
    uniforms: { uColor: { value: new Color(color) }, uGain: { value: gain } },
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
  })
  const mesh = new Mesh(geo, mat)
  mesh.frustumCulled = false
  mesh.renderOrder = 6
  mesh.visible = false
  scene.add(mesh)
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
    update(x, y, z, rxv, rzv, time, on, { width = 0.1, life = 0.9, spacing = 0.3, vertical = false } = {}) {
      if (count && Math.hypot(x - sx[0], y - sy[0], z - sz[0]) > 8) count = 0 // teleported
      if (on) {
        if (count < 2 || Math.hypot(sx[0] - sx[1], sy[0] - sy[1], sz[0] - sz[1]) > spacing) shift()
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
        const w = width * (0.4 + 0.6 * f)
        const k = i * 6
        if (vertical) {
          pos[k] = pos[k + 3] = sx[i]
          pos[k + 2] = pos[k + 5] = sz[i]
          pos[k + 1] = sy[i] - w
          pos[k + 4] = sy[i] + w
        } else {
          pos[k] = sx[i] - rx[i] * w
          pos[k + 1] = sy[i]
          pos[k + 2] = sz[i] - rz[i] * w
          pos[k + 3] = sx[i] + rx[i] * w
          pos[k + 4] = sy[i]
          pos[k + 5] = sz[i] + rz[i] * w
        }
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
