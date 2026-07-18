/**
 * 1v1 WebRTC voice (in-match only).
 *
 * Signaling over the game WebSocket; media is P2P (STUN).
 * Deterministic initiator: lower playerId creates the offer (no glare).
 * Mic transmit is gated by setTalking (PTT / open-mic / off from settings).
 */
import type { VoiceSignal } from '@duel/shared'
import { getUserSettings } from '../core/userSettings'

export type VoicePeerStatus =
  | 'idle'
  | 'need_permission'
  | 'connecting'
  | 'connected'
  | 'failed'
  | 'closed'

export type VoicePeerHandlers = {
  onStatus?: (status: VoicePeerStatus, detail?: string) => void
  onRemoteSpeaking?: (speaking: boolean) => void
  onLocalTalking?: (talking: boolean) => void
  sendSignal: (signal: VoiceSignal) => void
}

const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
]

export class VoicePeer {
  private pc: RTCPeerConnection | null = null
  private localStream: MediaStream | null = null
  private remoteAudio: HTMLAudioElement
  private handlers: VoicePeerHandlers
  private localId: string | null = null
  private remoteId: string | null = null
  private status: VoicePeerStatus = 'idle'
  private disposed = false
  private speakerEnabled = true
  private voiceVolume = 1
  private talking = false
  private remoteSpeaking = false
  private micReady = false
  private pendingIce: RTCIceCandidateInit[] = []
  private remoteDescSet = false
  private starting = false
  private speakingTimer: ReturnType<typeof setTimeout> | null = null
  private audioCtx: AudioContext | null = null

  constructor(handlers: VoicePeerHandlers) {
    this.handlers = handlers
    this.remoteAudio = document.createElement('audio')
    this.remoteAudio.autoplay = true
    this.remoteAudio.setAttribute('playsinline', 'true')
    // Keep in DOM so some browsers allow playback after gesture
    this.remoteAudio.style.display = 'none'
    document.body.appendChild(this.remoteAudio)
    this.voiceVolume = clamp01(getUserSettings().voiceVolume)
    this.applyRemoteVolume()
  }

  getStatus() {
    return this.status
  }

  /** True while local mic track is actively sending (PTT held). */
  isTalking() {
    return this.talking
  }

  /** Mic device acquired (permission granted). */
  isMicReady() {
    return this.micReady
  }

  isSpeakerEnabled() {
    return this.speakerEnabled
  }

  isRemoteSpeaking() {
    return this.remoteSpeaking
  }

  setLocalPlayerId(id: string) {
    this.localId = id
  }

  /**
   * Know the opponent — create the PC. Initiator sends offer once mic is ready
   * (or immediately for recv-only so ICE can start after either side enables).
   */
  ensurePeer(remotePlayerId: string) {
    if (this.disposed || !this.localId) return
    if (this.remoteId === remotePlayerId && this.pc) return
    this.remoteId = remotePlayerId
    void this.ensurePc()
  }

  private isInitiator(): boolean {
    if (!this.localId || !this.remoteId) return false
    return this.localId < this.remoteId
  }

  private setStatus(status: VoicePeerStatus, detail?: string) {
    this.status = status
    this.handlers.onStatus?.(status, detail)
  }

  private async ensurePc() {
    if (this.disposed || this.pc || this.starting) return
    if (!this.localId || !this.remoteId) return
    this.starting = true
    try {
      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS })
      this.pc = pc
      this.remoteDescSet = false
      this.pendingIce = []
      this.setStatus('connecting')

      pc.onicecandidate = (ev) => {
        if (!ev.candidate) return
        this.handlers.sendSignal({
          kind: 'ice',
          candidate: ev.candidate.candidate,
          sdpMid: ev.candidate.sdpMid,
          sdpMLineIndex: ev.candidate.sdpMLineIndex,
        })
      }

      pc.onconnectionstatechange = () => {
        const s = pc.connectionState
        if (s === 'connected') this.setStatus('connected')
        else if (s === 'failed') this.setStatus('failed', 'Connection failed (NAT?)')
        else if (s === 'disconnected') this.setStatus('connecting', 'Reconnecting…')
        else if (s === 'closed' && !this.disposed) this.setStatus('closed')
      }

      pc.ontrack = (ev) => {
        const stream = ev.streams[0] ?? new MediaStream([ev.track])
        this.remoteAudio.srcObject = stream
        this.applyRemoteVolume()
        void this.tryPlayRemote()
        this.watchRemoteAudio(stream)
      }

      // Always have a send slot so replaceTrack works without renegotiation
      pc.addTransceiver('audio', { direction: 'sendrecv' })

      // Attach mic if already granted
      if (this.localStream) {
        await this.bindMicToPc()
      }

      // Only initiator creates the first offer
      if (this.isInitiator()) {
        await this.createAndSendOffer()
      }
    } catch (err) {
      console.warn('[voice] ensurePc failed', err)
      this.setStatus('failed', err instanceof Error ? err.message : 'setup failed')
    } finally {
      this.starting = false
    }
  }

  private async createAndSendOffer() {
    const pc = this.pc
    if (!pc || this.disposed) return
    try {
      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)
      if (pc.localDescription?.sdp) {
        this.handlers.sendSignal({
          kind: 'offer',
          sdp: pc.localDescription.sdp,
        })
      }
    } catch (err) {
      console.warn('[voice] createOffer failed', err)
    }
  }

  private async flushIce() {
    const pc = this.pc
    if (!pc || !this.remoteDescSet) return
    const queued = this.pendingIce
    this.pendingIce = []
    for (const c of queued) {
      try {
        await pc.addIceCandidate(c)
      } catch (err) {
        console.warn('[voice] queued ice failed', err)
      }
    }
  }

  async handleSignal(fromId: string, signal: VoiceSignal) {
    if (this.disposed) return
    if (!this.remoteId) this.remoteId = fromId
    else if (fromId !== this.remoteId) this.remoteId = fromId

    if (!this.pc) await this.ensurePc()
    const pc = this.pc
    if (!pc) return

    try {
      if (signal.kind === 'hangup') {
        this.teardownPc(false)
        return
      }

      if (signal.kind === 'ice') {
        const init: RTCIceCandidateInit = {
          candidate: signal.candidate,
          sdpMid: signal.sdpMid,
          sdpMLineIndex: signal.sdpMLineIndex,
        }
        if (!this.remoteDescSet) {
          this.pendingIce.push(init)
          return
        }
        try {
          await pc.addIceCandidate(init)
        } catch (err) {
          console.warn('[voice] ice error', err)
        }
        return
      }

      if (signal.kind === 'offer') {
        // Non-initiator (or late restart): accept offer and answer
        if (pc.signalingState !== 'stable' && pc.signalingState !== 'have-remote-offer') {
          // Reset if we're in a weird state
          try {
            await pc.setLocalDescription({ type: 'rollback' })
          } catch {
            /* older browsers */
          }
        }
        await pc.setRemoteDescription({ type: 'offer', sdp: signal.sdp })
        this.remoteDescSet = true
        await this.flushIce()
        const answer = await pc.createAnswer()
        await pc.setLocalDescription(answer)
        if (pc.localDescription?.sdp) {
          this.handlers.sendSignal({
            kind: 'answer',
            sdp: pc.localDescription.sdp,
          })
        }
        return
      }

      if (signal.kind === 'answer') {
        if (pc.signalingState !== 'have-local-offer') {
          // Stale answer
          return
        }
        await pc.setRemoteDescription({ type: 'answer', sdp: signal.sdp })
        this.remoteDescSet = true
        await this.flushIce()
      }
    } catch (err) {
      console.warn('[voice] handleSignal failed', err)
      this.setStatus('failed', err instanceof Error ? err.message : 'signal error')
    }
  }

  /**
   * Request mic permission and prepare PTT. Call from a user gesture
   * (first Speak press). Does not start transmitting until setTalking(true).
   */
  async prepareMic(): Promise<boolean> {
    if (this.disposed) return false
    if (this.micReady && this.localStream) return true
    try {
      this.setStatus(
        this.status === 'connected' ? 'connected' : 'need_permission',
        'Requesting mic…',
      )
      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      })
      // Start muted — PTT enables the track
      for (const t of this.localStream.getAudioTracks()) {
        t.enabled = false
      }
      this.micReady = true
      if (this.pc) {
        await this.bindMicToPc()
        // Renegotiate so remote gets the new track if needed
        if (this.isInitiator() && this.pc.signalingState === 'stable') {
          await this.createAndSendOffer()
        }
      } else if (this.remoteId) {
        await this.ensurePc()
      }
      void this.tryPlayRemote()
      void this.audioCtx?.resume()
      if (this.status !== 'connected') {
        this.setStatus(this.pc ? 'connecting' : 'need_permission')
      }
      return true
    } catch (err) {
      console.warn('[voice] mic permission failed', err)
      this.micReady = false
      this.setStatus('failed', 'Microphone blocked — allow mic in browser')
      return false
    }
  }

  private async bindMicToPc() {
    const pc = this.pc
    const stream = this.localStream
    if (!pc || !stream) return
    const track = stream.getAudioTracks()[0]
    if (!track) return
    track.enabled = this.talking
    const sender =
      pc.getSenders().find((s) => s.track?.kind === 'audio') ??
      pc.getSenders().find((s) => !s.track)
    if (sender) {
      await sender.replaceTrack(track)
    } else {
      pc.addTrack(track, stream)
    }
  }

  /**
   * Push-to-talk: enable local mic track while held.
   * First call prepares mic (permission) if needed.
   */
  async setTalking(talking: boolean) {
    if (this.disposed) return
    // Full voice-off: never transmit
    if (talking && getUserSettings().voiceMode === 'off') {
      this.talking = false
      if (this.localStream) {
        for (const t of this.localStream.getAudioTracks()) t.enabled = false
      }
      this.handlers.onLocalTalking?.(false)
      return
    }
    if (talking) {
      const ok = await this.prepareMic()
      if (!ok) {
        this.talking = false
        this.handlers.onLocalTalking?.(false)
        return
      }
    }
    this.talking = talking
    if (this.localStream) {
      for (const t of this.localStream.getAudioTracks()) {
        t.enabled = talking
      }
    }
    void this.tryPlayRemote()
    this.handlers.onLocalTalking?.(talking)
  }

  setSpeakerEnabled(enabled: boolean) {
    this.speakerEnabled = enabled
    this.applyRemoteVolume()
    const s = getUserSettings()
    if (enabled && s.voiceMode !== 'off' && !s.muted) {
      void this.tryPlayRemote()
    }
  }

  /** Remote voice chat level (0–1). Independent of SFX buses. */
  setVoiceVolume(volume: number) {
    this.voiceVolume = clamp01(volume)
    this.applyRemoteVolume()
  }

  getVoiceVolume() {
    return this.voiceVolume
  }

  /** True when settings mode fully disables send + hear. */
  isVoiceFullyOff() {
    return getUserSettings().voiceMode === 'off'
  }

  /**
   * Re-read voice volume / mode from live user settings (slider or mode mid-match).
   * Voice-off forces remote mute and local mic off.
   */
  syncFromUserSettings() {
    this.voiceVolume = clamp01(getUserSettings().voiceVolume)
    if (getUserSettings().voiceMode === 'off') {
      this.talking = false
      if (this.localStream) {
        for (const t of this.localStream.getAudioTracks()) t.enabled = false
      }
      this.handlers.onLocalTalking?.(false)
    }
    this.applyRemoteVolume()
  }

  private applyRemoteVolume() {
    const settings = getUserSettings()
    // Voice-off or global mute: silence opponent completely
    if (settings.voiceMode === 'off' || settings.muted) {
      this.remoteAudio.volume = 0
      this.remoteAudio.muted = true
      return
    }
    this.remoteAudio.volume = this.speakerEnabled ? this.voiceVolume : 0
    this.remoteAudio.muted = !this.speakerEnabled || this.voiceVolume <= 0
  }

  private async tryPlayRemote() {
    try {
      if (!this.audioCtx) {
        this.audioCtx = new AudioContext()
      }
      if (this.audioCtx.state === 'suspended') {
        await this.audioCtx.resume()
      }
      this.applyRemoteVolume()
      await this.remoteAudio.play()
    } catch {
      /* need user gesture — PTT will retry */
    }
  }

  private watchRemoteAudio(stream: MediaStream) {
    if (this.speakingTimer) {
      clearTimeout(this.speakingTimer)
      this.speakingTimer = null
    }
    try {
      if (!this.audioCtx) this.audioCtx = new AudioContext()
      const source = this.audioCtx.createMediaStreamSource(stream)
      const analyser = this.audioCtx.createAnalyser()
      analyser.fftSize = 256
      source.connect(analyser)
      const data = new Uint8Array(analyser.frequencyBinCount)
      const tick = () => {
        if (this.disposed || this.remoteAudio.srcObject !== stream) return
        analyser.getByteFrequencyData(data)
        let sum = 0
        for (let i = 0; i < data.length; i++) sum += data[i]!
        const avg = sum / data.length
        const speaking = avg > 10
        if (speaking !== this.remoteSpeaking) {
          this.remoteSpeaking = speaking
          this.handlers.onRemoteSpeaking?.(speaking)
        }
        this.speakingTimer = setTimeout(tick, 100)
      }
      tick()
    } catch {
      /* optional */
    }
  }

  private teardownPc(notify: boolean) {
    if (this.speakingTimer) {
      clearTimeout(this.speakingTimer)
      this.speakingTimer = null
    }
    if (this.pc) {
      this.pc.onicecandidate = null
      this.pc.ontrack = null
      this.pc.onconnectionstatechange = null
      try {
        this.pc.close()
      } catch {
        /* ignore */
      }
      this.pc = null
    }
    this.remoteAudio.srcObject = null
    this.remoteSpeaking = false
    this.remoteDescSet = false
    this.pendingIce = []
    if (notify) {
      try {
        this.handlers.sendSignal({ kind: 'hangup' })
      } catch {
        /* ignore */
      }
    }
  }

  dispose() {
    this.disposed = true
    this.talking = false
    this.teardownPc(true)
    if (this.localStream) {
      for (const t of this.localStream.getTracks()) t.stop()
      this.localStream = null
    }
    this.micReady = false
    try {
      this.remoteAudio.remove()
    } catch {
      /* ignore */
    }
    if (this.audioCtx) {
      void this.audioCtx.close()
      this.audioCtx = null
    }
    this.setStatus('closed')
  }
}

function clamp01(n: number) {
  return Math.min(1, Math.max(0, n))
}
