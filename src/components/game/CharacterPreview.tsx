import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js'

import { findClip } from '@/game/character/locomotion'
import { DUMMY } from '@/game/core/config'
import { cn } from '@/lib/utils'

interface CharacterPreviewProps {
  color: string
  className?: string
  /** Slow idle spin so the skin is readable from a few angles. */
  spin?: boolean
}

type TintEntry = {
  mat: THREE.MeshStandardMaterial
  base: THREE.Color
  isSkin: boolean
}

function isSkinMeshName(name: string): boolean {
  return /head|face|skin|eye|hair|brow|mouth|tooth|teeth/i.test(name)
}

function isSkinMaterial(mat: THREE.MeshStandardMaterial): boolean {
  const c = mat.color
  // Rough skin-tone heuristic for untextured / albedo-tinted man.glb mats
  const r = c.r
  const g = c.g
  const b = c.b
  return r > 0.45 && g > 0.28 && b > 0.2 && r > g && g >= b * 0.85 && r - b > 0.08
}

/**
 * Mini WebGL stage that loads man.glb (same skin as in-game), plays idle,
 * and tints clothing/body with the lobby character color.
 */
export function CharacterPreview({
  color,
  className,
  spin = true,
}: CharacterPreviewProps) {
  const mountRef = useRef<HTMLDivElement>(null)
  const colorRef = useRef(color)
  colorRef.current = color
  const tintRef = useRef<TintEntry[]>([])
  const applyColorRef = useRef<(hex: string) => void>(() => {})

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return

    let disposed = false
    let frame = 0
    let mixer: THREE.AnimationMixer | null = null
    let modelRoot: THREE.Object3D | null = null
    const clock = new THREE.Clock()

    const w = () => Math.max(1, mount.clientWidth)
    const h = () => Math.max(1, mount.clientHeight)

    const scene = new THREE.Scene()
    scene.background = null

    const camera = new THREE.PerspectiveCamera(28, w() / h(), 0.1, 50)
    camera.position.set(0, 1.15, 3.35)
    camera.lookAt(0, 0.95, 0)

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'low-power',
    })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(w(), h(), false)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.domElement.style.display = 'block'
    renderer.domElement.style.width = '100%'
    renderer.domElement.style.height = '100%'
    mount.appendChild(renderer.domElement)

    const hemi = new THREE.HemisphereLight(0xffffff, 0x334455, 1.15)
    scene.add(hemi)
    const key = new THREE.DirectionalLight(0xfff2dd, 1.35)
    key.position.set(2.2, 4.5, 3)
    scene.add(key)
    const fill = new THREE.DirectionalLight(0xaaccff, 0.45)
    fill.position.set(-3, 1.5, -2)
    scene.add(fill)

    // Soft ground disk so the figure reads against the card
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(1.1, 48),
      new THREE.MeshBasicMaterial({
        color: 0x000000,
        transparent: true,
        opacity: 0.28,
      }),
    )
    ground.rotation.x = -Math.PI / 2
    ground.position.y = 0.01
    scene.add(ground)

    const pivot = new THREE.Group()
    scene.add(pivot)

    applyColorRef.current = (hex: string) => {
      const tint = new THREE.Color(hex)
      for (const entry of tintRef.current) {
        if (entry.isSkin) {
          entry.mat.color.copy(entry.base)
          continue
        }
        // Multiply clothing albedo by chosen color (keeps map contrast)
        entry.mat.color.copy(entry.base).multiply(tint)
      }
    }

    const loader = new GLTFLoader()
    loader.load(
      '/models/man.glb',
      (gltf) => {
        if (disposed) return

        const source = gltf.scene
        const box = new THREE.Box3().setFromObject(source)
        const size = box.getSize(new THREE.Vector3())
        const targetHeight =
          DUMMY.headOffsetY + DUMMY.headRadius * DUMMY.headEgg.y
        const scale = targetHeight / Math.max(size.y, 0.001)
        const footY = box.min.y

        const model = cloneSkinned(source)
        model.scale.setScalar(scale)
        model.position.y = -footY * scale
        modelRoot = model

        const tints: TintEntry[] = []
        model.traverse((o) => {
          if (!(o instanceof THREE.Mesh) && !(o instanceof THREE.SkinnedMesh)) {
            return
          }
          o.frustumCulled = false
          o.castShadow = false
          o.receiveShadow = false

          const list = Array.isArray(o.material) ? o.material : [o.material]
          const cloned = list.map((raw) => {
            const mat = (raw as THREE.Material).clone() as THREE.MeshStandardMaterial
            if ('color' in mat && mat.color instanceof THREE.Color) {
              const skin =
                isSkinMeshName(o.name) || isSkinMaterial(mat)
              tints.push({
                mat,
                base: mat.color.clone(),
                isSkin: skin,
              })
              // Slightly flatter for UI readability
              if ('flatShading' in mat) mat.flatShading = true
              if ('roughness' in mat && mat.roughnessMap == null) {
                mat.roughness = Math.min(0.85, (mat.roughness ?? 0.5) + 0.1)
              }
              mat.needsUpdate = true
            }
            return mat
          })
          o.material = Array.isArray(o.material) ? cloned : cloned[0]
        })
        tintRef.current = tints
        applyColorRef.current(colorRef.current)

        pivot.add(model)

        // Idle animation if available
        const clips = gltf.animations ?? []
        const idleClip =
          findClip(clips, 'Idle_Neutral', 'Idle') ?? clips[0] ?? null
        if (idleClip) {
          mixer = new THREE.AnimationMixer(model)
          const action = mixer.clipAction(idleClip)
          action.setLoop(THREE.LoopRepeat, Infinity)
          action.play()
        }

        // Fit camera to model bounds
        const fitted = new THREE.Box3().setFromObject(pivot)
        const center = fitted.getCenter(new THREE.Vector3())
        const ext = fitted.getSize(new THREE.Vector3())
        const maxDim = Math.max(ext.x, ext.y, ext.z)
        const dist = Math.max(2.4, maxDim * 2.15)
        camera.position.set(0.15, center.y + ext.y * 0.05, dist)
        camera.lookAt(center.x, center.y + ext.y * 0.02, center.z)
        camera.updateProjectionMatrix()
      },
      undefined,
      (err) => {
        console.warn('CharacterPreview: failed to load man.glb', err)
      },
    )

    const onResize = () => {
      const width = w()
      const height = h()
      camera.aspect = width / height
      camera.updateProjectionMatrix()
      renderer.setSize(width, height, false)
    }
    const ro = new ResizeObserver(onResize)
    ro.observe(mount)

    const tick = () => {
      if (disposed) return
      frame = requestAnimationFrame(tick)
      const dt = Math.min(clock.getDelta(), 0.05)
      mixer?.update(dt)
      if (spin && modelRoot) {
        pivot.rotation.y += dt * 0.45
      }
      renderer.render(scene, camera)
    }
    tick()

    return () => {
      disposed = true
      cancelAnimationFrame(frame)
      ro.disconnect()
      mixer?.stopAllAction()
      mixer = null
      tintRef.current = []

      scene.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry?.dispose()
          const m = obj.material
          if (Array.isArray(m)) m.forEach((x) => x.dispose())
          else m?.dispose()
        }
      })
      renderer.dispose()
      if (renderer.domElement.parentElement === mount) {
        mount.removeChild(renderer.domElement)
      }
    }
  }, [spin])

  // Live color updates without reloading the GLB
  useEffect(() => {
    applyColorRef.current(color)
  }, [color])

  return (
    <div
      ref={mountRef}
      className={cn('relative h-full w-full overflow-hidden', className)}
      aria-label="Character preview"
      role="img"
    />
  )
}
