# Boxity code metadata

canDie: false
hasScore: true

## Leaderboards
Boards `power`, `wins`, `rebirths` are declared in `src/bloxity.js` (`BOARDS` in `src/config.js`) and
reported by the game server from saved progress (`Car-vs-tape-backend/src/bloxity.ts`).

## Screens
`gameplay` (driving the plaza and track) and `panel` (the Car Shop, Rebirth and Sound windows). There is
no title menu, lobby or results screen.

## notApplicable
- deathScreen: the car cannot die; a fall or a tape slingshot only moves it (`canDie: false`).
- emotes: the player is a car, there is no character to play an emote on.
- gems: the game sells nothing for Gems (Gems are intentionally not integrated).
- chat bubbles over other players: other cars are not drawn yet; the local car shows its own bubble.
