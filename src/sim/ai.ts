import type { Battle, Company } from "./battle.ts";
import { FORWARD, TRENCH_Y, UNIT_MAGE, UNIT_MG, UNIT_RIFLE, WIRE_Y } from "./config.ts";

const LANES = [200, 600, 1000];

interface Attack {
  lane: number;
  stage: "prep" | "approach" | "storm";
  timer: number;
  units: number[];
}

/**
 * Einfacher Computergegner. Denkt alle paar Sekunden nach und gibt
 * dieselben Befehle, die auch der Spieler geben kann.
 */
export class BattleAI {
  private thinkTimer = 2;
  private artyWait = 20;
  private attackWait: number;
  private attack: Attack | null = null;

  private side: number;
  private aggression: number;

  constructor(side: number, aggression = 1) {
    this.side = side;
    this.aggression = aggression;
    this.attackWait = 90 / aggression;
  }

  update(b: Battle, dt: number) {
    if (b.result) return;
    this.thinkTimer -= dt;
    this.artyWait -= dt;
    this.attackWait -= dt;
    if (this.thinkTimer > 0) return;
    this.thinkTimer = 3;

    const own = b.companies.filter((c) => c.side === this.side && c.alive > 0);
    const foe = b.companies.filter((c) => c.side !== this.side && c.alive > 0);

    this.reserves(b);
    this.defend(b, own);
    this.offense(b, own, foe);
    this.artillery(b, own, foe);
    this.mages(b, own, foe);
  }

  private reserves(b: Battle) {
    const s = b.sides[this.side];
    if (s.reserves > 0 && b.groundStrength(this.side) < s.initialStrength * 0.65) b.callReserve(this.side);
  }

  private defend(b: Battle, own: Company[]) {
    const busy = new Set(this.attack?.units ?? []);
    for (const o of b.objectives) {
      const ours = o.owner === this.side;
      const threatened = ours && o.capturer >= 0;
      const lost = !ours && o.y === TRENCH_Y[this.side];
      if (!threatened && !lost) continue;
      const helper = own
        .filter((c) => c.type === UNIT_RIFLE && c.order === "advance" && c.morale > 55 && !busy.has(c.id))
        .sort((a, c) => dist(a, o) - dist(c, o))[0];
      if (helper && dist(helper, o) < 500) {
        b.orderStorm(helper.id, o.x, o.y);
        busy.add(helper.id);
      }
    }
    // Leere Frontabschnitte wieder besetzen
    for (const lane of LANES) {
      const manned = own.some(
        (c) => c.type !== UNIT_MAGE && Math.abs(c.cx - lane) < 180 && Math.abs(c.cy - TRENCH_Y[this.side]) < 60,
      );
      if (manned) continue;
      const spare = own
        .filter(
          (c) =>
            c.type === UNIT_RIFLE &&
            c.order === "advance" &&
            !busy.has(c.id) &&
            Math.abs(c.cy - TRENCH_Y[this.side]) > 100 &&
            behindFront(c, this.side),
        )
        .sort((a, c) => Math.abs(a.cx - lane) - Math.abs(c.cx - lane))[0];
      if (spare) {
        b.orderMove(spare.id, lane, TRENCH_Y[this.side]);
        spare.homeX = lane;
        spare.homeY = TRENCH_Y[this.side];
        busy.add(spare.id);
      }
    }
  }

  private offense(b: Battle, own: Company[], foe: Company[]) {
    const fwd = FORWARD[this.side];
    const enemyTrench = TRENCH_Y[1 - this.side];
    if (!this.attack) {
      if (this.attackWait > 0) return;
      // Abschnitt mit dem besten Kräfteverhältnis suchen
      let best = -1;
      let bestRatio = 0;
      for (let l = 0; l < LANES.length; l++) {
        const mine = strengthNear(own, LANES[l], 250, (c) => c.type === UNIT_RIFLE && c.morale > 60);
        const theirs = strengthNear(foe, LANES[l], 250, (c) => c.type !== UNIT_MAGE) + 1;
        const ratio = mine / theirs;
        if (ratio > bestRatio) {
          bestRatio = ratio;
          best = l;
        }
      }
      if (best < 0 || bestRatio < 0.6 / this.aggression) {
        this.attackWait = 30;
        return;
      }
      const lane = LANES[best];
      const units = own
        .filter((c) => c.type === UNIT_RIFLE && c.order === "advance" && c.morale > 60 && Math.abs(c.cx - lane) < 250)
        .sort((a, c) => c.alive - a.alive)
        .slice(0, 2)
        .map((c) => c.id);
      if (units.length === 0) {
        this.attackWait = 30;
        return;
      }
      this.attack = { lane, stage: "prep", timer: 0, units };
    }

    const a = this.attack;
    a.timer += 3;
    const units = a.units.map((id) => b.companies[id]).filter((c) => c.alive > 0 && c.order !== "rout");
    if (units.length === 0) {
      this.endAttack(b);
      return;
    }
    const jumpY = enemyTrench - fwd * 360;
    if (a.stage === "prep") {
      if (b.sides[this.side].artyCharges > 0) {
        b.callArtillery(this.side, a.lane, enemyTrench);
        this.artyWait = 25;
      }
      units.forEach((c, k) => b.orderMove(c.id, a.lane + (k - (units.length - 1) / 2) * 150, jumpY));
      a.stage = "approach";
      a.timer = 0;
    } else if (a.stage === "approach") {
      const ready = units.every((c) => Math.abs(c.cy - jumpY) < 40);
      if (ready || a.timer > 90) {
        if (b.sides[this.side].artyCharges > 0) b.callArtillery(this.side, a.lane, enemyTrench);
        a.stage = "storm";
        a.timer = 0;
      }
    } else if (a.stage === "storm") {
      // Kurz warten, bis die Granaten einschlagen, dann losstürmen
      if (a.timer === 6) units.forEach((c, k) => b.orderStorm(c.id, a.lane + (k - (units.length - 1) / 2) * 120, enemyTrench));
      if (a.timer > 120) {
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
    this.attackWait = (60 + b.rng.next() * 60) / this.aggression;
  }

  private artillery(b: Battle, own: Company[], foe: Company[]) {
    if (this.artyWait > 0 || b.sides[this.side].artyCharges === 0) return;
    const wireNear = WIRE_Y[this.side];
    let best: Company | null = null;
    let bestScore = 70;
    for (const c of foe) {
      if (c.type === UNIT_MAGE) continue;
      const inOpen = b.terrain.coverAt(c.cx, c.cy) < 0.5;
      let score = c.alive * (inOpen ? 1.6 : 0.4);
      if (c.type === UNIT_MG) score = 90;
      // Näher an uns = gefährlicher
      if ((c.cy - wireNear) * FORWARD[this.side] < 300) score *= 1.5;
      if (own.some((o) => dist(o, { x: c.cx, y: c.cy }) < 110)) continue; // kein Eigenbeschuss
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
    for (const m of own) {
      if (m.type !== UNIT_MAGE || m.order === "retreat") continue;
      const atHome = Math.hypot(m.cx - m.homeX, m.cy - m.homeY) < 60;
      if (atHome && m.mana < 85) continue;
      const enemyMage = foe.find((c) => c.type === UNIT_MAGE && Math.hypot(c.cx - c.homeX, c.cy - c.homeY) > 150);
      let target: Company | undefined = enemyMage;
      if (!target) {
        target = foe
          .filter((c) => c.type !== UNIT_MAGE)
          .sort((a, c) => score(b, c) - score(b, a))[0];
      }
      if (!target) continue;
      b.orderMove(m.id, target.cx, target.cy);
    }
  }
}

function score(b: Battle, c: Company) {
  const open = b.terrain.coverAt(c.cx, c.cy) < 0.5;
  return c.alive * (open ? 2 : 0.5) + (c.type === UNIT_MG ? 120 : 0);
}

function dist(c: Company, p: { x: number; y: number }) {
  return Math.hypot(c.cx - p.x, c.cy - p.y);
}

function strengthNear(list: Company[], x: number, r: number, f: (c: Company) => boolean) {
  let s = 0;
  for (const c of list) if (f(c) && Math.abs(c.cx - x) < r) s += c.alive;
  return s;
}

function behindFront(c: Company, side: number) {
  return (c.cy - TRENCH_Y[side]) * FORWARD[side] < 0;
}
