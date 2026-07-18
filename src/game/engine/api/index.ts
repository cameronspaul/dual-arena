import type { OnlineApi } from './onlineApi'
import { onlineApi } from './onlineApi'
import type { EditorApi } from './editorApi'
import { editorApi } from './editorApi'
import type { ViewmodelApi } from './viewmodelApi'
import { viewmodelApi } from './viewmodelApi'
import type { PlayerApi } from './playerApi'
import { playerApi } from './playerApi'
import type { GameEngine } from '../GameEngine'

export type EnginePublicApi = OnlineApi & EditorApi & ViewmodelApi & PlayerApi

/** Install public/internal methods onto GameEngine.prototype. */
export function installEngineApi(Ctor: typeof GameEngine) {
  Object.assign(Ctor.prototype, onlineApi, editorApi, viewmodelApi, playerApi)
}

export type { OnlineApi, EditorApi, ViewmodelApi, PlayerApi }
