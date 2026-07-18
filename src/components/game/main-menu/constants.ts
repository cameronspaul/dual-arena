import {
  SiDiscord,
  SiInstagram,
  SiTiktok,
  SiX,
  SiYoutube,
} from 'react-icons/si'

import { SKYBOX_IDS, type SkyboxPreference } from '@/game/scene/skyboxes'
import { DUEL_MAP_LIST } from '@/game/maps'
import type { WagerAmount } from '@/stores/useAppStore'

export const WAGER_OPTIONS: WagerAmount[] = [1, 3, 5, 10]
export const SKYBOX_OPTIONS: SkyboxPreference[] = [...SKYBOX_IDS, 'random']

export const COMMUNITY_LINKS = [
  {
    label: 'Discord',
    href: 'https://discord.com/invite/KFTtqWbutQ',
    icon: SiDiscord,
    className: 'bg-[#5865F2] text-white',
  },
  {
    label: 'YouTube',
    href: 'https://www.youtube.com/@muxlabs',
    icon: SiYoutube,
    className: 'bg-[#FF0000] text-white',
  },
  {
    label: 'Instagram',
    href: 'https://www.instagram.com/muxlabs',
    icon: SiInstagram,
    className:
      'bg-gradient-to-br from-[#f9ce34] via-[#ee2a7b] to-[#6228d7] text-white',
  },
  {
    label: 'TikTok',
    href: 'https://www.tiktok.com/@muxlabs',
    icon: SiTiktok,
    className: 'bg-black text-white',
  },
  {
    label: 'X',
    href: 'https://x.com/mux_labs',
    icon: SiX,
    className: 'bg-black text-white',
  },
] as const

export const LOBBY_WATCH_KEY = 'glint-lobby-watch'
export const AUTO_JOIN_SECONDS = 5
/** Idle list poll — light load when not queue-watching. */
export const LOBBY_POLL_IDLE_MS = 3000
/** Notify / Auto poll — snappier so queue-pop lands within ~1–2s of host. */
export const LOBBY_POLL_WATCH_MS = 1500

/** 1v1 arena carousel only — practice range lives next to Tutorial. */
export const PICKER_MAPS = DUEL_MAP_LIST
