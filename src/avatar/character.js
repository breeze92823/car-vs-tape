// The game's own default character, built procedurally on the same bone
// names and bind positions as the shared Bloxity base rig
// (static.bloxity.io/avatars/player.glb), so avatar/animator.js's
// generated walk cycle (ArmL1/ArmR1/LegL1/LegR1/Spine1) drives it unchanged,
// and it scales by the same RIG_HEIGHT. Pattern (rig + part sizing) ported
// from Age-every-click's systems/defaultCharacter.js, trimmed to this game's
// one look (blue outfit, brown hair).
//
// Each part is a rigid box parented straight to its bone rather than a
// skinned mesh: every part of the base rig is weighted to a single bone
// anyway, so rigid attachment deforms identically and needs no skinning.
// Bones keep identity rotations (the real rig's twisted limb frames only
// matter for its skin weights), so a parent-space X swing is still the
// forward/back flexion axis, as animator.js assumes.
import { Bone, BoxGeometry, CylinderGeometry, Group, Mesh, MeshStandardMaterial } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { CHARACTER_COLORS, MATERIAL_PBR, PLAYER_DIMS, RIG_HEIGHT } from '../config.js'

const { skin: SKIN, suit: SUIT, hair: HAIR } = CHARACTER_COLORS

// Part sizes in rig units (RIG_HEIGHT-tall space). The Y (height) of each
// part is dictated by the shared rig's fixed bind-pose bone gaps, copied
// from Age-every-click's systems/defaultCharacter.js (itself read from
// player.glb's mesh bounds): torso spans the 2.4-unit gap between the hip
// (Spine1) and the shoulder/neck pivot (Spine2 + 0.6), arms and legs each
// span another 2.4 units down from their pivot. Getting this wrong — as an
// earlier version of this file did by shrinking all three axes together —
// leaves the torso short of the shoulder pivot, so the arms hang from empty
// space instead of the body. X/Z (width/depth) stay this game's own slimmer
// build.
const TORSO = [1.35, 2.4, 0.68]
const ARM = [0.64, 2.4, 0.64]
const LEG = [0.66, 2.4, 0.68]
const HEAD_R = 0.8

const cache = {}
function cached(key, make) {
  return cache[key] || (cache[key] = make())
}

const mat = (opts) => new MeshStandardMaterial({ ...MATERIAL_PBR.PLAYER, ...opts })

function part(geo, material, x, y, z) {
  const m = new Mesh(geo, material)
  m.position.set(x, y, z)
  m.castShadow = true
  m.receiveShadow = true
  return m
}

function bone(name, parent, x, y, z) {
  const b = new Bone()
  b.name = name
  b.position.set(x, y, z)
  parent.add(b)
  return b
}

// The bare skeleton, bind positions copied from player.glb (parent-relative,
// identical to Age-every-click's buildRig()).
function buildRig(root) {
  const rig = bone('Rig1', root, 0, 0, 0)
  const spine1 = bone('Spine1', rig, 0, 2.4, 0)
  const spine2 = bone('Spine2', spine1, 0, 1.8, 0)
  const armR1 = bone('ArmR1', bone('ArmR_Offset', spine2, -2, 0.6, 0.4), 0, 0, 0)
  const armL1 = bone('ArmL1', bone('ArmL_Offset', spine2, 2, 0.6, 0.4), 0, 0, 0)
  const neck1 = bone('Neck1', bone('Neck_Offset', spine2, 0, 0.6, 0), 0, 0, 0)
  const legR1 = bone('LegR1', bone('LegR_Offset', rig, -0.6, 2.4, 0), 0, 0, 0)
  const legL1 = bone('LegL1', bone('LegL_Offset', rig, 0.6, 2.4, 0), 0, 0, 0)
  return { spine1, neck1, arms: [armR1, armL1], legs: [legR1, legL1] }
}

// Anchors in each bone's local space (arms/legs hang down from their pivot,
// torso grows up from Spine1, head sits on Neck1).
const TORSO_Y = TORSO[1] / 2
const ARM_Y = -ARM[1] / 2
// The shoulder pivot (ArmR_Offset/ArmL_Offset) sits 0.4 units forward of the
// spine, so the arm mesh needs the same backward offset to hang centred
// under the torso instead of out in front of it.
const ARM_Z = -0.4
const LEG_Y = -LEG[1] / 2
const HEAD_Y = HEAD_R

function dress(bones) {
  const geo = cached('geo', () => ({
    torso: new BoxGeometry(...TORSO),
    arm: new BoxGeometry(...ARM),
    leg: new BoxGeometry(...LEG),
    head: new CylinderGeometry(HEAD_R, HEAD_R, HEAD_R * 1.77, 20),
    hairTop: new BoxGeometry(HEAD_R * 2.23, HEAD_R * 0.77, HEAD_R * 2),
    hairBack: new BoxGeometry(HEAD_R * 2.15, HEAD_R * 1.38, HEAD_R * 1.3),
  }))
  const m = cached('mat', () => ({
    suit: mat({ color: SUIT }),
    skin: mat({ color: SKIN }),
    hair: mat({ color: HAIR }),
  }))

  bones.spine1.add(part(geo.torso, m.suit, 0, TORSO_Y, 0))
  for (const arm of bones.arms) {
    const mesh = part(geo.arm, m.suit, 0, ARM_Y, ARM_Z)
    mesh.name = arm.name === 'ArmL1' ? 'default_arm_L' : 'default_arm_R' // same names as the real rig, so themes can re-skin arms
    arm.add(mesh)
  }
  for (const leg of bones.legs) leg.add(part(geo.leg, m.suit, 0, LEG_Y, 0))

  bones.neck1.add(part(geo.head, m.skin, 0, HEAD_Y, 0))
  bones.neck1.add(part(geo.hairTop, m.hair, 0, HEAD_Y * 1.7, -0.04))
  bones.neck1.add(part(geo.hairBack, m.hair, 0, HEAD_Y * 1.15, -0.28))
}

// Returns a Group shaped like a loaded avatar's result: `nodes` (name ->
// node) and `animations` (none — animator.js falls back to its generated
// gait) stashed on the root, already scaled from rig units to game metres.
export function buildDefaultCharacter() {
  const root = new Group()
  root.name = 'character'
  const bones = buildRig(root)
  dress(bones)

  root.animations = []
  root.nodes = {}
  root.traverse((o) => {
    if (o.name) root.nodes[o.name] = o
  })
  root.scale.setScalar(PLAYER_DIMS.height / RIG_HEIGHT)
  return root
}

// The shared Bloxity default character, bundled in public/avatars/player.glb
// so it never depends on the CDN. Same return shape as buildDefaultCharacter().
// Falls back to the procedural character if the file fails to load.
let basePromise = null
export async function loadBaseCharacter() {
  try {
    basePromise ||= new GLTFLoader().loadAsync(`${import.meta.env.BASE_URL}avatars/player.glb`)
    const gltf = await basePromise
    const root = cloneSkeleton(gltf.scene)
    root.name = 'character'
    root.traverse((o) => {
      if (o.isMesh || o.isSkinnedMesh) {
        o.castShadow = true
        o.frustumCulled = false
      }
    })
    root.animations = gltf.animations || []
    root.nodes = {}
    root.traverse((o) => {
      if (o.name) root.nodes[o.name] = o
    })
    root.scale.setScalar(PLAYER_DIMS.height / RIG_HEIGHT)
    return root
  } catch (err) {
    basePromise = null
    console.warn('[defaultCharacter] player.glb failed to load, using procedural character', err)
    return buildDefaultCharacter()
  }
}
