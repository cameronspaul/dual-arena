/**
 * Viewmodel editor + gameplay input public surface.
 */
import type { ViewmodelConfig } from '../../viewmodel/config'
import type { GameEngine } from '../GameEngine'

export type ViewmodelApi = {
  isViewmodelReady(): boolean
  getViewmodelConfig(): ViewmodelConfig
  setViewmodelConfig(partial: unknown, replace?: boolean): void
  resetViewmodelConfig(): void
  setViewmodelEditorActive(active: boolean): void
  setGameplayEnabled(enabled: boolean): void
  isGameplayEnabled(): boolean
  requestPointerLock(opts?: { force?: boolean }): void
  setViewmodelArmSolo(solo: 'both' | 'left' | 'right'): void
  getViewmodelArmSolo(): 'both' | 'left' | 'right'
  hasArmBones(): boolean
  hasHandBones(): boolean
  isViewmodelEditorActive(): boolean
  setViewmodelForceAds(value: number | null): void
  getViewmodelForceAds(): number | null
  setViewmodelForceRun(value: number | null): void
  getViewmodelForceRun(): number | null
  setViewmodelFreezeBob(freeze: boolean): void
  getViewmodelFreezeBob(): boolean
  setViewmodelKeepVisible(keep: boolean): void
  getViewmodelKeepVisible(): boolean
}

export const viewmodelApi: ThisType<GameEngine> & ViewmodelApi = {
  isViewmodelReady() {
    return this.viewmodel.ready
  },
  getViewmodelConfig() {
    return this.viewmodel.getConfig()
  },
  setViewmodelConfig(partial, replace = false) {
    this.viewmodel.setConfig(partial, replace)
  },
  resetViewmodelConfig() {
    this.viewmodel.resetConfig()
  },
  setViewmodelEditorActive(active) {
    this.viewmodel.setEditorActive(active)
    this.input.setGameplayEnabled(!active)
  },
  setGameplayEnabled(enabled) {
    this.input.setGameplayEnabled(enabled)
  },
  isGameplayEnabled() {
    return this.input.isGameplayEnabled()
  },
  requestPointerLock(opts) {
    this.input.requestPointerLock(opts)
  },
  setViewmodelArmSolo(solo) {
    this.viewmodel.setArmSolo(solo)
  },
  getViewmodelArmSolo() {
    return this.viewmodel.armSolo
  },
  hasArmBones() {
    return this.viewmodel.hasArmBones()
  },
  hasHandBones() {
    return this.viewmodel.hasHandBones()
  },
  isViewmodelEditorActive() {
    return this.viewmodel.editorActive
  },
  setViewmodelForceAds(value) {
    this.viewmodel.forceAds = value
  },
  getViewmodelForceAds() {
    return this.viewmodel.forceAds
  },
  setViewmodelForceRun(value) {
    this.viewmodel.forceRun = value
  },
  getViewmodelForceRun() {
    return this.viewmodel.forceRun
  },
  setViewmodelFreezeBob(freeze) {
    this.viewmodel.freezeBob = freeze
  },
  getViewmodelFreezeBob() {
    return this.viewmodel.freezeBob
  },
  setViewmodelKeepVisible(keep) {
    this.viewmodel.keepVisible = keep
  },
  getViewmodelKeepVisible() {
    return this.viewmodel.keepVisible
  },
}
