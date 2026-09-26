import type { Battle, Company } from "./battle.ts";
import { FORWARD, UNIT_AT, UNIT_FLAME, UNIT_GUN, UNIT_MAGE, UNIT_MG, UNIT_RIFLE, UNIT_STORM, UNIT_TANK, WIRE_OFFSET, WORLD_W } from "./config.ts";

const LANES = [WORLD_W / 6, WORLD_W / 2, (WORLD_W * 5) / 6];

/** Haltung eines KI-Offiziers für eine Flanke. */
export type Stance = "hold" | "defensive" | "balanced" | "aggressive";

/** Wie leicht sich die Flanke zum Angriff entschließt (0 = nie). */
const AGGRESSION: Record<Stance, number> = { hold: 0, defensive: 0, balanced: 1, aggressive: 1.8 };

interface Attack {
  lane: number;
  /** Einbruchstelle: wo der Draht am meisten zerstört ist */
  breach: number;
  stage: "prep" | "approach" | "smoke" | "storm";
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
  /** Protokoll für Tests (Angriffe, Ergebnisse) */
  onLog: ((msg: string) => void) | null = null;
  private attackStart = 0;
  /** Erfahrene Offiziere nutzen Drahtschneiden, Nebel und Stoßtrupps; unerfahrene stürmen einfach los */
  veteran: boolean;

  constructor(side: number, stance: Stance = "balanced", veteran = true) {
    this.side = side;
    this.veteran = veteran;
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
        .filter((c) => (c.type === UNIT_RIFLE || c.type === UNIT_FLAME || c.type === UNIT_STORM) && c.order === "advance" && c.morale > 55 && !busy.has(c.id))
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
          strengthNear(own, LANES[l], 300, (c) => (c.type === UNIT_RIFLE || c.type === UNIT_STORM) && c.morale > 60) +
          strengthNear(own, LANES[l], 600, (c) => c.type === UNIT_TANK) * 60;
        const theirs = strengthNear(foe, LANES[l], 300, (c) => c.type !== UNIT_MAGE && c.type !== UNIT_GUN) + 1;
        const score = (mine / theirs) * a;
        if (score > bestScore) {
          bestScore = score;
          best = l;
        }
      }
      // Erfahrene Offiziere greifen nur mit örtlicher Überlegenheit an
      if (best < 0 || bestScore < (this.veteran ? 1.1 : 0.6)) {
        this.attackWait = 30;
        return;
      }
      const lane = LANES[best];
      const reach = this.veteran ? 480 : 300;
      const candidates = own
        .filter((c) => c.type === UNIT_RIFLE && c.order === "advance" && c.morale > 60 && Math.abs(c.cx - lane) < reach)
        .sort((a, c) => c.alive - a.alive);
      // Schwerpunkt bilden: erfahrene Offiziere werfen mehr Kompanien in den Angriff, ein Teil hält immer den Graben
      const share = 0.5;
      const infantry = candidates.slice(0, Math.max(2, Math.floor(candidates.length * share)));
      if (infantry.length === 0) {
        this.attackWait = 30;
        return;
      }
      const support = own.filter(
        (c) =>
          (c.type === UNIT_TANK || c.type === UNIT_FLAME || c.type === UNIT_STORM) &&
          c.order === "advance" &&
          Math.abs(c.cx - lane) < 600,
      );
      this.attack = { lane, breach: lane, stage: "prep", timer: 0, units: [...infantry, ...support].map((c) => c.id) };
      this.attackStart = [...infantry, ...support].reduce((n, c) => n + c.alive, 0);
      this.onLog?.(`Angriff Flanke ${best} mit ${this.attackStart} Mann`);
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
    if (!units.some((c) => c.type === UNIT_RIFLE || c.type === UNIT_STORM)) {
      this.endAttack(b);
      return;
    }
    const enemyFront = (x: number) => b.terrain.frontY(enemySide, x);
    const inTrench = (c: Company) => Math.abs(c.cy - enemyFront(c.cx)) < 50;
    // Erfahrene Offiziere brechen einen festgefahrenen Angriff ab, bevor er verblutet
    if (this.veteran && a.stage !== "prep") {
      const left = units.reduce((n, c) => n + c.alive, 0);
      const limit = a.stage === "storm" ? 0.5 : 0.7;
      if (left < this.attackStart * limit && !units.some((c) => c.type !== UNIT_TANK && inTrench(c))) {
        this.onLog?.(`Abbruch (Phase ${a.stage})`);
        for (const c of units) if (c.type !== UNIT_TANK) b.orderRetreat(c.id);
        this.endAttack(b);
        return;
      }
    }
    // Bereitstellung in Trichtern, nah genug für den Sturm, aber noch außerhalb des Drahts
    // Ausgangsstellung außerhalb der Gewehrreichweite (nur MGs reichen so weit)
    const jumpY = (x: number) => enemyFront(x) - fwd * 360;
    const spread = (k: number, n: number, w: number, around: number) => around + (k - (n - 1) / 2) * w;
    const foot = units.filter((c) => c.type !== UNIT_TANK);
    const tanks = units.filter((c) => c.type === UNIT_TANK);
    const arty = () => b.sides[this.side].artyCharges > 0;

    if (a.stage === "prep") {
      // 1. Draht zerschießen: Artillerie auf den Drahtgürtel vor dem Einbruchsabschnitt
      if (arty()) {
        b.callArtillery(this.side, a.lane, this.veteran ? b.terrain.wireY(enemySide, a.lane) : enemyFront(a.lane), "he");
        this.artyWait = 30;
      }
      // 2. Vorarbeiten in Deckung (von Trichter zu Trichter), Panzer vorneweg
      foot.forEach((c, k) => {
        const x = spread(k, foot.length, 170, a.lane);
        b.orderMove(c.id, x, jumpY(x));
      });
      tanks.forEach((c, k) => b.orderMove(c.id, spread(k, tanks.length, 120, a.lane), jumpY(a.lane) + fwd * 70));
      a.stage = "approach";
      a.timer = 0;
    } else if (a.stage === "approach") {
      // Wer in der Ausgangsstellung wartet, liegt unter Feuer: nicht auf die letzten Nachzügler warten
      const rifles = foot.filter((c) => c.type === UNIT_RIFLE);
      const there = rifles.filter((c) => Math.abs(c.cy - jumpY(c.cx)) < 80).length;
      const ready = there >= rifles.length * 0.75;
      if (ready || a.timer > (this.veteran ? 150 : 120)) {
        a.breach = this.veteran ? this.findBreach(b, enemySide, a.lane) : a.lane;
        // 3. Nebel auf den feindlichen Graben, dann Sprengfeuer
        if (this.veteran) {
          // Nebel direkt auf den feindlichen Graben: Die Verteidiger sehen erst auf wenige Meter
          const wall = enemyFront(a.breach) - fwd * 20;
          for (const dx of [-110, 0, 110]) if (arty()) b.callArtillery(this.side, a.breach + dx - 20, wall, "smoke");
        }
        if (arty()) b.callArtillery(this.side, a.breach, enemyFront(a.breach), "he");
        tanks.forEach((c) => b.orderMove(c.id, a.breach, enemyFront(a.breach) + fwd * 40));
        a.stage = "smoke";
        a.timer = 0;
      }
    } else if (a.stage === "smoke") {
      // 4. Sobald der Nebel steht: Stoßtrupps zuerst, dann die Infanterie – durch die Drahtlücke
      // Erfahrene warten, bis der Nebel wirklich über dem Einbruchsabschnitt liegt
      const smokeUp = b.smokes.filter((sm) => Math.abs(sm.x - a.breach) < 200).length >= 6;
      if (this.veteran ? smokeUp || a.timer >= 24 : a.timer >= 6) {
        const storm = foot.filter((c) => c.type === UNIT_STORM || c.type === UNIT_FLAME);
        const rest = foot.filter((c) => c.type === UNIT_RIFLE);
        storm.forEach((c, k) => {
          const x = spread(k, storm.length, 60, a.breach);
          b.orderStorm(c.id, x, enemyFront(x));
        });
        // Erfahrene führen die Welle eng durch die Lücke im Nebel, unerfahrene in breiter Linie
        rest.forEach((c, k) => {
          const x = spread(k, rest.length, this.veteran ? 70 : 110, a.breach);
          b.orderStorm(c.id, x, enemyFront(x));
        });
        a.stage = "storm";
        a.timer = 0;
      }
    } else if (a.stage === "storm") {
      // Feuerwalze: solange die eigenen Leute noch weit genug weg sind, weiter auf den Graben schießen
      if (this.veteran && arty()) {
        const lead = Math.min(...foot.map((c) => Math.abs(c.cy - enemyFront(c.cx))));
        if (lead > 170) b.callArtillery(this.side, a.breach, enemyFront(a.breach), "he");
      }
      if (a.timer > 120) {
        if (this.veteran) this.consolidate(b, a, foot, inTrench);
        else
          // Unerfahrene graben sich ein, wo sie gerade liegen – oft mitten im Niemandsland
          units.forEach((c) => {
            c.homeX = c.cx;
            c.homeY = c.cy;
          });
        this.endAttack(b);
      }
    }
  }

  /**
   * Einbruch sichern: Wer im feindlichen Graben steht, richtet ihn zur Verteidigung ein
   * und bekommt ein MG nachgeschoben. Wer davor liegen geblieben ist, geht zurück.
   */
  private consolidate(b: Battle, a: Attack, foot: Company[], inTrench: (c: Company) => boolean) {
    const holding = foot.filter(inTrench);
    for (const c of foot) {
      if (holding.includes(c)) {
        c.homeX = c.cx;
        c.homeY = c.cy;
      } else b.orderRetreat(c.id);
    }
    if (holding.length === 0) return;
    const mgs = b.companies.filter((c) => c.side === this.side && c.type === UNIT_MG && c.alive > 0 && c.order === "advance" && !c.manual);
    const mg = mgs.sort((p, q) => Math.abs(p.cx - a.breach) - Math.abs(q.cx - a.breach))[0];
    if (mg && mgs.length >= 2) {
      const y = b.terrain.frontY(1 - this.side, a.breach);
      b.orderMove(mg.id, a.breach, y);
      mg.homeX = a.breach;
      mg.homeY = y;
      this.onLog?.(`Einbruch gesichert, MG nachgezogen`);
    }
  }

  /** Wo im Abschnitt ist der feindliche Draht am stärksten zerschossen? */
  private findBreach(b: Battle, enemySide: number, lane: number): number {
    const fwd = FORWARD[enemySide];
    let best = lane;
    let bestScore = -Infinity;
    for (let x = lane - 180; x <= lane + 180; x += 15) {
      const base = b.terrain.frontY(enemySide, x);
      let open = 0;
      for (const off of [WIRE_OFFSET - 12, WIRE_OFFSET, WIRE_OFFSET + 14]) open += b.terrain.slowAt(x, base + fwd * off);
      const score = open - Math.abs(x - lane) / 400;
      if (score > bestScore) {
        bestScore = score;
        best = x;
      }
    }
    return best;
  }

  private endAttack(b: Battle) {
    if (this.attack && this.onLog) {
      const left = this.attack.units.reduce((n, id) => n + Math.max(0, b.companies[id].alive), 0);
      const obj = b.objectives.filter((o) => o.owner === this.side && Math.abs(o.y - b.terrain.frontY(1 - this.side, o.x)) < 40).length;
      this.onLog(`Angriff Ende (Phase ${this.attack.stage}): ${left}/${this.attackStart} übrig, feindliche Stellungen gehalten: ${obj}`);
    }
    this.attack = null;
    const aggr = Math.max(0.5, this.maxAggression());
    this.attackWait = (60 + b.rng.next() * 60) / aggr;
  }

  private artillery(b: Battle, own: Company[], foe: Company[]) {
    if (this.artyWait > 0 || b.sides[this.side].artyCharges === 0) return;
    // Erfahrene sparen sich die Batterien für Nebel und Feuerwalze ihres Angriffs auf
    if (this.veteran && this.attack && this.attack.stage !== "storm" && b.sides[this.side].artyCharges < 3) return;
    let best: Company | null = null;
    let bestScore = 70;
    for (const c of foe) {
      if (c.type === UNIT_MAGE) continue;
      const inOpen = b.terrain.coverAt(c.cx, c.cy) < 0.5;
      let score = c.alive * (inOpen ? 1.6 : 0.4);
      if (c.type === UNIT_MG) score = 90;
      if (c.type === UNIT_TANK) score = 60 * c.alive;
      if (c.type === UNIT_GUN) {
        // Gegenbatterie: wer gerade gefeuert hat, ist per Schallmessung geortet
        const heard = b.time - b.lastGunfire[c.side] < 40;
        score = (heard ? 140 : 60) * c.alive;
      }
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
    if (this.veteran) {
      this.veteranMages(b, own, foe);
      return;
    }
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

  /**
   * Erfahrene Magierführung: alle Staffeln fliegen gemeinsam, kämpfen über den eigenen Linien
   * und dem Niemandsland, wo die eigenen MGs mithelfen, fangen feindliche Magier dort ab,
   * fliegen nie tief ins feindliche Hinterland und nehmen angeschlagene Staffeln zurück.
   */
  private veteranMages(b: Battle, own: Company[], foe: Company[]) {
    const fwd = FORWARD[this.side];
    // wie weit etwas vor der eigenen Front liegt (negativ = dahinter)
    const ahead = (c: Company) => (c.cy - this.front(b, c.cx)) * fwd;
    const gap = (x: number) => (b.terrain.frontY(1 - this.side, x) - this.front(b, x)) * fwd;
    const atHome = (m: Company) => Math.hypot(m.cx - m.homeX, m.cy - m.homeY) < 60;
    const all = own.filter((m) => m.type === UNIT_MAGE && m.order !== "retreat");
    if (all.length === 0) return;
    const home = () => {
      for (const m of all) if (!atHome(m)) b.orderRetreat(m.id);
    };
    // 1. Feindliche Magier über der eigenen Stellung: alle Staffeln abfangen, dort helfen Gewehre und MGs mit
    const intruder = foe.filter((c) => c.type === UNIT_MAGE && ahead(c) < 160).sort((p, q) => ahead(p) - ahead(q))[0];
    if (intruder) {
      const y = this.front(b, intruder.cx) + fwd * Math.min(ahead(intruder), 60);
      for (const m of all) if (m.mana >= 15) b.orderMove(m.id, intruder.cx, y);
      return;
    }
    // 2. Eigene Ausfälle nur, solange die feindlichen Magier nicht eingreifen können
    //    (nachladen, zerschlagen oder klar unterlegen) – und nur mit allen vollen Staffeln gemeinsam
    const squads = all.filter((m) => m.alive >= m.initial * 0.5);
    const foeMages = foe.filter((c) => c.type === UNIT_MAGE);
    const foeReady = foeMages.filter((c) => c.order !== "retreat" && c.mana > 30).reduce((n, c) => n + c.alive, 0);
    const ours = squads.reduce((n, c) => n + c.alive, 0);
    const airOk = foeReady <= ours * 0.6;
    if (squads.length === 0 || squads.some((m) => atHome(m) && m.mana < 85)) {
      home();
      return;
    }
    if (!airOk) {
      // Ohne Luftüberlegenheit nur Nahverteidigung: Angreifer vor dem eigenen Draht, gedeckt vom eigenen Graben
      const close = foe
        .filter((c) => c.type !== UNIT_MAGE && c.type !== UNIT_GUN && ahead(c) > -40 && ahead(c) < 220)
        .sort((p, q) => score(b, q) - score(b, p))[0];
      if (!close) {
        home();
        return;
      }
      const y = this.front(b, close.cx) + fwd * Math.min(ahead(close) - 60, 40);
      squads.forEach((m, k) => b.orderMove(m.id, close.cx + (k - (squads.length - 1) / 2) * 30, y));
      return;
    }
    // nur was außerhalb der Reichweite der feindlichen Grabenbesatzung liegt
    const target = foe
      .filter((c) => c.type !== UNIT_MAGE && c.type !== UNIT_GUN && ahead(c) < gap(c.cx) - 150)
      .sort((p, q) => score(b, q) - score(b, p) + (this.attack ? (Math.abs(p.cx - this.attack.breach) - Math.abs(q.cx - this.attack.breach)) / 10 : 0))[0];
    if (!target) {
      home();
      return;
    }
    // Nicht bis an den feindlichen Graben: dort warten MGs und die ganze Besatzung
    const maxY = this.front(b, target.cx) + fwd * (gap(target.cx) - 260);
    const ty = fwd > 0 ? Math.min(target.cy, maxY) : Math.max(target.cy, maxY);
    squads.forEach((m, k) => b.orderMove(m.id, target.cx + (k - (squads.length - 1) / 2) * 30, ty));
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
