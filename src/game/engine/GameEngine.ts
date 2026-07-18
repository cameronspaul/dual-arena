/**
 * Thin orchestrator: owns state (EngineCore), runs the frame loop,
 * and exposes the public API via installed mixins.
 */
import type { GameEngineOptions } from './types'
import { EngineCore } from './EngineCore'
import { setupEngine } from './setupEngine'
import {
  disposeEngine,
  engineLoop,
  onEngineResize,
  startEngine,
  stopEngine,
} from './frameLoop'
import {
  installEngineApi,
  type EnginePublicApi,
} from './api'

export type {
  HudListener,
  ChatLine,
  ChatListener,
  VoiceUiListener,
  GameEngineOptions,
  OnlineSessionOpts,
} from './types'

/** Public + internal methods mixed onto the class prototype. */
export interface GameEngine extends EnginePublicApi {}

export class GameEngine extends EngineCore {
  constructor(container: HTMLElement, opts: GameEngineOptions = {}) {
    super()
    setupEngine(this, container, opts)
  }

  start() {
    startEngine(this)
  }

  stop() {
    stopEngine(this)
  }

  dispose() {
    disposeEngine(this)
  }

  /** @internal */
  onResize = () => {
    onEngineResize(this)
  }

  /** @internal */
  loop = () => {
    engineLoop(this)
  }
}

installEngineApi(GameEngine)
