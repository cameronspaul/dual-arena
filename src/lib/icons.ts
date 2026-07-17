/**
 * Public PNG icon set under /public/icons.
 * Prefer these for game flair (HUD vitals, lobby brand, economy);
 * keep lucide for dense chrome and form controls.
 */
export const icons = {
  aim: '/icons/Aim.png',
  ammo: '/icons/ammo.png',
  heart: '/icons/Heart.png',
  settings: '/icons/Settings.png',
  map: '/icons/Map.png',
  coins: '/icons/Coins.png',
  trophy: '/icons/Trophi.png',
  speed: '/icons/Speed.png',
  boost: '/icons/Boost.png',
  star: '/icons/Reward_Star.png',
  rocket: '/icons/Roket.png',
  flag: '/icons/Flag.png',
  locked: '/icons/Locked.png',
  check: '/icons/Check.png',
  globe: '/icons/Globe.png',
} as const

export type IconId = keyof typeof icons
