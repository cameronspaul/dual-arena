/**
 * man.glb part coloring — materials are untextured MeshStandardMaterials:
 *   Skin (face + hands/neck), Hair, Eyebrows, Eye, Suit (jacket + legs share name),
 *   White (shirt), Tie, Black (shoes).
 *
 * Suit jacket vs trousers share mat name "Suit" but live on different meshes,
 * so we resolve by mesh name first for legs.
 */
import * as THREE from 'three'

export type CharacterAppearance = {
  face: string
  hair: string
  suit: string
  trousers: string
  top: string
  tie: string
  shoes: string
}

export type AppearancePart = keyof CharacterAppearance

/** Defaults match man.glb authoring colors. */
export const DEFAULT_CHARACTER_APPEARANCE: CharacterAppearance = {
  face: '#ba9c79',
  hair: '#412914',
  suit: '#1d2329',
  trousers: '#1d2329',
  top: '#a3a3a3',
  tie: '#414751',
  shoes: '#202020',
}

export const APPEARANCE_PARTS: {
  id: AppearancePart
  label: string
  description: string
}[] = [
  { id: 'face', label: 'Face', description: 'Skin (face & hands)' },
  { id: 'hair', label: 'Hair', description: 'Hair & brows' },
  { id: 'suit', label: 'Suit', description: 'Jacket & sleeves' },
  { id: 'trousers', label: 'Trousers', description: 'Legs' },
  { id: 'top', label: 'Top', description: 'Shirt / collar' },
  { id: 'tie', label: 'Tie', description: 'Necktie' },
  { id: 'shoes', label: 'Shoes', description: 'Footwear' },
]

export function cloneAppearance(
  a: CharacterAppearance = DEFAULT_CHARACTER_APPEARANCE,
): CharacterAppearance {
  return {
    face: a.face,
    hair: a.hair,
    suit: a.suit,
    trousers: a.trousers,
    top: a.top,
    tie: a.tie,
    shoes: a.shoes,
  }
}

/** Normalize partial / legacy store data into a full appearance. */
export function normalizeAppearance(
  raw: Partial<CharacterAppearance> | null | undefined,
): CharacterAppearance {
  const d = DEFAULT_CHARACTER_APPEARANCE
  if (!raw || typeof raw !== 'object') return cloneAppearance(d)
  const hex = (v: unknown, fallback: string) =>
    typeof v === 'string' && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v.trim())
      ? v.trim().toLowerCase()
      : fallback
  return {
    face: hex(raw.face, d.face),
    hair: hex(raw.hair, d.hair),
    suit: hex(raw.suit, d.suit),
    trousers: hex(raw.trousers, d.trousers),
    top: hex(raw.top, d.top),
    tie: hex(raw.tie, d.tie),
    shoes: hex(raw.shoes, d.shoes),
  }
}

/**
 * Map a drawable mesh + material to a customizable part.
 * Returns null for fixed parts (eyes).
 */
export function resolveAppearancePart(
  meshName: string,
  matName: string,
): AppearancePart | null {
  const mat = (matName || '').toLowerCase()
  const mesh = (meshName || '').toLowerCase()

  if (mat === 'skin' || mat.includes('skin')) return 'face'
  if (mat === 'hair' || mat === 'eyebrows') return 'hair'
  if (mat === 'tie') return 'tie'
  if (mat === 'white') return 'top'

  // Shoes: Black mat on Suit_Feet (mesh name also checked for safety)
  if (
    mat === 'black' ||
    mesh.includes('feet') ||
    mesh.includes('foot') ||
    mesh.includes('shoe')
  ) {
    return 'shoes'
  }

  // Legs share Suit material with the jacket — mesh name wins.
  if (
    mesh.includes('leg') ||
    mesh.includes('trouser') ||
    mesh.includes('pant')
  ) {
    return 'trousers'
  }

  if (mat === 'suit') return 'suit'
  return null
}

/**
 * Apply part colors onto a man.glb root (or any clone).
 * Updates mat.color and userData.baseColors so damage tints stay in sync.
 */
export function applyCharacterAppearance(
  root: THREE.Object3D,
  appearance: CharacterAppearance,
): void {
  const colors = normalizeAppearance(appearance)

  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh) && !(o instanceof THREE.SkinnedMesh)) return
    if (o.userData.hitProxy || o.userData.skipHitbox) return

    const list = Array.isArray(o.material) ? o.material : [o.material]
    let bases = o.userData.baseColors as THREE.Color[] | undefined
    if (!bases || bases.length !== list.length) {
      bases = list.map((m) => {
        if (m && 'color' in m && m.color instanceof THREE.Color) {
          return m.color.clone()
        }
        return new THREE.Color(0xffffff)
      })
      o.userData.baseColors = bases
    }

    for (let i = 0; i < list.length; i++) {
      const mat = list[i] as THREE.MeshStandardMaterial | undefined
      if (!mat || !('color' in mat) || !(mat.color instanceof THREE.Color)) continue

      const part = resolveAppearancePart(o.name, mat.name ?? '')
      if (!part) continue

      const hex = colors[part]
      mat.color.set(hex)
      bases[i].set(hex)
      mat.needsUpdate = true
    }
  })
}
