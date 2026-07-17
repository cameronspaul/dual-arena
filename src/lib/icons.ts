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
  location: '/icons/Location.png',
  compass: '/icons/Compass.png',
  globe: '/icons/Globe.png',
  coins: '/icons/Coins.png',
  coins2: '/icons/Coins_2.png',
  coins3: '/icons/Coins_3.png',
  coins4: '/icons/Coins_4.png',
  money1: '/icons/Money_1.png',
  money2: '/icons/Money_2.png',
  money3: '/icons/Money_3.png',
  money4: '/icons/Money_4.png',
  trophy: '/icons/Trophi.png',
  star: '/icons/Reward_Star.png',
  blueStar: '/icons/Blue_Star.png',
  speed: '/icons/Speed.png',
  boost: '/icons/Boost.png',
  rocket: '/icons/Roket.png',
  flag: '/icons/Flag.png',
  locked: '/icons/Locked.png',
  check: '/icons/Check.png',
  pencil: '/icons/pencil.png',
  cap: '/icons/Cap.png',
  brush: '/icons/Brush.png',
  inv: '/icons/Inv.png',
  box: '/icons/Box.png',
  friend: '/icons/Friend.png',
  link: '/icons/Link.png',
  trade: '/icons/Trade.png',
  bolt: '/icons/Bolt.png',
  fire: '/icons/Fire.png',
  gem: '/icons/Gem_1.png',
  verified: '/icons/Verified.png',
  gift: '/icons/Gift.png',
  shop: '/icons/Shop.png',
} as const

export type IconId = keyof typeof icons

/** Soft-currency stake chips ($1 / $3 / $5 / $10). */
export const WAGER_ICONS = [
  icons.coins,
  icons.coins2,
  icons.coins3,
  icons.coins4,
] as const
