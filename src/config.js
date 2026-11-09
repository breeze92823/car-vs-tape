// Every tunable constant lives here; the rest of src/ holds no theme values.

// --- Identity -------------------------------------------------------------
export const GAME_SLUG = 'car-vs-tape' // slug registered on bloxity.io
export const GAME_TITLE = 'Car vs Tape'

// Forces the Bloxity SDK and avatar CDN to be treated as unavailable (see .env.example).
export const DEV_MODE = import.meta.env.VITE_DEV_MODE === 'true'

// --- World (metres: +X east, +Z south, +Y up) -------------------------------
export const GROUND_Y = 0
// The town plaza (world.js / town.js): an open studded plate ringed by a raised
// sidewalk and brick houses. North (-Z) is the gate to the tape track.
export const TOWN = {
  halfX: 62, // plaza half-width (x)
  north: -50, // z of the north edge (the gate wall line)
  south: 54, // z of the south edge
  walk: 7, // sidewalk band width beyond the plaza edge
  walkHeight: 0.3, // curb height (the car autosteps it)
  plateTile: 2, // m per baseplate texture tile (4 x 4 studs)
  fenceHeight: 6,
  gateWidth: 18, // opening into the track
}
export const SPAWN = { x: 0, y: 0.05, z: 14 }
export const SPAWN_FACING = Math.PI // yaw the car faces on spawn (PI = toward -Z, north)

// --- Player modes (modes.js) -------------------------------------------------
// 'character' = third-person chase cam with the avatar on screen.
// 'player' = first-person, the camera is the player's eyes and the avatar is hidden.
export const MODES = ['character', 'player']
export const START_MODE = 'character'

// --- Physics (physics.js, player.js) ------------------------------------------
export const PHYSICS = {
  gravity: -22, // m/s^2 for dynamic bodies and the player
  fixedStep: 1 / 60, // s per physics tick; rendering interpolates between ticks
  maxSubSteps: 5, // a long frame never runs more ticks than this
  walkSpeed: 8, // m/s
  sprintSpeed: 14, // m/s with Shift held
  accel: 70, // m/s^2 toward the target velocity on the ground
  airAccel: 22, // m/s^2 steering while airborne
  decel: 60, // m/s^2 when no key is held
  turnSpeed: 12, // rad/s the body turns toward its heading
  jumpSpeed: 8.5, // m/s
  coyoteTime: 0.1, // s after leaving a ledge a jump still counts
  jumpBuffer: 0.12, // s a jump pressed before landing is remembered
  stepHeight: 0.45, // m autostep
  maxSlope: 50, // degrees the player can walk up
  snapToGround: 0.4, // m the controller stays glued to downward steps and slopes
  pushMass: 80, // kg the character weighs when shoving crates
  killY: -6, // sank this far: respawn
}
export const PLAYER_DIMS = { radius: 0.75, height: 1.8 } // capsule the character controller moves

// --- Look ------------------------------------------------------------------
export const RENDER = { exposure: 1.0 }
export const FOG = { near: 190, far: 720 }
// The two lighting moods lighting.js blends between (key N toggles).
export const TIME_OF_DAY = {
  transition: 2.5, // s to blend day <-> night
  day: {
    zenith: '#00b2ff',
    horizon: '#7fe9ff',
    sunColor: '#fff4de',
    // Sun + hemi + env together keep the pale sand (#eed39c) near its own tan;
    // much more and ACES washes it (and the props) out to grey-white.
    sunIntensity: 2.4,
    sunElevation: 55, // degrees above the horizon
    sunAzimuth: 35, // degrees, 0 = from +Z
    hemiSky: '#e4f6ff',
    hemiGround: '#5a6a96',
    hemiIntensity: 1.0,
    envIntensity: 0.6,
    lampIntensity: 0,
    stars: 0,
    exposure: 0.95,
  },
  night: {
    zenith: '#050b22',
    horizon: '#24345e',
    sunColor: '#9fb4ff', // the moon
    sunIntensity: 0.55,
    sunElevation: 38,
    sunAzimuth: -60,
    hemiSky: '#3a4c80',
    hemiGround: '#1a1a22',
    hemiIntensity: 0.35,
    envIntensity: 0.25,
    lampIntensity: 30,
    stars: 1,
    exposure: 1.15,
  },
}
export const LIGHT = {
  shadowRange: 40, // half-width of the sun's shadow box around the player
  lampColor: '#ffb35c',
  lampDistance: 22,
}

// Default (fallback) character look, used only when player.glb cannot load.
export const CHARACTER_COLORS = { skin: '#f2c79a', suit: '#2f6fd0', hair: '#4a2f1c' }

export const MATERIAL_PBR = {
  PLAYER: { roughness: 0.7, metalness: 0 },
  GROUND: { roughness: 0.95, metalness: 0 },
}

// --- Graphics presets, picked by the Bloxity graphics_quality setting ----------
export const GRAPHICS_PRESETS = {
  Low: { shadows: false, shadowMap: 512, antialias: false, dpr: 1, bloom: false, particles: 0.35 },
  Medium: { shadows: true, shadowMap: 1024, antialias: false, dpr: 1.25, bloom: false, particles: 0.6 },
  High: { shadows: true, shadowMap: 2048, antialias: true, dpr: 2, bloom: true, particles: 1 },
  Ultra: { shadows: true, shadowMap: 4096, antialias: true, dpr: 2, bloom: true, particles: 1 },
}

// Bloom (postfx.js): only HDR-bright pixels (above threshold, linear, before
// tone mapping) glow: neon rails, waterfall, VIP gate, particles. Sunlit sand
// stays under the threshold.
export const BLOOM = { strength: 0.6, radius: 0.35, threshold: 2.0 }
// Neon materials (propkit.js): k = HDR colour multiplier with bloom on; with
// bloom off they are capped at plainMax so they stay coloured, not white.
export const NEON = { k: 3.5, plainMax: 1.2 }

// Phones and tablets default to a lighter preset when the portal sends no value,
// and any preset is capped there (a phone at DPR 3 renders 9x the pixels; bloom
// is a full-screen multi-pass blur, so it stays off on phones).
export const COARSE_POINTER = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches
export const DEFAULT_GRAPHICS = COARSE_POINTER ? 'Medium' : 'High'
export const MOBILE_GRAPHICS_CAP = { dpr: 1.5, shadowMap: 1024, particles: 0.6 }

// The preset to render with on this device.
export function graphicsPreset(name) {
  const p = GRAPHICS_PRESETS[name] ?? GRAPHICS_PRESETS[DEFAULT_GRAPHICS]
  if (!COARSE_POINTER) return p
  const cap = MOBILE_GRAPHICS_CAP
  return { ...p, dpr: Math.min(p.dpr, cap.dpr), shadowMap: Math.min(p.shadowMap, cap.shadowMap), bloom: false, particles: Math.min(p.particles, cap.particles) }
}

// --- Touch controls (touch.js) --------------------------------------------------
export const TOUCH = {
  deadZone: 0.12, // fraction of the joystick radius that does nothing
  lookScale: 1.5, // touch drag pixels -> look, relative to a mouse pixel
  pinchPixelsPerNotch: 30, // finger spread change that equals one wheel notch
}

// --- Camera (camera.js) -------------------------------------------------------
export const CAMERA = {
  fov: 70,
  near: 0.1,
  far: 1200,
  startPitch: 0.14, // radians above the horizon (low chase cam)
  minPitch: -0.35,
  maxPitch: 1.25,
  firstPersonPitch: 1.45, // |pitch| limit looking up/down in player mode
  eyeHeight: 0.92, // eye height as a fraction of player height (player mode)
  distance: 12.4, // resting boom length, m
  minDistance: 2.5, // wheel in past this enters player mode
  maxDistance: 26,
  followLerp: 14, // 1/s: the one smoothing stage, on the point the camera follows
  targetHeight: 1.2, // look-at point as a fraction of player height
  lookSensitivity: 0.0026, // rad per pixel of mouse movement
  zoomStep: 0.9, // m per wheel notch
  zoomEase: 12, // 1/s the zoom glides to its target
  speedFov: 6, // degrees the FOV widens at sprint speed
  speedEase: 3, // 1/s the speed framing eases in and out
  clearEase: 6, // 1/s the boom eases back out once a wall stops blocking it
}

// --- Bloxity (bloxity.js, avatar/) -------------------------------------------------
// SDK setting keys this game listens for; registering a listener makes the control
// appear in the portal's settings menu.
export const SETTINGS = {
  graphics_quality: { def: DEFAULT_GRAPHICS, type: 'enum', values: ['Low', 'Medium', 'High', 'Ultra'] },
  camera_sensitivity: { def: '1', type: 'number', min: 0.1, max: 5 },
  show_fps: { def: 'false', type: 'bool' },
  fullscreen: { def: 'false', type: 'bool' },
}

// The base rig, measured from player.glb: origin at the feet, 6.4 units tall at bind pose.
export const RIG_HEIGHT = 6.4
// Bind-pose values of the rig nodes the SDK proportions drive.
export const RIG = { armOffsetX: 2, legOffsetX: 0.6, neckOffsetY: 0.6 }
// getProportions() ranges, straight from the SDK spec; clamped before they reach the scene graph.
export const PROPORTIONS = {
  height: { def: 1, min: 0.5, max: 1.6 },
  shoulderWidth: { def: 1, min: 0.5, max: 1.5 },
  armLength: { def: 1, min: 0.05, max: 3 },
  legOffsetX: { def: 1, min: -0.7, max: 5 },
  torsoScaleX: { def: 1, min: 0.3, max: 2 },
  neckHeight: { def: 1, min: 0.94, max: 1.2 },
  headScale: { def: 1, min: 0.3, max: 2.6 },
}

// Procedural animation (avatar/animator.js), ported from Clean Leaves for Loot.
// Rotations are radians in CHARACTER space: +X swings a limb backward, +Y yaws, +Z rolls.
const deg = (d) => (d * Math.PI) / 180
export const ANIM = {
  airborneDelay: 0.07, // s off the ground before the air pose (ignores a step down a ledge)
  // Walk -> run is one cycle at two depths; phase advances with distance travelled.
  locomotion: {
    minFrequency: 0.7,
    maxFrequency: 3.6,
    strideDistance: 3.8, // m per cycle
    idleSpeed: 0.6,
    walkSpeed: 2.5,
    runSpeed: 8,
    sprintSpeed: 13,
    hipSwing: { walk: deg(22), run: deg(42), sprint: deg(56) },
    kneeBend: { walk: deg(30), run: deg(58), sprint: deg(72) },
    armSwing: { walk: deg(18), run: deg(36), sprint: deg(52) },
    elbowBend: { walk: deg(14), run: deg(44), sprint: deg(70) },
    torsoTwist: { walk: deg(4), run: deg(7), sprint: deg(9) },
    torsoLean: { walk: deg(3), run: deg(10), sprint: deg(18) },
    headCounterTwist: { walk: deg(2), run: deg(4), sprint: deg(5) },
    torsoRoll: { walk: deg(2), run: deg(3), sprint: deg(3) },
    bob: { walk: 0.03, run: 0.07, sprint: 0.09 }, // m, on the avatar root
    bankAngle: deg(9),
    bankRate: 8,
  },
  idle: {
    breathFrequency: 0.35,
    breathAmount: deg(1.8),
    breathBob: 0.007,
    basePose: {
      ArmL1: { x: deg(-4), z: deg(8) },
      ArmL2: { x: deg(12) },
      ArmR1: { x: deg(-4), z: deg(-8) },
      ArmR2: { x: deg(12) },
      LegL1: { x: deg(-4) },
      LegR1: { x: deg(4) },
    },
  },
  airborne: {
    rise: {
      LegL1: { x: deg(-38) }, LegR1: { x: deg(8) }, LegL2: { x: deg(62) }, LegR2: { x: deg(40) },
      ArmL1: { x: deg(-40), z: deg(34) }, ArmR1: { x: deg(-30), z: deg(-34) },
      ArmL2: { x: deg(30) }, ArmR2: { x: deg(30) }, Spine1: { x: deg(6) },
    },
    fall: {
      LegL1: { x: deg(-14) }, LegR1: { x: deg(10) }, LegL2: { x: deg(22) }, LegR2: { x: deg(18) },
      ArmL1: { x: deg(-70), z: deg(40) }, ArmR1: { x: deg(-60), z: deg(-40) },
      ArmL2: { x: deg(20) }, ArmR2: { x: deg(20) }, Spine1: { x: deg(-4) },
    },
    velocityReference: 8, // m/s vertical speed that reads as fully rising / falling
  },
  landing: {
    duration: 0.16,
    pose: {
      LegL1: { x: deg(-34) }, LegR1: { x: deg(-34) }, LegL2: { x: deg(58) }, LegR2: { x: deg(58) },
      ArmL1: { x: deg(-18), z: deg(20) }, ArmR1: { x: deg(-18), z: deg(-20) }, Spine1: { x: deg(14) },
    },
    bobY: -0.2,
  },
  transitions: { toLocomotion: 0.14, toAirborne: 0.12, toLanding: 0.06 }, // s to blend a pose change
}

export const FONT_FAMILY = 'Fredoka'

// --- Game server (../Car-vs-tape-backend, Colyseus room "world") -------------------
// Local dev talks to `npm start` in the backend; deployed builds ask Bloxity's matchmaker
// (bloxity.js resolveServerEndpoint). Without either, progress stays in this browser.
export const SERVER_URL = import.meta.env.DEV ? import.meta.env.VITE_SERVER_URL_DEV || 'ws://localhost:2567' : ''
export const NET = {
  saveEvery: 5, // s: progress is sent at most this often (and when the tab hides or closes)
  retry: 2, // s before the first reconnect; doubles after each failed resolve/join...
  retryMax: 30, // ...up to this
  rejoin: 1, // s before resolving again after the room closed
  poseHz: 5, // car pose updates per second (relayed to the roster, not drawn yet)
}

export function clamp(n, min, max) {
  return n < min ? min : n > max ? max : n
}

// Coerce one raw SDK string against its SETTINGS entry.
export function coerceSetting(key, raw) {
  const spec = SETTINGS[key]
  if (!spec) return raw
  const value = raw === '' || raw == null ? spec.def : raw
  if (spec.type === 'bool') return value === 'true' || value === true
  if (spec.type === 'enum') return spec.values.includes(value) ? value : spec.def
  const n = Number(value)
  return clamp(Number.isFinite(n) ? n : Number(spec.def), spec.min, spec.max)
}

// =============================================================================
// Car vs Tape: the game
// =============================================================================

// Arcade car handling (car.js). Speeds in m/s; each car scales topSpeed.
export const CAR = {
  radius: 0.95, // capsule radius of the car's collider
  length: 4.2, // capsule tip to tip
  accel: 26, // m/s^2 at standstill, fading toward top speed
  brake: 46,
  reverseSpeed: 11,
  coast: 7, // m/s^2 rolling drag with no pedal
  steerRate: 2.4, // rad/s at full lock
  steerSpeedRef: 7, // m/s below which steering fades out
  grip: 9, // 1/s lateral slip dies out (high = rails)
  driftGrip: 1.6, // with the handbrake held
  driftSteer: 1.6, // steering multiplier while drifting
  gravity: -26,
  bumpLoss: 0.45, // fraction of speed kept after a wall hit
  stepHeight: 0.5,
}

// Where the driver sits: carmodel.js cuts every car's cockpit to fit (m, in the car's frame).
export const DRIVER_SEAT = {
  sitHeight: 0.6, // seat cushion to the top of the seated driver's head
  clearance: 0.04, // between that head and the glass roof
  cushion: 0.12, // seat cushion above the cockpit floor
  back: 0.3, // seat back height: kept under the shoulders so the head shows from behind
  reach: 0.34, // from the hips forward to the steering wheel
  wheelHeight: 0.3, // steering wheel centre above the cushion
  wheelR: 0.14,
  wheelTurn: 3, // steering wheel turn per radian of front-wheel steer
}

// The driver (driver.js): the player's Bloxity avatar in the seat above, sized so the seated
// body (hip to crown + half a thigh) is DRIVER_SEAT.sitHeight. Angles in radians, character
// space (avatar/rig.js: +X swings a limb backward / pitches the spine forward, +Y turns to
// the character's left (+X), +Z rolls toward the character's right (-X)).
const dg = (d) => (d * Math.PI) / 180
export const DRIVER = {
  thigh: 0.15, // thigh thickness under the hip joint, as a fraction of the hip height
  inertia: 0.5, // s the "felt" speed lags the real one (pinned back pulling away, lurch braking)
  surge: 8, // m/s of surge (speed - felt) for the full lean
  lateral: 22, // m/s^2 of cornering for the full lean out of the turn
  idleAfter: 2.5, // s stopped before the idle fidgets (glances, finger drumming, looking at you)
  glance: { every: [2.5, 6], hold: [0.8, 1.8], yaw: dg(60) },
  lookAtCamera: 0.35, // chance a glance goes to the camera instead
  cheerFor: 1.6, // s of fist pumping when a tape snaps
  waveFor: 1.8, // s of waving for a new car / level / rebirth
  dizzyFor: 1.6, // s the head wobbles after a tape slingshots the car back
  honkFor: 0.45, // s of the punch on the wheel's centre (H / HORN)
  spring: { stiffness: 140, damping: 0.45 }, // head whiplash + seat bounce (damping < 1 overshoots)
  bumpKick: 0.05, // m the body drops on a wall hit at full force (springs back)
  vibrate: 0.004, // m engine buzz at top speed
  sway: { accel: dg(14), brake: dg(16), corner: dg(16), boost: dg(8), hunch: dg(16) },
  hands: { wheel: 0.55, slide: 0.3 }, // arm swing per unit of steer (raise/lower, sideways)
  pose: {
    sit: { Spine1: { x: dg(-6) }, LegL1: { x: dg(-82), z: dg(4) }, LegR1: { x: dg(-82), z: dg(-4) }, LegL2: { x: dg(62) }, LegR2: { x: dg(62) } },
    wheelL: { ArmL1: { x: dg(-62), z: dg(-14) }, ArmL2: { x: dg(-28) } }, // hands at ten to two
    wheelR: { ArmR1: { x: dg(-62), z: dg(14) }, ArmR2: { x: dg(-28) } },
    handbrake: { ArmL1: { x: dg(-22), z: dg(-22) }, ArmL2: { x: dg(-55) } }, // left hand yanks the lever by the console
    reverse: { ArmL1: { x: dg(-12), z: dg(78) }, ArmL2: { x: dg(-30) }, Spine2: { y: dg(22) } }, // arm over the passenger seat
    relaxL: { ArmL1: { x: dg(-150), z: dg(42) }, ArmL2: { x: dg(-125) } }, // Auto Drive: hands behind the head
    relaxR: { ArmR1: { x: dg(-150), z: dg(-42) }, ArmR2: { x: dg(-125) } },
    cheerL: { ArmL1: { x: dg(-100), z: dg(30) }, ArmL2: { x: dg(-95) } }, // fists up by the head (under the glass roof)
    cheerR: { ArmR1: { x: dg(-100), z: dg(-30) }, ArmR2: { x: dg(-95) } },
    wave: { ArmR1: { x: dg(-105), z: dg(-28) }, ArmR2: { x: dg(-65) } }, // the window hand, up by the face
    honk: { ArmR1: { x: dg(-74), z: dg(34) }, ArmR2: { x: dg(-8) } }, // the right hand on the horn (absolute, blended in)
  },
}

// Chase camera (carcam.js).
export const CAR_CAM = {
  fov: 66,
  speedFov: 14, // extra degrees at top speed
  distance: 11,
  minDistance: 6,
  maxDistance: 32,
  height: 1.3, // look-at point above the car
  pitch: 0.32, // high enough to look down through the glass roof at the driver
  minPitch: -0.1,
  maxPitch: 1.2,
  followYaw: 4.5, // 1/s the orbit swings back behind the car
  orbitHold: 1.4, // s after a drag before the camera recentres
  lookSensitivity: 0.0032,
  zoomStep: 1.2,
  // On spawn and on every new car: the camera starts low off the front corner on the
  // driver's side (yaw from behind; PI = straight ahead), close, looking into the cabin,
  // and sweeps round to the chase spot. Looking around cancels it.
  intro: { duration: 2.8, yaw: 2.2, distance: 4.8, pitch: 0.3, height: 0.9 },
  // Cockpit view (V / the VIEW button): from the driver's eyes.
  cockpit: { fov: 74, speedFov: 12, pitch: 0, forward: 0.09, maxYaw: 2.2, maxPitch: 0.9 },
}

// The tape track north of the gate (track.js). Tape i needs `power` to snap and pays `wins`.
export const TRACK = {
  startZ: -58, // first metre past the gate
  width: 18,
  spacing: 75, // m between tapes
  firstTapeZ: -105,
  tapes: [
    { power: 20, wins: 1 },
    { power: 100, wins: 2 },
    { power: 350, wins: 3 },
    { power: 1000, wins: 5 },
    { power: 3000, wins: 8 },
    { power: 9000, wins: 12 },
    { power: 25e3, wins: 18 },
    { power: 70e3, wins: 27 },
    { power: 200e3, wins: 40 },
    { power: 600e3, wins: 60 },
    { power: 1.8e6, wins: 90 },
    { power: 5e6, wins: 135 },
    { power: 15e6, wins: 200 },
    { power: 45e6, wins: 300 },
    { power: 140e6, wins: 450 },
    { power: 500e6, wins: 700 },
  ],
  tapeColors: ['#ffd400', '#ff3b3b', '#2f8cff', '#28d46a', '#b04dff', '#ff8a1c', '#19e0e0', '#ff4fb8'],
  stretchK: 30, // spring stiffness (1/s^2) of a tape the car is too weak for
  stun: 0.6, // s the pedals are dead after a bounce
}

// Economy (game.js).
export const ECONOMY = {
  basePower: 2, // power per second at full speed with every multiplier at 1
  speedRef: 18, // m/s that counts as "full speed" for training
  xpPerSecond: 6,
  xpPerTape: 25, // x (tape index + 1)
  levelNeed: (level) => Math.round(30 * Math.pow(level, 1.45)),
  levelBonus: 0.1, // +10% power per level above 1
  rebirthCost: (n) => Math.round(15 * Math.pow(3, n)), // wins
  rebirthBonus: 0.5, // +50% power per rebirth
  boost: { mult: 2, duration: 120 }, // rewarded ad at the chest: x2 power for 2 min
  saveEvery: 4, // s
}

// Treadmills on the east side (town.js). Holding the throttle on one trains at `mult`.
export const TREADMILLS = [
  { mult: 1, rebirths: 0, color: '#1b2238', accent: '#3fe6ff' },
  { mult: 2, rebirths: 1, color: '#e0a21c', accent: '#fff36a' },
  { mult: 4, rebirths: 2, color: '#2fc14a', accent: '#b6ff5a' },
  { mult: 8, rebirths: 3, color: '#4b2bd6', accent: '#d36bff' },
  { mult: 15, rebirths: 4, color: '#e02828', accent: '#ffb02e' },
  { mult: 40, rebirths: 5, color: '#f2f6ff', accent: '#5ff7ff' },
  { mult: 120, rebirths: 6, color: '#ff2fb4', accent: '#ffffff' },
]

// The showroom (west). type: hatch | coupe | super | hyper. mult = power multiplier, speed = top speed.
export const CARS = [
  { id: 'pebble', name: 'Pebble', type: 'hatch', color: '#1f3fd1', cost: 0, mult: 1, speed: 28 },
  { id: 'bubble', name: 'Bubble', type: 'hatch', color: '#ff7fc8', cost: 3, mult: 1.5, speed: 29 },
  { id: 'sprout', name: 'Sprout', type: 'coupe', color: '#ef2b2b', cost: 10, mult: 2.2, speed: 30 },
  { id: 'glacier', name: 'Glacier', type: 'coupe', color: '#7cd3ff', cost: 30, mult: 3.5, speed: 31 },
  { id: 'comet', name: 'Comet', type: 'super', color: '#f4f4f8', cost: 90, mult: 5.5, speed: 33 },
  { id: 'ember', name: 'Ember', type: 'super', color: '#ff6a00', cost: 250, mult: 9, speed: 34 },
  { id: 'viper', name: 'Viper', type: 'super', color: '#22d84a', cost: 700, mult: 15, speed: 35 },
  { id: 'sunstrike', name: 'Sunstrike', type: 'hyper', color: '#ffc81a', cost: 2000, mult: 26, speed: 37 },
  { id: 'redline', name: 'Redline X', type: 'hyper', color: '#e3101e', cost: 6000, mult: 45, speed: 39 },
  { id: 'frost', name: 'Frostbite', type: 'hyper', color: '#2a6bff', cost: 18000, mult: 80, speed: 41 },
  { id: 'onyx', name: 'Onyx', type: 'hyper', color: '#16161c', cost: 55000, mult: 150, speed: 43 },
  { id: 'nebula', name: 'Nebula', type: 'hyper', color: '#a43bff', cost: 160000, mult: 300, speed: 46 },
]

// House wall colours around the plaza.
export const HOUSE_COLORS = ['#ff2fa0', '#ffe31a', '#18c9ff', '#ff2222', '#2fd23a', '#ff8a12', '#b9a7ff', '#1e6bff', '#c63bff', '#f6f39a', '#8b8f9e']

// --- Boxity leaderboards (declared in bloxity.js, reported by the server: backend bloxity.ts BOARDS) ---
// Ids are permanent; they match the saved doc fields the backend ranks.
export const BOARDS = [
  { id: 'power', label: 'Power', format: 'compact', reset: 'none' },
  { id: 'wins', label: 'Wins', format: 'compact', reset: 'none' },
  { id: 'rebirths', label: 'Rebirths', format: 'number', reset: 'none' },
]
// Rewarded ad on the boost chest while it recharges: placement name (letters, digits, hyphens).
export const REWARDED = { placement: 'boost' }

// Free Boost chest (town.js, north plaza): a Bloxity-signed-in player opens it after an hour of play.
// The server counts the hour (backend playtime.ts: tab visible + connected, kept across sessions) and
// decides `needMs`; `minutes` is only what the client shows before the server answers. Reward: x2 power
// for `boost` s (stacks with any boost running) + a Wins bag worth `winsShare` of the next car's price
// (rebirth cost once every car is owned), at least `winsMin`.
export const PLAY_REWARD = { minutes: 60, boost: 15 * 60, winsShare: 0.3, winsMin: 5 }
