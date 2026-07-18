/**
 * Shared mutable state for GameEngine + tick/online modules.
 * Keeps field noise out of the orchestrator class file.
 */
import * as THREE from 'three'
import { PLAYER } from '../core/config'
import { InputManager } from '../core/input'
import type { DeathReason, HitEvent, SniperState } from '../core/types'
import type {
  MapBarrierLayout,
  MapDef,
  MapSpawnLayout,
  MapStaticPerf,
} from '../maps'
import type { SkyboxId } from '../scene/skyboxes'
import { createPlayer } from '../sim/player'
import { createSniper } from '../sim/sniper'
import type { FreeCamState } from '../sim/spectate'
import { createDummies, type RespawnTimer } from '../sim/world'
import { BarrierVisuals } from '../systems/BarrierVisuals'
import { CombatFx } from '../systems/CombatFx'
import { DummySystem } from '../systems/DummySystem'
import { PlayerVisuals } from '../systems/PlayerVisuals'
import { ViewFeel } from '../systems/ViewFeel'
import { ViewmodelSystem } from '../viewmodel/ViewmodelSystem'
import {
  NetClient,
  Prediction,
  RemotePlayerSystem,
  VoicePeer,
} from '../net'
import {
  MATCH,
  TICK_RATE,
  type MatchEndMessage,
  type MatchPhase,
  type SnapshotMessage,
} from '@glint/shared'
import type { ChatListener, HudListener, VoiceUiListener } from './types'
import type { LevelEditorSession } from './levelEditorSession'
import type { PlaySpawn } from './playerLifecycle'

export abstract class EngineCore {
  // --- scene / loop ----------------------------------------------------------
  /** @internal */ renderer!: THREE.WebGLRenderer
  /** @internal */ scene!: THREE.Scene
  /** @internal */ camera!: THREE.PerspectiveCamera
  /** @internal */ input = new InputManager()
  /** @internal */ player = createPlayer()
  /** @internal */ sniper = createSniper()
  /** @internal */ colliders: import('../core/types').AABB[] = []
  /** @internal */ dummies = createDummies()
  /** @internal */ respawns: RespawnTimer[] = []
  /** @internal */ running = false
  /** @internal */ raf = 0
  /** @internal */ lastTime = 0
  /** @internal */ frameTimeEma = 1 / 60
  /** @internal */ fps = 60
  /** @internal */ simMsEma = 0
  /** @internal */ renderMsEma = 0
  /** @internal */ frameMsEma = 16.7
  /** @internal */ nearbyCollision = 0
  /** @internal */ mapStaticPerf: MapStaticPerf | null = null
  /** @internal */ pingMs: number | null = null
  /** @internal */ container!: HTMLElement
  /** @internal */ clock = new THREE.Clock()

  /** @internal */ viewmodel = new ViewmodelSystem()
  /** @internal */ dummiesSys = new DummySystem()
  /** @internal */ playerVisuals = new PlayerVisuals()
  /** @internal */ combatFx = new CombatFx()
  /** @internal */ barrierVisuals = new BarrierVisuals()
  /** @internal */ viewFeel = new ViewFeel()

  // --- online ----------------------------------------------------------------
  /** @internal */ isOnline = false
  /** @internal */ net: NetClient | null = null
  /** @internal */ voice: VoicePeer | null = null
  /** @internal */ prediction = new Prediction()
  /** @internal */ remotes = new RemotePlayerSystem()
  /** @internal */ localPlayerId: string | null = null
  /** @internal */ onlineStatus = 'idle'
  /** @internal */ chatLines: import('./types').ChatLine[] = []
  /** @internal */ chatListeners = new Set<ChatListener>()
  /** @internal */ voiceUiListeners = new Set<VoiceUiListener>()
  /** @internal */ chatIdSeq = 0
  /** @internal */ matchEnd: MatchEndMessage | null = null
  /** @internal */ pendingDrawFromId: string | null = null
  /** @internal */ pendingSnapshots: SnapshotMessage[] = []
  /** @internal */ serverTickRate = TICK_RATE
  /** @internal */ matchTimeLeft: number | null = null
  /** @internal */ matchWaiting = false
  /** @internal */ matchPhase: MatchPhase | null = null
  /** @internal */ matchPhaseTimer = 0
  /** @internal */ matchFirstTo: number = MATCH.firstTo
  /** @internal */ localReady = false
  /** @internal */ enemyReady = false
  /** @internal */ lastReadyToggleAt = 0
  /** @internal */ localRematchReady = false
  /** @internal */ enemyRematchReady = false
  /** @internal */ rematchAvailable = false
  /** @internal */ lastRematchToggleAt = 0
  /** @internal */ enemyKills = 0
  /** @internal */ teamColor: 'blue' | 'red' | null = null
  /** @internal */ serverRespawnIn = 0
  /** @internal */ lastMatchPhase: MatchPhase | null = null
  /** @internal */ onlineTeamSpawnReady = false
  /** @internal */ waitOnRange = false

  // --- local player / HUD ----------------------------------------------------
  /** @internal */ hudListeners = new Set<HudListener>()
  /** @internal */ lastHit: HitEvent | null = null
  /** @internal */ lastHitAge = 999
  /** @internal */ lastHitId = 0
  /** @internal */ lastInput: import('../core/types').PlayerInput | null = null
  /** @internal */ kills = 0
  /** @internal */ playerHp: number = PLAYER.maxHp
  /** @internal */ playerAlive = true
  /** @internal */ deathReason: DeathReason | null = null
  /** @internal */ spectateTimer = 0
  /** @internal */ freeCam: FreeCamState | null = null
  /** @internal */ fallKillY: number | null = null
  /** @internal */ playSpawn: PlaySpawn = {
    spawn: { x: 0, y: 0, z: 8 },
    spawnYaw: 0,
  }
  /** @internal */ floorMat: THREE.MeshStandardMaterial | null = null
  /** @internal */ coverMat: THREE.MeshStandardMaterial | null = null
  /** @internal */ envTextures: THREE.Texture[] = []
  /** @internal */ thirdPerson = false
  /** @internal */ voluntaryFreeCam = false
  /** @internal */ dummiesEnabled = true
  /** @internal */ prevSniperPhase: SniperState['phase'] = 'ready'

  // --- map -------------------------------------------------------------------
  /** @internal */ mapDef!: MapDef
  /** @internal */ skyboxId!: SkyboxId
  /** @internal */ mapHitMeshes: THREE.Object3D[] = []
  /** @internal */ meshWorld: { meshes: THREE.Object3D[] } | null = null
  /** @internal */ mapReady = false
  /** @internal */ mapLoadError: string | null = null

  // --- level editor ----------------------------------------------------------
  /** @internal */ editor!: LevelEditorSession

  /** @internal layout aliases for modules that expect them on the engine */
  get spawnLayout(): MapSpawnLayout {
    return this.editor.spawnLayout
  }
  set spawnLayout(v: MapSpawnLayout) {
    this.editor.spawnLayout = v
  }
  get barrierLayout(): MapBarrierLayout {
    return this.editor.barrierLayout
  }
  set barrierLayout(v: MapBarrierLayout) {
    this.editor.barrierLayout = v
  }
  get barrierColliders() {
    return this.editor.barrierColliders
  }
  /** @internal */
  get levelEditorActive() {
    return this.editor.active
  }
  set levelEditorActive(v: boolean) {
    this.editor.active = v
  }
  /** @internal LevelEditorSystem used by map bootstrap / hit meshes */
  get levelEditor() {
    return this.editor.system
  }
}
