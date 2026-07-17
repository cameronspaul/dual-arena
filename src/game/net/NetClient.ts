/**
 * WebSocket client for server-authoritative 1v1.
 * Sends inputs only; never damage/kill claims.
 */
import type {
  ClientMessage,
  ErrorMessage,
  InputMessage,
  MatchEndMessage,
  PlayerBody,
  PlayerInput,
  PongMessage,
  ServerMessage,
  SnapshotMessage,
  WelcomeMessage,
} from '@duel/shared'
import { INPUT_SEND_HZ } from '@duel/shared'

export type NetClientStatus =
  | 'idle'
  | 'connecting'
  | 'joined'
  | 'disconnected'
  | 'error'

export type NetClientHandlers = {
  onWelcome?: (msg: WelcomeMessage) => void
  onSnapshot?: (msg: SnapshotMessage) => void
  onMatchEnd?: (msg: MatchEndMessage) => void
  onError?: (msg: ErrorMessage) => void
  onStatus?: (status: NetClientStatus, detail?: string) => void
  onPong?: (rttMs: number) => void
}

export type NetClientOpts = {
  url: string
  matchId: string
  token: string
  /** Catalog map id so server assigns blue/red pads for that map. */
  mapId?: string
  handlers?: NetClientHandlers
}

export class NetClient {
  private ws: WebSocket | null = null
  private readonly url: string
  private readonly matchId: string
  private readonly token: string
  private readonly mapId: string | undefined
  private handlers: NetClientHandlers
  private seq = 0
  private status: NetClientStatus = 'idle'
  private inputAccum = 0
  private pingTimer: ReturnType<typeof setInterval> | null = null
  private closed = false

  /** Last RTT in ms (null until first pong). */
  pingMs: number | null = null
  playerId: string | null = null
  welcome: WelcomeMessage | null = null
  lastSnapshot: SnapshotMessage | null = null
  matchEnd: MatchEndMessage | null = null

  constructor(opts: NetClientOpts) {
    this.url = opts.url
    this.matchId = opts.matchId
    this.token = opts.token
    this.mapId = opts.mapId
    this.handlers = opts.handlers ?? {}
  }

  getStatus() {
    return this.status
  }

  setHandlers(h: NetClientHandlers) {
    this.handlers = h
  }

  connect() {
    if (this.ws || this.closed) return
    this.setStatus('connecting')
    const ws = new WebSocket(this.url)
    this.ws = ws

    ws.onopen = () => {
      this.send({
        type: 'join',
        matchId: this.matchId,
        token: this.token,
        mapId: this.mapId,
      })
      this.pingTimer = setInterval(() => this.sendPing(), 1000)
      this.sendPing()
    }

    ws.onmessage = (ev) => {
      let msg: ServerMessage
      try {
        msg = JSON.parse(String(ev.data)) as ServerMessage
      } catch {
        return
      }
      this.handleMessage(msg)
    }

    ws.onerror = () => {
      this.setStatus('error', 'WebSocket error')
    }

    ws.onclose = () => {
      this.cleanupSocket()
      if (!this.closed) this.setStatus('disconnected', 'Connection closed')
    }
  }

  disconnect() {
    this.closed = true
    this.cleanupSocket()
    this.setStatus('disconnected')
  }

  private cleanupSocket() {
    if (this.pingTimer) {
      clearInterval(this.pingTimer)
      this.pingTimer = null
    }
    if (this.ws) {
      this.ws.onopen = null
      this.ws.onmessage = null
      this.ws.onerror = null
      this.ws.onclose = null
      if (
        this.ws.readyState === WebSocket.OPEN ||
        this.ws.readyState === WebSocket.CONNECTING
      ) {
        this.ws.close()
      }
      this.ws = null
    }
  }

  private setStatus(status: NetClientStatus, detail?: string) {
    this.status = status
    this.handlers.onStatus?.(status, detail)
  }

  private handleMessage(msg: ServerMessage) {
    switch (msg.type) {
      case 'welcome':
        this.welcome = msg
        this.playerId = msg.playerId
        this.setStatus('joined')
        this.handlers.onWelcome?.(msg)
        break
      case 'snapshot':
        this.lastSnapshot = msg
        this.handlers.onSnapshot?.(msg)
        break
      case 'match_end':
        this.matchEnd = msg
        this.handlers.onMatchEnd?.(msg)
        break
      case 'pong':
        this.onPong(msg)
        break
      case 'error':
        this.handlers.onError?.(msg)
        this.setStatus('error', msg.message)
        break
    }
  }

  private onPong(msg: PongMessage) {
    const rtt = Math.max(0, performance.now() - msg.t)
    this.pingMs = rtt
    this.handlers.onPong?.(rtt)
  }

  private sendPing() {
    this.send({ type: 'ping', t: performance.now() })
  }

  private send(msg: ClientMessage) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return
    this.ws.send(JSON.stringify(msg))
  }

  /**
   * Queue an input + pose sample. Call every frame; rate-limits to INPUT_SEND_HZ.
   * Returns the seq if a packet was sent, else null.
   */
  maybeSendInput(
    input: PlayerInput,
    dt: number,
    body: PlayerBody,
  ): number | null {
    this.inputAccum += dt
    const interval = 1 / INPUT_SEND_HZ
    if (this.inputAccum < interval) return null
    this.inputAccum = 0
    return this.sendInputNow(input, body)
  }

  /**
   * Force-send current input + claimed pose (e.g. fire edge must not wait).
   * Server validates pose; does not re-simulate movement.
   */
  sendInputNow(input: PlayerInput, body: PlayerBody): number {
    this.seq += 1
    const msg: InputMessage = {
      type: 'input',
      seq: this.seq,
      forward: input.forward,
      right: input.right,
      jump: input.jumpHeld || input.jump,
      crouch: input.crouch,
      sprint: input.sprint,
      ads: input.ads,
      fire: input.fire,
      reload: input.reload,
      yaw: input.yaw,
      pitch: input.pitch,
      clientTime: performance.now(),
      x: body.position.x,
      y: body.position.y,
      z: body.position.z,
      vx: body.velocity.x,
      vy: body.velocity.y,
      vz: body.velocity.z,
      grounded: body.grounded,
      state: body.state,
    }
    this.send(msg)
    return this.seq
  }

  get lastSeq() {
    return this.seq
  }
}
