// Dresses the game's Bloxity base rig (avatar/character.js) with a
// signed-in player's equipped cosmetics: skin texture, replaced body parts
// (head/torso/arms/legs) and hat/back .obj items from the avatar CDN. Any
// slot that 404s or fails to parse is skipped, leaving the rig's own default
// mesh in place. Framework-free (no React) so it can be reused outside
// a framework.
//
// Same rule as bloxity.js: nothing here may throw outward. A blocked
// CDN or a failed slot is logged and skipped. Approach ported from
// Ice-Skate's systems/avatarModel.js, which targets the same base rig.
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import {
  Color,
  FrontSide,
  MeshStandardMaterial,
  NearestFilter,
  NearestMipmapLinearFilter,
  SRGBColorSpace,
  TextureLoader,
} from 'three'
import { MATERIAL_PBR, PLAYER_DIMS, PROPORTIONS, RIG, RIG_HEIGHT, clamp } from '../config.js'
import { AVATAR_SLOTS, assetUrl, composedSkinUrl, describeItem, isEquipped, itemUrls, partUrl, skinUrl } from './cdn.js'

const HAT_LIFT = 0.8

const gltfLoader = new GLTFLoader()
const objLoader = new OBJLoader()
const textureLoader = new TextureLoader()

// The bundled player.glb shares one material between every clone of the base
// rig, so painting a skin onto it would leak onto every other character.
// Give this instance its own copies first; meshes that shared a material
// keep sharing one (the rig's six body meshes all use a single `char`).
function ownMaterials(root) {
  const converted = new Map()
  root.traverse((o) => {
    if (!o.isMesh && !o.isSkinnedMesh) return
    const source = Array.isArray(o.material) ? o.material[0] : o.material
    if (!source) return
    let own = converted.get(source.uuid)
    if (!own) {
      own = new MeshStandardMaterial({
        map: source.map || null,
        color: source.color ? source.color.clone() : new Color(0xffffff),
        side: source.side ?? FrontSide,
        transparent: !!source.transparent,
        alphaTest: source.alphaTest || 0,
        roughness: source.roughness ?? MATERIAL_PBR.PLAYER.roughness,
        metalness: source.metalness ?? MATERIAL_PBR.PLAYER.metalness,
        normalMap: source.normalMap || null,
        roughnessMap: source.roughnessMap || null,
        metalnessMap: source.metalnessMap || null,
      })
      converted.set(source.uuid, own)
    }
    o.material = own
  })
}

// Skins are pixel art and glTF UVs are not flipped, so a plain PNG has to
// match the base rig's convention explicitly.
function configureSkinTexture(texture) {
  texture.flipY = false
  texture.colorSpace = SRGBColorSpace
  texture.magFilter = NearestFilter
  texture.minFilter = NearestMipmapLinearFilter
  texture.anisotropy = 1
  return texture
}

function configureItemTexture(texture) {
  texture.colorSpace = SRGBColorSpace
  texture.magFilter = NearestFilter
  texture.minFilter = NearestMipmapLinearFilter
  texture.anisotropy = 1
  return texture
}

// With no skin equipped the portal still dresses the body in its default skin
// (skins/0.png), so do the same rather than keeping the rig's embedded map.
async function applySkin(root, equipped, skinTextureUrl) {
  const id = equipped.skinId
  const wanted = isEquipped(id)
  let plain = skinUrl(wanted ? id : 0)
  if (wanted) {
    const item = await describeItem(id)
    plain = assetUrl(item?.assetPaths?.texture) || plain
  }
  // The portal's composed skin (face/shirt/pants drawn on) first, then the bare one.
  const candidates = [skinTextureUrl || composedSkinUrl(equipped), plain].filter(Boolean)
  let texture = null
  for (const url of candidates) {
    try {
      texture = configureSkinTexture(await textureLoader.loadAsync(url))
      break
    } catch {
      // try the next candidate
    }
  }
  if (!texture) return // keep the rig's embedded texture
  root.traverse((o) => {
    if (o.isSkinnedMesh && o.material) {
      o.material.map = texture
      o.material.needsUpdate = true
    }
  })
}

// The base rig ships six SkinnedMeshes (default_head, default_torso,
// default_arm_L/R, default_leg_L/R) bound to one shared skeleton. Equipping a
// part swaps *that mesh's geometry* in place, keeping its skeleton binding
// and its (skin-painted) material — the part GLB's own material is dropped.
// The part's skinIndex values are remapped bone-name-by-bone-name into the
// base skeleton's order first, since its own export order usually differs.
async function applyPart(root, slot, id) {
  const item = await describeItem(id)
  const pathKey = slot.side ? `mesh${slot.side}` : 'mesh'
  const url = assetUrl(item?.assetPaths?.[pathKey]) || partUrl(slot, id)
  let gltf
  try {
    gltf = await gltfLoader.loadAsync(url)
  } catch {
    return // slot unavailable: the default_* mesh stays visible
  }
  const target = root.nodes[slot.replaces]
  if (!target || !target.isSkinnedMesh) return

  let skinnedSource = null
  let plainSource = null
  gltf.scene.traverse((o) => {
    if (o.isSkinnedMesh && !skinnedSource) skinnedSource = o
    else if (o.isMesh && !plainSource) plainSource = o
  })
  if (!skinnedSource && !plainSource) return

  if (!skinnedSource) {
    target.geometry = plainSource.geometry
    return
  }

  const geometry = skinnedSource.geometry.clone()
  if (skinnedSource.skeleton) {
    const baseIndexByName = new Map()
    target.skeleton.bones.forEach((bone, i) => baseIndexByName.set(bone.name, i))
    const remap = new Map()
    skinnedSource.skeleton.bones.forEach((bone, i) => {
      const baseIndex = baseIndexByName.get(bone.name)
      if (baseIndex !== undefined) remap.set(i, baseIndex)
    })
    const skinIndex = geometry.getAttribute('skinIndex')
    if (skinIndex) {
      const array = skinIndex.array
      for (let i = 0; i < array.length; i += 1) {
        const mapped = remap.get(array[i])
        if (mapped !== undefined) array[i] = mapped
      }
      skinIndex.needsUpdate = true
    }
  }
  target.geometry = geometry
}

async function applyItem(root, slot, id) {
  const anchor = root.nodes[slot.attach]
  if (!anchor) return
  const item = await describeItem(id)
  const fallback = slot.type ? itemUrls(slot, id) : {}
  const urls = {
    mesh: assetUrl(item?.assetPaths?.mesh) || fallback.mesh,
    texture: assetUrl(item?.assetPaths?.texture) || fallback.texture,
  }
  if (!urls.mesh) return
  let object
  try {
    object = await objLoader.loadAsync(urls.mesh)
  } catch (err) {
    console.warn('[avatarLoader] accessory failed to load', urls.mesh, err)
    return
  }
  let texture = null
  try {
    if (!urls.texture) throw new Error('no texture')
    texture = configureItemTexture(await textureLoader.loadAsync(urls.texture))
  } catch {
    // An untextured accessory still reads better than skipping it outright.
  }
  object.traverse((o) => {
    if (!o.isMesh) return
    o.castShadow = true
    o.material = new MeshStandardMaterial(
      texture ? { map: texture, ...MATERIAL_PBR.PLAYER } : { color: '#cccccc', ...MATERIAL_PBR.PLAYER },
    )
  })
  // Hats are authored for the portal rig, whose renderer parents them to the
  // head bone lifted 0.8 up; at the bone origin they sink into the head.
  if (slot.at) object.position.set(...slot.at)
  else if (slot.key === 'hatId') object.position.set(0, HAT_LIFT, 0)
  anchor.add(object)
}

// A hat can insist on a head ('-1' = the stock one) because it is modelled
// around it; a custom head would poke through. The portal applies this when
// the hat is equipped, but looks reaching us another way (e.g. a remote
// player's saved JSON) may predate it, so enforce it here too.
async function withForcedHead(equipped) {
  for (const key of ['hatId', 'hairId', 'maskId']) {
    if (!isEquipped(equipped[key])) continue
    const item = await describeItem(equipped[key])
    const forced = item?.forceHeadId
    if (forced !== undefined && forced !== null) return { ...equipped, headId: forced }
  }
  return equipped
}

// `equipped` is the shape SDK.avatar.getEquipped() returns. `root` is a
// character from avatar/character.js, whose `nodes` map names every rig node.
// `signal` (optional AbortSignal) lets a caller cancel a stale load.
export async function attachEquippedAccessories(root, equipped, { signal, skinTextureUrl } = {}) {
  if (!root || !equipped) return
  try {
    ownMaterials(root)
    equipped = await withForcedHead(equipped)
    if (signal?.aborted) return
    await applySkin(root, equipped, skinTextureUrl)
    if (signal?.aborted) return
    // Slots load in parallel; each one swallows its own failure.
    await Promise.all(
      AVATAR_SLOTS.filter((slot) => isEquipped(equipped[slot.key])).map((slot) =>
        slot.kind === 'part' ? applyPart(root, slot, equipped[slot.key]) : applyItem(root, slot, equipped[slot.key]),
      ),
    )
  } catch (err) {
    console.warn('[avatarLoader] equipping avatar failed', err)
  }
}

function prop(proportions, key) {
  const spec = PROPORTIONS[key]
  const raw = Number(proportions?.[key])
  return clamp(Number.isFinite(raw) ? raw : spec.def, spec.min, spec.max)
}

// Rescales an already-built character per SDK.avatar.getProportions(). Safe
// to call repeatedly (e.g. from onProportionsChanged) since it only mutates
// existing node transforms, no reload needed. A null `proportions` resets to
// the defaults.
export function applyProportions(root, proportions) {
  if (!root) return
  const n = root.nodes || {}
  const p = {}
  for (const key of Object.keys(PROPORTIONS)) p[key] = prop(proportions, key)

  if (n.ArmL_Offset) n.ArmL_Offset.position.x = RIG.armOffsetX * p.shoulderWidth
  if (n.ArmR_Offset) n.ArmR_Offset.position.x = -RIG.armOffsetX * p.shoulderWidth
  if (n.ArmL1) n.ArmL1.scale.y = p.armLength
  if (n.ArmR1) n.ArmR1.scale.y = p.armLength
  if (n.LegL_Offset) n.LegL_Offset.position.x = RIG.legOffsetX * p.legOffsetX
  if (n.LegR_Offset) n.LegR_Offset.position.x = -RIG.legOffsetX * p.legOffsetX
  if (n.Spine1) n.Spine1.scale.x = p.torsoScaleX
  if (n.Neck_Offset) n.Neck_Offset.position.y = RIG.neckOffsetY * p.neckHeight
  if (n.Neck1) n.Neck1.scale.setScalar(p.headScale)

  // Rig units -> metres uniformly (must not distort), then the portal's
  // height proportion as a vertical stretch only — a taller character isn't
  // proportionally wider, just taller.
  const unitScale = PLAYER_DIMS.height / RIG_HEIGHT
  root.scale.set(unitScale, unitScale * p.height, unitScale)
}
