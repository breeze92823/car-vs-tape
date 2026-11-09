// Game state and rules: power, wins, level/XP, rebirths, owned cars, the x2
// boost, the Free Boost chest, and the best tape reached. Saved on the game server only (net.js); no browser save.
// Every change goes through here and is broadcast with emit(event, data) so
// the HUD, world and audio react without knowing about each other.
import { CARS, ECONOMY, PLAY_REWARD, TRACK, TREADMILLS } from './config.js'

export const state = {
  power: 0,
  wins: 0,
  level: 1,
  xp: 0,
  rebirths: 0,
  owned: ['pebble'],
  car: 'pebble',
  bestTape: -1, // highest tape index ever snapped
  boostUntil: 0, // ms timestamp
  autoDrive: false,
  totalWins: 0,
}

const listeners = new Map()
export function on(event, fn) {
  if (!listeners.has(event)) listeners.set(event, new Set())
  listeners.get(event).add(fn)
  return () => listeners.get(event).delete(fn)
}
export function emit(event, data) {
  for (const fn of listeners.get(event) ?? []) {
    try {
      fn(data)
    } catch (err) {
      console.warn(`[game] ${event} listener threw`, err)
    }
  }
}

// Copies a saved doc (the server's `progress`) into the state, keeping only
// well-typed known fields.
export function hydrate(s) {
  if (!s || typeof s !== 'object') return
  for (const k of Object.keys(state)) if (k in s && typeof s[k] === typeof state[k]) state[k] = s[k]
  if (Array.isArray(s.owned)) state.owned = s.owned.filter((id) => typeof id === 'string')
  state.owned = state.owned.filter((id) => CARS.some((c) => c.id === id))
  if (!state.owned.includes('pebble')) state.owned.unshift('pebble')
  if (!state.owned.includes(state.car)) state.car = 'pebble'
  emit('hydrate')
  emit('car', state.car)
  emit('wins', 0)
}

// What is saved: the server's `saveProgress` payload (Car-vs-tape-backend sanitize.ts) and the
// state share this shape.
export function snapshot() {
  return { ...state, owned: [...state.owned], lastSeen: Date.now() }
}

// Back to a brand-new player (signing out: the account's progress stays on the server).
const defaults = JSON.stringify(state)
export function reset() {
  hydrate(JSON.parse(defaults))
}

let dirty = false
let persist = () => {} // net.js sets this: progress lives on the server only, nothing is kept in the browser
export const setPersist = (fn) => (persist = fn)
export function save() {
  dirty = false
  persist()
}

// --- Derived values ----------------------------------------------------------
export const carDef = (id = state.car) => CARS.find((c) => c.id === id) ?? CARS[0]
export const levelNeed = () => ECONOMY.levelNeed(state.level)
export const boostLeft = () => Math.max(0, (state.boostUntil - Date.now()) / 1000)
export const rebirthCost = () => ECONOMY.rebirthCost(state.rebirths)
export const rebirthMult = (n = state.rebirths) => 1 + ECONOMY.rebirthBonus * n
export const levelMult = () => 1 + ECONOMY.levelBonus * (state.level - 1)
export const treadmillUnlocked = (i) => state.rebirths >= TREADMILLS[i].rebirths
export function powerMult(padMult = 1) {
  return carDef().mult * padMult * rebirthMult() * levelMult() * (boostLeft() > 0 ? ECONOMY.boost.mult : 1)
}
export const nextTape = () => Math.min(state.bestTape + 1, TRACK.tapes.length - 1)

// --- Actions -------------------------------------------------------------------
// Power comes in fixed ticks (like the "+1" popups): a tick lands every POWER_TICK
// seconds of full-speed driving and pays basePower x every multiplier, so with no
// car / rebirth / level / treadmill bonus it is always +1.
const POWER_TICK = 1
let tickT = 0
// Called every frame while the car is driving/training. speed: m/s of the wheels.
export function train(dt, speed, padMult) {
  const k = Math.min(1, Math.abs(speed) / ECONOMY.speedRef)
  if (k < 0.05) return 0
  const perSec = ECONOMY.basePower * powerMult(padMult)
  tickT += k * dt
  if (tickT >= POWER_TICK) {
    tickT -= POWER_TICK
    const whole = Math.max(1, Math.round(perSec * POWER_TICK))
    state.power += whole
    emit('power', whole)
  }
  addXp(ECONOMY.xpPerSecond * k * Math.sqrt(padMult) * dt)
  dirty = true
  return perSec * k
}

export function addXp(x) {
  state.xp += x
  let ups = 0
  while (state.xp >= levelNeed()) {
    state.xp -= levelNeed()
    state.level++
    ups++
  }
  if (ups) emit('levelup', state.level)
}

export function tapeSnapped(i) {
  const w = TRACK.tapes[i].wins
  state.wins += w
  state.totalWins += w
  if (i > state.bestTape) state.bestTape = i
  addXp(ECONOMY.xpPerTape * (i + 1))
  emit('wins', w)
  dirty = true
  return w
}

export function buyCar(id) {
  const def = carDef(id)
  if (state.owned.includes(id)) {
    state.car = id
    emit('car', id)
    save()
    return 'equipped'
  }
  if (state.wins < def.cost) return 'poor'
  state.wins -= def.cost
  state.owned.push(id)
  state.car = id
  emit('wins', 0)
  emit('car', id)
  save()
  return 'bought'
}

export function rebirth() {
  if (state.wins < rebirthCost()) return false
  state.wins -= rebirthCost()
  state.rebirths++
  state.power = 0
  emit('rebirth', state.rebirths)
  emit('wins', 0)
  save()
  return true
}

// x2 power for `seconds` more (stacks on a running boost): the rewarded ad and the chest.
export function addBoost(seconds) {
  state.boostUntil = Math.max(state.boostUntil, Date.now()) + seconds * 1000
  emit('boost', seconds)
  save()
}

// --- Free Boost chest ------------------------------------------------------------
// Progress toward the next chest, as the server last reported it (net.js `playtime` / `chestResult`):
// not part of the save, the server keeps it. `running` = the server's clock is counting (connected,
// tab visible), so the client extrapolates from `at`. known = false until the server has answered.
export const chest = { known: false, signedIn: false, playMs: 0, needMs: PLAY_REWARD.minutes * 60000, claims: 0, at: 0, running: false }

export function setChest(s, running) {
  if (s && typeof s === 'object') {
    chest.known = true
    chest.signedIn = s.signedIn === true
    if (Number.isFinite(s.playMs)) chest.playMs = Math.max(0, s.playMs)
    if (Number.isFinite(s.needMs) && s.needMs > 0) chest.needMs = s.needMs
    if (Number.isFinite(s.claims)) chest.claims = s.claims
  } else if (chest.known) chest.playMs = chestPlayMs() // freeze where it got to
  chest.at = Date.now()
  chest.running = !!running && chest.signedIn
}
export function forgetChest() {
  setChest(null, false)
  chest.known = false
}
const chestPlayMs = () => Math.min(chest.needMs, chest.playMs + (chest.running ? Date.now() - chest.at : 0))
// Seconds of play left before the chest opens (0 = ready); -1 while it can't open (unknown, guest).
export const chestLeft = () => (chest.known && chest.signedIn ? Math.max(0, (chest.needMs - chestPlayMs()) / 1000) : -1)
export const chestProgress = () => (chest.known && chest.signedIn ? chestPlayMs() / chest.needMs : 0)

// What the chest pays right now: a Wins bag sized to the next goal (the cheapest car not owned,
// else the next rebirth) so it always moves the player forward, plus the long boost.
export function chestReward() {
  const next = CARS.find((c) => !state.owned.includes(c.id))
  const goal = next ? next.cost : rebirthCost()
  return { wins: Math.max(PLAY_REWARD.winsMin, Math.round(goal * PLAY_REWARD.winsShare)), boost: PLAY_REWARD.boost }
}
// The server said ok (net.js claimChest): pay out.
export function openChest() {
  const r = chestReward()
  state.wins += r.wins
  state.totalWins += r.wins
  emit('wins', r.wins)
  addBoost(r.boost)
  emit('chest', r)
  return r
}

export function setAutoDrive(on) {
  state.autoDrive = on
  emit('auto', on)
  dirty = true
}

let saveTimer = 0
export function tick(dt) {
  saveTimer += dt
  if (dirty && saveTimer > ECONOMY.saveEvery) {
    saveTimer = 0
    save()
  }
}

// 1234 -> "1.23K", 1.5e9 -> "1.50B".
const SUFFIX = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi']
export function fmt(n, digits = 2) {
  n = Math.floor(n)
  if (n < 1000) return String(n)
  let i = 0
  let v = n
  while (v >= 1000 && i < SUFFIX.length - 1) {
    v /= 1000
    i++
  }
  const d = v >= 100 ? 0 : v >= 10 ? 1 : digits
  return v.toFixed(d) + SUFFIX[i]
}
