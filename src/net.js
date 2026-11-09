// Colyseus link to ../Car-vs-tape-backend (room "world"). Signed-in players' progress lives on the
// server: on join it answers `progress` (the saved doc -> game.hydrate), `noProgress` (new account,
// guest or no database: keep the current state and save it) or `serverError` (the save could not
// be read: never overwrite it). From then on game.snapshot() is sent as `saveProgress` when it
// changed, at most every NET.saveEvery s and when the tab hides. It also feeds the plaza
// leaderboards (`leaderboard`) and relays this car's pose / loadout.
// Nothing is kept in the browser: guests (and play without a reachable server) keep progress for the page only.
// Never throws and never blocks play.
import { Client } from '@colyseus/sdk'
import { DEV_MODE, GAME_SLUG, NET, SERVER_URL } from './config.js'
import { authState, canResolveServer, getEquippedAvatar, getPfp, getProportions, getSkinTextureUrl, launchRoomId, locateRoom, reportPlayer, resolveServerEndpoint, subscribeAuth, updateRoom } from './bloxity.js'
import { car } from './car.js'
import * as game from './game.js'

export const net = { room: null, connected: false, hydrated: false, boards: null }

// --- Identity ---------------------------------------------------------------------
function storedId(key, make) {
  try {
    let id = localStorage.getItem(key)
    if (!id) localStorage.setItem(key, (id = make()))
    return id
  } catch {
    return make()
  }
}
const rand = () => Math.random().toString(36).slice(2, 8)
const GUEST = storedId(`${GAME_SLUG}.guest`, () => `guest-${rand()}`)
const DEV = DEV_MODE ? storedId(`${GAME_SLUG}.dev`, () => `dev-${rand()}`) : ''

function identity() {
  if (DEV) return { userId: DEV, username: `Dev ${DEV.slice(4)}` }
  const u = authState.user
  const id = u && (u._id || u.id || u.userId || u.uid)
  if (!id) return { userId: GUEST, username: authState.guest?.displayName || authState.guest?.username || 'Guest' }
  return { userId: String(id), username: String(u.displayName || u.username || u.name || 'Player') }
}
const isGuestId = (id) => id.startsWith('guest-')
export const hasServer = () => !!(SERVER_URL || canResolveServer())

// --- Saving -----------------------------------------------------------------------
let lastSaved = ''
let sentId = ''
let loadedId = ''

function send(type, payload) {
  try {
    net.room?.send(type, payload)
  } catch (err) {
    console.warn('[net] send failed', type, err)
  }
}
function serverSave() {
  if (!net.connected || !net.hydrated || isGuestId(sentId)) return
  const { lastSeen, ...rest } = game.snapshot()
  const snap = JSON.stringify(rest) // lastSeen would make every snapshot differ
  if (snap === lastSaved) return
  lastSaved = snap
  send('saveProgress', { ...rest, lastSeen })
}
// Saves where the current identity's progress lives. Nothing until auth has settled.
export function saveNow() {
  if (hasServer() && !authState.ready) return
  serverSave()
}

// --- Presence (relayed through the roster, drawn by remotes.js) ----------------------
// Bits of the pose `flags` (backend WorldState): what the car is doing, for the others' lights, smoke and driver.
export const POSE_FLAGS = { braking: 1, drifting: 2, handbrake: 4, pad: 8, boosted: 16, stunned: 32, rocket: 64, flying: 128 }
// main.js hands over the local rocket (Shift boost / FLY) so the others can draw its flames and smoke.
const rocketState = { burning: false, flying: false }
export const setRocketSource = (r) => Object.defineProperties(rocketState, { burning: { get: () => r.burning }, flying: { get: () => r.flying } })
let sentPose = ''
let sentLoadout = ''
let sentAvatar = ''
function sendPose() {
  if (!net.connected) return
  const r = (n) => Math.round(n * 100) / 100
  const p = car.position
  const flags =
    (car.braking ? POSE_FLAGS.braking : 0) |
    (car.drifting ? POSE_FLAGS.drifting : 0) |
    (car.handbrake ? POSE_FLAGS.handbrake : 0) |
    (car.pad ? POSE_FLAGS.pad : 0) |
    (game.boostLeft() > 0 ? POSE_FLAGS.boosted : 0) |
    (car.stun > 0 ? POSE_FLAGS.stunned : 0) |
    (rocketState.burning ? POSE_FLAGS.rocket : 0) |
    (rocketState.flying ? POSE_FLAGS.flying : 0)
  const key = JSON.stringify({ x: r(p.x), y: r(p.y), z: r(p.z), yaw: r(car.yaw), speed: r(car.wheelSpeed), steer: r(car.steer), thr: r(car.throttle), flags })
  if (key !== sentPose) send('pose', JSON.parse((sentPose = key)))
}
// The Bloxity avatar this player wears (equipped items, proportions, composed skin): the others dress the
// same avatar in their copy of this car's seat.
function avatarPayload() {
  return { equipped: getEquippedAvatar(), proportions: getProportions(), skin: getSkinTextureUrl() || '' }
}
function sendAvatar() {
  if (!net.connected) return
  const payload = avatarPayload()
  const key = JSON.stringify(payload)
  if (key !== sentAvatar) send('avatar', JSON.parse((sentAvatar = key)))
}
// The driver's gesture, for the others' copy: 1 cheer, 2 wave, 3 honk.
export function sendEmote(kind) {
  if (net.connected) send('emote', { kind })
}
game.on('wins', (n) => n > 0 && sendEmote(1))
for (const ev of ['car', 'levelup', 'rebirth']) game.on(ev, () => sendEmote(2))
// The other players: { has, forEach((state, sessionId)), self } over the server's roster, or null offline.
export function roster() {
  const players = net.connected ? net.room?.state?.players : null
  if (!players?.forEach) return null
  return { has: (id) => players.has(id), forEach: (fn) => players.forEach(fn), self: net.room.sessionId }
}
function sendLoadout() {
  if (!net.connected) return
  const key = JSON.stringify({ car: game.state.car, level: game.state.level })
  if (key !== sentLoadout) send('loadout', JSON.parse((sentLoadout = key)))
}

// --- Rewarded ad check ----------------------------------------------------------
// The server has Boxity verify the single-use token before the reward is granted. Without a
// configured server there is nobody to ask: the client's 'completed' is all there is.
let adWaiting = null
export function verifyAdReward(rewardToken) {
  if (!hasServer()) return Promise.resolve(true)
  if (!net.connected || !rewardToken) return Promise.resolve(false)
  return new Promise((resolve) => {
    adWaiting?.(false)
    const timer = setTimeout(() => adWaiting?.(false), 8000)
    adWaiting = (ok) => {
      clearTimeout(timer)
      adWaiting = null
      resolve(ok)
    }
    send('adReward', { rewardToken })
  })
}

// --- Free Boost chest -------------------------------------------------------------
// The server counts the hour of play and decides the claim (backend playtime.ts); this side shows
// the countdown (game.chest) and pays out on ok. Resolves { ok, reason? } and never rejects:
// reason 'offline' (no server / not connected), 'signin' (guest), 'loading', 'early'.
let chestWaiting = null
export function claimChest() {
  if (!net.connected) return Promise.resolve({ ok: false, reason: 'offline' })
  return new Promise((resolve) => {
    chestWaiting?.({ ok: false, reason: 'offline' })
    const timer = setTimeout(() => chestWaiting?.({ ok: false, reason: 'offline' }), 8000)
    chestWaiting = (r) => {
      clearTimeout(timer)
      chestWaiting = null
      resolve(r)
    }
    send('claimChest', {})
  })
}
// The Free Car podium: same server clock rules. id = game.giftCar().id. Resolves { ok, reason? }:
// reason as claimChest, plus 'owned' (that car was already gifted) and 'bad'.
let carWaiting = null
export function claimCar(id) {
  if (!net.connected) return Promise.resolve({ ok: false, reason: 'offline' })
  return new Promise((resolve) => {
    carWaiting?.({ ok: false, reason: 'offline' })
    const timer = setTimeout(() => carWaiting?.({ ok: false, reason: 'offline' }), 8000)
    carWaiting = (r) => {
      clearTimeout(timer)
      carWaiting = null
      resolve(r)
    }
    send('claimCar', { car: id })
  })
}
// The reward clocks only run while the game is on screen.
const playing = () => !document.hidden
function sendPlayActive() {
  if (!net.connected) return
  send('playActive', { active: playing() })
  game.setChest(null, playing())
}

// --- Connection -------------------------------------------------------------------
let onLeaderboard = () => {}
let known = null // sessionIds already announced to Boxity's join toasts
function attach(room) {
  known = null
  net.room = room
  net.connected = true
  room.onMessage('progress', (doc) => {
    net.hydrated = true
    lastSaved = ''
    // A reconnect under the same identity: this tab is newer than the save, so push it instead.
    if (loadedId === sentId || !doc) return saveNow()
    loadedId = sentId
    game.hydrate(doc)
    saveNow()
  })
  room.onMessage('noProgress', () => {
    net.hydrated = true
    loadedId = sentId
    lastSaved = ''
    saveNow()
  })
  room.onMessage('serverError', () => {
    net.hydrated = false
    console.warn('[net] server could not read the saved progress; saving is off for this session')
  })
  room.onMessage('adRewardResult', (r) => adWaiting?.(r?.ok === true))
  room.onMessage('playtime', (s) => game.setChest(s, s?.active === true))
  room.onMessage('chestResult', (r) => {
    game.setChest(r, r?.active === true)
    chestWaiting?.({ ok: r?.ok === true, reason: typeof r?.reason === 'string' ? r.reason : '' })
  })
  room.onMessage('carResult', (r) => {
    game.setChest(r, r?.active === true)
    carWaiting?.({ ok: r?.ok === true, reason: typeof r?.reason === 'string' ? r.reason : '' })
  })
  room.onMessage('leaderboard', (data) => {
    net.boards = data
    onLeaderboard(data)
  })
  room.onLeave(() => {
    if (net.room !== room) return
    net.room = null
    net.connected = false
    net.hydrated = false
    game.setChest(null, false) // frozen until the server answers again
    updateRoom('')
    setTimeout(connect, NET.rejoin * 1000)
  })
}

// ?roomId= the page was opened with (a friend's invite, or the game page's Open Rooms Join): join
// that room, else matchmake normally.
let launchRoom = launchRoomId()
async function joinLaunchRoom(options) {
  const id = launchRoom
  launchRoom = ''
  if (!id) return null
  try {
    if (SERVER_URL) return { room: await new Client(SERVER_URL).joinById(id.split('~').pop(), options), relay: '' }
    const at = await locateRoom(id)
    if (at) return { room: await new Client(at.endpoint).joinById(at.roomId, options), relay: at.relayRoomId }
  } catch (err) {
    console.info('[net] the invited room is gone or full; matchmaking instead', err?.message ?? err)
  }
  return null
}

async function joinAnyRoom(options) {
  if (SERVER_URL) return { room: await new Client(SERVER_URL).joinOrCreate('world', options), relay: '' }
  const { endpoint, relayRoomId } = await resolveServerEndpoint(/^(guest|dev)-/.test(options.userId) ? undefined : options.userId)
  return { room: await new Client(endpoint).joinOrCreate('world', options), relay: relayRoomId }
}

let connecting = false
let retryIn = NET.retry
async function connect() {
  if (!hasServer() || connecting || net.connected) return
  connecting = true
  try {
    const id = identity()
    sentId = id.userId
    sentPose = ''
    sentLoadout = JSON.stringify({ car: game.state.car, level: game.state.level })
    const avatar = avatarPayload()
    sentAvatar = JSON.stringify(avatar)
    const options = { ...id, pfp: getPfp(), loadout: JSON.parse(sentLoadout), avatar }
    const { room, relay } = (await joinLaunchRoom(options)) ?? (await joinAnyRoom(options))
    retryIn = NET.retry
    attach(room)
    if (!playing()) sendPlayActive()
    // Friends' invites and the game page's Open Rooms land in this room.
    updateRoom(relay ? `${relay}~${room.roomId}` : room.roomId)
  } catch (err) {
    console.info(`[net] could not reach the server (retrying in ${retryIn}s); progress will not be saved until it connects`, err?.message ?? err)
    setTimeout(connect, retryIn * 1000)
    retryIn = Math.min(retryIn * 2, NET.retryMax)
  } finally {
    connecting = false
  }
}

// Boxity's "X joined you" toasts (friends only): the roster's first look is who was already here.
function announcePlayers() {
  const players = net.connected ? net.room?.state?.players : null
  if (!players) return
  const first = known === null
  known ??= new Set()
  players.forEach?.((p, id) => {
    if (id === net.room.sessionId || known.has(id)) return
    known.add(id)
    reportPlayer(p.username, first)
  })
}

setInterval(() => {

  sendLoadout()
  if (!document.hidden) saveNow()
}, NET.saveEvery * 1000)
setInterval(sendPose, 1000 / NET.poseHz)
setInterval(sendAvatar, 1000)
setInterval(announcePlayers, 1000)

// setLeaderboard(data): town.js's boards, { boards: { power|wins|rebirths: [{ name, value }] }, ranks }.
export function initNet({ setLeaderboard } = {}) {
  if (setLeaderboard) onLeaderboard = setLeaderboard
  game.setPersist(saveNow)
  window.addEventListener('pagehide', saveNow)
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) saveNow()
    sendPlayActive()
  })
  if (!hasServer()) return console.info('[net] no server configured; progress is kept in this browser')
  subscribeAuth((s) => {
    if (!s.ready) return
    if (!net.connected) return void connect()
    const id = identity()
    if (id.userId === sentId) return send('identify', { username: id.username, pfp: getPfp() })
    // Save under the OLD identity before switching (auth has already moved on).
    serverSave()
    net.hydrated = false
    game.forgetChest() // the new identity's count comes with its load
    // Signed out: a fresh guest (the account's progress stays on the server).
    if (isGuestId(id.userId)) game.reset()
    sentId = id.userId
    send('identify', { ...id, pfp: getPfp() })
  })
}
