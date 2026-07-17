# Dual Arena — Design Document

Browser-based **sniper-only 1v1** duel game with optional wagers (virtual currency first). Inspired by Krunker’s instant-play WebGL FPS and Roblox Rivals’ sniper 1v1 skill culture.

---

## 1. Vision

| Pillar | Description |
|--------|-------------|
| **Pure aim** | One weapon family. No loadout RNG. |
| **Fair fights** | Authoritative server, lag-compensated hitscan. |
| **Fast loop** | Queue → duel → settle → rematch in under a minute. |
| **Stakes** | Soft currency escrow now; real money only after legal review. |
| **Browser-first** | No download. React lobby + Three.js game canvas. |

**Tagline:** *One shot. One stake. Prove it.*

---

## 2. Core Rules (v1)

| Rule | Value |
|------|--------|
| Players | 2 |
| Weapon | Bolt-action sniper only |
| Win | First to **5** kills (configurable) |
| Head damage | **100** (one-tap) |
| Body damage | **45** (3-shot) |
| Mag size | 5 |
| Bolt cycle | ~0.7s after each shot |
| Reload | ~2.0s |
| ADS | Hold RMB; FOV zooms; move speed reduced |
| Match time | 4 minutes max → most kills wins; ties → sudden death 1 kill |
| Spawn | Opposite sides; brief invulnerability (0.5s) |

### Soft currency wager (Phase 3)

1. Both players accept stake `S`.
2. Server escrows `S` from each wallet.
3. On valid match end: winner receives `2S − rake` (rake 5–10%).
4. Disconnect / abandon: forfeit rules (opponent wins after grace period).
5. All ledger rows immutable.

**Real money / crypto is out of scope until counsel + KYC/geo compliance.**

---

## 3. Architecture

```
┌──────────────────────────────────────────────────────┐
│ Client (Vite + React)                                │
│  Lobby / Wallet / Matchmaking  →  shadcn + Zustand   │
│  Match page mounts GameCanvas  →  Three.js engine    │
│  HUD overlay                   →  Tailwind           │
└───────────────────────┬──────────────────────────────┘
                        │ WebSocket (inputs + state)
┌───────────────────────▼──────────────────────────────┐
│ Game Server (Node + Colyseus or Socket.io)           │
│  DuelRoom: movement validate, hitscan, score, clock  │
└───────────────────────┬──────────────────────────────┘
                        │
┌───────────────────────▼──────────────────────────────┐
│ API + Postgres                                       │
│  users, balances, escrows, match_history, reports    │
└──────────────────────────────────────────────────────┘
```

### Responsibility split

| Concern | Owner |
|---------|--------|
| Rendering, prediction, local feel | Client `src/game/` |
| Hit validation, scores, match end | Server |
| Balances, escrow, auth | API + DB |
| Menus, stake UI, results | React pages |

### RULES.md note

- **React UI** follows `RULES.md` (Tailwind, shadcn, Zustand, Framer Motion).
- **`src/game/**`** is WebGL/Three.js — styling rules do not apply to the canvas.
- HUD is React + Tailwind overlaid on the canvas.

---

## 4. Repo layout (target)

```
dual-arena/
├── DESIGN.md
├── RULES.md                 # UI coding standards
├── src/
│   ├── components/
│   │   ├── game/            # GameCanvas, HUD
│   │   └── ui/              # shadcn
│   ├── game/                # pure TS engine (no React)
│   │   ├── config.ts
│   │   ├── engine.ts
│   │   ├── input.ts
│   │   ├── player.ts
│   │   ├── sniper.ts
│   │   ├── world.ts
│   │   ├── hitscan.ts
│   │   └── types.ts
│   ├── pages/
│   ├── stores/
│   └── ...
├── server/                  # Phase 2+
└── shared/                  # Phase 2+ shared types/constants
```

---

## 5. Client game systems

### 5.1 Input

- Pointer Lock API for look.
- Keys: WASD move, Space jump, Shift sprint, Ctrl crouch, R reload, LMB fire, RMB ADS, Esc unlock.
- Sensitivity: hip + scoped multipliers (user settings later).

### 5.2 Player controller

- Eye height ~1.6m, radius ~0.35m.
- Ground check + gravity + jump impulse.
- Sprint speed boost when not ADS.
- ADS: reduce move speed and mouse sensitivity.

### 5.3 Sniper

```
Idle → (LMB if can fire) → Firing → Bolt cycle → Idle
                          → empty mag → need Reload
ADS: independent hold state (FOV lerp)
```

### 5.4 Hitscan

- Ray from camera origin along view direction.
- First hit against world colliders or target hitboxes.
- Hitboxes: `head` (sphere), `body` (capsule/box).
- Phase 0: client-side only. Phase 2+: server re-simulates with lag compensation.

### 5.5 Maps (Phase 0 = Range)

**Range:** flat ground, cover boxes, 3–5 dummies at varying distances for aim practice.

Later duel maps: Long Alley, Boxes, Pit (mid cover + long sightlines).

---

## 6. Networking (Phase 2)

### Tick model

- Server tick: **30 Hz**.
- Client send: inputs every frame or 30–60 Hz with sequence numbers.
- Client: predict local player; interpolate remote player.

### Messages (sketch)

```ts
// client → server
{ type: "input", seq: number, buttons: number, yaw: number, pitch: number }

// server → client
{
  type: "snapshot",
  tick: number,
  players: Array<{
    id: string
    x: number; y: number; z: number
    yaw: number; pitch: number
    hp: number
    scoped: boolean
  }>
  events: Array<HitEvent | KillEvent | MatchEndEvent>
}
```

### Authority rules

- Client never applies damage locally as truth (cosmetic tracer/blood only).
- Server clamps speed, fire rate, ammo.
- Shots: rewind remote positions by RTT/2 (simple lag comp), cast ray, apply damage.

---

## 7. Economy schema (Phase 3)

```sql
users(id, display_name, created_at)
wallets(user_id, balance, updated_at)
ledger(id, user_id, delta, reason, match_id, created_at)
matches(id, stake, rake_bps, winner_id, status, started_at, ended_at)
match_players(match_id, user_id, kills, deaths)
escrows(match_id, user_id, amount, status) -- held | released | refunded
```

---

## 8. Anti-cheat (minimum for any valued currency)

1. Server-side movement validation (max speed, air time).
2. Server fire rate / bolt / ammo.
3. Ray origin must be near player eye; angle within look delta budget.
4. Match replay ring buffer (last N ticks) for reports.
5. Rate-limit queue and stake size by account age / trust.

---

## 9. Phased roadmap

| Phase | Status | Goal |
|-------|--------|------|
| **0 — Range** | In progress | Offline sniper range: move, ADS, hitscan, dummies, HUD |
| **1 — Local duel** | Planned | Two players simulated or hot-seat rules; scoreboard |
| **2 — Online 1v1** | Planned | Invite link + authoritative room, no money |
| **3 — Soft wager** | Planned | Escrow, settle, rematch |
| **4 — Polish** | Planned | Ranked, cosmetics, more maps |
| **5 — Real stakes?** | Maybe | Legal + payments only if intentional |

---

## 10. Tunables (`src/game/config.ts`)

All combat numbers live in one config so balance iteration is safe and later shareable with `shared/`.

---

## 11. Open decisions

- [ ] Colyseus vs raw Socket.io for Phase 2
- [ ] First to 5 vs round-based (plant-style) rounds
- [ ] Scope sway / breath mechanics (may hurt casual feel)
- [ ] Auth provider (Clerk / Supabase / custom)
- [ ] Whether soft currency is purchasable with real money (IAP) or earn-only

---

## 12. Success criteria (Phase 0)

- [x] Click to lock mouse, look and move smoothly
- [x] ADS zooms FOV
- [x] Fire hitscan destroys / damages range dummies
- [x] Head vs body feedback
- [x] Ammo, bolt, reload reflected in HUD
- [x] Esc releases pointer; UI still usable
