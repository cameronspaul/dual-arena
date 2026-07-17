import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type ServerRegion = 'us-east' | 'eu'
export type WagerAmount = 1 | 3 | 5 | 10

interface AppState {
  theme: 'light' | 'dark'
  setTheme: (theme: 'light' | 'dark') => void
  toggleTheme: () => void

  /** Display name shown in lobby (optional until auth). */
  username: string
  setUsername: (name: string) => void

  characterColor: string
  setCharacterColor: (color: string) => void

  serverRegion: ServerRegion
  setServerRegion: (region: ServerRegion) => void

  wagerAmount: WagerAmount
  setWagerAmount: (amount: WagerAmount) => void

  /** Soft-currency balance preview (Phase 3 will wire to wallet). */
  balance: number

  /** Game server WebSocket URL for online 1v1. */
  serverUrl: string
  setServerUrl: (url: string) => void

  /** Invite / match room id. */
  matchId: string
  setMatchId: (id: string) => void
}

const DEFAULT_COLOR = '#a855f7'

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      theme: 'dark',
      setTheme: (theme) => set({ theme }),
      toggleTheme: () =>
        set({ theme: get().theme === 'light' ? 'dark' : 'light' }),

      username: '',
      setUsername: (username) => set({ username: username.slice(0, 24) }),

      characterColor: DEFAULT_COLOR,
      setCharacterColor: (characterColor) => set({ characterColor }),

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
        characterColor: s.characterColor,
        serverRegion: s.serverRegion,
        wagerAmount: s.wagerAmount,
        serverUrl: s.serverUrl,
        matchId: s.matchId,
      }),
    },
  ),
)
