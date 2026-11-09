import * as THREE from 'three'
import { ACESFilmicToneMapping, Clock, Color, DirectionalLight, HemisphereLight, PCFShadowMap, PCFSoftShadowMap, PerspectiveCamera, Scene, SRGBColorSpace, Vector3, WebGLRenderer } from 'three'
import { CAMERA_FAR, CAR_CAM, CARS, COARSE_POINTER, ECONOMY, REWARDED, SPAWN, SPAWN_FACING, TRACK, TREADMILLS, graphicsPreset } from './config.js'
import * as bloxity from './bloxity.js'
import { install as installInput, onKey } from './input.js'
import { installTouch } from './touch.js'
import { initPhysics, stepPhysics, bodyCount } from './physics.js'
import { createLighting } from './lighting.js'
import { buildGround } from './world.js'
import { createPostFx } from './postfx.js'
import { label, relabel, setNeonBloom } from './propkit.js'
import { createFx } from './fx.js'
import { car, createCarBody, createCarView, interpolate, setPads, teleportCar } from './car.js'
import { setCameraDriver, setCameraSensitivity, shakeCamera, snapCamera, toggleCockpit, updateCamera } from './carcam.js'
import { buildTown } from './town.js'
import { buildTrack } from './track.js'
import { buildCar } from './carmodel.js'
import { createHud } from './hud.js'
import { installAudio, isMuted, setAudioPref, sfx, toggleMute, updateEngine } from './audio.js'
import * as game from './game.js'
import { claimCar, claimChest, hasServer, initNet, net, sendEmote, verifyAdReward } from './net.js'
import { createRemotes } from './remotes.js'

// Boot: Bloxity SDK -> renderer -> Rapier -> sky/lighting, ground, town, track,
// car -> HUD -> loop. The SDK is optional at every step.
const { state } = game
let lighting = null
let renderer = null
let postfx = null
let fx = null

function applySetting(key, value) {
  if (key === 'camera_sensitivity') setCameraSensitivity(value)
  else if (key === 'fullscreen') bloxity.requestFullscreen(value)
  else if (key === 'graphics_quality' && renderer) {
    const next = graphicsPreset(value)
    renderer.shadowMap.enabled = next.shadows
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, next.dpr))
    lighting?.setShadows(next)
    postfx?.configure(next)
    setNeonBloom(next.bloom)
    fx?.setQuality(next.particles)
    fx?.setBloom(next.bloom)
    postfx?.setSize(window.innerWidth, window.innerHeight)
  }
}
bloxity.onSetting(applySetting)
bloxity.init()

// --- Renderer -----------------------------------------------------------------
const preset = graphicsPreset(bloxity.settings.graphics_quality)
renderer = new WebGLRenderer({ antialias: preset.antialias, powerPreference: 'high-performance' })
renderer.outputColorSpace = SRGBColorSpace
renderer.toneMapping = ACESFilmicToneMapping
renderer.shadowMap.enabled = preset.shadows
renderer.shadowMap.type = COARSE_POINTER ? PCFShadowMap : PCFSoftShadowMap
renderer.setPixelRatio(Math.min(window.devicePixelRatio, preset.dpr))
document.body.appendChild(renderer.domElement)
installInput(() => bloxity.showMenu(), renderer.domElement)

const scene = new Scene()
const camera = new PerspectiveCamera(CAR_CAM.fov, 1, 0.1, CAMERA_FAR)
postfx = createPostFx(renderer, scene, camera)
postfx.configure(preset)

function resize() {
  renderer.setSize(window.innerWidth, window.innerHeight)
  postfx.setSize(window.innerWidth, window.innerHeight)
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
}
window.addEventListener('resize', resize)
resize()

// --- World ----------------------------------------------------------------------
bloxity.loadingStep('Starting physics')
await initPhysics()
lighting = createLighting(scene, renderer, preset)
fx = createFx(scene, preset.particles)
for (const key of Object.keys(bloxity.settings)) applySetting(key, bloxity.settings[key])
fx.setBloom(preset.bloom)

bloxity.loadingStep('Building the town')
buildGround(scene)
createCarBody()
const carView = createCarView(scene, fx, preset)
carView.setCar(game.carDef())
setCameraDriver(carView.driver) // the cockpit view sits at the driver's eyes
const remotes = createRemotes({ scene, fx, preset }) // the other players' cars, avatars and name plates
// H / HORN: honk, and the driver punches the wheel.
function honk() {
  sfx.horn()
  carView.driver.honk()
  sendEmote(3)
}
const town = buildTown(scene, lighting, fx, preset)
setPads(town.pads)

// --- Name plate over the car -----------------------------------------------------
const plateText = () => `${bloxity.displayName()}\nLevel ${state.level}`
const plateOpts = { colors: ['#ffffff', '#ffffff'], font: '700 64px Fredoka, Arial, sans-serif', outlineWidth: 10 }
const plate = label(plateText(), 0.9, plateOpts)
scene.add(plate)
const refreshPlate = () => relabel(plate, plateText(), 0.9, plateOpts)
bloxity.subscribeAuth(refreshPlate)

// --- Screen-space helpers ---------------------------------------------------------
const tmpV = new Vector3()
function toScreen(x, y, z) {
  tmpV.set(x, y, z).project(camera)
  if (tmpV.z > 1) return null
  return { x: (tmpV.x * 0.5 + 0.5) * window.innerWidth, y: (-tmpV.y * 0.5 + 0.5) * window.innerHeight }
}

// --- Travel ----------------------------------------------------------------------------
function goHome() {
  teleportCar(SPAWN.x, SPAWN.y, SPAWN.z, SPAWN_FACING)
  snapCamera()
}
function goTrain() {
  let best = town.pads[0]
  for (const p of town.pads) if (p.unlocked() && TREADMILLS[p.index].mult >= TREADMILLS[best.index].mult) best = p
  teleportCar(best.x - best.hx - 7, 0.05, best.z, best.axis)
  snapCamera()
}
function goTrack() {
  teleportCar(0, 0.05, TRACK.startZ + 14, Math.PI)
  snapCamera()
}

// --- Effects hooks for the track ------------------------------------------------------
let hitstop = 0
const track = buildTrack(scene, fx, {
  onSnap(i, x, y, z, color) {
    const won = game.tapeSnapped(i)
    fx.confetti(x, y + 0.5, z, 70, [color, '#ffffff', '#ffd21a', '#ff4fb8', '#2ae8ff'], 11)
    fx.sparks(x, y, z, 40, [color, '#ffffff'], 12, 0.9, 0.7)
    fx.ring(x, y + 0.5, z, color, 9, 0.6, false)
    fx.ring(x, 0.1, z, '#ffffff', 12, 0.8, true)
    const s = toScreen(x, y + 3, z)
    if (s) hud.popup(`+${won} Wins`, s.x, s.y, 'wins')
    shakeCamera(0.9)
    hitstop = 0.07
    hud.flash()
    sfx.snap()
    setTimeout(() => sfx.win(), 120)
    town.refresh()
  },
  onStretch() {
    sfx.stretch()
  },
  onBounce(i, power) {
    sfx.twang()
    shakeCamera(0.6)
    hud.toast(`Need ${game.fmt(power)} Power for tape #${i + 1}!`, 'bad')
  },
  onFinish() {
    hud.banner('TRACK COMPLETE!', '#7dff5a')
    const p = car.position
    fx.confetti(p.x, 3, p.z - 6, 160, ['#ffd21a', '#ffffff', '#7dff5a', '#2ae8ff', '#ff4fb8'], 14)
    sfx.levelUp()
    setTimeout(goHome, 2200)
  },
})

// --- HUD ------------------------------------------------------------------------------
const zones = town.zones
let activeZone = null
// Rewarded ad on the chest while it is still locked (guests too). The server has Boxity verify the
// token (net.js); offline there is nobody to ask and the ad itself counts.
let adBusy = false
async function watchBoostAd() {
  if (adBusy) return
  adBusy = true
  try {
    const r = await bloxity.showRewardedAd(REWARDED.placement)
    if (r.status !== 'completed') hud.toast(r.status === 'skipped' ? 'Watch the whole ad for the boost' : 'No ad right now, try again later', 'bad')
    else if (!(await verifyAdReward(r.rewardToken))) hud.toast('Could not verify the ad, try again', 'bad')
    else {
      game.addBoost(ECONOMY.boost.duration)
      fx.confetti(30, 4, -42, 80, ['#ffd21a', '#ff8a14', '#ffffff'], 10)
      hud.banner('x2 POWER BOOST!', '#ffb31a')
      hud.toast('x2 power boost from the ad!', 'good')
    }
  } finally {
    adBusy = false
  }
}

// Free Boost chest: a signed-in Bloxity player opens it after an hour of play (the server counts and
// decides, net.js claimChest); the Wins + 15 min boost are paid here on its ok.
let chestBusy = false
const minutesLeft = (s) => (s >= 60 ? `${Math.ceil(s / 60)} min` : `${Math.ceil(s)}s`)
async function openChest() {
  if (chestBusy) return
  const left = game.chestLeft()
  if (!hasServer()) return hud.toast('The Free Boost chest needs the game server', 'bad')
  if (!net.connected || !game.chest.known) return hud.toast('Connecting to the server...', 'bad')
  if (!game.chest.signedIn) return hud.toast('Sign in to Bloxity (top-left) to earn the Free Boost chest!', 'bad')
  if (left > 0) return hud.toast(`Play ${minutesLeft(left)} more to open the chest`)
  chestBusy = true
  try {
    const r = await claimChest()
    if (r.ok) {
      const reward = game.openChest()
      fx.confetti(30, 4, -42, 160, ['#ffd21a', '#ff8a14', '#ffffff', '#7dff5a'], 14)
      fx.sparks(30, 3, -42, 80, ['#ffe45a', '#ffffff'], 12, 1, 0.8)
      fx.ring(30, 0.15, -42, '#ffd21a', 12, 1, true)
      sfx.levelUp()
      hud.banner('FREE BOOST!', '#ffd21a')
      hud.toast(`+${game.fmt(reward.wins)} Wins and x2 Power for ${Math.round(reward.boost / 60)} min!`, 'good')
    } else if (r.reason === 'early') hud.toast(`Play ${minutesLeft(Math.max(1, game.chestLeft()))} more to open the chest`)
    else if (r.reason === 'signin') hud.toast('Sign in to Bloxity (top-left) to earn the Free Boost chest!', 'bad')
    else hud.toast('Could not reach the server, try again', 'bad')
  } finally {
    chestBusy = false
  }
}

// Free Car podium: the next car above the player's best, free once the server's play clock for it
// is done (net.js claimCar). On ok the car is owned and equipped (game.openGift -> 'car' event).
let giftBusy = false
async function openGift() {
  if (giftBusy) return
  const def = game.giftCar()
  if (!def) return hud.toast('You own every car!', 'good')
  const left = game.giftLeft()
  if (!hasServer()) return hud.toast('The Free Car needs the game server', 'bad')
  if (!net.connected || !game.chest.known) return hud.toast('Connecting to the server...', 'bad')
  if (!game.chest.signedIn) return hud.toast(`Sign in to Bloxity (top-left) to win ${def.name} free!`, 'bad')
  if (left > 0) return hud.toast(`Play ${minutesLeft(left)} more to drive ${def.name} home free`)
  giftBusy = true
  try {
    const r = await claimCar(def.id)
    if (r.ok) {
      town.giftBurst()
      hitstop = 0.25
      shakeCamera(0.5)
      sfx.levelUp()
      sfx.buy()
      game.openGift(def.id)
      hud.flash('#ffd21a')
      hud.banner(`FREE CAR: ${def.name.toUpperCase()}!`, '#ffd21a')
      hud.toast(`${def.name} is yours! x${def.mult} Power`, 'good')
    } else if (r.reason === 'early') hud.toast(`Play ${minutesLeft(Math.max(1, game.giftLeft()))} more to drive ${def.name} home free`)
    else if (r.reason === 'signin') hud.toast(`Sign in to Bloxity (top-left) to win ${def.name} free!`, 'bad')
    else if (r.reason === 'owned') {
      game.openGift(def.id) // already gifted on this account: just make sure it's owned
      hud.toast(`${def.name} is already yours`, 'good')
    } else hud.toast('Could not reach the server, try again', 'bad')
  } finally {
    giftBusy = false
  }
}

function runZone(z) {
  if (!z) return
  if (z.id === 'chest-ad') watchBoostAd()
  else if (z.id === 'shop') hud.openShop()
  else if (z.id === 'rebirth') hud.openRebirth()
}

const hud = createHud({
  onShop: () => hud.openShop(),
  onRebirth: () => hud.openRebirth(),
  onTrain: goTrain,
  onTrack: goTrack,
  onHome: goHome,
  onPrompt: () => runZone(activeZone),
  onMute: toggleMute,
  onWindow(open) {
    car.frozen = open
    if (open) document.exitPointerLock?.()
  },
  onBuy(id) {
    const r = game.buyCar(id)
    if (r === 'bought') {
      sfx.buy()
      hud.toast(`New car: ${game.carDef(id).name}!`, 'good')
    } else if (r === 'poor') {
      sfx.error()
      hud.toast(`Need ${game.fmt(game.carDef(id).cost - state.wins)} more Wins`, 'bad')
    } else sfx.click()
  },
  onDoRebirth() {
    if (game.rebirth()) {
      sfx.levelUp()
      hud.banner(`REBIRTH ${state.rebirths}!`, '#ff7ad9')
      hud.close()
    }
  },
  thumbnails: makeThumbnails,
})

game.on('car', (id) => {
  carView.setCar(game.carDef(id))
  town.refresh()
  const p = car.position
  fx.sparks(p.x, 1, p.z, 50, ['#2affff', '#ffffff', '#ffd21a'], 9, 0.9, 0.6)
  fx.ring(p.x, 0.1, p.z, '#2affff', 8, 0.7, true)
})
game.on('levelup', (lv) => {
  hud.banner(`LEVEL ${lv}!`, '#4ad8ff')
  refreshPlate()
  const p = car.position
  fx.ring(p.x, 0.15, p.z, '#4ad8ff', 10, 0.9, true)
  fx.sparks(p.x, 1.5, p.z, 60, ['#4ad8ff', '#ffffff', '#7dff5a'], 10, 1, 0.7, -6)
  sfx.levelUp()
})
game.on('rebirth', () => {
  town.refresh()
  const p = car.position
  fx.ring(p.x, 0.15, p.z, '#ff7ad9', 14, 1.1, true)
  fx.confetti(p.x, 2, p.z, 90, ['#ff7ad9', '#ffffff', '#c06bff'], 10)
})
game.on('boost', () => sfx.boost())
let powerAcc = 0
game.on('power', (n) => (powerAcc += n))

// Server link: progress (hydrate -> refresh the world and plate), live leaderboards.
initNet({ setLeaderboard: town.setLeaderboard })
game.on('hydrate', () => {
  town.refresh()
  refreshPlate()
})
installAudio()

// --- Boxity: ad breaks, banner screens, chat bubbles, Reset Character -----------------------
// An ad break covers the game: stop the world and the sound until it is over.
let adPause = false
let mutedBeforeAd = false
bloxity.onAdBreak((on) => {
  adPause = on
  if (on) {
    mutedBeforeAd = isMuted()
    setAudioPref('music', false)
    setAudioPref('sfx', false)
  } else if (!mutedBeforeAd) {
    setAudioPref('music', true)
    setAudioPref('sfx', true)
  }
  if (on) clock.getDelta() // the break's length must not become one huge step
})
// Banners: the plaza while driving, a window while the shop / rebirth / settings is open.
let adScreenNow = ''
function syncAdScreen() {
  const next = hud.isOpen() ? 'panel' : 'gameplay'
  if (next === adScreenNow) return
  adScreenNow = next
  bloxity.adScreen(next, next === 'panel' ? { skip: ['top-right'] } : undefined)
}
// A message from the portal's chat box floats over the car for a few seconds.
bloxity.onChat((m) => (m.isLocal ? bloxity.attachChatBubble(THREE, carView.root, m.text) : remotes.chat(m, THREE)))
// The portal menu's Reset Character: back to the plaza.
bloxity.onRespawnRequest(goHome)

// --- Keys ------------------------------------------------------------------------------
onKey('KeyN', () => lighting.toggleDayNight())
onKey('KeyR', goHome)
onKey('KeyE', () => runZone(activeZone))
onKey('KeyC', () => (hud.isOpen() ? hud.close() : hud.openShop()))
onKey('KeyM', toggleMute)
onKey('KeyH', honk)
onKey('KeyV', toggleCockpit)
window.addEventListener(
  'keydown',
  (e) => {
    if (e.code === 'Escape' && hud.isOpen()) {
      hud.close()
      e.stopPropagation()
    }
  },
  { capture: true },
)
installTouch({ day: () => lighting.toggleDayNight(), horn: honk, view: toggleCockpit })

// --- Car shop thumbnails: rendered once with the game's own renderer -------------------------
// Each car has the player's avatar at the wheel, waving (waits up to 2.5 s for it to load).
let thumbPromise = null
function makeThumbnails() {
  const avatar = Promise.race([carView.driver.whenLoaded, new Promise((r) => setTimeout(r, 2500))])
  thumbPromise ??= avatar.then(() => new Promise((resolve) => {
    requestAnimationFrame(() => {
      const out = {}
      const ts = new Scene()
      ts.background = new Color('#3b5fd8')
      ts.environment = scene.environment
      ts.add(new HemisphereLight('#ffffff', '#4a5a8a', 1.2))
      const key = new DirectionalLight('#ffffff', 2.4)
      key.position.set(5, 8, 6)
      ts.add(key)
      const cam = new PerspectiveCamera(30, 16 / 10, 0.1, 50)
      cam.position.set(4.7, 2.1, 5.6)
      cam.lookAt(0, 0.55, 0)
      const W = 240
      const H = 150
      const dpr = renderer.getPixelRatio()
      const c2 = document.createElement('canvas')
      c2.width = W
      c2.height = H
      const ctx = c2.getContext('2d')
      const fullH = renderer.domElement.height
      renderer.setScissorTest(true)
      for (const def of CARS) {
        const parts = buildCar(def)
        carView.driver.seatPreview(parts)
        const m = parts.root
        m.rotation.y = 0.55
        ts.add(m)
        renderer.setViewport(0, 0, W, H)
        renderer.setScissor(0, 0, W, H)
        renderer.render(ts, cam)
        ctx.drawImage(renderer.domElement, 0, fullH - H * dpr, W * dpr, H * dpr, 0, 0, W, H)
        out[def.id] = c2.toDataURL('image/png')
        ts.remove(m)
      }
      renderer.setScissorTest(false)
      renderer.setViewport(0, 0, window.innerWidth, window.innerHeight)
      postfx.render()
      resolve(out)
    })
  }))
  return thumbPromise
}

// --- Loop ---------------------------------------------------------------------------------
const clock = new Clock()
let shownLoading = true
let readySince = 0
let popupT = 0
let night = 0
let padToastT = 0
let lastZone = null
const CHEST_AD = { id: 'chest-ad', prompt: 'Watch an ad: free boost' }

function frame() {
  if (adPause) return clock.getDelta() // an ad break is showing over the game
  const rawDt = Math.min(clock.getDelta(), 0.1)
  const elapsed = clock.elapsedTime
  hitstop = Math.max(0, hitstop - rawDt)
  const dt = hitstop > 0 ? rawDt * 0.12 : rawDt

  stepPhysics(dt)
  interpolate()

  // Training: driving anywhere trains at x1; a treadmill multiplies it.
  const padMult = car.pad ? car.pad.mult : 1
  const rate = car.frozen ? 0 : game.train(dt, car.wheelSpeed, padMult)
  for (const p of town.pads) {
    p.active = car.pad === p
    p.activeSpeed = car.wheelSpeed
  }
  if (car.padHit && (padToastT -= dt) <= 0) {
    padToastT = 3
    hud.toast(`Locked: needs ${TREADMILLS[car.padHit.index].rebirths} Rebirths`, 'bad')
  }

  // Zones: auto-trigger ones fire on entry; the rest show a prompt.
  const p = car.renderPosition
  let near = null
  for (const z of zones) if (Math.hypot(p.x - z.x, p.z - z.z) < z.r) near = z
  if (near !== lastZone) {
    lastZone = near
    if (near?.id === 'chest') openChest()
    else if (near?.id === 'gift') openGift()
    else if (near?.id === 'portal') hud.toast(state.rebirths >= 10 ? 'World 2 is coming soon!' : 'World 2 needs 10 Rebirths', 'bad')
  }
  activeZone = near && near.prompt ? near : near?.id === 'chest' && game.chestLeft() !== 0 && bloxity.adsAvailable() && !adBusy ? CHEST_AD : null

  const boosted = game.boostLeft() > 0
  night += ((lighting.isNight() ? 1 : 0) - night) * Math.min(1, dt / 2)
  carView.setNight(night)
  carView.update(dt, camera, elapsed, boosted)
  remotes.update(dt, camera, elapsed, night)
  updateCamera(camera, rawDt)
  town.update(dt, elapsed, p)
  track.update(dt)
  fx.update(dt, camera, renderer.domElement.height)
  lighting.update(dt, p)

  plate.position.set(p.x, p.y + 3.1, p.z)

  // "+N" power popups gathered over a short window, floating off the car.
  popupT -= rawDt
  if (popupT <= 0 && powerAcc > 0) {
    popupT = 0.2
    const s = toScreen(p.x + (Math.random() - 0.5) * 3.2, p.y + 1.6 + Math.random() * 1.4, p.z)
    if (s) hud.popup(`+${game.fmt(powerAcc)}`, s.x, s.y, 'power')
    hud.bumpPower()
    powerAcc = 0
  }

  const speedK = Math.min(1, Math.abs(car.wheelSpeed) / car.topSpeed)
  updateEngine(speedK, car.throttle, car.drifting || (car.pad && car.throttle > 0.1) ? 1 : 0)
  hud.update(rawDt, {
    rate,
    pad: car.pad ? car.pad.mult : 0,
    nextTape: game.nextTape(),
    prompt: activeZone?.prompt,
    onTrack: car.position.z < TRACK.startZ,
    speedLines: Math.max(0, (speedK - 0.85) / 0.15) * 0.35 + (boosted && car.throttle > 0.5 ? 0.2 : 0),
  })
  game.tick(rawDt)
  syncAdScreen()
  postfx.render()

  if (shownLoading) {
    readySince += rawDt
    if (readySince > 0.3) {
      shownLoading = false
      bloxity.notifyFirstFrame()
    }
  }
}
renderer.setAnimationLoop(frame)

window.addEventListener('beforeunload', () => {
  game.save()
  bloxity.teardown()
})
document.addEventListener('visibilitychange', () => document.hidden && game.save())

if (import.meta.env.DEV) {
  import('./devviews.js').then((m) => (window.__game.views = m.makeViews(window.__game)))
  window.__game = { pause: () => renderer.setAnimationLoop(null), resume: () => renderer.setAnimationLoop(frame), buildCar, CARS, car, scene, renderer, camera, postfx, fx, game, track, town, bodies: bodyCount, net, remotes, goHome, goTrain, goTrack, teleport: teleportCar }
}
