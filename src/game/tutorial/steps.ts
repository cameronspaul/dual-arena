/**
 * Guided tutorial — steps + completion checks against live HudSnapshot.
 * Values pull from shared MATCH / SNIPER so copy never drifts from balance.
 */
import { MATCH, MOVE, SNIPER } from '../core/config'
import type { HitZone, HudSnapshot } from '../core/types'
import {
  codesFor,
  formatKeyCode,
  type ActionId,
} from '../core/userSettings'

export type TutorialStepId =
  | 'welcome'
  | 'look'
  | 'sensitivity'
  | 'controls'
  | 'audio'
  | 'move'
  | 'sprint'
  | 'jump'
  | 'slide'
  | 'ads'
  | 'fire'
  | 'ammo'
  | 'reload'
  | 'damage'
  | 'hit_dummy'
  | 'match_rules'
  | 'disconnect'
  | 'done'

export type TutorialStepKind = 'action' | 'info' | 'finish' | 'settings'

/** Settings dialog tab opened by the step hotkey. */
export type TutorialSettingsSection = 'audio' | 'mouse' | 'keybinds'

export interface TutorialStep {
  id: TutorialStepId
  kind: TutorialStepKind
  title: string
  body: string
  /** Short objective line under the body (action steps). */
  objective?: string
  /** Optional bullet facts (rules / damage table). */
  bullets?: string[]
  /** Icon key from /public/icons set. */
  icon:
    | 'aim'
    | 'ammo'
    | 'bolt'
    | 'boost'
    | 'check'
    | 'fire'
    | 'flag'
    | 'globe'
    | 'heart'
    | 'rocket'
    | 'settings'
    | 'speed'
    | 'star'
    | 'trophy'
  /**
   * Settings-tab steps: open this section with the open hotkey (O).
   * Continue with Y after adjusting.
   */
  settingsSection?: TutorialSettingsSection
  /** Keyboard code that opens settings for this step (default KeyO). */
  openSettingsCode?: string
}

/** Hotkey shown / bound for “open this settings page”. */
export const TUTORIAL_OPEN_SETTINGS_CODE = 'KeyO'
export const TUTORIAL_OPEN_SETTINGS_LABEL = 'O'

/** Hotkey for continue / ready-up (“yes”) across tutorial + pregame. */
export const TUTORIAL_CONTINUE_CODE = 'KeyY'
export const TUTORIAL_CONTINUE_LABEL = 'Y'

/** Format the first bound key for an action (live user settings). */
export function keyLabel(action: ActionId): string {
  const codes = codesFor(action)
  if (codes.length === 0) return '?'
  return formatKeyCode(codes[0]!)
}

export function keyLabels(action: ActionId, max = 2): string {
  return codesFor(action)
    .slice(0, max)
    .map(formatKeyCode)
    .join(' / ')
}

/** Fresh step list each call so keybind labels stay current. */
export function buildTutorialSteps(): TutorialStep[] {
  const move = `${keyLabel('forward')}${keyLabel('left')}${keyLabel('back')}${keyLabel('right')}`
  const sprint = keyLabels('sprint')
  const crouch = keyLabels('crouch')
  const jump = keyLabels('jump')
  const ads = keyLabels('ads')
  const fire = keyLabels('fire')
  const reload = keyLabels('reload')
  const openKey = TUTORIAL_OPEN_SETTINGS_LABEL
  const yesKey = TUTORIAL_CONTINUE_LABEL

  const grace = MATCH.disconnectGraceByLeave
  const firstGrace = grace[0] ?? MATCH.disconnectForfeit
  const secondGrace = grace[1] ?? 30

  return [
    {
      id: 'welcome',
      kind: 'info',
      title: 'Welcome to Duel',
      body: 'Sniper-only 1v1. This course covers settings, movement, the bolt rifle, damage zones, and online match rules.',
      bullets: [
        'Click the game to capture the mouse',
        'Esc releases the mouse anytime',
        `Press ${openKey} on settings steps · ${yesKey} to continue`,
      ],
      icon: 'star',
    },
    {
      id: 'look',
      kind: 'action',
      title: 'Look around',
      body: 'Move the mouse to aim. Click the canvas if the cursor is free.',
      objective: 'Lock the pointer (click the game view)',
      icon: 'aim',
    },
    {
      id: 'sensitivity',
      kind: 'settings',
      title: 'Mouse sensitivity',
      body: 'Dial hip and ADS sensitivity so tracking feels natural. Hip is freer; ADS is slower for precise scoped shots. Invert Y is here too.',
      bullets: [
        `Press ${openKey} to open Mouse settings`,
        'Tweak hip / ADS sensitivity while you look around',
        `Esc closes settings · ${yesKey} continues the tutorial`,
      ],
      objective: `Press ${openKey} for Mouse settings, then ${yesKey} when ready`,
      icon: 'aim',
      settingsSection: 'mouse',
      openSettingsCode: TUTORIAL_OPEN_SETTINGS_CODE,
    },
    {
      id: 'controls',
      kind: 'settings',
      title: 'Controls & keybinds',
      body: 'Rebind movement, crouch/slide, sprint, jump, fire, ADS, and reload. Multiple keys per action are supported.',
      bullets: [
        `Press ${openKey} to open Keybinds`,
        'Click an action, then press the new key',
        `Esc cancels capture · ${yesKey} continues when you are set`,
      ],
      objective: `Press ${openKey} for Keybinds, then ${yesKey} when ready`,
      icon: 'settings',
      settingsSection: 'keybinds',
      openSettingsCode: TUTORIAL_OPEN_SETTINGS_CODE,
    },
    {
      id: 'audio',
      kind: 'settings',
      title: 'Audio',
      body: 'Set master and SFX volume so gunshots and UI stay clear. Voice chat (online) has push-to-talk, open mic, or off — plus voice volume and rebind.',
      bullets: [
        `Press ${openKey} to open Audio settings`,
        'Adjust master / SFX, voice mode & volume',
        `Esc closes settings · ${yesKey} continues`,
      ],
      objective: `Press ${openKey} for Audio, then ${yesKey} when ready`,
      icon: 'bolt',
      settingsSection: 'audio',
      openSettingsCode: TUTORIAL_OPEN_SETTINGS_CODE,
    },
    {
      id: 'move',
      kind: 'action',
      title: 'Move',
      body: `Use ${move} to walk. Keep your reticle level — movement opens your hipfire cone.`,
      objective: `Hold ${move} and walk a few steps`,
      icon: 'speed',
    },
    {
      id: 'sprint',
      kind: 'action',
      title: 'Sprint',
      body: `Hold ${sprint} while moving forward to run. Sprinting widens spread — scope up before the shot.`,
      objective: `Sprint with ${sprint}`,
      icon: 'boost',
    },
    {
      id: 'jump',
      kind: 'action',
      title: 'Jump',
      body: `Press ${jump} to jump. Airborne shots are very inaccurate — land before you take the duel.`,
      objective: `Jump with ${jump}`,
      icon: 'rocket',
    },
    {
      id: 'slide',
      kind: 'action',
      title: 'Slide',
      body: `While sprinting at speed, tap ${crouch} to slide. Great for peeks and breaking aim. Slide also opens your hipfire a lot.`,
      objective: `Sprint, then ${crouch} to slide`,
      icon: 'boost',
    },
    {
      id: 'ads',
      kind: 'action',
      title: 'Aim down sights',
      body: `Hold ${ads} to scope. ADS tightens the cone to near-laser accuracy and slows your move speed.`,
      objective: `Scope with ${ads}`,
      icon: 'aim',
    },
    {
      id: 'fire',
      kind: 'action',
      title: 'Fire',
      body: `Click ${fire} to shoot. Bolt-action: after each round you cycle the bolt before the next shot.`,
      objective: `Fire a round with ${fire}`,
      icon: 'fire',
    },
    {
      id: 'ammo',
      kind: 'info',
      title: 'Ammo & magazine',
      body: `You carry a ${SNIPER.magSize}-round magazine. Empty forces a reload. Reloads always refill — ammo is infinite; the limit is mag + bolt timing.`,
      bullets: [
        `Magazine: ${SNIPER.magSize} rounds`,
        `Bolt cycle ~${SNIPER.boltTime.toFixed(1)}s between shots`,
        `Reload ~${SNIPER.reloadTime.toFixed(1)}s (R or empty mag)`,
      ],
      icon: 'ammo',
    },
    {
      id: 'reload',
      kind: 'action',
      title: 'Reload',
      body: `Press ${reload} anytime (or fire on empty). You can queue reload while bolting. Stay behind cover — you are vulnerable mid-mag change.`,
      objective: `Reload with ${reload}`,
      icon: 'ammo',
    },
    {
      id: 'damage',
      kind: 'info',
      title: 'What does damage?',
      body: 'Hitscan zones on the body. Head ends the fight; limbs chip. Only solid hits count — cover blocks shots.',
      bullets: [
        `Head — ${SNIPER.headDamage} (one-tap)`,
        `Chest / torso — ${SNIPER.chestDamage}`,
        `Arms / hands — ${SNIPER.armDamage}`,
        `Legs / feet — ${SNIPER.legDamage}`,
      ],
      icon: 'heart',
    },
    {
      id: 'hit_dummy',
      kind: 'action',
      title: 'Hit a target',
      body: 'Dummies roam the range. Scope in, lead a little if they move, and land a shot. Watch the hit confirm for zone + damage.',
      objective: 'Hit any dummy (any zone)',
      icon: 'aim',
    },
    {
      id: 'match_rules',
      kind: 'info',
      title: 'How to win',
      body: 'Online duels are competitive 1v1. Warmup free-fire until both ready, then countdown into live rounds.',
      bullets: [
        `First to ${MATCH.firstTo} kills wins the match`,
        'Live rounds last until a kill (no round clock)',
        `Brief spawn invuln (${MATCH.spawnInvuln}s) after each reset`,
        `Press ${yesKey} to ready up in pregame when both players are set`,
      ],
      icon: 'trophy',
    },
    {
      id: 'disconnect',
      kind: 'info',
      title: 'Disconnects & rejoin',
      body: 'Leaving mid-match costs the current round and pauses for rejoin. Use Rejoin match on the homepage before the timer ends.',
      bullets: [
        `1st leave → ${firstGrace}s rejoin window`,
        `2nd leave → ${secondGrace}s rejoin window`,
        `Max ${MATCH.disconnectMaxRejoins} rejoins — further leaves forfeit`,
        'Seat token stays on this device for the grace window',
      ],
      icon: 'globe',
    },
    {
      id: 'done',
      kind: 'finish',
      title: 'You are ready',
      body: 'Deploy any map for free practice, or host / join a lobby for ranked 1v1. Reopen Help anytime offline to replay this course.',
      bullets: [
        'Practice Range = offline dummies, no stakes',
        'Host duel / Lobbies = online first-to match',
        'Good luck — one shot, one stake.',
      ],
      icon: 'check',
    },
  ]
}

/** Mutable progress the overlay keeps while the tutorial is open. */
export interface TutorialProgress {
  /** Ammo when the current step began (detect shots). */
  ammoAtStepStart: number
  /** lastHitId when step began. */
  hitIdAtStepStart: number
  /** Zones confirmed this session (for optional UI). */
  zonesHit: Set<HitZone>
}

export function createTutorialProgress(hud: HudSnapshot | null): TutorialProgress {
  return {
    ammoAtStepStart: hud?.ammo ?? SNIPER.magSize,
    hitIdAtStepStart: hud?.lastHitId ?? 0,
    zonesHit: new Set(),
  }
}

/**
 * Whether the active action step is satisfied by the latest HUD sample.
 * Info / settings / finish steps never auto-complete here (user presses Continue).
 */
export function isStepComplete(
  step: TutorialStep,
  hud: HudSnapshot | null,
  progress: TutorialProgress,
): boolean {
  if (step.kind !== 'action') return false
  if (!hud) return false

  switch (step.id) {
    case 'look':
      return hud.pointerLocked
    case 'move':
      // Prefer input intent — pointer lock not required (keys work unlocked).
      return (
        hud.moving &&
        hud.speed >= 1.0 &&
        (hud.moveState === 'walk' ||
          hud.moveState === 'run' ||
          hud.moveState === 'crouch' ||
          hud.moveState === 'slide')
      )
    case 'sprint':
      // Prefer live sprint key + movement. moveState==='run' alone can miss
      // frames (crouch priority, ads, air) even when the player is sprinting.
      return (
        (hud.sprintHeld && hud.moving) ||
        hud.moveState === 'run' ||
        (hud.sprintHeld && hud.speed >= MOVE.walkSpeed * 0.85)
      )
    case 'jump':
      return hud.moveState === 'jump'
    case 'slide':
      return hud.moveState === 'slide' || (hud.sprintHeld && hud.crouchHeld && hud.speed >= 3)
    case 'ads':
      return hud.adsBlend >= 0.55 || hud.ads
    case 'fire':
      return (
        hud.ammo < progress.ammoAtStepStart ||
        hud.phase === 'firing' ||
        hud.phase === 'bolt'
      )
    case 'reload':
      return hud.phase === 'reloading'
    case 'hit_dummy':
      if (hud.lastHit && hud.lastHitId > progress.hitIdAtStepStart) {
        progress.zonesHit.add(hud.lastHit.zone)
        return true
      }
      return false
    default:
      return false
  }
}
