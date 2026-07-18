/**
 * RAF loop, sim tick dispatch, dispose.
 */
import * as THREE from 'three'
import { DEBUG } from '../core/config'
import { countNearbyCollisionMeshes, perfEma } from '../maps'
import { tickOffline } from './tick/tickOffline'
import { tickOnline } from './tick/tickOnline'
import { tickOnlineDead } from './tick/tickOnlineDead'
import { tickLevelEditor } from './tick/tickLevelEditor'
import { flushNetSnapshots } from './tick/netApply'
import type { GameEngine } from './GameEngine'

export function startEngine(eng: GameEngine) {
  if (eng.running) return
  eng.running = true
  eng.lastTime = performance.now()
  eng.clock.start()
  eng.loop()
}

export function stopEngine(eng: GameEngine) {
  eng.running = false
  cancelAnimationFrame(eng.raf)
}

export function disposeEngine(eng: GameEngine) {
  stopEngine(eng)
  eng.voice?.dispose()
  eng.voice = null
  eng.net?.disconnect()
  eng.net = null
  eng.chatListeners.clear()
  eng.voiceUiListeners.clear()
  eng.chatLines = []
  eng.remotes.clear()
  eng.prediction.clear()
  eng.input.setPointerLockChangeListener(null)
  eng.input.detach()
  window.removeEventListener('resize', eng.onResize)
  eng.editor.dispose()
  eng.barrierVisuals.dispose()
  eng.renderer.dispose()
  eng.renderer.domElement.remove()
  for (const t of eng.envTextures) t.dispose()
  eng.envTextures = []
  eng.scene.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      obj.geometry.dispose()
      const m = obj.material
      if (Array.isArray(m)) m.forEach((x) => x.dispose())
      else m.dispose()
    }
  })
}

export function onEngineResize(eng: GameEngine) {
  const w = eng.container.clientWidth || window.innerWidth
  const h = eng.container.clientHeight || window.innerHeight
  eng.camera.aspect = w / h
  eng.camera.updateProjectionMatrix()
  eng.renderer.setSize(w, h)
}

export function engineLoop(eng: GameEngine) {
  if (!eng.running) return
  eng.raf = requestAnimationFrame(() => engineLoop(eng))
  const now = performance.now()
  let dt = (now - eng.lastTime) / 1000
  eng.lastTime = now

  if (dt > 0 && dt < 1) {
    eng.frameTimeEma = eng.frameTimeEma * 0.9 + dt * 0.1
    eng.fps = Math.round(1 / eng.frameTimeEma)
    eng.frameMsEma = perfEma(eng.frameMsEma, dt * 1000, 0.12)
  }

  dt = Math.min(dt, 0.05)

  const t0 = performance.now()
  engineTick(eng, dt)
  const t1 = performance.now()
  eng.renderer.render(eng.scene, eng.camera)
  const t2 = performance.now()

  if (DEBUG.showPerf) {
    eng.simMsEma = perfEma(eng.simMsEma, t1 - t0)
    eng.renderMsEma = perfEma(eng.renderMsEma, t2 - t1)
    eng.nearbyCollision = countNearbyCollisionMeshes(
      eng.meshWorld,
      eng.player.position,
      8,
    )
  }
}

export function engineTick(eng: GameEngine, dt: number) {
  const input = eng.input.sample()
  eng.lastInput = input
  eng.input.setAdsBlend(eng.sniper.adsBlend)

  if (eng.editor.active) {
    if (eng.isOnline) {
      eng.editor.setActive(false)
    } else {
      tickLevelEditor(eng, dt, input)
      return
    }
  }

  if (eng.isOnline) {
    flushNetSnapshots(eng, dt)
  }

  if (eng.isOnline && !eng.playerAlive) {
    tickOnlineDead(eng, dt, input)
    return
  }

  if (!eng.playerAlive || (!eng.isOnline && eng.voluntaryFreeCam)) {
    eng.tickSpectate(dt, input)
    return
  }

  if (eng.isOnline) {
    tickOnline(eng, dt, input)
    return
  }

  tickOffline(eng, dt, input)
}
