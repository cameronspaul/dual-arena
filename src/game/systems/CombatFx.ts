/**
 * Tracer line + impact decal pool.
 */
import * as THREE from 'three'

export class CombatFx {
  private impactPool: THREE.Mesh[] = []
  private tracer: THREE.Line | null = null
  private tracerTimer = 0

  build(scene: THREE.Scene) {
    const geo = new THREE.SphereGeometry(0.06, 6, 6)
    const mat = new THREE.MeshBasicMaterial({ color: 0xffee88 })
    for (let i = 0; i < 12; i++) {
      const m = new THREE.Mesh(geo, mat.clone())
      m.visible = false
      scene.add(m)
      this.impactPool.push(m)
    }
    const tGeo = new THREE.BufferGeometry()
    tGeo.setAttribute(
      'position',
      new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0], 3),
    )
    this.tracer = new THREE.Line(
      tGeo,
      new THREE.LineBasicMaterial({
        color: 0xfff0a0,
        transparent: true,
        opacity: 0.85,
      }),
    )
    this.tracer.visible = false
    scene.add(this.tracer)
  }

  showTracer(
    from: { x: number; y: number; z: number },
    dir: { x: number; y: number; z: number },
    to: { x: number; y: number; z: number },
  ) {
    if (!this.tracer) return
    const pos = this.tracer.geometry.attributes
      .position as THREE.BufferAttribute
    const start = 0.35
    pos.setXYZ(
      0,
      from.x + dir.x * start,
      from.y + dir.y * start,
      from.z + dir.z * start,
    )
    pos.setXYZ(1, to.x, to.y, to.z)
    pos.needsUpdate = true
    this.tracer.visible = true
    this.tracerTimer = 0.12
  }

  showImpact(
    p: { x: number; y: number; z: number },
    kind: 'world' | 'body' | 'head' = 'world',
    killed = false,
  ) {
    const m = this.impactPool.find((x) => !x.visible) ?? this.impactPool[0]
    m.position.set(p.x, p.y, p.z)
    m.visible = true
    const mat = m.material as THREE.MeshBasicMaterial
    if (killed) mat.color.setHex(0xff3344)
    else if (kind === 'head') mat.color.setHex(0xffee55)
    else if (kind === 'body') mat.color.setHex(0xff8866)
    else mat.color.setHex(0xffee88)
    const s = killed ? 1.8 : kind === 'head' ? 1.45 : kind === 'body' ? 1.15 : 1
    m.scale.setScalar(s)
    window.setTimeout(
      () => {
        m.visible = false
        m.scale.setScalar(1)
      },
      killed ? 320 : 200,
    )
  }

  update(dt: number) {
    if (this.tracer && this.tracerTimer > 0) {
      this.tracerTimer -= dt
      if (this.tracerTimer <= 0) this.tracer.visible = false
      else {
        const mat = this.tracer.material as THREE.LineBasicMaterial
        mat.opacity = Math.min(1, this.tracerTimer * 4) * 0.85
      }
    }
  }
}
