import type { Battle, Company } from "./battle.ts";
import { FORWARD, UNIT_AT, UNIT_FLAME, UNIT_GUN, UNIT_MAGE, UNIT_MG, UNIT_RIFLE, UNIT_TANK, WORLD_W } from "./config.ts";

const LANES = [WORLD_W / 6, WORLD_W / 2, (WORLD_W * 5) / 6];

/** Haltung eines KI-Offiziers für eine Flanke. */
export type Stance = "hold" | "defensive" | "balanced" | "aggressive";

/** Wie leicht sich die Flanke zum Angriff entschließt (0 = nie). */
const AGGRESSION: Record<Stance, number> = { hold: 0, defensive: 0, balanced: 1, aggressive: 1.8 };

interface Attack {
  lane: number;
  stage: "prep" | "approach" | "storm";
  timer: number;
  units: number[];
}

export function laneOf(x: number) {
  return x < WORLD_W / 3 ? 0 : x < (WORLD_W * 2) / 3 ? 1 : 2;
}

/**
 * KI-Offiziere einer Seite: je Flanke (links, Mitte, rechts) eine Haltung.
 * Gibt dieselben Befehle, die auch der Spieler geben kann, und lässt
 * Kompanien in Ruhe, die der Spieler direkt führt (manual).
 */
export class BattleAI {
  /** Haltung je Flanke: links, Mitte, rechts */
  stances: Stance[];
  private thinkTimer = 2;
  private artyWait = 20;
  private attackWait: number;
  private attack: Attack | null = null;
  private side: number;

  constructor(side: number, stance: Stance = "balanced") {
    this.side = side;
    this.stances = [stance, stance, stance];
    this.attackWait = 90;
  }

  private maxAggression() {
    return Math.max(...this.stances.map((s) => AGGRESSION[s]));
  }

  update(b: Battle, dt: number) {
    if (b.result) return;
    this.thinkTimer -= dt;
    this.artyWait -= dt;
    this.attackWait -= dt;
    if (this.thinkTimer > 0) return;
    this.thinkTimer = 3;

    const own = b.companies.filter((c) => c.side === this.side && c.alive > 0 && !c.manual);
    const foe = b.companies.filter((c) => c.side !== this.side && c.alive > 0);

    this.reserves(b);
    this.defend(b, own);
    this.antiTank(b, own, foe);
    this.offense(b, own, foe);
    this.artillery(b, own, foe);
    this.mages(b, own, foe);
  }

  private reserves(b: Battle) {
    const s = b.sides[this.side];
    if (s.reserves > 0 && b.groundStrength(this.side) < s.initialStrength * 0.65) b.callReserve(this.side);
  }

  private front(b: Battle, x: number) {
    return b.terrain.frontY(this.side, x);
  }

  private defend(b: Battle, own: Company[]) {
    const busy = new Set(this.attack?.units ?? []);
    for (const o of b.objectives) {
      if (this.stances[laneOf(o.x)] === "hold") continue;
      const ours = o.owner === this.side;
      const threatened = ours && o.capturer >= 0;
      const lost = !ours && Math.abs(o.y - this.front(b, o.x)) < 40;
      if (!threatened && !lost) continue;
      const helper = own
        .filter((c) => (c.type === UNIT_RIFLE || c.type === UNIT_FLAME) && c.order === "advance" && c.morale > 55 && !busy.has(c.id))
        .sort((a, c) => dist(a, o) - dist(c, o))[0];
      if (helper && dist(helper, o) < 600) {
        b.orderStorm(helper.id, o.x, o.y);
        busy.add(helper.id);
      }
    }
    // „Halten“: alles, was vor dem eigenen Draht steht, zurück in den Graben
    for (const c of own) {
      if (busy.has(c.id) || c.type === UNIT_MAGE || c.type === UNIT_GUN || c.order !== "advance") continue;
      if (this.stances[laneOf(c.cx)] !== "hold") continue;
      if ((c.cy - b.terrain.wireY(this.side, c.cx)) * FORWARD[this.side] > 20) {
        const y = this.front(b, c.cx);
        b.orderMove(c.id, c.cx, y);
        c.homeX = c.cx;
        c.homeY = y;
      }
    }
    // Leere Frontabschnitte wieder besetzen
    for (const lane of LANES) {
      const fy = this.front(b, lane);
      const manned = b.companies.some(
        (c) =>
          c.side === this.side &&
          c.alive > 0 &&
          (c.type === UNIT_RIFLE || c.type === UNIT_MG) &&
          Math.abs(c.cx - lane) < 220 &&
          Math.abs(c.cy - fy) < 70,
      );
      if (manned) continue;
      const spare = own
        .filter(
          (c) =>
            c.type === UNIT_RIFLE &&
            c.order === "advance" &&
            !busy.has(c.id) &&
            Math.abs(c.cy - this.front(b, c.cx)) > 100 &&
            (c.cy - this.front(b, c.cx)) * FORWARD[this.side] < 0,
        )
        .sort((a, c) => Math.abs(a.cx - lane) - Math.abs(c.cx - lane))[0];
      if (spare) {
        b.orderMove(spare.id, lane, fy);
        spare.homeX = lane;
        spare.homeY = fy;
        busy.add(spare.id);
      }
    }
  }

  /** Tankgewehre dorthin, wo feindliche Panzer durchbrechen */
  private antiTank(b: Battle, own: Company[], foe: Company[]) {
    const tanks = foe.filter((c) => c.type === UNIT_TANK);
    for (const at of own.filter((c) => c.type === UNIT_AT && c.order === "advance")) {
      const near = tanks.sort((a, c) => dist(a, { x: at.cx, y: at.cy }) - dist(c, { x: at.cx, y: at.cy }))[0];
      if (near && dist(near, { x: at.cx, y: at.cy }) < 700) {
        // Stellung in Deckung zwischen Panzer und eigener Front
        const tx = near.cx;
        const ty = this.front(b, tx);
        if (Math.hypot(at.tx - tx, at.ty - ty) > 60) b.orderMove(at.id, tx, ty);
      }
    }
  }

  private offense(b: Battle, own: Company[], foe: Company[]) {
    const fwd = FORWARD[this.side];
    const enemySide = 1 - this.side;
    if (!this.attack) {
      const aggr = this.maxAggression();
      if (this.attackWait > 0 || aggr === 0) return;
      // Flanke mit dem besten Kräfteverhältnis (nur Flanken, die angreifen dürfen)
      let best = -1;
      let bestScore = 0;
      for (let l = 0; l < LANES.length; l++) {
        const a = AGGRESSION[this.stances[l]];
        if (a === 0) continue;
        const mine =
          strengthNear(own, LANES[l], 300, (c) => c.type === UNIT_RIFLE && c.morale > 60) +
          strengthNear(own, LANES[l], 600, (c) => c.type === UNIT_TANK) * 60;
        const theirs = strengthNear(foe, LANES[l], 300, (c) => c.type !== UNIT_MAGE && c.type !== UNIT_GUN) + 1;
        const score = (mine / theirs) * a;
        if (score > bestScore) {
          bestScore = score;
          best = l;
        }
      }
      if (best < 0 || bestScore < 0.6) {
        this.attackWait = 30;
        return;
      }
      const lane = LANES[best];
      const infantry = own
        .filter((c) => c.type === UNIT_RIFLE && c.order === "advance" && c.morale > 60 && Math.abs(c.cx - lane) < 300)
        .sort((a, c) => c.alive - a.alive)
        .slice(0, 2);
      if (infantry.length === 0) {
        this.attackWait = 30;
        return;
      }
      const support = own.filter(
        (c) => (c.type === UNIT_TANK || c.type === UNIT_FLAME) && c.order === "advance" && Math.abs(c.cx - lane) < 600,
      );
      this.attack = { lane, stage: "prep", timer: 0, units: [...infantry, ...support].map((c) => c.id) };
    }

    const a = this.attack;
    // Haltung wurde inzwischen geändert → Angriff abbrechen
    if (AGGRESSION[this.stances[laneOf(a.lane)]] === 0) {
      a.units.forEach((id) => {
        const c = b.companies[id];
        if (c.alive > 0 && !c.manual) b.orderRetreat(id);
      });
      this.endAttack(b);
      return;
    }
    a.timer += 3;
    const units = a.units.map((id) => b.companies[id]).filter((c) => c.alive > 0 && c.order !== "rout" && !c.manual);
    if (!units.some((c) => c.type === UNIT_RIFLE)) {
      this.endAttack(b);
      return;
    }
    const enemyFront = b.terrain.frontY(enemySide, a.lane);
    const jumpY = enemyFront - fwd * 380;
    const spread = (k: number, n: number, w: number) => a.lane + (k - (n - 1) / 2) * w;
    if (a.stage === "prep") {
      if (b.sides[this.side].artyCharges > 0) {
        b.callArtillery(this.side, a.lane, enemyFront);
        this.artyWait = 25;
      }
      const inf = units.filter((c) => c.type !== UNIT_TANK);
      inf.forEach((c, k) => b.orderMove(c.id, spread(k, inf.length, 170), jumpY));
      // Panzer fahren vorneweg
      units.filter((c) => c.type === UNIT_TANK).forEach((c) => b.orderMove(c.id, a.lane, jumpY + fwd * 60));
      a.stage = "approach";
      a.timer = 0;
    } else if (a.stage === "approach") {
      const ready = units.filter((c) => c.type === UNIT_RIFLE).every((c) => Math.abs(c.cy - jumpY) < 50);
      if (ready || a.timer > 100) {
        if (b.sides[this.side].artyCharges > 0) b.callArtillery(this.side, a.lane, enemyFront);
        units.filter((c) => c.type === UNIT_TANK).forEach((c) => b.orderMove(c.id, a.lane, enemyFront + fwd * 40));
        a.stage = "storm";
        a.timer = 0;
      }
    } else if (a.stage === "storm") {
      // Kurz warten, bis die Granaten einschlagen, dann losstürmen
      if (a.timer === 6) {
        const inf = units.filter((c) => c.type !== UNIT_TANK);
        inf.forEach((c, k) => b.orderStorm(c.id, spread(k, inf.length, 130), b.terrain.frontY(enemySide, spread(k, inf.length, 130))));
      }
      if (a.timer > 130) {
        units.forEach((c) => {
          c.homeX = c.cx;
          c.homeY = c.cy;
        });
        this.endAttack(b);
      }
    }
  }

  private endAttack(b: Battle) {
    this.attack = null;
    const aggr = Math.max(0.5, this.maxAggression());
    this.attackWait = (60 + b.rng.next() * 60) / aggr;
  }

  private artillery(b: Battle, own: Company[], foe: Company[]) {
    if (this.artyWait > 0 || b.sides[this.side].artyCharges === 0) return;
    let best: Company | null = null;
    let bestScore = 70;
    for (const c of foe) {
      if (c.type === UNIT_MAGE) continue;
      const inOpen = b.terrain.coverAt(c.cx, c.cy) < 0.5;
      let score = c.alive * (inOpen ? 1.6 : 0.4);
      if (c.type === UNIT_MG) score = 90;
      if (c.type === UNIT_TANK) score = 60 * c.alive;
      if (c.type === UNIT_GUN) score = 50 * c.alive; // Gegenbatterie
      // Näher an uns = gefährlicher
      if ((c.cy - b.terrain.wireY(this.side, c.cx)) * FORWARD[this.side] < 300) score *= 1.5;
      if (own.some((o) => o.type !== UNIT_MAGE && dist(o, { x: c.cx, y: c.cy }) < 110)) continue; // kein Eigenbeschuss
      if (b.barrages.some((br) => Math.hypot(br.x - c.cx, br.y - c.cy) < 80)) continue;
      if (score > bestScore) {
        bestScore = score;
        best = c;
      }
    }
    if (best) {
      b.callArtillery(this.side, best.cx, best.cy);
      this.artyWait = 15 + b.rng.next() * 20;
    }
  }

  private mages(b: Battle, own: Company[], foe: Company[]) {
    if (this.stances.every((s) => s === "hold")) return;
    for (const m of own) {
      if (m.type !== UNIT_MAGE || m.order === "retreat") continue;
      const atHome = Math.hypot(m.cx - m.homeX, m.cy - m.homeY) < 60;
      if (atHome && m.mana < 85) continue;
      const enemyMage = foe.find((c) => c.type === UNIT_MAGE && Math.hypot(c.cx - c.homeX, c.cy - c.homeY) > 150);
      let target: Company | undefined = enemyMage;
      if (!target) {
        target = foe.filter((c) => c.type !== UNIT_MAGE).sort((a, c) => score(b, c) - score(b, a))[0];
      }
      if (!target) continue;
      b.orderMove(m.id, target.cx, target.cy);
    }
  }
}

function score(b: Battle, c: Company) {
  const open = b.terrain.coverAt(c.cx, c.cy) < 0.5;
  return c.alive * (open ? 2 : 0.5) + (c.type === UNIT_MG ? 120 : 0) + (c.type === UNIT_TANK ? 200 : 0) + (c.type === UNIT_AT ? 60 : 0);
}

function dist(c: Company, p: { x: number; y: number }) {
  return Math.hypot(c.cx - p.x, c.cy - p.y);
}

function strengthNear(list: Company[], x: number, r: number, f: (c: Company) => boolean) {
  let s = 0;
  for (const c of list) if (f(c) && Math.abs(c.cx - x) < r) s += c.alive;
  return s;
}
