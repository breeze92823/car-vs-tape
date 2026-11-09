import { BoxGeometry, Group, IcosahedronGeometry, Mesh, MeshLambertMaterial, MeshStandardMaterial, PlaneGeometry, Vector2 } from 'three'
import { TOWN } from './config.js'
import { RAPIER, addFixed } from './physics.js'
import { mulberry32, toTexture } from './textures.js'
import { paintFine, paintPlate, paintWall } from './bricktex.js'

// Ground and sky dressing: one huge studded baseplate (plaza and track), the
// raised light sidewalk ring round the plaza, the plaza's invisible fence and
// puffy clouds. Shared brick textures live here too (made once).

let tex = null
// { plate, wall, fine }: { color, normal } canvases wrapped as repeating textures (repeat 1:
// geometries carry UVs in tiles, see brickBox).
export function brickTextures() {
  if (tex) return tex
  const wrap = (p) => ({ map: toTexture(p.color, { srgb: true }), normalMap: toTexture(p.normal) })
  tex = { plate: wrap(paintPlate()), wall: wrap(paintWall()), fine: wrap(paintFine()) }
  return tex
}

// A box whose UVs run in metres / tile on every face, so a shared repeating
// texture keeps the same stud size whatever the box's size.
export function brickBox(w, h, d, tile = 4) {
  const g = new BoxGeometry(w, h, d)
  const uv = g.attributes.uv
  // Face order px, nx, py, ny, pz, nz; 4 vertices each.
  const spans = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]]
  for (let f = 0; f < 6; f++) {
    for (let k = 0; k < 4; k++) {
      const i = f * 4 + k
      uv.setXY(i, (uv.getX(i) * spans[f][0]) / tile, (uv.getY(i) * spans[f][1]) / tile)
    }
  }
  return g
}

const matCache = new Map()
// Studded material in `color`; kind = wall | fine | plate.
export function brickMat(color, kind = 'wall', extra = {}) {
  const key = `${color}|${kind}|${JSON.stringify(extra)}`
  let m = matCache.get(key)
  if (!m) {
    const t = brickTextures()[kind]
    m = new MeshStandardMaterial({ color, map: t.map, normalMap: t.normalMap, normalScale: new Vector2(0.7, 0.7), roughness: 0.72, metalness: 0, ...extra })
    matCache.set(key, m)
  }
  return m
}

function makeClouds() {
  const rand = mulberry32(2024)
  const geo = new IcosahedronGeometry(1, 3)
  const mat = new MeshLambertMaterial({ color: '#ffffff', emissive: '#e6f6ff', emissiveIntensity: 0.7, fog: false })
  const group = new Group()
  for (let i = 0; i < 26; i++) {
    const ang = rand() * Math.PI * 2
    const dist = 260 + rand() * 200
    const cloud = new Group()
    const puffs = 5 + Math.floor(rand() * 4)
    const len = 24 + rand() * 30
    for (let p = 0; p < puffs; p++) {
      const t = p / (puffs - 1) - 0.5
      const r = (1 - Math.abs(t) * 1.1) * (9 + rand() * 7)
      const puff = new Mesh(geo, mat)
      puff.scale.set(r, r * 0.8, r)
      puff.position.set(t * len, r * 0.25 + rand() * 3, (rand() - 0.5) * 8)
      cloud.add(puff)
    }
    const flat = new Mesh(geo, mat)
    flat.scale.set(len * 0.62, 4, 9)
    cloud.add(flat)
    cloud.position.set(Math.cos(ang) * dist, 45 + rand() * 80, Math.sin(ang) * dist - 200)
    cloud.lookAt(0, cloud.position.y, -200)
    group.add(cloud)
  }
  return group
}

// The baseplate under everything, the sidewalk ring and the clouds.
export function buildGround(scene) {
  const t = brickTextures()
  const W = 900
  const D = 1900
  const plate = new PlaneGeometry(W, D)
  plate.attributes.uv.array.forEach((v, i, a) => (a[i] = v * ((i % 2 === 0 ? W : D) / TOWN.plateTile)))
  const ground = new Mesh(plate, new MeshStandardMaterial({ color: '#33415f', map: t.plate.map, normalMap: t.plate.normalMap, normalScale: new Vector2(0.9, 0.9), roughness: 0.8 }))
  ground.rotation.x = -Math.PI / 2
  ground.position.set(0, 0, -D / 2 + 260)
  ground.receiveShadow = true
  scene.add(ground)
  addFixed(RAPIER.ColliderDesc.cuboid(W / 2, 1, D / 2), { x: 0, y: -1, z: -D / 2 + 260 }, null, { friction: 0.9 })

  // Sidewalk ring: four raised light slabs just outside the plaza (gap at the gate).
  const { halfX: X, north: N, south: S, walk, walkHeight: h, gateWidth } = TOWN
  const walkMat = brickMat('#d4d9ea', 'plate')
  const slabs = [
    // [x, z, w, d]
    [-(X + walk / 2), (N + S) / 2, walk, S - N + walk * 2],
    [X + walk / 2, (N + S) / 2, walk, S - N + walk * 2],
    [0, S + walk / 2, X * 2, walk],
    [-(X + gateWidth / 2) / 2 - 0.0, N - walk / 2, X - gateWidth / 2, walk],
    [(X + gateWidth / 2) / 2, N - walk / 2, X - gateWidth / 2, walk],
  ]
  const group = new Group()
  for (const [x, z, w, d] of slabs) {
    const m = new Mesh(brickBox(w, h, d, TOWN.plateTile), walkMat)
    m.position.set(x, h / 2, z)
    m.receiveShadow = true
    group.add(m)
    addFixed(RAPIER.ColliderDesc.cuboid(w / 2, h / 2, d / 2), { x, y: h / 2, z })
  }
  scene.add(group, makeClouds())

  // Invisible fence at the outer sidewalk edge (houses stand beyond it), gap at the gate.
  const fh = TOWN.fenceHeight
  const ox = X + walk
  const fence = [
    [-ox, (N + S) / 2, 0.5, (S - N) / 2 + walk],
    [ox, (N + S) / 2, 0.5, (S - N) / 2 + walk],
    [0, S + walk, ox, 0.5],
    [-(ox + gateWidth / 2) / 2, N - walk, (ox - gateWidth / 2) / 2, 0.5],
    [(ox + gateWidth / 2) / 2, N - walk, (ox - gateWidth / 2) / 2, 0.5],
  ]
  for (const [x, z, hx, hz] of fence) addFixed(RAPIER.ColliderDesc.cuboid(hx, fh / 2, hz), { x, y: fh / 2, z })
}
