/**
 * One-time construction: scene, renderer, subsystems, map bootstrap, net.
 */
import * as THREE from 'three'
import { LOOK } from '../core/config'
import {
  getMap,
  loadBarrierLayout,
  loadSpawnLayout,
} from '../maps'
import { createPlayer } from '../sim/player'
import { createDummies } from '../sim/world'
import type { GameEngineOptions } from './types'
import { LevelEditorSession } from './levelEditorSession'
import { connectOnline } from './onlineSession'
import { bootstrapMap } from './mapBootstrap'
import type { GameEngine } from './GameEngine'

export function setupEngine(
  eng: GameEngine,
  container: HTMLElement,
  opts: GameEngineOptions = {},
) {
  eng.container = container
  eng.mapDef = getMap(opts.mapId)
  eng.skyboxId = opts.skybox ?? 'day'
  eng.isOnline = opts.mode === 'online' && !!opts.online?.serverUrl
  eng.waitOnRange = Boolean(opts.online?.waitOnRange) && eng.isOnline

  eng.editor = new LevelEditorSession(
    {
      player: eng.player,
      mapId: eng.mapDef.id,
      barrierVisuals: eng.barrierVisuals,
      applySpawn: (s, yaw) => eng.applySpawn(s, yaw),
      rebuildFallKillY: () => eng.rebuildFallKillY(),
    },
    eng.mapDef.id,
    loadSpawnLayout(eng.mapDef.id),
    loadBarrierLayout(eng.mapDef.id),
  )

  if (eng.isOnline) {
    eng.dummiesEnabled = eng.waitOnRange
    if (eng.waitOnRange) {
      eng.matchWaiting = true
      eng.matchPhase = 'waiting'
    }
  }

  eng.scene = new THREE.Scene()
  eng.scene.background = new THREE.Color(eng.mapDef.bgColor)
  eng.scene.fog = new THREE.Fog(
    eng.mapDef.fogColor,
    eng.mapDef.fogNear,
    eng.mapDef.fogFar,
  )

  const w = container.clientWidth || window.innerWidth
  const h = container.clientHeight || window.innerHeight
  eng.camera = new THREE.PerspectiveCamera(
    LOOK.hipFov,
    w / h,
    0.05,
    eng.mapDef.cameraFar,
  )
  eng.camera.rotation.order = 'YXZ'

  eng.renderer = new THREE.WebGLRenderer({
    antialias: true,
    powerPreference: 'high-performance',
  })
  eng.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
  eng.renderer.setSize(w, h)
  eng.renderer.shadowMap.enabled = true
  eng.renderer.shadowMap.type = THREE.PCFShadowMap
  container.appendChild(eng.renderer.domElement)
  eng.renderer.domElement.classList.add('touch-none', 'outline-none')
  eng.renderer.domElement.tabIndex = 0

  eng.player = createPlayer(eng.mapDef.spawn)
  eng.player.yaw = eng.mapDef.spawnYaw
  eng.input.setLook(eng.mapDef.spawnYaw, 0)
  eng.editor.setHost({
    player: eng.player,
    mapId: eng.mapDef.id,
    barrierVisuals: eng.barrierVisuals,
    applySpawn: (s, yaw) => eng.applySpawn(s, yaw),
    rebuildFallKillY: () => eng.rebuildFallKillY(),
  })

  eng.dummies = createDummies({
    defs: eng.mapDef.dummies,
    bounds: eng.mapDef.dummyBounds,
  })

  eng.combatFx.build(eng.scene)
  eng.playerVisuals.buildPlaceholder(eng.scene)
  eng.scene.add(eng.editor.system.root)
  eng.scene.add(eng.barrierVisuals.root)
  eng.editor.system.sync(eng.editor.spawnLayout.spawns)
  eng.editor.system.syncBarriers(eng.editor.barrierLayout.barriers)
  eng.barrierVisuals.sync(eng.editor.barrierLayout.barriers)
  void bootstrapMap(eng)
  void eng.viewmodel.load(eng.camera, eng.scene)
  eng.input.attach(eng.renderer.domElement)
  eng.input.setPointerLockChangeListener(() => {
    eng.emitHud()
  })

  if (eng.isOnline && opts.online) {
    void eng.remotes.ensureLoaded(eng.scene)
    connectOnline(eng, opts.online)
  }

  window.addEventListener('resize', eng.onResize)
}
