/**
 * Lightweight pooled HTMLAudio sound layer for hit confirmation feedback.
 * Unlock happens on first user gesture (pointer lock / fire).
 */

export type SfxId =
  | 'hitmarker'
  | 'hitmarkerHead'
  | 'hitBody'
  | 'hitHead'
  | 'kill'
  | 'impactWorld'
  | 'impactBody'

type ClipDef = {
  src: string
  volume: number
  /** Optional second variant for variety */
  variants?: string[]
}

const CLIPS: Record<SfxId, ClipDef> = {
  hitmarker: {
    src: '/sounds/hitmarker_tick.ogg',
    volume: 0.55,
    variants: ['/sounds/hitmarker_tick.ogg', '/sounds/hitmarker_tick2.ogg'],
  },
  hitmarkerHead: {
    src: '/sounds/hitmarker_tick2.ogg',
    volume: 0.7,
  },
  hitBody: {
    src: '/sounds/hit_01.ogg',
    volume: 0.45,
    variants: ['/sounds/hit_01.ogg', '/sounds/hit_02.ogg', '/sounds/hit_03.ogg'],
  },
  hitHead: {
    src: '/sounds/hit_head.ogg',
    volume: 0.65,
  },
  kill: {
    src: '/sounds/kill_body.ogg',
    volume: 0.75,
    variants: ['/sounds/kill_body.ogg', '/sounds/kill_metal.ogg'],
  },
  impactWorld: {
    src: '/sounds/impact_world_01.ogg',
    volume: 0.35,
    variants: [
      '/sounds/impact_world_01.ogg',
      '/sounds/impact_world_02.ogg',
      '/sounds/impact_world_03.ogg',
      '/sounds/impact_world_04.ogg',
    ],
  },
  impactBody: {
    src: '/sounds/impact_body_01.ogg',
    volume: 0.4,
    variants: [
      '/sounds/impact_body_01.ogg',
      '/sounds/impact_body_02.ogg',
      '/sounds/impact_body_03.ogg',
    ],
  },
}

const POOL_SIZE = 4

export class GameAudio {
  private pools = new Map<SfxId, HTMLAudioElement[]>()
  private cursor = new Map<SfxId, number>()
  private unlocked = false
  private muted = false

  constructor() {
    for (const id of Object.keys(CLIPS) as SfxId[]) {
      const def = CLIPS[id]
      const pool: HTMLAudioElement[] = []
      for (let i = 0; i < POOL_SIZE; i++) {
        const a = new Audio(def.src)
        a.preload = 'auto'
        a.volume = def.volume
        pool.push(a)
      }
      this.pools.set(id, pool)
      this.cursor.set(id, 0)
    }
  }

  /** Call from a user gesture so browsers allow playback. */
  unlock() {
    if (this.unlocked) return
    this.unlocked = true
    // Quiet prime of one element per pool (some browsers need play() once).
    for (const pool of this.pools.values()) {
      const a = pool[0]
      if (!a) continue
      const prev = a.volume
      a.volume = 0
      void a
        .play()
        .then(() => {
          a.pause()
          a.currentTime = 0
          a.volume = prev
        })
        .catch(() => {
          a.volume = prev
        })
    }
  }

  setMuted(m: boolean) {
    this.muted = m
  }

  play(id: SfxId, opts?: { volume?: number; rate?: number }) {
    if (this.muted) return
    this.unlock()
    const def = CLIPS[id]
    const pool = this.pools.get(id)
    if (!pool?.length) return

    const idx = this.cursor.get(id) ?? 0
    this.cursor.set(id, (idx + 1) % pool.length)
    const a = pool[idx]

    const variants = def.variants
    if (variants && variants.length > 1) {
      const src = variants[Math.floor(Math.random() * variants.length)]
      if (!a.src.endsWith(src) && !a.src.includes(src.replace(/^\//, ''))) {
        a.src = src
      }
    }

    a.volume = Math.min(1, Math.max(0, opts?.volume ?? def.volume))
    a.playbackRate = opts?.rate ?? 1
    try {
      a.currentTime = 0
    } catch {
      /* ignore seek race */
    }
    void a.play().catch(() => {
      /* autoplay blocked until unlock gesture */
    })
  }

  /** Body / head / kill confirmation stack (marker + flesh + optional kill). */
  playHitConfirm(opts: { zone: string; killed: boolean }) {
    if (opts.killed) {
      this.play('hitmarker', { volume: 0.5, rate: 0.95 })
      this.play('kill')
      this.play('impactBody', { volume: 0.5 })
      return
    }
    if (opts.zone === 'head') {
      this.play('hitmarkerHead', { volume: 0.75, rate: 1.05 })
      this.play('hitHead')
      this.play('impactBody', { volume: 0.45, rate: 1.1 })
      return
    }
    // Slight pitch variance so repeated chest/limb hits don't sound identical
    const rate = 0.94 + Math.random() * 0.12
    this.play('hitmarker', { rate })
    this.play('hitBody', { rate })
    this.play('impactBody', { volume: 0.32, rate })
  }

  playWorldImpact() {
    this.play('impactWorld', {
      volume: 0.28 + Math.random() * 0.12,
      rate: 0.9 + Math.random() * 0.2,
    })
  }
}

/** Shared instance for the client game session. */
export const gameAudio = new GameAudio()
