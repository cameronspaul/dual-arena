/**
 * Online match public surface (chat, voice, draw, rematch, ready).
 */
import type {
  ChatListener,
  VoiceUiListener,
} from '../types'
import {
  acceptDraw,
  canOfferAgreement,
  cancelDraw,
  declineDraw,
  offerDraw,
  onChat,
  onVoiceUi,
  prepareVoiceMic,
  sendChat,
  setReady,
  setRematch,
  setVoiceSpeakerEnabled,
  setVoiceTalking,
  setVoiceVolume,
  surrender,
  syncVoiceFromUserSettings,
  toggleReady,
  toggleRematch,
} from '../onlineSession'
import type { GameEngine } from '../GameEngine'

export type OnlineApi = {
  onChat(fn: ChatListener): () => void
  sendChat(text: string): void
  onVoiceUi(fn: VoiceUiListener): () => void
  setVoiceTalking(talking: boolean): Promise<void>
  prepareVoiceMic(): Promise<boolean>
  setVoiceSpeakerEnabled(enabled: boolean): void
  setVoiceVolume(volume: number): void
  syncVoiceFromUserSettings(): void
  isOnlineMode(): boolean
  getOnlineStatus(): string
  getMatchEnd(): GameEngine['matchEnd']
  getLocalPlayerId(): string | null
  getPendingDrawFromId(): string | null
  canOfferAgreement(): boolean
  surrender(): boolean
  offerDraw(): boolean
  acceptDraw(): boolean
  declineDraw(): boolean
  cancelDraw(): boolean
  setRematch(ready: boolean): boolean
  toggleRematch(): boolean
  setReady(ready: boolean): boolean
  toggleReady(): boolean
  isLocalReady(): boolean
  getMatchPhase(): GameEngine['matchPhase']
}

export const onlineApi: ThisType<GameEngine> & OnlineApi = {
  onChat(fn) {
    return onChat(this, fn)
  },
  sendChat(text) {
    sendChat(this, text)
  },
  onVoiceUi(fn) {
    return onVoiceUi(this, fn)
  },
  async setVoiceTalking(talking) {
    await setVoiceTalking(this, talking)
  },
  async prepareVoiceMic() {
    return prepareVoiceMic(this)
  },
  setVoiceSpeakerEnabled(enabled) {
    setVoiceSpeakerEnabled(this, enabled)
  },
  setVoiceVolume(volume) {
    setVoiceVolume(this, volume)
  },
  syncVoiceFromUserSettings() {
    syncVoiceFromUserSettings(this)
  },
  isOnlineMode() {
    return this.isOnline
  },
  getOnlineStatus() {
    return this.onlineStatus
  },
  getMatchEnd() {
    return this.matchEnd
  },
  getLocalPlayerId() {
    return this.localPlayerId
  },
  getPendingDrawFromId() {
    return this.pendingDrawFromId
  },
  canOfferAgreement() {
    return canOfferAgreement(this)
  },
  surrender() {
    return surrender(this)
  },
  offerDraw() {
    return offerDraw(this)
  },
  acceptDraw() {
    return acceptDraw(this)
  },
  declineDraw() {
    return declineDraw(this)
  },
  cancelDraw() {
    return cancelDraw(this)
  },
  setRematch(ready) {
    return setRematch(this, ready)
  },
  toggleRematch() {
    return toggleRematch(this)
  },
  setReady(ready) {
    return setReady(this, ready)
  },
  toggleReady() {
    return toggleReady(this)
  },
  isLocalReady() {
    return this.localReady
  },
  getMatchPhase() {
    return this.matchPhase
  },
}
