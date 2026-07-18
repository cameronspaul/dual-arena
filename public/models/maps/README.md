# Map assets for Glint

## Format: use **glTF binary (`.glb`)** — not USDZ

| Format | Use it? | Why |
|--------|---------|-----|
| **`.glb` (glTF 2.0 binary)** | **Yes** | Native in Three.js, one file, web-standard |
| `.gltf` + `.bin` + textures | OK | Same as glb, just multi-file |
| **USDZ** | **No** | Apple AR format; bad WebGL story |
| FBX / OBJ | Convert first | Prefer export → glb |

Put files in this folder and register them in `src/game/maps/catalog.ts`.

---

## How the game “interacts” with a map

The engine does **not** use a physics file. It raycasts against triangle meshes for:

1. **Walking** — feet cast down for floor; horizontal probes for walls  
2. **Bullets** — hitscan rays against the same meshes  

So whatever you export as solid geometry *is* the collision (unless you add a dedicated collision layer — see below).

---

## Best export settings (Blender)

1. **Unit scale:** 1 unit = **1 meter**. Player is ~1.7 m tall.  
2. **Y-up** (Blender: export glTF with “+Y Up”).  
3. **Apply** location / rotation / scale (`Ctrl+A`) before export.  
4. Floor roughly around **Y = 0**.  
5. Export **glTF 2.0 → glTF Binary (.glb)**.  
6. Include normals; materials optional (we can re-light in-engine).

### Sketchfab / marketplace downloads

Many files already work as `.glb`. Prefer the **glTF** download over USDZ / FBX.

---

## Optional: separate collision mesh (recommended for big maps)

If the visual is heavy (100k+ tris) or has foliage / decals you shouldn’t collide with:

1. Build a **low-poly** hull (boxes, simple walls, floor).  
2. Name it so the loader picks it up exclusively:
   - `COL_...` or `collision` or `collider` or Unreal-style `UCX_...`
3. Keep the pretty mesh as visual only (no those name prefixes).  
4. Export **both** in one `.glb`.

When any mesh matches those names, **only** those are used for walk/bullet collision.

---

## Catalog entry

```ts
// src/game/maps/catalog.ts
myMap: {
  id: 'myMap',
  name: 'My Map',
  kind: 'gltf',
  url: '/models/maps/my_map.glb',
  scale: 1,          // tune if the model is cm-scale (try 0.01) or tiny
  rotateY: 0,
  offset: { x: 0, y: 0, z: 0 },
  spawn: { x: 0, y: 0, z: 4 }, // preferred offset from map center after fit
  spawnYaw: Math.PI,
  dummies: [],
  dummyBounds: 20,
  // fog / camera...
}
```

After load the engine **fits** the mesh (floor to y≈0, center XZ) and picks a walkable spawn with raycasts. Spawns outside the real footprint are clamped.

---

## Debugging

Open the browser console on play:

```
[map] desert fitted { size, ... } spawn { x,y,z } collisionMeshes N
[map-perf] desert { meshes, triangles, materials, shadowCasters, collisionMeshes, dedicatedCollision, … }
  notes: [ "High tris…", "No COL_ hull…", … ]
```

In-game (top-right, when `DEBUG.showPerf` is true — default on):

| Field | Meaning |
|-------|---------|
| **FPS / ms** | Frame rate and total frame time (180 Hz budget ≈ 5.6 ms) |
| **sim / ren** | CPU simulation (movement + mesh collision) vs `renderer.render` |
| **draws / tris** | WebGL draw calls and triangles submitted this frame |
| **col near/total** | Collision meshes near the player vs full set (walk/bullet probes) |
| **map line** | Static load cost: total tris, mesh count, shadow casters, `COL✓/✗` |
| **limit** | Best-guess bottleneck (CPU collision vs GPU draw/shadows vs DPR) |

- `collisionMeshes: 0` → nothing solid to walk on (export failed / empty).  
- Spawn Y should sit on the floor (~0–2).  
- If you fall forever, geometry isn’t under the spawn (scale/rotation wrong).  
- If you walk through walls, tris are missing or faces are open — add a closed `COL_` hull.  
- **Low FPS only while walking** + high `sim` / `col near` → add a low-poly `COL_` hull.  
- **Low FPS while standing still** + high `ren` / `draws` / shadow casters → simplify mesh, cut casters, or lower DPR.  
- Toggle the panel via `DEBUG.showPerf` in `src/game/core/config.ts`.

### Automatic walk-collider filter

If a map has **no** `COL_` / `collision` / `UCX_` meshes, the loader still uses visuals for collision, but **walk probes** drop tiny decorative props (bullets keep the fuller set). Console:

```
[map] desert walk colliders 180/427 (visual set filtered for CPU)
```

Authoring a real low-poly `COL_` hull is still the best fix for high-refresh targets.
