/**
 * Online duel: net connect, chat, voice, draw/surrender, rematch, ready.
 */
import { PLAYER } from '../core/config'
import {
  NetClient,
  VoicePeer,
  type VoicePeerStatus,
} from '../net'
import {
  MATCH,
  TICK_RATE,
  pickTeamSpawn,
  type ChatBroadcastMessage,
  type DrawUpdateMessage,
  type MatchEndMessage,
  type MatchPhase,
  type RematchStartMessage,
  type RematchUpdateMessage,
  type SnapshotMessage,
  type WelcomeMessage,
} from '@glint/shared'
import { resetSniper } from '../sim/sniper'
import type { DeathReason, SniperState } from '../core/types'
import type { Prediction } from '../net'
import type { FreeCamState } from '../sim/spectate'
import type {
  ChatLine,
  ChatListener,
  OnlineSessionOpts,
  VoiceUiListener,
} from './types'
import type { PlaySpawn } from './playerLifecycle'

const READY_COOLDOWN_MS = 500
const REMATCH_COOLDOWN_MS = 500

export type OnlineSessionHost = {
  mapDef: { id: string }
  sniper: SniperState
  prevSniperPhase: SniperState['phase']
  prediction: Prediction
  waitOnRange: boolean
  isOnline: boolean
  net: NetClient | null
  voice: VoicePeer | null
  localPlayerId: string | null
  onlineStatus: string
  chatLines: ChatLine[]
  chatListeners: Set<ChatListener>
  voiceUiListeners: Set<VoiceUiListener>
  chatIdSeq: number
  matchEnd: MatchEndMessage | null
  pendingDrawFromId: string | null
  pendingSnapshots: SnapshotMessage[]
  serverTickRate: number
  matchFirstTo: number
  localReady: boolean
  enemyReady: boolean
  lastReadyToggleAt: number
  localRematchReady: boolean
  enemyRematchReady: boolean
  rematchAvailable: boolean
  lastRematchToggleAt: number
  enemyKills: number
  teamColor: 'blue' | 'red' | null
  onlineTeamSpawnReady: boolean
  playSpawn: PlaySpawn
  playerHp: number
  playerAlive: boolean
  kills: number
  deathReason: DeathReason | null
  freeCam: FreeCamState | null
  voluntaryFreeCam: boolean
  matchPhase: MatchPhase | null
  pingMs: number | null
  applySpawn(
    spawn: { x: number; y: number; z: number },
    spawnYaw: number,
  ): void
  rebuildFallKillY(): void
  emitHud(): void
}

export function connectOnline(host: OnlineSessionHost, online: OnlineSessionOpts) {
  const token =
    online.token?.trim() || `p-${Math.random().toString(36).slice(2, 10)}`

  host.voice?.dispose()
  host.voice = new VoicePeer({
    sendSignal: (signal) => host.net?.sendVoiceSignal(signal),
    onStatus: () => emitVoiceUi(host),
    onRemoteSpeaking: () => emitVoiceUi(host),
    onLocalTalking: () => emitVoiceUi(host),
  })

  host.net = new NetClient({
    url: online.serverUrl,
    matchId: online.matchId,
    token,
    // Room map may be the duel arena while we visually sit on the range
    mapId: online.mapId ?? host.mapDef.id,
    hostName: online.hostName,
    wager: online.wager,
    handlers: {
      onWelcome: (w) => onNetWelcome(host, w),
      onSnapshot: (s) => host.pendingSnapshots.push(s),
      onMatchEnd: (m) => {
        host.matchEnd = m
        host.pendingDrawFromId = null
        host.localRematchReady = false
        host.enemyRematchReady = false
        // Eligible until snapshot shows opponent left
        host.rematchAvailable = m.reason !== 'disconnect'
        host.emitHud()
      },
      onDrawUpdate: (m) => onDrawUpdate(host, m),
      onRematchUpdate: (m) => onRematchUpdate(host, m),
      onRematchStart: (m) => onRematchStart(host, m),
      onPong: (rtt) => {
        host.pingMs = rtt
      },
      onStatus: (status, detail) => {
        host.onlineStatus = detail ? `${status}: ${detail}` : status
        console.info('[net]', status, detail ?? '')
      },
      onError: (e) => {
        console.warn('[net] error', e.code, e.message)
        // Forfeit closed the lobby — surface as match end so HUD / rejoin clear
        if (
          (e.code === 'match_ended' || e.code === 'lobby_closed') &&
          !host.matchEnd
        ) {
          host.matchEnd = {
            type: 'match_end',
            winnerId: null,
            scores: {},
            reason: 'disconnect',
          }
        }
      },
      onChat: (msg) => onNetChat(host, msg),
      onVoiceSignal: (msg) => {
        void host.voice?.handleSignal(msg.fromId, msg.signal)
      },
    },
  })
  host.net.connect()
}

export function onNetWelcome(host: OnlineSessionHost, w: WelcomeMessage) {
  host.localPlayerId = w.playerId
  host.voice?.setLocalPlayerId(w.playerId)
  host.serverTickRate = w.tickRate || TICK_RATE
  host.matchFirstTo = w.firstTo ?? MATCH.firstTo
  host.teamColor = w.teamColor ?? (w.team === 0 ? 'blue' : 'red')
  // Prefer server-provided pad (map blue/red); fallback to shared table.
  // Host wait room stays on practice-range spawns — duel pads load after remount.
  if (!host.waitOnRange) {
    const spawn =
      w.spawn ?? pickTeamSpawn(w.mapId || host.mapDef.id, w.team)
    host.applySpawn(
      { x: spawn.x, y: spawn.y, z: spawn.z },
      spawn.yaw,
    )
    host.playSpawn = {
      spawn: { x: spawn.x, y: spawn.y, z: spawn.z },
      spawnYaw: spawn.yaw,
    }
    host.onlineTeamSpawnReady = true
    host.rebuildFallKillY()
  }
  host.playerHp = PLAYER.maxHp
  host.playerAlive = true
  host.kills = 0
  host.enemyKills = 0
  host.localReady = false
  host.enemyReady = false
  host.lastReadyToggleAt = 0
  host.localRematchReady = false
  host.enemyRematchReady = false
  host.rematchAvailable = false
  host.lastRematchToggleAt = 0
  host.prediction.clear()
  // Clean weapon FSM after rejoin — snapshots will authoritatively fill ammo/phase
  resetSniper(host.sniper)
  host.prevSniperPhase = 'ready'
  host.matchEnd = null
  host.pendingDrawFromId = null
  host.deathReason = null
  host.freeCam = null
  host.voluntaryFreeCam = false
  console.info(
    '[net] welcome',
    w.playerId,
    host.teamColor,
    'map',
    w.mapId,
    host.waitOnRange ? '(wait-room range)' : '',
    'firstTo',
    host.matchFirstTo,
  )
}

export function onNetChat(host: OnlineSessionHost, msg: ChatBroadcastMessage) {
  host.chatIdSeq += 1
  const line: ChatLine = {
    id: `c-${host.chatIdSeq}-${msg.t}`,
    fromId: msg.fromId,
    self: msg.fromId === host.localPlayerId,
    text: msg.text,
    t: msg.t,
  }
  host.chatLines = [...host.chatLines.slice(-49), line]
  for (const fn of host.chatListeners) fn(host.chatLines)
}

export function onChat(
  host: OnlineSessionHost,
  fn: ChatListener,
): () => void {
  host.chatListeners.add(fn)
  fn(host.chatLines)
  return () => host.chatListeners.delete(fn)
}

export function sendChat(host: OnlineSessionHost, text: string) {
  if (!host.isOnline || !host.net) return
  host.net.sendChat(text)
}

export function onVoiceUi(
  host: OnlineSessionHost,
  fn: VoiceUiListener,
): () => void {
  host.voiceUiListeners.add(fn)
  emitVoiceUi(host, fn)
  return () => host.voiceUiListeners.delete(fn)
}

export function emitVoiceUi(host: OnlineSessionHost, only?: VoiceUiListener) {
  const state = {
    status: host.voice?.getStatus() ?? ('idle' as VoicePeerStatus),
    talking: host.voice?.isTalking() ?? false,
    micReady: host.voice?.isMicReady() ?? false,
    speakerEnabled: host.voice?.isSpeakerEnabled() ?? true,
    remoteSpeaking: host.voice?.isRemoteSpeaking() ?? false,
  }
  if (only) {
    only(state)
    return
  }
  for (const fn of host.voiceUiListeners) fn(state)
}

/** Push-to-talk: hold true while speaking. First press asks for mic permission. */
export async function setVoiceTalking(host: OnlineSessionHost, talking: boolean) {
  if (!host.voice) return
  await host.voice.setTalking(talking)
  emitVoiceUi(host)
}

/** Warm up mic permission without transmitting (optional). */
export async function prepareVoiceMic(host: OnlineSessionHost) {
  if (!host.voice) return false
  const ok = await host.voice.prepareMic()
  emitVoiceUi(host)
  return ok
}

export function setVoiceSpeakerEnabled(
  host: OnlineSessionHost,
  enabled: boolean,
) {
  if (!host.voice) return
  host.voice.setSpeakerEnabled(enabled)
  emitVoiceUi(host)
}

/** Remote voice chat level (0–1). */
export function setVoiceVolume(host: OnlineSessionHost, volume: number) {
  if (!host.voice) return
  host.voice.setVoiceVolume(volume)
}

/** Pull voice volume from live user settings (settings slider mid-match). */
export function syncVoiceFromUserSettings(host: OnlineSessionHost) {
  host.voice?.syncFromUserSettings()
}

/** Wire opponent id into voice when both seats are filled. */
export function syncVoicePeerFromSnapshot(
  host: OnlineSessionHost,
  snap: SnapshotMessage,
) {
  if (!host.voice || !host.localPlayerId) return
  const other = snap.players.find((p) => p.id !== host.localPlayerId)
  if (other) host.voice.ensurePeer(other.id)
}

/**
 * Competitive phases where surrender / draw are allowed
 * (countdown, live, round_reset — not pregame / waiting / rejoin).
 */
export function canOfferAgreement(host: OnlineSessionHost): boolean {
  if (!host.isOnline || !host.net || host.matchEnd) return false
  const p = host.matchPhase
  return p === 'live' || p === 'countdown' || p === 'round_reset'
}

/** Voluntary forfeit — opponent wins. */
export function surrender(host: OnlineSessionHost): boolean {
  if (!canOfferAgreement(host) || !host.net) return false
  host.net.sendSurrender()
  return true
}

/** Offer a mutual draw (or accept if opponent already offered). */
export function offerDraw(host: OnlineSessionHost): boolean {
  if (!canOfferAgreement(host) || !host.net) return false
  host.net.sendDrawOffer()
  return true
}

/** Accept a pending draw offer from the opponent. */
export function acceptDraw(host: OnlineSessionHost): boolean {
  if (!canOfferAgreement(host) || !host.net) return false
  if (!host.pendingDrawFromId || host.pendingDrawFromId === host.localPlayerId)
    return false
  host.net.sendDrawResponse(true)
  return true
}

/** Decline a pending draw offer from the opponent. */
export function declineDraw(host: OnlineSessionHost): boolean {
  if (!host.net) return false
  if (!host.pendingDrawFromId || host.pendingDrawFromId === host.localPlayerId)
    return false
  host.net.sendDrawResponse(false)
  return true
}

/** Cancel your own pending draw offer. */
export function cancelDraw(host: OnlineSessionHost): boolean {
  if (!host.net) return false
  if (host.pendingDrawFromId !== host.localPlayerId) return false
  host.net.sendDrawCancel()
  return true
}

export function onDrawUpdate(host: OnlineSessionHost, m: DrawUpdateMessage) {
  if (m.status === 'pending') {
    host.pendingDrawFromId = m.fromId
  } else {
    // declined / cancelled
    host.pendingDrawFromId = null
  }
  host.emitHud()
}

export function onRematchUpdate(
  host: OnlineSessionHost,
  m: RematchUpdateMessage,
) {
  const self = host.localPlayerId
  const ready = new Set(m.readyIds)
  host.localRematchReady = self ? ready.has(self) : false
  host.enemyRematchReady = [...ready].some((id) => id !== self)
  host.emitHud()
}

export function onRematchStart(
  host: OnlineSessionHost,
  _m: RematchStartMessage,
) {
  clearMatchEndForRematch(host)
  host.emitHud()
}

/** Clear post-match state when the room restarts for another duel. */
export function clearMatchEndForRematch(host: OnlineSessionHost) {
  host.matchEnd = null
  host.localRematchReady = false
  host.enemyRematchReady = false
  host.rematchAvailable = false
  host.pendingDrawFromId = null
  host.kills = 0
  host.enemyKills = 0
  host.localReady = false
  host.enemyReady = false
}

/**
 * Post-match rematch vote. Both players must vote for the server to reset.
 * @returns true if the request was sent.
 */
export function setRematch(host: OnlineSessionHost, ready: boolean): boolean {
  if (!host.isOnline || !host.net || !host.matchEnd) return false
  if (!host.rematchAvailable) return false
  if (host.matchEnd.reason === 'disconnect') return false
  if (host.localRematchReady === ready) return false
  const now = performance.now()
  if (now - host.lastRematchToggleAt < REMATCH_COOLDOWN_MS) {
    return false
  }
  host.lastRematchToggleAt = now
  host.localRematchReady = ready
  host.net.sendRematch(ready)
  host.emitHud()
  return true
}

/** Toggle rematch vote on the post-match screen. */
export function toggleRematch(host: OnlineSessionHost): boolean {
  return setRematch(host, !host.localRematchReady)
}

/**
 * Pregame ready toggle — both players must ready to start the countdown.
 * 0.5s cooldown between changes so ready/unready can't be spammed.
 * @returns true if the state actually changed.
 */
export function setReady(host: OnlineSessionHost, ready: boolean): boolean {
  if (!host.isOnline || !host.net) return false
  if (host.matchPhase !== 'pregame' && host.matchPhase !== 'waiting')
    return false
  if (host.localReady === ready) return false
  const now = performance.now()
  if (now - host.lastReadyToggleAt < READY_COOLDOWN_MS) return false
  host.lastReadyToggleAt = now
  host.localReady = ready
  host.net.sendReady(ready)
  host.emitHud()
  return true
}

/** Toggle ready; returns true if the state changed. */
export function toggleReady(host: OnlineSessionHost): boolean {
  return setReady(host, !host.localReady)
}
