/**
 * Pooled HTMLAudio SFX for Dual Arena.
 * Uses samples in /public/sounds (fire, bolt, reload, hits, foley, UI).
 */

export type SfxId =
  | 'fire'
  | 'bolt'
  | 'reload'
  | 'reloadDone'
  | 'dryFire'
  | 'hitBody'
  | 'land'
  | 'jump'
  | 'slide'
  | 'footstep'
  | 'adsIn'
  | 'adsOut'
  | 'uiClick'
  | 'uiConfirm'

type ClipDef = {
  src: string
  volume: number
  variants?: string[]
  /** How many concurrent instances (rapid fire / footsteps). */
  pool?: number
}

const CLIPS: Record<SfxId, ClipDef> = {
  fire: {
    src: '/sounds/fire_03.mp3',
    volume: 0.9,
    pool: 6,
  },
  bolt: {
    src: '/sounds/bolt_01.mp3',
    volume: 0.75,
    variants: [
      '/sounds/bolt_01.mp3',
      '/sounds/bolt_02.mp3',
      '/sounds/bolt_03.mp3',
    ],
    pool: 3,
  },
  reload: {
    src: '/sounds/reload_mag.mp3',
    volume: 0.8,
    variants: [
      '/sounds/reload_mag.mp3',
      '/sounds/reload_mag2.mp3',
      '/sounds/reload_mag3.mp3',
    ],
    pool: 2,
  },
  reloadDone: {
    src: '/sounds/reload_chamber.mp3',
    volume: 0.7,
    variants: ['/sounds/reload_chamber.mp3', '/sounds/hammer.mp3'],
  },
  dryFire: {
    src: '/sounds/dry_01.mp3',
    volume: 0.65,
    variants: [
      '/sounds/dry_01.mp3',
      '/sounds/dry_02.mp3',
      '/sounds/gun_click.mp3',
    ],
  },
  hitBody: {
    src: '/sounds/hit_01.ogg',
    volume: 0.45,
    variants: ['/sounds/hit_01.ogg', '/sounds/hit_02.ogg', '/sounds/hit_03.ogg'],
  },
  land: {
    src: '/sounds/land.ogg',
    volume: 0.5,
  },
  jump: {
    src: '/sounds/jump.ogg',
    volume: 0.4,
  },
  slide: {
    src: '/sounds/slide.ogg',
    volume: 0.3,
  },
  footstep: {
    src: '/sounds/footstep_0.mp3',
    volume: 0.9,
    variants: [
      '/sounds/footstep_0.mp3',
      '/sounds/footstep_1.mp3',
      '/sounds/footstep_2.mp3',
      '/sounds/footstep_3.mp3',
      '/sounds/footstep_4.mp3',
      '/sounds/footstep_5.mp3',
    ],
    pool: 6,
  },
  adsIn: {
    src: '/sounds/ads_in.ogg',
    volume: 0.55,
  },
  adsOut: {
    src: '/sounds/ads_out.ogg',
    volume: 0.48,
  },
  uiClick: {
    src: '/sounds/ui_click.ogg',
    volume: 0.45,
  },
  uiConfirm: {
    src: '/sounds/ui_confirm.ogg',
    volume: 0.5,
  },
}

const DEFAULT_POOL = 4

export class GameAudio {
  private pools = new Map<SfxId, HTMLAudioElement[]>()
  private cursor = new Map<SfxId, number>()
  private unlocked = false
  private muted = false
  private masterVolume = 1
  private sfxVolume = 1
  private lastFootstep = 0
  private lastDry = 0
  private reloadTimers: number[] = []
  private slideAudio: HTMLAudioElement | null = null

  constructor() {
    for (const id of Object.keys(CLIPS) as SfxId[]) {
      const def = CLIPS[id]
      const n = def.pool ?? DEFAULT_POOL
      const pool: HTMLAudioElement[] = []
      for (let i = 0; i < n; i++) {
        const a = new Audio(def.src)
        a.preload = 'auto'
        a.volume = def.volume
        pool.push(a)
      }
      this.pools.set(id, pool)
      this.cursor.set(id, 0)
    }
  }

  /** Sync from user settings store (master / sfx / mute). */
  applyUserAudio(opts: {
    masterVolume: number
    sfxVolume: number
    muted: boolean
  }) {
    this.masterVolume = Math.min(1, Math.max(0, opts.masterVolume))
    this.sfxVolume = Math.min(1, Math.max(0, opts.sfxVolume))
    this.muted = opts.muted
  }

  private scaleVolume(clipVolume: number) {
    if (this.muted) return 0
    return Math.min(
      1,
      Math.max(0, clipVolume * this.masterVolume * this.sfxVolume),
    )
  }

  /** Call from a user gesture so browsers allow playback. */
  unlock() {
    if (this.unlocked) return
    this.unlocked = true
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

  isMuted() {
    return this.muted
  }

  setMasterVolume(v: number) {
    this.masterVolume = Math.min(1, Math.max(0, v))
  }

  setSfxVolume(v: number) {
    this.sfxVolume = Math.min(1, Math.max(0, v))
  }

  play(id: SfxId, opts?: { volume?: number; rate?: number }) {
    if (this.muted) return
    this.unlock()
    const def = CLIPS[id]
    const pool = this.pools.get(id)
    if (!pool?.length || !def) return

    const idx = this.cursor.get(id) ?? 0
    this.cursor.set(id, (idx + 1) % pool.length)
    const a = pool[idx]

    const variants = def.variants
    if (variants && variants.length > 1) {
      const src = variants[Math.floor(Math.random() * variants.length)]
      // Compare pathname end so absolute blob URLs still rematch
      if (!a.src.includes(src.replace(/^\//, '')) && !a.src.endsWith(src)) {
        a.src = src
      }
    }

    a.volume = this.scaleVolume(opts?.volume ?? def.volume)
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

  /** Layered fire: report + soft mechanical click. */
  playFire(opts?: { volume?: number }) {
    const v = opts?.volume ?? 1
    const rate = 0.97 + Math.random() * 0.06
    this.play('fire', { volume: 0.9 * v, rate })
    // Soft under-click for bolt-gun body
    this.play('dryFire', { volume: 0.2 * v, rate: 0.85 + Math.random() * 0.1 })
  }

  /** Bolt cycle with a second rack click. */
  playBolt(opts?: { volume?: number }) {
    const v = opts?.volume ?? 1
    this.play('bolt', { volume: 0.78 * v, rate: 0.96 + Math.random() * 0.06 })
    window.setTimeout(() => {
      this.play('bolt', { volume: 0.55 * v, rate: 1.05 + Math.random() * 0.05 })
    }, 200)
  }

  /** Mag sequence: out → in → chamber. */
  playReload(opts?: { volume?: number }) {
    const v = opts?.volume ?? 1
    // Cancel previous reload sequence if player reloads again mid-sequence
    for (const t of this.reloadTimers) window.clearTimeout(t)
    this.reloadTimers = []

    this.play('reload', { volume: 0.85 * v, rate: 0.98 + Math.random() * 0.04 })
    this.reloadTimers.push(
      window.setTimeout(() => {
        this.play('reload', {
          volume: 0.75 * v,
          rate: 0.92 + Math.random() * 0.04,
        })
      }, 450),
    )
    this.reloadTimers.push(
      window.setTimeout(() => {
        this.play('bolt', { volume: 0.7 * v, rate: 1 + Math.random() * 0.04 })
      }, 950),
    )
    this.reloadTimers.push(
      window.setTimeout(() => {
        this.play('reloadDone', {
          volume: 0.7 * v,
          rate: 1 + Math.random() * 0.04,
        })
      }, 1350),
    )
  }

  playDryFire() {
    const t = performance.now()
    if (t - this.lastDry < 140) return
    this.lastDry = t
    this.play('dryFire', { rate: 0.95 + Math.random() * 0.1 })
  }

  /** Body / head / kill confirmation stack. */
  playHitConfirm(opts: { zone: string; killed: boolean }) {
    const rate = 0.94 + Math.random() * 0.12
    this.play('hitBody', { rate })
  }

  footstep(speed: number, sprint: boolean) {
    const gap = sprint ? 0.28 : 0.30
    const t = performance.now() / 1000
    if (t - this.lastFootstep < gap) return
    this.lastFootstep = t
    const rate = sprint
      ? 1.05 + Math.random() * 0.08
      : 0.92 + Math.random() * 0.1
    const volume =
      Math.min(0.55, 0.28 + speed * 0.035) * (sprint ? 0.95 : 0.8)
    this.play('footstep', { volume, rate })
  }

  playSlide() {
    if (this.muted) return
    this.unlock()
    if (!this.slideAudio) {
      this.slideAudio = new Audio('/sounds/slide.ogg')
      this.slideAudio.preload = 'auto'
      this.slideAudio.loop = true
    }
    this.slideAudio.volume = this.scaleVolume(CLIPS.slide.volume)
    this.slideAudio.currentTime = 0
    void this.slideAudio.play().catch(() => {})
  }

  stopSlide() {
    if (this.slideAudio) {
      this.slideAudio.pause()
      this.slideAudio.currentTime = 0
    }
  }

  uiClick() {
    this.play('uiClick')
  }

  uiConfirm() {
    this.play('uiConfirm')
  }
}

/** Shared instance for the client game session. */
export const gameAudio = new GameAudio()

/** Wire first pointer / key gesture so browsers allow audio. */
export function installAudioUnlock() {
  if (typeof window === 'undefined') return
  const unlock = () => {
    gameAudio.unlock()
  }
  window.addEventListener('pointerdown', unlock, { once: true, capture: true })
  window.addEventListener('keydown', unlock, { once: true, capture: true })
}
