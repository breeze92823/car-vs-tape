import {
  AdditiveBlending,
  TorusGeometry,
  OctahedronGeometry,
  BoxGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DoubleSide,
  ExtrudeGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  PointLight,
  RingGeometry,
  RepeatWrapping,
  ShaderMaterial,
  Shape,
  SRGBColorSpace,
  Vector3,
} from 'three'
import { CARS, HOUSE_COLORS, TOWN, TRACK, TREADMILLS } from './config.js'
import { brickBox, brickMat } from './world.js'
import { bake } from './bake.js'
import { fontReady, glow, label, neon, relabel, setNeonColor, setNeonLevel, solidBox } from './propkit.js'
import { addHoverDiscs, buildCar, foldWheels, makeFlame } from './carmodel.js'
import { mulberry32, toTexture } from './textures.js'
import { paintBelt, paintDoor, paintWood } from './bricktex.js'
import { carLook, chest as chestState, chestLeft, chestProgress, fmt, giftCar, giftLeft, giftProgress, state, treadmillUnlocked } from './game.js'

// The plaza and everything standing in it:
//   north  - the gate to the tape track (roll-up door, best-tape bar), the
//            free boost chest, the free car podium, two market stalls
//   east   - a row of treadmills (one per multiplier, locked by rebirths)
//   west   - the terraced car showroom
//   south  - three leaderboards and the locked World 2 portal
// ringed by brick houses with voxel pine trees and street lamps.
// Static dressing is baked (bake.js) into one mesh per material.

const rand = mulberry32(9001)
const { halfX: X, north: N, south: S, walk } = TOWN

// --- Small builders -----------------------------------------------------------
function add(parent, geo, mat, x, y, z, { cast = true, receive = true, ry = 0 } = {}) {
  const m = new Mesh(geo, mat)
  m.position.set(x, y, z)
  m.rotation.y = ry
  m.castShadow = cast
  m.receiveShadow = receive
  parent.add(m)
  return m
}

const frameMat = brickMat('#d8dcf0', 'fine')
const paneMat = new MeshStandardMaterial({ color: '#1f5fd6', roughness: 0.15, metalness: 0.2, emissive: '#0a2a6a', emissiveIntensity: 0.25 })
const roofMat = brickMat('#d6dae8', 'fine')
const trimMat = brickMat('#c3c8da', 'fine')

// A 4-pane window on the +Z face of a parent at (x, y) in its local frame (z = face).
function windowAt(g, x, y, z, w = 2.6, h = 3) {
  add(g, new BoxGeometry(w + 0.5, h + 0.5, 0.35), frameMat, x, y, z + 0.1)
  const pw = (w - 0.25) / 2
  const ph = (h - 0.25) / 2
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) add(g, new BoxGeometry(pw, ph, 0.1), paneMat, x + (sx * (pw + 0.25)) / 2, y + (sy * (ph + 0.25)) / 2, z + 0.29, { cast: false })
}

// A brick house with gable roof and windows on the face toward the plaza (+Z local).
export function house(color, w, h, d) {
  const g = new Group()
  const wall = brickMat(color, 'wall')
  add(g, brickBox(w, h, d), wall, 0, h / 2, 0)
  add(g, brickBox(w + 0.4, 0.8, d + 0.4, 2), trimMat, 0, 0.4, 0) // plinth
  add(g, brickBox(w + 1.2, 0.7, d + 1.2, 2), roofMat, 0, h + 0.35, 0) // cornice
  // Gable: trapezoid prism along the width.
  const s = new Shape()
  const rh = 3 + rand() * 1.5
  s.moveTo(-d / 2 - 0.4, 0)
  s.lineTo(d / 2 + 0.4, 0)
  s.lineTo(d / 2 - 1.6, rh)
  s.lineTo(-d / 2 + 1.6, rh)
  s.closePath()
  const gable = new ExtrudeGeometry(s, { depth: w + 0.6, bevelEnabled: false })
  gable.rotateY(Math.PI / 2)
  gable.translate(-(w + 0.6) / 2, 0, 0)
  // World-ish UVs so the studs read at the same size.
  const uv = gable.attributes.uv
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / 2, uv.getY(i) / 2)
  add(g, gable, roofMat, 0, h + 0.7, 0)
  // Windows: floors every ~5 m, columns every ~5.5 m, on the front and both sides.
  const floors = Math.max(1, Math.floor((h - 2) / 5))
  const cols = Math.max(1, Math.floor(w / 5.5))
  for (let f = 0; f < floors; f++) {
    const y = 3.4 + f * 5
    for (let c = 0; c < cols; c++) windowAt(g, (c - (cols - 1) / 2) * (w / cols), y, d / 2)
    // Side windows (rotated groups).
    for (const side of [-1, 1]) {
      const sg = new Group()
      sg.rotation.y = (side * Math.PI) / 2
      sg.position.x = (side * w) / 2
      windowAt(sg, 0, y, 0, 2.2, 2.8)
      g.add(sg)
    }
  }
  return g
}

// Voxel pine: a trunk and 4 stacked, alternately turned green blocks.
export function tree(scale = 1) {
  const g = new Group()
  const bark = brickMat('#7a4a22', 'fine')
  const leaf = brickMat('#2fae2f', 'fine')
  const leaf2 = brickMat('#239a2a', 'fine')
  add(g, brickBox(0.9, 3, 0.9, 2), bark, 0, 1.5, 0)
  const tiers = [[4.2, 1.6, 3], [3.4, 1.5, 4.4], [2.5, 1.4, 5.7], [1.5, 1.4, 6.9], [0.7, 1, 7.9]]
  tiers.forEach(([s, hh, y], i) => {
    const m = add(g, brickBox(s, hh, s, 2), i % 2 ? leaf2 : leaf, 0, y, 0)
    m.rotation.y = i % 2 ? Math.PI / 4 : 0
  })
  g.scale.setScalar(scale)
  return g
}

// A street lamp: post, arm and a glowing bulb; returns the bulb material for lighting.addLamp.
const bulbMat = new MeshStandardMaterial({ color: '#fff1c4', emissive: '#ffd27a', emissiveIntensity: 0.3 })
function lamp() {
  const g = new Group()
  const metal = new MeshStandardMaterial({ color: '#2b3040', roughness: 0.5, metalness: 0.6 })
  add(g, new CylinderGeometry(0.16, 0.22, 7, 10), metal, 0, 3.5, 0)
  add(g, new BoxGeometry(0.15, 0.15, 1.6), metal, 0, 6.9, 0.7)
  add(g, new BoxGeometry(0.7, 0.3, 0.7), metal, 0, 6.85, 1.4)
  add(g, new BoxGeometry(0.5, 0.18, 0.5), bulbMat, 0, 6.65, 1.4, { cast: false })
  return g
}

// Text painted onto a canvas texture (for boards that change).
function canvasTexture(w, h) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const t = new CanvasTexture(c)
  t.colorSpace = SRGBColorSpace
  return { c, ctx: c.getContext('2d'), t }
}

// Big floating sign: outlined text sprite.
function sign(parent, text, x, y, z, height, opts) {
  const s = label(text, height, opts)
  s.position.set(x, y, z)
  parent.add(s)
  return s
}

// =============================================================================
export function buildTown(scene, lighting, fx, preset) {
  const dressing = new Group() // baked at the end
  const live = new Group() // animated / changing parts
  scene.add(live)
  const zones = [] // proximity zones: { x, z, r, prompt, action, id }
  const updaters = []
  const extraLights = preset.particles >= 0.6

  // --- Houses round the plaza -------------------------------------------------
  let ci = 0
  const nextColor = () => HOUSE_COLORS[ci++ % HOUSE_COLORS.length]
  const placeRow = (from, to, fixed, axis, faceYaw) => {
    let p = from
    while (p < to - 8) {
      const w = 14 + Math.floor(rand() * 3) * 3
      const h = 13 + Math.floor(rand() * 3) * 4
      const d = 14
      const hg = house(nextColor(), w, h, d)
      const c = p + w / 2
      const off = fixed + (axis === 'x' ? Math.sign(fixed) : Math.sign(fixed)) * (d / 2 + 1)
      if (axis === 'x') hg.position.set(c, 0, off)
      else hg.position.set(off, 0, c)
      hg.rotation.y = faceYaw
      dressing.add(hg)
      // Collider (rotated boxes: swap extents on the E/W rows).
      if (axis === 'x') solidBox(w / 2, h / 2, d / 2, c, h / 2, off)
      else solidBox(d / 2, h / 2, w / 2, off, h / 2, c)
      p += w + 1.5 + rand() * 2
    }
  }
  const edgeN = N - walk
  const edgeS = S + walk
  const edgeX = X + walk
  placeRow(-edgeX - 10, -16, edgeN, 'x', 0) // north row, west of the gate (faces +Z)
  placeRow(16, edgeX + 10, edgeN, 'x', 0)
  placeRow(-edgeX - 10, edgeX + 10, edgeS, 'x', Math.PI) // south row faces -Z
  placeRow(edgeN + 2, edgeS - 2, -edgeX, 'z', Math.PI / 2) // west row faces +X
  placeRow(edgeN + 2, edgeS - 2, edgeX, 'z', -Math.PI / 2) // east row faces -X

  // Trees and lamps along the sidewalk.
  const treeSpots = [
    [-X - 3, -30], [-X - 3, 2], [-X - 3, 34], [X + 3, -40], [X + 3, 34], [-40, S + 3.5], [-6, S + 3.5], [30, S + 3.5], [56, S + 3.5],
    [-48, N - 3.5], [-22, N - 3.5], [24, N - 3.5], [50, N - 3.5],
  ]
  for (const [x, z] of treeSpots) {
    const t = tree(0.85 + rand() * 0.35)
    t.position.set(x, TOWN.walkHeight, z)
    t.rotation.y = rand() * Math.PI
    dressing.add(t)
    solidBox(0.5, 3, 0.5, x, 3, z)
  }
  const lampSpots = [[-X - 1.5, -20, Math.PI / 2], [-X - 1.5, 20, Math.PI / 2], [X + 1.5, -46, -Math.PI / 2], [X + 1.5, 40, -Math.PI / 2], [-30, S + 1.5, Math.PI], [12, S + 1.5, Math.PI]]
  lampSpots.forEach(([x, z, ry], i) => {
    const l = lamp()
    l.position.set(x, TOWN.walkHeight, z)
    l.rotation.y = ry
    dressing.add(l)
    solidBox(0.25, 3.5, 0.25, x, 3.5, z)
    if (extraLights && i < 4) lighting.addLamp(x + Math.sin(ry) * 1.4, 6.3, z + Math.cos(ry) * 1.4, bulbMat)
  })

  // Purple voxel flowers in little clumps on the sidewalk.
  const flowerMat = brickMat('#b24dff', 'fine')
  const stemMat = brickMat('#2fae2f', 'fine')
  for (let i = 0; i < 26; i++) {
    const side = i % 4
    const x = side === 0 ? -X - 5 : side === 1 ? X + 5 : (rand() - 0.5) * X * 1.8
    const z = side < 2 ? N + rand() * (S - N) : side === 2 ? S + 5 : N - 5
    if (Math.abs(x) < 12 && z < N) continue
    add(dressing, new BoxGeometry(0.15, 0.6, 0.15), stemMat, x, TOWN.walkHeight + 0.3, z, { cast: false })
    add(dressing, new BoxGeometry(0.55, 0.3, 0.55), flowerMat, x, TOWN.walkHeight + 0.75, z, { cast: false })
  }

  // --- North: the gate --------------------------------------------------------
  const gate = buildGate(dressing, live)
  updaters.push(gate.update)

  // --- North: free boost chest + free car podium + stalls ---------------------
  const chest = buildChest(live, 30, N + 8, fx)
  zones.push({ id: 'chest', x: 30, z: N + 9, r: 6, auto: true })
  updaters.push(chest.update)

  const featured = buildGiftPodium(live, 15, N + 8, fx)
  zones.push({ id: 'gift', x: 15, z: N + 11, r: 5.5, auto: true })
  updaters.push(featured.update)

  const stallA = buildStall(dressing, live, -20, N + 8, '#2a7bff', 'REBIRTH')
  const stallB = buildStall(dressing, live, -36, N + 8, '#ff2a2a', 'CARS')
  zones.push({ id: 'rebirth', x: -20, z: N + 13, r: 5, prompt: 'Rebirth' })
  zones.push({ id: 'shop', x: -36, z: N + 13, r: 5, prompt: 'Car Shop' })
  updaters.push(stallA.update, stallB.update)

  // --- East: treadmills -------------------------------------------------------
  const tm = buildTreadmills(dressing, live, fx, extraLights)
  updaters.push(tm.update)

  // --- West: car showroom -----------------------------------------------------
  const showroom = buildShowroom(dressing, live, fx, preset)
  zones.push({ id: 'shop', x: -38, z: 0, r: 13, prompt: 'Car Shop' })
  updaters.push(showroom.update)
  // Above it: the golden sky dais of the legendary flying car.
  const dais = buildSkyDais(live, fx, preset)
  updaters.push(dais.update)

  // --- South: leaderboards + portal --------------------------------------------
  const boards = buildLeaderboards(dressing, live)
  updaters.push(boards.update)
  const setLeaderboard = boards.setData
  const portal = buildPortal(dressing, live, 42, S - 6, fx, extraLights)
  zones.push({ id: 'portal', x: 42, z: S - 9, r: 6, auto: true })
  updaters.push(portal.update)

  // Bake the static dressing (houses, trees, lamps, stall frames, frames...).
  const baked = bake(dressing, true)
  baked.traverse((o) => {
    if (o.isMesh) o.receiveShadow = true
  })
  scene.add(baked)

  return {
    zones,
    setLeaderboard,
    pads: tm.pads,
    giftBurst: () => featured.burst(),
    refresh() {
      showroom.refresh()
      dais.refresh()
      featured.refresh()
      tm.refresh()
      gate.refresh()
    },
    update(dt, elapsed, carPos) {
      for (const u of updaters) u(dt, elapsed, carPos)
    },
  }
}

// --- Gate ------------------------------------------------------------------------
function buildGate(dressing, live) {
  const z = N - 4
  const gw = TOWN.gateWidth
  const stone = brickMat('#cfd4e6', 'wall')
  const pillarW = 6
  const H = 14
  for (const s of [-1, 1]) {
    add(dressing, brickBox(pillarW, H, 9), stone, s * (gw / 2 + pillarW / 2), H / 2, z)
    solidBox(pillarW / 2, H / 2, 4.5, s * (gw / 2 + pillarW / 2), H / 2, z)
  }
  add(dressing, brickBox(gw + 0.2, 4, 9), stone, 0, H - 2, z)
  add(dressing, brickBox(gw + pillarW * 2 + 1.2, 0.8, 10), roofMat, 0, H + 0.4, z)
  // Door frame trim.
  add(dressing, new BoxGeometry(gw + 0.8, 0.5, 0.6), trimMat, 0, H - 4, z + 4.5)

  // Roll-up door: a plane that shortens as it rolls into the drum.
  const doorTex = toTexture(paintDoor(), { srgb: true })
  doorTex.wrapT = RepeatWrapping
  const door = new Mesh(new PlaneGeometry(gw, 10), new MeshStandardMaterial({ map: doorTex, roughness: 0.4, metalness: 0.6, side: DoubleSide }))
  door.position.set(0, 5, z + 3.9)
  live.add(door)
  const drum = add(live, new CylinderGeometry(0.7, 0.7, gw, 16), new MeshStandardMaterial({ color: '#5a5f70', metalness: 0.7, roughness: 0.4 }), 0, 10.3, z + 3.6)
  drum.rotation.z = Math.PI / 2

  // Title + best tape progress board above the opening.
  sign(live, 'TAPE TRACK', 0, H + 4.6, z + 4, 4.6, { color: '#ffffff' })
  const board = canvasTexture(512, 128)
  const boardMesh = new Mesh(new PlaneGeometry(9, 2.25), new MeshBasicMaterial({ map: board.t, transparent: true, toneMapped: false }))
  boardMesh.position.set(0, H - 2, z + 4.55)
  live.add(boardMesh)
  const draw = () => {
    const { ctx, c } = board
    ctx.clearRect(0, 0, c.width, c.height)
    ctx.font = '700 46px Fredoka, Arial, sans-serif'
    ctx.textAlign = 'center'
    ctx.lineWidth = 10
    ctx.strokeStyle = '#0b1a3a'
    ctx.fillStyle = '#ffffff'
    const best = state.bestTape + 1
    ctx.strokeText(`Best Tape ${best} / ${TRACK.tapes.length}`, 256, 50)
    ctx.fillText(`Best Tape ${best} / ${TRACK.tapes.length}`, 256, 50)
    ctx.fillStyle = '#0b1a3a'
    roundRect(ctx, 56, 74, 400, 36, 18)
    ctx.fill()
    const g = ctx.createLinearGradient(0, 0, 400, 0)
    g.addColorStop(0, '#5bff3a')
    g.addColorStop(1, '#c8ff2e')
    ctx.fillStyle = g
    roundRect(ctx, 62, 80, Math.max(24, 388 * (best / TRACK.tapes.length)), 24, 12)
    ctx.fill()
    board.t.needsUpdate = true
  }
  draw()

  let open = 0
  return {
    refresh: draw,
    update(dt, elapsed, p) {
      // Opens as the car comes within ~28 m of the doorway on either side.
      const near = Math.abs(p.x) < 20 && Math.abs(p.z - z) < 28
      open += ((near ? 1 : 0) - open) * Math.min(1, dt * 3)
      const h = 10 * (1 - open * 0.92)
      door.scale.y = h / 10
      door.position.y = 10 - h / 2
      doorTex.repeat.set(1, h / 10)
      drum.rotation.x = -open * 12
    },
  }
}

export function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

// --- Free boost chest ---------------------------------------------------------------
// Opens for a Bloxity-signed-in player after an hour of play (game.chest, counted by the server):
// the sign counts down the hour, a bar on the front fills, guests are told to sign in.
function buildChest(live, x, z, fx) {
  const g = new Group()
  g.position.set(x, 0, z)
  const wood = brickMat('#ff8a14', 'fine')
  const dark = brickMat('#c25a08', 'fine')
  const gold = new MeshStandardMaterial({ color: '#ffd23a', metalness: 0.9, roughness: 0.25 })
  add(g, brickBox(6, 3, 4, 2), wood, 0, 1.5, 0)
  for (const sx of [-2.2, 2.2]) add(g, brickBox(0.5, 3.1, 4.1, 2), dark, sx, 1.55, 0)
  add(g, brickBox(6.1, 0.4, 4.1, 2), dark, 0, 0.2, 0)
  const lid = new Group()
  lid.position.set(0, 3, -2) // hinge along the back edge
  g.add(lid)
  add(lid, brickBox(6.1, 1.4, 4.1, 2), wood, 0, 0.7, 2)
  for (const sx of [-2.2, 2.2]) add(lid, brickBox(0.5, 1.5, 4.2, 2), dark, sx, 0.75, 2)
  add(g, new BoxGeometry(0.8, 1, 0.2), gold, 0, 2.6, 2.05)
  add(g, new BoxGeometry(0.3, 0.4, 0.22), new MeshStandardMaterial({ color: '#1a1a22' }), 0, 2.5, 2.1)
  // Inner glow (seen when the lid lifts).
  const inner = add(g, new BoxGeometry(5.2, 0.2, 3.2), neon('#ffe26a', 4), 0, 2.95, 0, { cast: false })
  // Hour-of-play bar on the front face.
  add(g, new BoxGeometry(4, 0.5, 0.12), new MeshStandardMaterial({ color: '#1a1a22', roughness: 0.7 }), 0, 1.05, 2.06, { cast: false })
  const barMat = neon('#7dff5a', 3)
  const bar = add(g, new BoxGeometry(3.8, 0.32, 0.14), barMat, 0, 1.05, 2.08, { cast: false })
  live.add(g)
  solidBox(3, 1.5, 2, x, 1.5, z)
  const title = sign(live, 'FREE\nBOOST', x, 7.4, z, 3.4, { colors: ['#fff35a', '#ffd21a'] })
  const timer = sign(live, ' ', x, 4.9, z + 0.5, 1.1, { color: '#ffffff' })
  let lastText = ''
  let sparkT = 0
  return {
    update(dt, elapsed) {
      const cd = chestLeft()
      const ready = cd === 0
      const txt = !chestState.known ? '· · ·' : cd < 0 ? 'SIGN IN TO EARN' : ready ? 'READY!' : `${Math.floor(cd / 60)}:${String(Math.floor(cd % 60)).padStart(2, '0')}`
      if (txt !== lastText) {
        lastText = txt
        relabel(timer, txt, 1.1, { color: ready ? '#7dff5a' : cd < 0 ? '#ffb31a' : '#ffffff' })
      }
      const k = chestProgress()
      bar.visible = k > 0.005
      bar.scale.x = Math.max(0.001, k)
      bar.position.x = -1.9 * (1 - k)
      // Ready: the lid bobs open and sparkles fly out.
      const target = ready ? 0.18 + Math.sin(elapsed * 4) * 0.08 : 0
      lid.rotation.x += (-target - lid.rotation.x) * Math.min(1, dt * 6)
      inner.visible = ready
      title.position.y = 7.4 + Math.sin(elapsed * 2) * 0.25
      if (ready) {
        sparkT -= dt
        if (sparkT <= 0) {
          sparkT = 0.06
          fx.glow({ x: x + (Math.random() - 0.5) * 4, y: 3.2, z: z + (Math.random() - 0.5) * 2.5, vx: (Math.random() - 0.5) * 2, vy: 3 + Math.random() * 3, vz: (Math.random() - 0.5) * 2, life: 1.2, size: 0.6, sizeEnd: 0.1, color: Math.random() < 0.5 ? '#ffe45a' : '#ffffff', drag: 1, gravity: -2 })
        }
      }
    },
  }
}

// --- Free Car podium: the next car above your best, free after a stretch of play -----------
// (game.gift, counted by the server). A gold ring on the deck fills with the play clock, light beams
// sweep the sky and sparkles in the car's colour rise faster as it fills; once ready the car lifts
// off on rocket thrust and spins over a gold fountain. The car shown is its Rocket Edition (game.carLook:
// jets + rocket exhaust once owned). burst() is the claim; the next car pops in after it.
function buildGiftPodium(live, x, z, fx) {
  const g = new Group()
  g.position.set(x, 0, z)
  live.add(g)
  add(g, new BoxGeometry(7, 0.5, 5), new MeshStandardMaterial({ color: '#2a2f42', roughness: 0.6 }), 0, 0.25, 0)
  const rim = neon('#ffd21a', 3)
  for (const [w, d, px, pz] of [[7.2, 0.25, 0, 2.55], [7.2, 0.25, 0, -2.55], [0.25, 5.2, 3.55, 0], [0.25, 5.2, -3.55, 0]]) add(g, new BoxGeometry(w, 0.55, d), rim, px, 0.27, pz, { cast: false })
  solidBox(3.5, 0.25, 2.5, x, 0.25, z)

  // Progress ring on the deck: a dim track and a gold arc that grows with the play clock.
  const R0 = 2.05
  const R1 = 2.4
  const track = add(g, new RingGeometry(R0, R1, 64), new MeshBasicMaterial({ color: '#141826' }), 0, 0.51, 0, { cast: false })
  track.rotation.x = -Math.PI / 2
  const arc = add(g, new RingGeometry(R0, R1, 64, 1, Math.PI / 2, 0.001), neon('#ffd21a', 3), 0, 0.52, 0, { cast: false })
  arc.rotation.x = -Math.PI / 2
  let arcPct = -1

  // Searchlight beams from the four corners, sweeping.
  const beamGeo = new CylinderGeometry(1.3, 0.16, 18, 14, 1, true)
  beamGeo.translate(0, 9, 0)
  const beams = []
  for (const [bx, bz] of [[-3.1, -2.1], [3.1, -2.1], [-3.1, 2.1], [3.1, 2.1]]) {
    const pivot = new Group()
    pivot.position.set(bx, 0.5, bz)
    g.add(pivot)
    const mat = glow('#fff1b0', 0.1)
    const beam = new Mesh(beamGeo, mat)
    beam.renderOrder = 5
    pivot.add(beam)
    beams.push({ pivot, mat, phase: beams.length * 1.7, lean: Math.sign(bx) })
  }

  const turn = new Group()
  turn.position.y = 0.5
  g.add(turn)
  const title = sign(live, 'FREE CAR', x, 8.2, z, 1.9, { color: '#ffd21a' })
  const name = sign(live, ' ', x, 6.6, z, 1.4, { color: '#ffffff' })
  const timer = sign(live, ' ', x, 5.2, z, 1.3, { color: '#ffffff' })

  let model = null
  let shown = null // the podium car's parts (jets for the thrust)
  let shownId = null
  let color = '#ffd21a'
  let lastText = ''
  let sparkT = 0
  let popT = 1 // a new car scales in
  let flash = 0 // beams flare after a claim
  let thrustT = 0
  const back = new Vector3()
  const jetAt = new Vector3()
  const white = new Color('#ffffff')
  const refresh = () => {
    const def = giftCar() ?? CARS.filter((c) => !c.legend).at(-1)
    if (def.id === shownId) return
    const first = shownId === null
    shownId = def.id
    if (model) turn.remove(model)
    shown = buildCar(carLook(def.id, true), { static: true })
    model = shown.root
    turn.add(model)
    popT = first ? 1 : 0
    color = def.color
    const paintName = () => relabel(name, `${def.name} ROCKET`, 1.4, { color: new Color(def.color).lerp(white, 0.45).getStyle() })
    paintName()
    fontReady.then(paintName) // label()'s own font repaint would put the placeholder's size back
    for (const b of beams) b.mat.color.copy(new Color(def.color).lerp(white, 0.6))
    lastText = '' // the timer line may change too (all cars owned)
  }
  refresh()

  return {
    refresh,
    // The claim: rings, a spark burst, confetti and a column of light.
    burst() {
      const cols = [color, '#ffd21a', '#ffffff']
      fx.ring(x, 0.6, z, '#ffd21a', 12, 0.9, true)
      fx.ring(x, 0.6, z, color, 7, 0.6, true)
      fx.ring(x, 2.5, z, '#ffffff', 6, 0.7, false)
      fx.sparks(x, 2, z, 140, cols, 14, 1.2, 0.8, -8)
      fx.confetti(x, 3, z, 200, ['#ffd21a', '#ff4fb8', '#2ae8ff', '#7dff5a', '#ffffff', color], 14)
      for (let i = 0; i < 70; i++) {
        const a = Math.random() * Math.PI * 2
        const r = Math.random() * 1.2
        fx.glow({ x: x + Math.cos(a) * r, y: 0.6 + Math.random() * 2, z: z + Math.sin(a) * r, vx: 0, vy: 10 + Math.random() * 14, vz: 0, life: 1.4, size: 1, sizeEnd: 0.1, color: cols[i % 3], drag: 0.6, gravity: 0 })
      }
      flash = 1
    },
    update(dt, elapsed) {
      const owned = !giftCar()
      const cd = giftLeft()
      const ready = !owned && cd === 0
      const txt = owned ? 'ALL CARS OWNED!' : !chestState.known ? '· · ·' : cd < 0 ? 'SIGN IN TO EARN' : ready ? 'READY! DRIVE IN' : `${Math.floor(cd / 60)}:${String(Math.floor(cd % 60)).padStart(2, '0')}`
      if (txt !== lastText) {
        lastText = txt
        relabel(timer, txt, 1.3, { color: ready || owned ? '#7dff5a' : cd < 0 ? '#ffb31a' : '#ffffff' })
      }
      const k = owned ? 1 : giftProgress()
      const pct = Math.round(k * 200) / 2
      if (pct !== arcPct) {
        arcPct = pct
        arc.geometry.dispose()
        arc.geometry = new RingGeometry(R0, R1, 64, 1, Math.PI / 2, Math.max(0.001, k * Math.PI * 2))
        arc.visible = k > 0.002
      }

      // The car: turns, pops in when new, lifts off and spins when ready.
      popT = Math.min(1, popT + dt * 1.6)
      const pop = popT < 1 ? popT + Math.sin(popT * Math.PI) * 0.3 : 1
      turn.scale.setScalar(Math.max(0.05, pop))
      const lift = ready ? 1.3 + Math.sin(elapsed * 2.4) * 0.25 : 0
      turn.position.y += (0.5 + lift - turn.position.y) * Math.min(1, dt * 3)
      turn.rotation.y += dt * (ready ? 1.8 : 0.5)
      title.position.y = 8.2 + Math.sin(elapsed * 2) * 0.2
      setNeonLevel(rim, ready ? 3 + Math.round(Math.sin(elapsed * 8) * 3) / 2 : 3)

      // Beams sweep; brighter as the ring fills, flaring after a claim.
      flash = Math.max(0, flash - dt * 0.8)
      const op = 0.05 + k * 0.08 + (ready ? 0.1 : 0) + flash * 0.4
      for (const b of beams) {
        const t = elapsed * (ready ? 1.3 : 0.6) + b.phase
        b.pivot.rotation.z = -b.lean * (0.25 + Math.sin(t) * 0.2)
        b.pivot.rotation.x = Math.cos(t * 0.8) * 0.3
        b.mat.opacity = op
      }

      // Rocket thrust from the podium car's jets: a pilot flicker while counting, a full burn
      // holding it up once it's ready.
      thrustT -= dt
      if (shown?.jets.length && thrustT <= 0) {
        thrustT = ready ? 0.03 : 0.15
        shown.root.updateWorldMatrix(true, false) // a static car is baked into root (body is not in the scene)
        back.set(0, 0, -1).transformDirection(shown.root.matrixWorld)
        for (const j of shown.jets) {
          jetAt.set(j.x, j.y, j.z - 0.1).applyMatrix4(shown.root.matrixWorld)
          const s = ready ? 7 : 1.5
          fx.glow({ x: jetAt.x, y: jetAt.y, z: jetAt.z, vx: back.x * s + (Math.random() - 0.5), vy: back.y * s - (ready ? 3 : 0), vz: back.z * s + (Math.random() - 0.5), life: ready ? 0.45 : 0.25, size: ready ? 0.9 : 0.35, sizeEnd: 0.1, color: Math.random() < 0.5 ? '#ffb31a' : Math.random() < 0.5 ? '#ff5a0a' : '#fff6d0', drag: 2.5 })
          if (ready && Math.random() < 0.4) fx.smoke({ x: jetAt.x, y: jetAt.y, z: jetAt.z, vx: back.x * 3, vy: -1, vz: back.z * 3, life: 1.2, size: 0.4, sizeEnd: 2, color: '#9aa0ae', alpha: 0.15, drag: 1.5 })
        }
      }

      // Sparkles rising off the ring (more as it fills), a gold fountain when ready.
      sparkT -= dt
      if (sparkT <= 0) {
        sparkT = ready ? 0.025 : 0.2 - k * 0.14
        const a = Math.random() * Math.PI * 2
        const r = (R0 + R1) / 2
        fx.glow({ x: x + Math.cos(a) * r, y: 0.7, z: z + Math.sin(a) * r, vx: -Math.sin(a) * 0.8, vy: 1.5 + Math.random() * 2 + k * 2, vz: Math.cos(a) * 0.8, life: 1.6, size: 0.45, sizeEnd: 0.05, color: Math.random() < 0.6 ? color : '#ffffff', drag: 0.4, gravity: 0 })
        if (ready) {
          const s = 2.5 + Math.random() * 2
          fx.glow({ x, y: 1, z, vx: Math.cos(a) * s, vy: 9 + Math.random() * 4, vz: Math.sin(a) * s, life: 1.3, size: 0.6, sizeEnd: 0.1, color: Math.random() < 0.5 ? '#ffd21a' : '#ffffff', drag: 0.8, gravity: -9 })
        }
      }
    },
  }
}

// --- Market stall with a shopkeeper ---------------------------------------------------
function buildStall(dressing, live, x, z, awning, text) {
  const g = new Group()
  g.position.set(x, 0, z)
  const wood = new MeshStandardMaterial({ map: toTexture(paintWood(), { srgb: true }), roughness: 0.85 })
  const woodDark = brickMat('#6e3e18', 'fine')
  add(g, new BoxGeometry(8, 2.2, 2), wood, 0, 1.1, 1.6) // counter
  add(g, new BoxGeometry(8.4, 0.3, 2.4), woodDark, 0, 2.3, 1.6)
  add(g, new BoxGeometry(8, 3.4, 0.4), wood, 0, 1.7, -1.8) // back wall
  for (const sx of [-3.9, 3.9]) for (const sz of [-1.8, 2.4]) add(g, new BoxGeometry(0.4, 5.4, 0.4), woodDark, sx, 2.7, sz)
  // Striped awning (alternating colour boxes, sloped).
  const aw = new Group()
  aw.position.set(0, 5.6, 0.4)
  aw.rotation.x = 0.28
  g.add(aw)
  const white = brickMat('#ffffff', 'fine')
  const col = brickMat(awning, 'fine')
  for (let i = 0; i < 8; i++) {
    add(aw, brickBox(1.1, 0.35, 5.6, 2), i % 2 ? white : col, -3.85 + i * 1.1, 0, 0)
    add(aw, brickBox(1.1, 0.7, 0.3, 2), i % 2 ? white : col, -3.85 + i * 1.1, -0.45, 2.75) // valance
  }
  // Shopkeeper: blocky figure behind the counter.
  const shirt = brickMat('#1f2a6e', 'fine')
  const skin = new MeshStandardMaterial({ color: '#f2c79a', roughness: 0.7 })
  const hair = brickMat('#7a2e10', 'fine')
  add(g, new BoxGeometry(1.6, 1.6, 0.9), shirt, 0, 2.9, 0.2)
  add(g, new BoxGeometry(1.1, 1.1, 1.1), skin, 0, 4.25, 0.2)
  add(g, new BoxGeometry(1.25, 0.45, 1.25), hair, 0, 4.85, 0.1)
  add(g, new BoxGeometry(1.25, 0.6, 0.35), hair, 0, 4.55, -0.35)
  for (const s of [-1, 1]) add(g, new BoxGeometry(0.5, 1.4, 0.5), shirt, s * 1.05, 2.8, 0.55)
  const eyeMat = new MeshStandardMaterial({ color: '#111' })
  for (const s of [-1, 1]) add(g, new BoxGeometry(0.14, 0.2, 0.05), eyeMat, s * 0.25, 4.35, 0.78, { cast: false })
  dressing.add(g)
  solidBox(4.2, 1.5, 2.2, x, 1.5, z + 0.4)
  // Glowing floor pad in front (the trigger).
  const pad = new Mesh(new BoxGeometry(8, 0.12, 3.4), neon(awning, 2.5))
  pad.position.set(x, 0.06, z + 4.4)
  live.add(pad)
  sign(live, text, x, 8, z + 1, 3.4, { color: '#ffffff' })
  return {
    update(dt, elapsed) {
      pad.material.opacity = 1
      pad.scale.y = 1 + Math.sin(elapsed * 3) * 0.3
    },
  }
}

// --- Treadmills ---------------------------------------------------------------------
function buildTreadmills(dressing, live, fx, extraLights) {
  const pads = []
  const beltTex = toTexture(paintBelt(), { srgb: true })
  beltTex.repeat.set(1, 3)
  const beltMat = new MeshStandardMaterial({ map: beltTex, roughness: 0.9 })
  // Lawn strip behind them.
  add(dressing, brickBox(18, 0.04, 76, 4), brickMat('#3fd23a', 'plate'), X - 5, 0.02, -2, { cast: false })
  sign(live, 'Training', X - 6, 19, -2, 7, { color: '#ffffff' })
  const icon = treadmillIcon()
  icon.position.set(X - 6, 23.5, -2)
  live.add(icon)

  const locks = []
  TREADMILLS.forEach((def, i) => {
    const z = -29 + i * 9
    const cx = X - 8 // belt centre
    const g = new Group()
    g.position.set(cx, 0, z)
    const frame = brickMat(def.color, 'fine')
    const len = 12
    const wid = 5.6
    // Deck with side rails and end caps.
    add(g, brickBox(len, 0.3, wid + 0.8, 2), frame, 0, 0.15, 0)
    solidBox(len / 2, 0.15, wid / 2 + 0.4, cx, 0.15, z)
    for (const s of [-1, 1]) add(g, brickBox(len + 0.4, 0.5, 0.45, 2), frame, 0.2, 0.3, s * (wid / 2 + 0.3))
    add(g, brickBox(1.1, 0.6, wid + 1.2, 2), frame, len / 2 + 0.4, 0.3, 0) // motor housing
    // Uprights, console and handrails at the far (east) end.
    for (const s of [-1, 1]) {
      const up = add(g, brickBox(0.45, 4.2, 0.45, 2), frame, len / 2 + 0.2, 2.2, s * (wid / 2 + 0.3))
      up.rotation.z = 0.18
      add(g, brickBox(4.5, 0.3, 0.3, 2), frame, len / 2 - 1.8, 3, s * (wid / 2 + 0.3)) // handrail
    }
    const consoleG = new Group()
    consoleG.position.set(len / 2 - 0.3, 4.3, 0)
    consoleG.rotation.z = -0.5
    g.add(consoleG)
    add(consoleG, brickBox(1.6, 0.4, wid + 1.2, 2), frame, 0, 0, 0)
    dressing.add(g)

    // Live parts: belt (scrolls), screen + buttons (glow), lock and label.
    const belt = new Mesh(new PlaneGeometry(wid, len), beltMat)
    belt.rotation.set(-Math.PI / 2, 0, Math.PI / 2)
    belt.position.set(cx, 0.31, z)
    belt.receiveShadow = true
    live.add(belt)
    const screenMat = neon(def.accent, 2.4)
    const screen = new Mesh(new BoxGeometry(1.0, 0.1, 2.6), screenMat)
    screen.position.set(0, 0.23, -0.6)
    const ws = new Group()
    ws.position.copy(g.position).add(consoleG.position)
    ws.rotation.z = consoleG.rotation.z
    live.add(ws)
    ws.add(screen)
    const wsd = new Group() // static twin of `ws` inside the baked dressing
    wsd.position.copy(ws.position)
    wsd.rotation.copy(ws.rotation)
    dressing.add(wsd)
    BUTTON_MATS().forEach((m, k) => add(wsd, new BoxGeometry(0.4, 0.12, 0.35), m, 0, 0.23, 1.2 + k * 0.5, { cast: false }))
    solidBox(0.6, 2, wid / 2 + 0.6, cx + len / 2 + 0.6, 2, z) // console end blocks the car

    const lbl = label(`${def.mult}x Power`, 2.2, { color: '#ffffff' })
    lbl.position.set(cx + 2, 7.2, z)
    live.add(lbl)
    const lock = label(`LOCKED\n${def.rebirths} Rebirths`, 1.8, { colors: ['#ff5a5a', '#ffd21a'] })
    lock.position.set(cx - 1, 3.4, z)
    live.add(lock)
    locks.push({ lock, belt, def })

    let light = null
    if (extraLights && i % 2 === 0) {
      light = new PointLight(def.accent, 0, 12, 1.8)
      light.position.set(cx + 4, 4, z)
      live.add(light)
    }
    pads.push({
      x: cx, z, hx: len / 2 - 0.5, hz: wid / 2 - 0.3, axis: Math.PI / 2, mult: def.mult, index: i, accent: new Color(def.accent),
      unlocked: () => treadmillUnlocked(i),
      belt, beltTex, screenMat, light, spin: 0,
    })
  })

  const refresh = () => {
    for (const l of locks) l.lock.visible = state.rebirths < l.def.rebirths
  }
  refresh()
  let sparkT = 0
  return {
    pads,
    refresh,
    update(dt, elapsed) {
      // Belts idle slowly, run with the car's wheels when it trains on them.
      for (const p of pads) {
        const target = p.active ? p.activeSpeed : p.unlocked() ? 1.2 : 0
        p.spin += (target - p.spin) * Math.min(1, dt * 4)
        p.beltTex.offset.y -= (p.spin * dt) / 4
        const on = p.active ? 5 : p.unlocked() ? 2.2 : 0.6
        setNeonLevel(p.screenMat, on + Math.sin(elapsed * 6 + p.index) * 0.3)
        if (p.light) p.light.intensity = p.active ? 14 : p.unlocked() ? 4 : 0
      }
      // Idle sparkle above unlocked consoles.
      sparkT -= dt
      if (sparkT <= 0) {
        sparkT = 0.15
        const p = pads[Math.floor(Math.random() * pads.length)]
        if (p.unlocked()) fx.glow({ x: p.x + p.hx + 0.5, y: 4.6, z: p.z + (Math.random() - 0.5) * 3, vx: 0, vy: 1.5, vz: 0, life: 1, size: 0.5, sizeEnd: 0.05, color: '#' + p.accent.getHexString(), drag: 0.5 })
      }
    },
  }
}

let buttonMats = null
const BUTTON_MATS = () => (buttonMats ??= ['#ff3030', '#30ff5a', '#ffe030'].map((c) => neon(c, 2.5)))

// Little treadmill pictogram for the TRAINING sign.
function treadmillIcon() {
  const t = canvasTexture(256, 256)
  const { ctx } = t
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  const draw = (w, c) => {
    ctx.strokeStyle = c
    ctx.lineWidth = w
    ctx.beginPath()
    ctx.moveTo(40, 200)
    ctx.lineTo(210, 200)
    ctx.moveTo(190, 200)
    ctx.lineTo(160, 70)
    ctx.lineTo(120, 70)
    ctx.stroke()
  }
  draw(34, '#0b1a3a')
  draw(18, '#e6e9f2')
  ctx.fillStyle = '#0b1a3a'
  ctx.fillRect(30, 205, 196, 24)
  ctx.fillStyle = '#9aa0b4'
  ctx.fillRect(38, 210, 180, 12)
  t.t.needsUpdate = true
  const m = new Mesh(new PlaneGeometry(6, 6), new MeshBasicMaterial({ map: t.t, transparent: true, toneMapped: false, side: DoubleSide }))
  m.rotation.y = -Math.PI / 2
  return m
}

// --- Showroom -------------------------------------------------------------------------
function buildShowroom(dressing, live, fx, preset) {
  const stone = brickMat('#7f88a6', 'plate')
  const tiers = [
    { x: -X + 19, top: 0.8, depth: 8 },
    { x: -X + 11, top: 3.0, depth: 8 },
    { x: -X + 3, top: 5.2, depth: 8 },
  ]
  const span = 44
  for (const t of tiers) {
    add(dressing, brickBox(t.depth, t.top, span, 4), stone, t.x, t.top / 2, 0)
    solidBox(t.depth / 2, t.top / 2, span / 2, t.x, t.top / 2, 0)
  }
  // Side walls of the stepped block.
  for (const s of [-1, 1]) add(dressing, brickBox(24, 5.4, 1, 4), brickMat('#6d7694', 'plate'), -X + 11, 2.7, s * (span / 2 + 0.5))
  sign(live, 'Cars', -X + 6, 21, 0, 6, { color: '#ffffff' }) // above the golden sky dais (buildSkyDais)

  const podiums = []
  // Legendary cars fly round the golden sky dais instead (buildSkyDais).
  CARS.filter((def) => !def.legend).forEach((def, i) => {
    const tier = tiers[Math.floor(i / 4)]
    const z = -15 + (i % 4) * 10
    const x = tier.x + 0.5
    const y = tier.top
    const g = new Group()
    g.position.set(x, y, z)
    add(g, new BoxGeometry(5.2, 0.3, 5.2), new MeshStandardMaterial({ color: '#242a3c', roughness: 0.5 }), 0, 0.15, 0)
    const rimMat = neon('#ff2424', 2.6)
    for (const [w, d, px, pz] of [[5.5, 0.3, 0, 2.6], [5.5, 0.3, 0, -2.6], [0.3, 5.5, 2.6, 0], [0.3, 5.5, -2.6, 0]]) add(g, new BoxGeometry(w, 0.36, d), rimMat, px, 0.18, pz, { cast: false })
    const built = buildCar(def, { static: true })
    const model = built.root
    model.scale.setScalar(0.9)
    // Jet cars (kit) turn slowly on their podiums, afterburners revving, so the jets show from
    // the plaza; on the Low preset they stand baked like the rest.
    const spin = def.kit && fx && preset?.particles >= 0.5 ? new Group() : null
    const flames = []
    if (spin) {
      spin.position.set(x, y + 0.3, z)
      spin.add(model)
      live.add(spin)
      for (const j of built.jets) {
        const f = makeFlame(j.r * 0.82, built.flameHot, built.flameColor)
        f.position.set(j.x, j.y, j.z - 0.01)
        model.add(f)
        flames.push({ f, j })
      }
    } else {
      model.position.set(x, y + 0.3, z)
      model.rotation.y = Math.PI / 2 - 0.55
      dressing.add(model)
    }
    live.add(g)
    const lbl = label(`${def.cost ? fmt(def.cost) + ' Wins' : 'FREE'}\nx${def.mult} Power\n${def.name}`, 2.8, { colors: ['#ffd21a', '#7dff5a', '#ffffff'] })
    lbl.position.set(x, y + 4.2, z)
    live.add(lbl)
    podiums.push({ def, rimMat, model, spin, flames, accent: built.accent, flameColor: built.flameColor, x, y, z, phase: i * 1.7, burst: 0, burstT: 2 + i * 0.7, emitT: 0 })
  })
  const refresh = () => {
    for (const p of podiums) {
      const owned = state.owned.includes(p.def.id)
      const sel = state.car === p.def.id
      setNeonColor(p.rimMat, sel ? '#2affff' : owned ? '#2aff4a' : '#ff2424')
    }
  }
  refresh()
  const spinners = podiums.filter((p) => p.spin)
  const nozzle = new Vector3()
  return {
    refresh,
    update(dt, elapsed, carPos) {
      const near = carPos && Math.hypot(carPos.x - (-X + 11), carPos.z) < 70 // particles only when the player is around
      for (const p of spinners) {
        p.spin.rotation.y = elapsed * 0.32 + p.phase
        p.burstT -= dt
        if (p.burstT <= 0) {
          p.burst = 1.4
          p.burstT = 5 + Math.random() * 3
        }
        p.burst = Math.max(0, p.burst - dt)
        const heat = p.burst > 0 ? Math.min(1, p.burst * 3) : 0.3 + 0.3 * Math.max(0, Math.sin(elapsed * 2 + p.phase)) ** 2
        const flick = 0.9 + Math.random() * 0.2
        for (const { f } of p.flames) f.userData.set(elapsed, 0.7 + heat * 0.9, (0.5 + heat * 2.8) * flick, 0.95 + heat * 0.4)
        if (!near) continue
        p.emitT -= dt
        if (p.emitT > 0) continue
        p.emitT = p.burst > 0 ? 0.03 : 0.08
        p.spin.updateMatrixWorld(true)
        const yaw = p.spin.rotation.y
        const sx = -Math.sin(yaw)
        const sz = -Math.cos(yaw)
        for (const { j } of p.flames) {
          p.model.localToWorld(nozzle.set(j.x, j.y, j.z - 0.3 - Math.random() * heat))
          const out = 3 + heat * 10
          fx.glow({ x: nozzle.x, y: nozzle.y, z: nozzle.z, vx: sx * out + (Math.random() - 0.5), vy: (Math.random() - 0.5) * 0.6, vz: sz * out + (Math.random() - 0.5), life: 0.3, size: j.r * (3 + heat * 5), sizeEnd: 0.05, color: Math.random() < 0.4 ? '#fff3c0' : p.flameColor, drag: 2.5 })
        }
        // Glitter in the car's accent colour rising off the podium.
        const a = Math.random() * Math.PI * 2
        fx.glow({ x: p.x + Math.cos(a) * 2.4, y: p.y + 0.4, z: p.z + Math.sin(a) * 2.4, vx: 0, vy: 1 + Math.random() * 1.5, vz: 0, life: 1.4, size: 0.35, sizeEnd: 0.03, color: Math.random() < 0.6 ? p.accent : '#ffffff', drag: 0.4, gravity: 0 })
      }
    },
  }
}

// --- Golden sky dais: the legendary flying car (CARS `legend`) ------------------------------
// A floating gold platform over the showroom with spinning halos and a pillar of light down to
// the terraces; the car itself flies figure-eights round it, wheels folded into thruster discs,
// banking through the turns and leaving a gold sparkle trail.
function buildSkyDais(live, fx, preset) {
  const def = CARS.find((c) => c.legend)
  if (!def) return { refresh() {}, update() {} }
  const C = { x: -X + 14, y: 9.5, z: 0 }
  const gold = new MeshStandardMaterial({ color: '#ffab00', metalness: 0.6, roughness: 0.28, envMapIntensity: 0.55, emissive: '#7a4000', emissiveIntensity: 0.25 })
  const g = new Group()
  g.position.set(C.x, C.y, C.z)
  live.add(g)
  add(g, new CylinderGeometry(5, 4.4, 0.9, 8), gold, 0, 0, 0)
  add(g, new CylinderGeometry(4.4, 0.5, 2.2, 8), gold, 0, -1.55, 0)
  const topGlow = add(g, new CylinderGeometry(3.6, 3.6, 0.06, 8), neon('#ff9a00', 1.6), 0, 0.47, 0, { cast: false })
  const rimMat = neon('#ffc21a', 2.4)
  add(g, new TorusGeometry(4.75, 0.12, 6, 8), rimMat, 0, 0.48, 0, { cast: false }).rotation.x = Math.PI / 2
  const crystal = add(g, new OctahedronGeometry(0.75), neon('#fff2b0', 4), 0, -3.1, 0, { cast: false })
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4
    add(g, new BoxGeometry(0.5, 1.8, 0.5), gold, Math.cos(a) * 3.9, 1.35, Math.sin(a) * 3.9)
    add(g, new OctahedronGeometry(0.35), neon('#fff2b0', 4), Math.cos(a) * 3.9, 2.55, Math.sin(a) * 3.9, { cast: false })
  }
  // Two halo rings turning on different axes.
  const halos = [6.4, 7.2].map((r, i) => {
    const h = new Mesh(new TorusGeometry(r, 0.09, 6, 64), neon(i ? '#ffb31a' : '#ffe27a', 2.2))
    h.position.set(C.x, C.y + 1.2, C.z)
    live.add(h)
    return h
  })
  // Pillar of light from the terraces up to the crystal.
  const pillarMat = new MeshBasicMaterial({ color: '#ffe9a0', transparent: true, opacity: 0.16, blending: AdditiveBlending, depthWrite: false, side: DoubleSide, toneMapped: false })
  const pillarTop = C.y - 3.1
  const pillar = new Mesh(new CylinderGeometry(0.8, 2.2, pillarTop - 3, 20, 1, true), pillarMat)
  pillar.position.set(C.x, (pillarTop + 3) / 2, C.z)
  pillar.renderOrder = 5
  live.add(pillar)
  const plaque = sign(live, ' ', C.x, C.y + 4.2, C.z, 3.3, { colors: ['#ffd21a', '#ffffff', '#7dff5a'] })

  // The flying car: built live (not baked) so its wheels fold and its jets burn.
  const parts = buildCar(def)
  // A thruster car (the Tesla Roadster) flies on its own hover + rear thrusters, wheels down;
  // any other legend folds its wheels into thruster discs.
  const th = parts.thrusters?.down.length ? parts.thrusters : null
  if (!th) foldWheels(parts, 1)
  const discs = th ? [] : addHoverDiscs(parts)
  for (const d of discs) d.scale.setScalar(1)
  if (th) for (const n of [...th.down, ...th.rear]) n.flame && (n.flame.visible = true)
  const flyer = new Group()
  flyer.add(parts.root)
  live.add(flyer)
  const fxOn = !!fx && (preset?.particles ?? 1) >= 0.5
  const pos = new Vector3()
  const prev = new Vector3()
  const tmpV = new Vector3()
  let heading = 0
  let bank = 0
  let emitT = 0
  let rippleT = 0
  const path = (t, out) => out.set(C.x + 6 * Math.sin(2 * t), C.y + 3.5 + 2 * Math.sin(3 * t), C.z + 15 * Math.sin(t))
  path(0, prev)

  const refresh = () => {
    const owned = state.owned.includes(def.id)
    relabel(plaque, `LEGENDARY\n${def.name.toUpperCase()}\n${owned ? 'OWNED' : fmt(def.cost) + ' Wins'}`, 3.3, { colors: ['#ffd21a', '#ffffff', owned ? '#2affff' : '#7dff5a'] })
  }
  fontReady.then(refresh)
  refresh()

  return {
    refresh,
    update(dt, elapsed, carPos) {
      g.position.y = C.y + Math.sin(elapsed * 0.9) * 0.25
      g.rotation.y = elapsed * 0.15
      crystal.rotation.y = elapsed * 1.6
      halos[0].rotation.set(Math.PI / 2 + Math.sin(elapsed * 0.5) * 0.35, elapsed * 0.4, 0)
      halos[1].rotation.set(Math.PI / 2 + Math.cos(elapsed * 0.4) * 0.4, -elapsed * 0.3, 0.3)
      pillarMat.opacity = 0.12 + Math.sin(elapsed * 2.2) * 0.04
      setNeonLevel(rimMat, 2.4 + Math.round(Math.sin(elapsed * 3) * 4) / 10)
      void topGlow

      // Fly the loop: face along the path, bank into the turn.
      path(elapsed * 0.32, pos)
      const dx = pos.x - prev.x
      const dz = pos.z - prev.z
      if (dx * dx + dz * dz > 1e-8) {
        const h = Math.atan2(dx, dz)
        let dh = h - heading
        dh = Math.atan2(Math.sin(dh), Math.cos(dh))
        heading += dh
        bank += (Math.max(-0.7, Math.min(0.7, -(dh / Math.max(dt, 1e-3)) * 0.45)) - bank) * Math.min(1, dt * 3)
      }
      prev.copy(pos)
      flyer.position.copy(pos)
      flyer.rotation.set(0, heading, 0)
      parts.body.rotation.set(-0.06, 0, bank)
      for (const w of parts.wheels) w.spin.rotation.x += dt * 25
      for (const d of discs) d.scale.setScalar(1 + Math.sin(elapsed * 14) * 0.06)
      for (const j of parts.jets) j.flame?.userData.set(elapsed, 1.2, 1.6 + Math.random() * 0.5, 1.15)
      if (th) {
        for (const n of th.down) n.flame?.userData.set(elapsed, 1.3, 1.2 + Math.random() * 0.4, 1.5)
        for (const n of th.rear) n.flame?.userData.set(elapsed, 1.6, 2 + Math.random() * 0.6, 1.3)
      }

      // Particles while the player is anywhere near the showroom.
      if (!fxOn || !carPos || Math.hypot(carPos.x - C.x, carPos.z - C.z) > 110) return
      flyer.updateMatrixWorld(true)
      emitT -= dt
      if (emitT <= 0) {
        emitT = 0.04
        if (th) {
          // Blue-white sparks off the hover plumes, white smoke + red light streaks off the tail.
          const bx = -Math.sin(heading)
          const bz = -Math.cos(heading)
          for (const n of th.down) {
            parts.body.localToWorld(tmpV.set(n.x, n.y - 0.15, n.z))
            fx.glow({ x: tmpV.x, y: tmpV.y, z: tmpV.z, vx: (Math.random() - 0.5) * 0.6, vy: -6 - Math.random() * 3, vz: (Math.random() - 0.5) * 0.6, life: 0.25, size: 0.5, sizeEnd: 0.06, color: Math.random() < 0.5 ? '#ffffff' : '#7fd8ff', drag: 2 })
          }
          for (const n of th.rear) {
            parts.body.localToWorld(tmpV.set(n.x, n.y, n.z - 0.6))
            fx.smoke({ x: tmpV.x, y: tmpV.y, z: tmpV.z, vx: bx * 2 + (Math.random() - 0.5), vy: 0.2, vz: bz * 2 + (Math.random() - 0.5), life: 2, size: 0.6, sizeEnd: 3.2, color: '#f4f6fa', alpha: 0.4, drag: 1.5 })
          }
          for (const tp of parts.trailPoints) {
            parts.body.localToWorld(tmpV.set(tp[0], tp[1], tp[2]))
            fx.glow({ x: tmpV.x, y: tmpV.y, z: tmpV.z, vx: bx * 2, vy: 0, vz: bz * 2, life: 0.9, size: 0.3, sizeEnd: 0.1, color: '#ff2a3a', drag: 0.4, gravity: 0 })
          }
        }
        for (const w of th ? [] : parts.wheels) {
          w.pivot.localToWorld(tmpV.set(-w.side * 0.2, 0, 0))
          fx.glow({ x: tmpV.x, y: tmpV.y, z: tmpV.z, vx: (Math.random() - 0.5) * 0.6, vy: -4 - Math.random() * 2, vz: (Math.random() - 0.5) * 0.6, life: 0.3, size: 0.55, sizeEnd: 0.08, color: Math.random() < 0.55 ? parts.accent : '#ffffff', drag: 3 })
        }
        for (const j of parts.jets) {
          parts.body.localToWorld(tmpV.set(j.x, j.y, j.z - 0.3))
          const bx = -Math.sin(heading) * 6
          const bz = -Math.cos(heading) * 6
          fx.glow({ x: tmpV.x, y: tmpV.y, z: tmpV.z, vx: bx + (Math.random() - 0.5), vy: (Math.random() - 0.5) * 0.5, vz: bz + (Math.random() - 0.5), life: 0.3, size: 0.7, sizeEnd: 0.06, color: Math.random() < 0.5 ? '#fff3c0' : '#ffc21a', drag: 2.5 })
        }
        // The sparkle trail hangs in the air behind it.
        for (let i = 0; i < 2; i++) {
          parts.body.localToWorld(tmpV.set((Math.random() - 0.5) * parts.dims.width, 0.4 + Math.random() * 0.5, parts.dims.back + Math.random() * 0.4))
          fx.glow({ x: tmpV.x, y: tmpV.y, z: tmpV.z, vx: (Math.random() - 0.5) * 0.4, vy: -0.2 - Math.random() * 0.4, vz: (Math.random() - 0.5) * 0.4, life: 1.6 + Math.random() * 0.8, size: 0.36, sizeEnd: 0.02, color: Math.random() < 0.5 ? '#ffd21a' : Math.random() < 0.5 ? '#ffffff' : '#fff2b0', drag: 0.6, gravity: 0 })
        }
        // Gold dust rising round the dais.
        const a = Math.random() * Math.PI * 2
        fx.glow({ x: C.x + Math.cos(a) * 4.6, y: g.position.y + 0.6, z: C.z + Math.sin(a) * 4.6, vx: 0, vy: 1 + Math.random() * 1.5, vz: 0, life: 1.5, size: 0.3, sizeEnd: 0.02, color: Math.random() < 0.6 ? '#ffd21a' : '#ffffff', drag: 0.4, gravity: 0 })
      }
      // A pulse of light runs down the pillar now and then.
      rippleT -= dt
      if (rippleT <= 0) {
        rippleT = 1.6
        fx.ring(C.x, g.position.y + 0.55, C.z, '#ffd21a', 7, 0.9, true)
        fx.ring(C.x, 3.1, C.z, '#fff2b0', 4, 0.8, true) // at the foot of the pillar
      }
    },
  }
}

// --- Leaderboards ---------------------------------------------------------------------
const BOT_NAMES = ['TurboTaco', 'GearGoblin', 'NitroNoodle', 'VroomVera', 'PistonPete', 'DriftDuck', 'ClutchKid', 'RevRaccoon', 'ZoomZara', 'TorqueTom', 'BoostBean', 'SkidSally']
function buildLeaderboards(dressing, live) {
  const frame = brickMat('#3c4560', 'fine')
  const boards = [
    { title: 'Top Power', key: 'power', x: -22, base: 4.2e7 },
    { title: 'Top Wins', key: 'wins', x: 0, base: 9.5e4 },
    { title: 'Top Rebirths', key: 'rebirths', x: 22, base: 64 },
  ]
  const z = S - 3
  for (const b of boards) {
    for (const s of [-1, 1]) {
      add(dressing, brickBox(1.2, 11, 1.2, 2), frame, b.x + s * 5.6, 5.5, z)
      solidBox(0.6, 5.5, 0.6, b.x + s * 5.6, 5.5, z)
    }
    add(dressing, brickBox(12.6, 1.2, 1.4, 2), frame, b.x, 11.2, z)
    add(dressing, brickBox(10.2, 9.4, 0.5, 2), frame, b.x, 6, z - 0.1)
    const tex = canvasTexture(512, 480)
    const m = new Mesh(new PlaneGeometry(10, 9.2), new MeshBasicMaterial({ map: tex.t, toneMapped: false }))
    m.position.set(b.x, 6, z - 0.4)
    m.rotation.y = Math.PI
    live.add(m)
    sign(live, b.title, b.x, 13.6, z, 2.4, { color: '#ffffff' })
    b.tex = tex
    const r = mulberry32(b.x + 100)
    b.bots = BOT_NAMES.map((n) => ({ name: '@' + n + Math.floor(r() * 90 + 10), v: 0 }))
    b.bots.forEach((bot, i) => (bot.v = Math.round(b.base * Math.pow(0.78, i) * (0.9 + r() * 0.2))))
  }
  const draw = (b) => {
    const { ctx, c, t } = b.tex
    ctx.fillStyle = '#e9ecf6'
    ctx.fillRect(0, 0, c.width, c.height)
    ctx.fillStyle = '#c9cfe2'
    for (let y = 0; y < c.height; y += 32) for (let x = (y / 32) % 2 ? 32 : 0; x < c.width; x += 64) ctx.fillRect(x, y, 32, 32)
    const me = { name: 'You', v: Math.floor(state[b.key]), me: true }
    // Live lists from the server (net.js) when there are any; otherwise the local bots.
    const remote = data?.boards?.[b.key]
    const myRank = data?.ranks?.[b.key] ?? null
    let rows
    if (remote) {
      rows = remote.slice(0, 10).map((r) => ({ name: r.name, v: r.value }))
      if (myRank && myRank <= rows.length) Object.assign(rows[myRank - 1], { me: true, v: Math.max(rows[myRank - 1].v, me.v) })
      else if (myRank || rows.length < 10) rows[Math.min(rows.length, 9)] = Object.assign(me, { rank: myRank || rows.length + 1 })
    } else {
      rows = [...b.bots, me].sort((a, b2) => b2.v - a.v).slice(0, 10)
      if (!rows.includes(me)) rows[9] = me
    }
    ctx.font = '700 26px Fredoka, Arial, sans-serif'
    ctx.fillStyle = '#1b2240'
    ctx.textAlign = 'left'
    ctx.fillText('Rank  Username', 18, 34)
    ctx.textAlign = 'right'
    ctx.fillText(b.title.split(' ')[1], 494, 34)
    rows.forEach((row, i) => {
      const y = 76 + i * 40
      if (row.me) {
        ctx.fillStyle = 'rgba(70,200,255,0.55)'
        ctx.fillRect(8, y - 28, 496, 36)
      }
      ctx.fillStyle = '#1b2240'
      ctx.font = 'italic 700 26px Fredoka, Arial, sans-serif'
      ctx.textAlign = 'left'
      const rank = remote ? row.rank || i + 1 : row.me ? [...b.bots, me].sort((a, b2) => b2.v - a.v).indexOf(me) + 1 : i + 1
      ctx.fillText(`#${rank}`, 18, y)
      ctx.font = '600 22px Fredoka, Arial, sans-serif'
      ctx.fillText(row.name, 80, y)
      ctx.textAlign = 'right'
      ctx.font = '700 26px Fredoka, Arial, sans-serif'
      ctx.fillText(fmt(row.v), 494, y)
    })
    t.needsUpdate = true
  }
  let timer = 0
  let data = null
  for (const b of boards) draw(b)
  return {
    // Server lists: { boards: { power|wins|rebirths: [{ name, value }] }, ranks } (net.js).
    setData(d) {
      data = d
      for (const b of boards) draw(b)
    },
    update(dt) {
      timer += dt
      if (timer > 3) {
        timer = 0
        for (const b of boards) draw(b)
      }
    },
  }
}

// --- World 2 portal --------------------------------------------------------------------
function buildPortal(dressing, live, x, z, fx, extraLights) {
  const stone = brickMat('#59617a', 'fine')
  const vine = brickMat('#2c9a33', 'fine')
  const g = new Group()
  g.position.set(x, 0, z)
  g.rotation.y = Math.PI + 0.5
  for (const s of [-1, 1]) add(g, brickBox(2, 10, 2.4, 2), stone, s * 4.2, 5, 0)
  add(g, brickBox(10.4, 2, 2.4, 2), stone, 0, 10.6, 0)
  add(g, brickBox(11, 0.6, 3.4, 2), stone, 0, 0.3, 0)
  const r = mulberry32(55)
  for (let i = 0; i < 30; i++) {
    const s = i % 2 ? 1 : -1
    const onTop = i > 22
    add(g, new BoxGeometry(0.5 + r() * 0.6, 0.4 + r() * 0.8, 0.3), vine, onTop ? (r() - 0.5) * 9 : s * (4.2 + (r() - 0.5) * 1.6), onTop ? 10 + r() * 1.5 : 1 + r() * 9, 1.25, { cast: false })
  }
  dressing.add(g)
  solidBox(5.5, 5.5, 1.4, x, 5.5, z, Math.PI + 0.5)

  // Swirling portal sheet.
  const mat = new ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uBoost: { value: 1.6 } },
    transparent: true,
    side: DoubleSide,
    depthWrite: false,
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: /* glsl */ `
      varying vec2 vUv; uniform float uTime; uniform float uBoost;
      void main(){
        vec2 p = vUv - 0.5; p.x *= 0.95;
        float r = length(p); float a = atan(p.y, p.x);
        float swirl = sin(a * 5.0 + r * 18.0 - uTime * 3.0) * 0.5 + 0.5;
        float rings = sin(r * 40.0 - uTime * 5.0) * 0.5 + 0.5;
        vec3 c = mix(vec3(1.0, 0.0, 0.9), vec3(0.55, 0.05, 1.0), swirl);
        c += vec3(1.0, 0.6, 1.0) * pow(rings, 6.0) * 0.4;
        c += vec3(1.0) * smoothstep(0.25, 0.0, r) * 0.6;
        float edge = smoothstep(0.5, 0.42, max(abs(p.x), abs(p.y)));
        gl_FragColor = vec4(c * uBoost, 0.92 * edge);
      }`,
  })
  const sheet = new Mesh(new PlaneGeometry(6.4, 9), mat)
  sheet.position.set(0, 5.1, 0)
  const sg = new Group()
  sg.position.copy(g.position)
  sg.rotation.copy(g.rotation)
  sg.add(sheet)
  live.add(sg)
  let light = null
  if (extraLights) {
    light = new PointLight('#ff2ae6', 10, 16, 1.6)
    light.position.set(x - 2, 4, z - 3)
    live.add(light)
  }
  sign(live, 'WORLD 2', x, 13.8, z, 3.4, { color: '#ffffff' })
  sign(live, 'LOCKED  10 Rebirths', x, 12, z, 1.1, { color: '#ff7ad9' })
  let moteT = 0
  return {
    update(dt, elapsed) {
      mat.uniforms.uTime.value = elapsed
      if (light) light.intensity = 8 + Math.sin(elapsed * 3) * 3
      moteT -= dt
      if (moteT <= 0) {
        moteT = 0.08
        const a = (Math.random() - 0.5) * 6
        const dir = g.rotation.y
        fx.glow({ x: x + Math.cos(dir) * a, y: 1 + Math.random() * 8, z: z - Math.sin(dir) * a, vx: Math.sin(dir) * 1.5, vy: 0.6, vz: Math.cos(dir) * 1.5, life: 1.6, size: 0.4, sizeEnd: 0.05, color: Math.random() < 0.5 ? '#ff4af0' : '#c06bff', drag: 0.4 })
      }
    },
  }
}

