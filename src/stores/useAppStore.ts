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

interface AppState {
  theme: 'light' | 'dark'
  setTheme: (theme: 'light' | 'dark') => void
  toggleTheme: () => void

  /** Display name shown in lobby (optional until auth). */
  username: string
  setUsername: (name: string) => void

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
    }),
    {
      name: 'app-store',
      partialize: (s) => ({
        theme: s.theme,
        username: s.username,
        characterAppearance: s.characterAppearance,
        serverRegion: s.serverRegion,
        wagerAmount: s.wagerAmount,
        serverUrl: s.serverUrl,
        matchId: s.matchId,
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

        return {
          ...current,
          ...p,
          characterAppearance: appearance,
        }
      },
    },
  ),
)
