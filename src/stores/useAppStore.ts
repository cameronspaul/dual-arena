import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import {
  cloneAppearance,
  DEFAULT_CHARACTER_APPEARANCE,
  normalizeAppearance,
  type AppearancePart,
  type CharacterAppearance,
} from '@/game/character/appearance'

export type ServerRegion = 'us-east' | 'eu'
export type WagerAmount = 1 | 3 | 5 | 10

/** Grace seconds for homepage rejoin by leave number (1st, 2nd). 3rd+ = none. */
export const REJOIN_GRACE_BY_LEAVE = [60, 30] as const
export const REJOIN_MAX_LEAVES = REJOIN_GRACE_BY_LEAVE.length

/** Credentials to rejoin a mid-match lobby after disconnect/leave. */
export type RejoinSession = {
  matchId: string
  serverUrl: string
  token: string
  mapId: string
  /**
   * Wall-clock ms when the homepage Rejoin CTA expires.
   * `null` while still in the match (credentials remembered, button hidden).
   * Armed when the user leaves or disconnects mid-match.
   */
  expiresAt: number | null
  /**
   * Mid-match leaves so far this match (server tracks the same).
   * Used to pick 60s vs 30s homepage CTA; 3rd leave has no rejoin.
   */
  leaveCount: number
}

/** Grace seconds for the next leave (0 = forfeit, no CTA). */
export function rejoinGraceForLeave(leaveCount: number): number {
  if (leaveCount < 1 || leaveCount > REJOIN_MAX_LEAVES) return 0
  return REJOIN_GRACE_BY_LEAVE[leaveCount - 1] ?? 0
}

function mintPlayerToken(): string {
  return `p-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`
}

interface AppState {
  theme: 'light' | 'dark'
  setTheme: (theme: 'light' | 'dark') => void
  toggleTheme: () => void

  /** Display name shown in lobby (optional until auth). */
  username: string
  setUsername: (name: string) => void

  /**
   * Stable seat token for online matches (reconnect / rejoin).
   * Not the display name — hostName is sent separately.
   */
  playerToken: string

  /** Custom man.glb part colors (face, hair, suit, …). */
  characterAppearance: CharacterAppearance
  setCharacterAppearance: (appearance: CharacterAppearance) => void
  setAppearancePart: (part: AppearancePart, color: string) => void
  resetCharacterAppearance: () => void

  serverRegion: ServerRegion
  setServerRegion: (region: ServerRegion) => void

  wagerAmount: WagerAmount
  setWagerAmount: (amount: WagerAmount) => void

  /** Solana wallet balance preview (wired when wallet connect lands). */
  balance: number

  /** Game server WebSocket URL for online 1v1. */
  serverUrl: string
  setServerUrl: (url: string) => void

  /** Invite / match room id. */
  matchId: string
  setMatchId: (id: string) => void

  /**
   * Active online match the player can rejoin from the homepage
   * (after leave/disconnect mid-match, within the server grace window).
   */
  rejoinSession: RejoinSession | null
  setRejoinSession: (session: RejoinSession | null) => void
  /**
   * Record a mid-match leave and arm the homepage CTA.
   * 1st leave → 60s, 2nd → 30s, 3rd+ → clear session (no rejoin).
   * Returns the grace seconds armed (0 if no rejoin allowed).
   */
  armRejoinWindow: () => number
  clearRejoinSession: () => void
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      theme: 'dark',
      setTheme: (theme) => set({ theme }),
      toggleTheme: () =>
        set({ theme: get().theme === 'light' ? 'dark' : 'light' }),

      username: '',
      setUsername: (username) => set({ username: username.slice(0, 24) }),

      playerToken: mintPlayerToken(),

      characterAppearance: cloneAppearance(),
      setCharacterAppearance: (characterAppearance) =>
        set({ characterAppearance: normalizeAppearance(characterAppearance) }),
      setAppearancePart: (part, color) =>
        set({
          characterAppearance: {
            ...get().characterAppearance,
            [part]: color,
          },
        }),
      resetCharacterAppearance: () =>
        set({ characterAppearance: cloneAppearance(DEFAULT_CHARACTER_APPEARANCE) }),

      serverRegion: 'eu',
      setServerRegion: (serverRegion) => set({ serverRegion }),

      wagerAmount: 1,
      setWagerAmount: (wagerAmount) => set({ wagerAmount }),

      balance: 0,

      serverUrl: 'ws://localhost:2567',
      setServerUrl: (serverUrl) => set({ serverUrl: serverUrl.trim() }),

      matchId: 'duel-1',
      setMatchId: (matchId) =>
        set({ matchId: matchId.trim().slice(0, 48) || 'duel-1' }),

      rejoinSession: null,
      setRejoinSession: (rejoinSession) => set({ rejoinSession }),
      armRejoinWindow: () => {
        const cur = get().rejoinSession
        if (!cur) return 0
        // Already armed this leave (exit + pagehide both fire) — don't double-count
        if (cur.expiresAt != null && cur.expiresAt > Date.now()) {
          return rejoinGraceForLeave(cur.leaveCount)
        }
        const leaveCount = (cur.leaveCount ?? 0) + 1
        const grace = rejoinGraceForLeave(leaveCount)
        if (grace <= 0) {
          set({ rejoinSession: null })
          return 0
        }
        set({
          rejoinSession: {
            ...cur,
            leaveCount,
            expiresAt: Date.now() + grace * 1000,
          },
        })
        return grace
      },
      clearRejoinSession: () => set({ rejoinSession: null }),
    }),
    {
      name: 'app-store',
      partialize: (s) => ({
        theme: s.theme,
        username: s.username,
        playerToken: s.playerToken,
        characterAppearance: s.characterAppearance,
        serverRegion: s.serverRegion,
        wagerAmount: s.wagerAmount,
        serverUrl: s.serverUrl,
        matchId: s.matchId,
        rejoinSession: s.rejoinSession,
      }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<AppState> & {
          /** Legacy single clothing tint from earlier builds. */
          characterColor?: string
        }
        const appearance = p.characterAppearance
          ? normalizeAppearance(p.characterAppearance)
          : p.characterColor
            ? {
                ...cloneAppearance(DEFAULT_CHARACTER_APPEARANCE),
                // Old store only tinted clothes — keep skin defaults.
                suit: p.characterColor,
                trousers: p.characterColor,
              }
            : current.characterAppearance

        const playerToken =
          typeof p.playerToken === 'string' && p.playerToken.trim().length > 0
            ? p.playerToken.trim()
            : current.playerToken

        let rejoinSession = p.rejoinSession ?? null
        // Drop expired rejoin CTAs; arm unarmed mid-match sessions after tab close.
        if (rejoinSession) {
          const leaveCount =
            typeof rejoinSession.leaveCount === 'number'
              ? rejoinSession.leaveCount
              : 0
          rejoinSession = { ...rejoinSession, leaveCount }
          const exp = rejoinSession.expiresAt
          if (typeof exp === 'number' && exp <= Date.now()) {
            rejoinSession = null
          } else if (exp == null) {
            // Tab closed mid-match — count as a leave and arm next grace
            const nextLeave = leaveCount + 1
            const grace = rejoinGraceForLeave(nextLeave)
            if (grace <= 0) {
              rejoinSession = null
            } else {
              rejoinSession = {
                ...rejoinSession,
                leaveCount: nextLeave,
                expiresAt: Date.now() + grace * 1000,
              }
            }
          }
        }

        return {
          ...current,
          ...p,
          playerToken,
          rejoinSession,
          characterAppearance: appearance,
        }
      },
    },
  ),
)
