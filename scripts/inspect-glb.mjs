import { readFileSync } from 'fs'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'

const path = process.argv[2] || './public/models/man.glb'
const buf = readFileSync(path)
const loader = new GLTFLoader()

loader.parse(
  buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
  '',
  (gltf) => {
    console.log('file:', path)
    console.log('animations:', gltf.animations?.length ?? 0)
    for (const clip of gltf.animations ?? []) {
      console.log(
        `CLIP: "${clip.name}" duration=${clip.duration.toFixed(3)}s tracks=${clip.tracks.length}`,
      )
      for (const t of clip.tracks.slice(0, 12)) {
        console.log(`  track: ${t.name}`)
      }
      if (clip.tracks.length > 12) {
        console.log(`  ... ${clip.tracks.length - 12} more`)
      }
    }

    let skinned = 0
    gltf.scene.traverse((o) => {
      if (o.isSkinnedMesh) {
        skinned++
        console.log(
          `SkinnedMesh: "${o.name}" bones=${o.skeleton?.bones?.length ?? 0}`,
        )
      }
    })
    console.log('skinnedMeshes:', skinned)

    const dump = (obj, depth = 0) => {
      if (depth > 4) return
      const label = obj.name ? `${obj.type} "${obj.name}"` : obj.type
      console.log(`${'  '.repeat(depth)}${label}`)
      for (const c of obj.children) dump(c, depth + 1)
    }
    console.log('hierarchy:')
    dump(gltf.scene)
  },
  (err) => {
    console.error(err)
    process.exit(1)
  },
)
