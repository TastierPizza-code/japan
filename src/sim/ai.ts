import type { Battle, Company } from "./battle.ts";
import { FORWARD, STATS, UNIT_AT, UNIT_FLAME, UNIT_GUN, UNIT_MAGE, UNIT_MG, UNIT_RIFLE, UNIT_STORM, UNIT_TANK, WIRE_OFFSET, WORLD_W } from "./config.ts";

const LANES = [WORLD_W / 6, WORLD_W / 2, (WORLD_W * 5) / 6];
const LANE_NAMES = ["links", "Mitte", "rechts"];

/** Haltung eines KI-Offiziers für eine Flanke. */
export type Stance = "hold" | "defensive" | "balanced" | "aggressive";

/** Wie leicht sich die Flanke zum Angriff entschließt (0 = nie). */
const AGGRESSION: Record<Stance, number> = { hold: 0, defensive: 0, balanced: 1, aggressive: 1.8 };

interface Attack {
  lane: number;
  /** Einbruchstelle: wo der Draht am meisten zerstört ist */
  breach: number;
  stage: "prep" | "approach" | "tanks" | "smoke" | "storm";
  timer: number;
  units: number[];
  /** vom Spieler befohlen */
  planned: boolean;
  /** Begleit-MGs sind in den Einbruch nachgezogen */
  mgsForward?: boolean;
  /** Infanterie ist in die Ausgangsstellung unterwegs */
  infantryGo?: boolean;
  /** Gas auf den Unterstützungsgraben ist geschossen */
  gassed?: boolean;
  /** Kompanie der zweiten Welle und ob sie schon stürmt */
  wave?: number;
  waveSent?: boolean;
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
  /** So viele Batterien bleiben für den Spieler frei (solange er zuschaut) */
  keepBatteries = 0;
  /** Meldungen an den Spieler (Angriffe, Einbrüche, feindliche Stürme, Gas …) */
  reports: { text: string; kind: "good" | "bad" | "info"; x: number; y: number }[] = [];
  private lastWarn = new Map<string, number>();
  private owners: number[] = [];
  /** Protokoll für Tests (Angriffe, Ergebnisse) */
  onLog: ((msg: string) => void) | null = null;
  private attackStart = 0;
  /** Erfahrene Offiziere nutzen Drahtschneiden, Nebel und Stoßtrupps; unerfahrene stürmen einfach los */
  veteran: boolean;
  /** Feindliche Stärke je Abschnitt in den letzten Minuten */
  private history: { t: number; s: number[] }[] = [];
  /** Gehaltener Einbruch: dorthin geht Sperrfeuer gegen Gegenstöße */
  private held: { x: number; y: number; until: number } | null = null;

  constructor(side: number, stance: Stance = "balanced", veteran = true) {
    this.side = side;
    // Beide Stäbe denken zeitversetzt: keine Seite entscheidet systematisch zuerst
    this.thinkTimer = 2 + side * 1.5;
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
    // Beobachtung: feindliche Stärke je Abschnitt, um frische Verluste zu erkennen
    this.history.push({ t: b.time, s: LANES.map((x) => strengthNear(foe, x, 300, (c) => c.type !== UNIT_MAGE && c.type !== UNIT_GUN)) });
    while (this.history.length > 0 && b.time - this.history[0].t > 150) this.history.shift();

    this.watch(b, foe);
    this.reserves(b);
    this.defend(b, own);
    this.antiTank(b, own, foe);
    this.offense(b, own, foe);
    this.artillery(b, own, foe);
    this.mages(b, own, foe);
  }

  private report(text: string, kind: "good" | "bad" | "info", x: number, y: number) {
    this.reports.push({ text, kind, x, y });
    if (this.reports.length > 12) this.reports.shift();
  }

  /** Warnung höchstens alle paar Minuten je Anlass */
  private warn(key: string, now: number, every: number) {
    if ((this.lastWarn.get(key) ?? -Infinity) + every > now) return false;
    this.lastWarn.set(key, now);
    return true;
  }

  /** Was der Stab beobachtet und meldet: feindliche Stürme, Gas, Stellungen */
  private watch(b: Battle, foe: Company[]) {
    const fwd = FORWARD[this.side];
    for (let l = 0; l < LANES.length; l++) {
      const storming = foe.filter(
        (c) => c.order === "storm" && Math.abs(c.cx - LANES[l]) < 300 && (c.cy - this.front(b, c.cx)) * fwd > -500,
      );
      const men = storming.reduce((n, c) => n + c.alive, 0);
      if (men >= 40 && this.warn(`sturm${l}`, b.time, 120)) this.report(`Feind stürmt ${LANE_NAMES[l]}! (${men} Mann)`, "bad", LANES[l], this.front(b, LANES[l]));
    }
    for (const sm of b.smokes) {
      if (!sm.gas || b.time - sm.t0 > 3.5) continue;
      const hit = b.companies.some((c) => c.side === this.side && c.alive > 0 && Math.hypot(c.cx - sm.x, c.cy - sm.y) < 120);
      if (hit && this.warn(`gas${laneOf(sm.x)}`, b.time, 60)) this.report(`Gas ${LANE_NAMES[laneOf(sm.x)]}! Masken auf`, "bad", sm.x, sm.y);
    }
    b.objectives.forEach((o, k) => {
      const prev = this.owners[k];
      if (prev !== undefined && prev !== o.owner) {
        if (o.owner === this.side) this.report(`Feindliche Stellung ${LANE_NAMES[laneOf(o.x)]} genommen!`, "good", o.x, o.y);
        else this.report(`Stellung ${LANE_NAMES[laneOf(o.x)]} verloren!`, "bad", o.x, o.y);
      }
      this.owners[k] = o.owner;
    });
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
    // „Halten“: alles, was im Niemandsland liegt, zurück in den Graben – ein eroberter feindlicher Graben wird gehalten
    for (const c of own) {
      if (busy.has(c.id) || c.type === UNIT_MAGE || c.type === UNIT_GUN || c.order !== "advance") continue;
      if (this.stances[laneOf(c.cx)] !== "hold") continue;
      const inEnemyTrench = Math.abs(c.cy - b.terrain.frontY(1 - this.side, c.cx)) < 50;
      if (!inEnemyTrench && (c.cy - b.terrain.wireY(this.side, c.cx)) * FORWARD[this.side] > 20) {
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
      const now = LANES.map((x) => strengthNear(foe, x, 300, (c) => c.type !== UNIT_MAGE && c.type !== UNIT_GUN));
      const past = this.history.find((h) => b.time - h.t <= 150) ?? null;
      for (let l = 0; l < LANES.length; l++) {
        const a = AGGRESSION[this.stances[l]];
        if (a === 0) continue;
        // Gelegenheit: wo der Gegner gerade viele Männer verloren hat (gescheiterter Angriff, Trommelfeuer)
        const bled = past ? Math.max(0, past.s[l] - now[l]) : 0;
        const chance = this.veteran ? 1 + Math.min(1, bled / 300) : 1;
        const mine =
          strengthNear(own, LANES[l], 300, (c) => (c.type === UNIT_RIFLE || c.type === UNIT_STORM) && c.morale > 60) +
          strengthNear(own, LANES[l], 600, (c) => c.type === UNIT_TANK) * 60;
        const theirs = strengthNear(foe, LANES[l], 300, (c) => c.type !== UNIT_MAGE && c.type !== UNIT_GUN) + 1;
        const score = (mine / theirs) * a * chance;
        if (score > bestScore) {
          bestScore = score;
          best = l;
        }
      }
      // Erfahrene Offiziere greifen nur mit örtlicher Überlegenheit an – und wer insgesamt
      // unterlegen ist, verteidigt lieber, außer der Gegner hat gerade schwer geblutet
      const ratio = b.groundStrength(this.side) / Math.max(1, b.groundStrength(1 - this.side));
      const need = this.veteran ? (ratio < 1 ? 1.3 / Math.max(0.5, ratio) ** 2 : 1.3) : 0.6;
      if (best < 0 || bestScore < need) {
        this.attackWait = 30;
        return;
      }
      if (!this.startAttack(b, own, LANES[best], false)) {
        this.attackWait = 30;
        return;
      }
    }

    const a = this.attack;
    if (!a) return;
    // Haltung wurde inzwischen geändert → Angriff abbrechen (befohlene Angriffe laufen weiter)
    if (!a.planned && AGGRESSION[this.stances[laneOf(a.lane)]] === 0) {
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
        this.report(`Angriff ${LANE_NAMES[laneOf(a.lane)]} abgebrochen – zu hohe Verluste`, "bad", a.breach, (enemyFront(a.breach) + this.front(b, a.breach)) / 2);
        for (const c of units) if (c.type !== UNIT_TANK) b.orderRetreat(c.id);
        this.endAttack(b);
        return;
      }
    }
    // Bereitstellung in Trichtern, nah genug für den Sturm, aber noch außerhalb des Drahts
    // Ausgangsstellung außerhalb der Gewehrreichweite (nur MGs reichen so weit)
    const jumpY = (x: number) => enemyFront(x) - fwd * 360;
    const spread = (k: number, n: number, w: number, around: number) => around + (k - (n - 1) / 2) * w;
    const foot = units.filter((c) => c.type !== UNIT_TANK && c.type !== UNIT_MG);
    const mgs = units.filter((c) => c.type === UNIT_MG);
    const tanks = units.filter((c) => c.type === UNIT_TANK);
    const arty = () => b.sides[this.side].artyCharges > 0;

    if (a.stage === "prep") {
      // 1. Draht zerschießen: Artillerie auf den Drahtgürtel vor dem Einbruchsabschnitt
      if (arty()) {
        b.callArtillery(this.side, a.lane, this.veteran ? b.terrain.wireY(enemySide, a.lane) : enemyFront(a.lane), "he");
        this.artyWait = 30;
      }
      // 2. Panzer hinter der Ausgangsstellung bereitstellen, außerhalb der Reichweite der Tankgewehre.
      //    Erfahrene lassen die Infanterie erst losgehen, wenn sie gleichzeitig mit den Panzern ankommt.
      tanks.forEach((c, k) => b.orderMove(c.id, spread(k, tanks.length, 120, a.lane), jumpY(a.lane) - fwd * 40));
      if (!this.veteran || tanks.length === 0) this.moveInfantry(b, a, foot, jumpY);
      // Begleit-MGs an die Flanken der Ausgangsstellung: halten die Nachbarabschnitte nieder
      mgs.forEach((c, k) => {
        const x = a.lane + (k % 2 === 0 ? -1 : 1) * 240;
        b.orderMove(c.id, x, enemyFront(x) - fwd * 330);
      });
      if (this.veteran) this.prepareWave(b, a, (x) => jumpY(x) - fwd * 140);
      a.stage = "approach";
      a.timer = 0;
    } else if (a.stage === "approach") {
      // Vorbereitung – eine Batterie bleibt für den Nebel frei:
      // zuerst Gas auf den feindlichen Unterstützungsgraben (von dort kommt der Gegenstoß), dann Sprengfeuer
      if (this.veteran && b.sides[this.side].artyCharges >= 2) {
        if (!a.gassed) {
          a.gassed = true;
          b.callArtillery(this.side, a.lane - 60, b.terrain.supportY(enemySide, a.lane), "gas");
        } else b.callArtillery(this.side, a.lane, enemyFront(a.lane), "he");
      }
      if (!a.infantryGo) {
        // Warten im eigenen Graben, bis die langsamen Panzer weit genug vorn sind
        const eta = (list: Company[], speed: number, ty: (c: Company) => number) =>
          Math.max(0, ...list.map((c) => Math.hypot(c.cx - c.tx, c.cy - ty(c)) / speed));
        const tankEta = eta(tanks, STATS[UNIT_TANK].walk * 0.85, (c) => c.ty);
        const infEta = eta(foot, STATS[UNIT_RIFLE].walk, (c) => jumpY(c.cx));
        if (tankEta <= infEta + 10 || a.timer > 200) {
          this.moveInfantry(b, a, foot, jumpY);
          a.timer = 0;
        }
        return;
      }
      // Wer in der Ausgangsstellung wartet, liegt unter Feuer: nicht auf die letzten Nachzügler warten
      const rifles = foot.filter((c) => c.type === UNIT_RIFLE);
      const there = rifles.filter((c) => Math.abs(c.cy - jumpY(c.cx)) < 80).length;
      // Erfahrene warten auch auf die Panzer
      const tanksThere = !this.veteran || tanks.every((c) => Math.abs(c.cy - (jumpY(c.cx) - fwd * 40)) < 80);
      const ready = there >= rifles.length * 0.75 && tanksThere;
      if (ready || a.timer > (this.veteran ? 200 : 120)) {
        a.breach = this.veteran ? this.findBreach(b, enemySide, a.lane) : a.lane;
        tanks.forEach((c, k) => b.orderMove(c.id, spread(k, tanks.length, 60, a.breach), enemyFront(a.breach) + fwd * 40));
        if (this.veteran && tanks.length > 0) {
          // Panzer rollen voraus; Nebel und Sturm erst, wenn sie nah am Graben sind
          if (arty()) b.callArtillery(this.side, a.breach, enemyFront(a.breach), "he");
          a.stage = "tanks";
          a.timer = 0;
          return;
        }
        // 3. Nebel auf den feindlichen Graben, dann Sprengfeuer
        if (this.veteran) {
          // Nebel direkt auf den feindlichen Graben: Die Verteidiger sehen erst auf wenige Meter
          const wall = enemyFront(a.breach) - fwd * 20;
          for (const dx of [-110, 0, 110]) if (arty()) b.callArtillery(this.side, a.breach + dx - 20, wall, "smoke");
        }
        if (arty()) b.callArtillery(this.side, a.breach, enemyFront(a.breach), "he");
        a.stage = "smoke";
        a.timer = 0;
      }
    } else if (a.stage === "tanks") {
      // Die Infanterie läuft fast dreimal so schnell: erst los, wenn die Panzer vorn sind
      const lead = Math.min(...tanks.map((c) => Math.abs(c.cy - enemyFront(c.cx))));
      if (tanks.length === 0 || lead < 260 || a.timer > 60) {
        const wall = enemyFront(a.breach) - fwd * 20;
        for (const dx of [-110, 0, 110]) if (arty()) b.callArtillery(this.side, a.breach + dx - 20, wall, "smoke");
        a.stage = "smoke";
        a.timer = 0;
      }
    } else if (a.stage === "smoke") {
      // 4. Sobald der Nebel steht: Stoßtrupps zuerst, dann die Infanterie – durch die Drahtlücke
      // Erfahrene warten, bis der Nebel wirklich über dem Einbruchsabschnitt liegt
      const smokeUp = b.smokes.filter((sm) => !sm.gas && Math.abs(sm.x - a.breach) < 200).length >= 6;
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
        this.report(`Sturm ${LANE_NAMES[laneOf(a.breach)]}!`, "info", a.breach, enemyFront(a.breach));
        // Trillerpfeifen entlang der Ausgangsstellung
        for (const dx of [-120, 0, 120]) b.signal(a.breach + dx, jumpY(a.breach + dx), 0);
      }
    } else if (a.stage === "storm") {
      // Feuerwalze: solange die eigenen Leute noch weit genug weg sind, weiter auf den Graben schießen
      const brokeIn = foot.some((c) => c.alive >= 8 && inTrench(c));
      if (this.veteran && arty()) {
        const lead = Math.min(...foot.map((c) => Math.abs(c.cy - enemyFront(c.cx))));
        if (lead > 170) b.callArtillery(this.side, a.breach, enemyFront(a.breach), "he");
        else if (brokeIn) {
          // Abriegelungsfeuer: hinter den genommenen Abschnitt, dorthin, wo der Gegenstoß herkommt
          const y = b.terrain.supportY(enemySide, a.breach);
          if (this.clearOfOwn(b, a.breach, y, 120)) b.callArtillery(this.side, a.breach, y, "he");
        }
      }
      // Zweite Welle: aus der Ausgangsstellung in den Einbruch
      if (brokeIn && a.wave !== undefined && !a.waveSent) {
        a.waveSent = true;
        const w = b.companies[a.wave];
        if (w.alive > 0 && w.order === "advance" && !w.manual) {
          b.orderStorm(w.id, a.breach, enemyFront(a.breach));
          this.onLog?.(`Zweite Welle stürmt: ${w.name}`);
          this.report(`Einbruch ${LANE_NAMES[laneOf(a.breach)]}! Zweite Welle stürmt nach`, "good", a.breach, enemyFront(a.breach));
        }
      }
      if (this.veteran && brokeIn && !a.mgsForward) {
        // Begleit-MGs sofort in den Einbruch nachziehen
        a.mgsForward = true;
        this.held = { x: a.breach, y: enemyFront(a.breach), until: b.time + 300 };
        mgs.forEach((c, k) => {
          const x = a.breach + (k === 0 ? -50 : 50);
          const y = enemyFront(x);
          b.orderMove(c.id, x, y);
          c.homeX = x;
          c.homeY = y;
        });
      }
      if (a.timer > (brokeIn ? 150 : 120)) {
        if (!a.mgsForward) for (const c of mgs) b.orderRetreat(c.id);
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
      this.report(`Einbruch ${LANE_NAMES[laneOf(a.breach)]} gesichert, MG nachgezogen`, "good", a.breach, b.terrain.frontY(1 - this.side, a.breach));
    }
  }

  /**
   * Zweite Welle bereitstellen: eine frische Kompanie aus der eigenen Stellung folgt der ersten
   * mit Abstand, solange in jedem Abschnitt noch Besatzung bleibt.
   */
  private prepareWave(b: Battle, a: Attack, jumpY: (x: number) => number) {
    const fwd = FORWARD[this.side];
    const fresh = b.companies
      .filter((c) => c.side === this.side && c.alive > 60 && c.type === UNIT_RIFLE && c.order === "advance" && !c.manual && !a.units.includes(c.id))
      .filter((c) => (c.cy - this.front(b, c.cx)) * fwd <= 20)
      .sort((p, q) => Math.abs(p.cx - a.breach) - Math.abs(q.cx - a.breach));
    const manned = (skip: Company) =>
      LANES.every((l) =>
        b.companies.some((c) => c.side === this.side && c !== skip && c.alive > 0 && !a.units.includes(c.id) && (c.type === UNIT_RIFLE || c.type === UNIT_MG) && Math.abs(c.cx - l) < 300),
      );
    const wave = fresh.find((c) => manned(c));
    if (!wave) return;
    b.orderMove(wave.id, a.lane, jumpY(a.lane));
    a.units.push(wave.id);
    a.wave = wave.id;
    this.onLog?.(`Zweite Welle rückt nach: ${wave.name}`);
  }

  /** Vorarbeiten in die Ausgangsstellung: Stoßtrupps und Flammenwerfer in die Mitte, Schützen daneben */
  private moveInfantry(b: Battle, a: Attack, foot: Company[], jumpY: (x: number) => number) {
    const fwd = FORWARD[this.side];
    const spread = (k: number, n: number, w: number, around: number) => around + (k - (n - 1) / 2) * w;
    const lead = foot.filter((c) => c.type === UNIT_STORM || c.type === UNIT_FLAME);
    const line = foot.filter((c) => c.type === UNIT_RIFLE);
    lead.forEach((c, k) => {
      const x = spread(k, lead.length, 50, a.lane);
      b.orderMove(c.id, x, jumpY(x) - fwd * 30);
    });
    line.forEach((c, k) => {
      const x = spread(k, line.length, 150, a.lane);
      b.orderMove(c.id, x, jumpY(x));
    });
    a.infantryGo = true;
  }

  /** Liegen keine eigenen Leute im Umkreis? (kein Beschuss der eigenen Truppe) */
  private clearOfOwn(b: Battle, x: number, y: number, r: number) {
    return !b.companies.some((c) => c.side === this.side && c.alive > 0 && c.type !== UNIT_MAGE && Math.hypot(c.cx - x, c.cy - y) < r);
  }

  /** Angriff zusammenstellen: Schützen aus dem Abschnitt, dazu Panzer, Flammenwerfer und Stoßtrupps */
  private startAttack(b: Battle, own: Company[], lane: number, planned: boolean): boolean {
    const reach = this.veteran ? 480 : 300;
    const candidates = own
      .filter((c) => c.type === UNIT_RIFLE && c.order === "advance" && c.morale > 60 && Math.abs(c.cx - lane) < reach)
      .sort((a, c) => c.alive - a.alive);
    // Schwerpunkt bilden, aber ein Teil hält immer den Graben (befohlene Angriffe setzen mehr ein)
    const infantry = candidates.slice(0, Math.max(2, Math.floor(candidates.length * (planned ? 0.7 : 0.5))));
    if (infantry.length === 0) return false;
    const support = own.filter(
      (c) => (c.type === UNIT_TANK || c.type === UNIT_FLAME || c.type === UNIT_STORM) && c.order === "advance" && Math.abs(c.cx - lane) < 600,
    );
    // Erfahrene nehmen bis zu zwei MGs als Begleitfeuer mit, mindestens eins bleibt im Graben
    if (this.veteran) {
      const mgs = own.filter((c) => c.type === UNIT_MG && c.order === "advance");
      const take = mgs
        .filter((c) => Math.abs(c.cx - lane) < 700)
        .sort((p, q) => Math.abs(p.cx - lane) - Math.abs(q.cx - lane))
        .slice(0, Math.min(2, mgs.length - 1));
      support.push(...take);
    }
    this.attack = { lane, breach: lane, stage: "prep", timer: 0, units: [...infantry, ...support].map((c) => c.id), planned };
    this.attackStart = [...infantry, ...support].reduce((n, c) => n + c.alive, 0);
    this.onLog?.(`Angriff bei x=${Math.round(lane)} mit ${this.attackStart} Mann${planned ? " (befohlen)" : ""}`);
    this.report(`Angriff ${LANE_NAMES[laneOf(lane)]} mit ${this.attackStart} Mann – Vorbereitung läuft`, "info", lane, this.front(b, lane));
    return true;
  }

  /**
   * Vom Spieler befohlener Angriff auf einen Abschnitt: Der Offizier führt ihn mit allen
   * Mitteln aus (Draht, Nebel, Feuerwalze, Stoßtrupps), auch wenn er selbst nicht angreifen würde.
   */
  planAttack(b: Battle, x: number): boolean {
    if (this.attack || b.result) return false;
    const lane = Math.max(150, Math.min(WORLD_W - 150, x));
    const own = b.companies.filter((c) => c.side === this.side && c.alive > 0 && !c.manual);
    return this.startAttack(b, own, lane, true);
  }

  /** Kurzbeschreibung des laufenden Angriffs für die Anzeige */
  attackStatus(): string | null {
    const a = this.attack;
    if (!a) return null;
    const where = LANE_NAMES[laneOf(a.lane)];
    const what = { prep: "Draht", approach: "Bereitstellung", tanks: "Panzer rollen", smoke: "Nebel", storm: "Sturm" }[a.stage];
    return `⚔ ${where}: ${what}`;
  }

  /** Laufenden Angriff abbrechen: alle zurück in die Ausgangsstellung */
  cancelAttack(b: Battle) {
    if (!this.attack) return;
    for (const id of this.attack.units) {
      const c = b.companies[id];
      if (c.alive > 0 && !c.manual && c.type !== UNIT_TANK) b.orderRetreat(id);
    }
    this.endAttack(b);
  }

  /** Wo im Abschnitt ist der Draht am stärksten zerschossen und der Graben am dünnsten besetzt? */
  private findBreach(b: Battle, enemySide: number, lane: number): number {
    const fwd = FORWARD[enemySide];
    let best = lane;
    let bestScore = -Infinity;
    for (let x = lane - 180; x <= lane + 180; x += 15) {
      const base = b.terrain.frontY(enemySide, x);
      let open = 0;
      for (const off of [WIRE_OFFSET - 12, WIRE_OFFSET, WIRE_OFFSET + 14]) open += b.terrain.slowAt(x, base + fwd * off);
      // Schwachstelle: wo der Graben dünn besetzt ist (von Beobachtern und Fliegern zu sehen)
      const defenders = b.countNear(enemySide, x, base, 70);
      const score = open - defenders / 40 - Math.abs(x - lane) / 400;
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
    if (this.artyWait > 0 || b.sides[this.side].artyCharges <= this.keepBatteries) return;
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
      // Gegenstoß auf unseren Einbruch: Sperrfeuer
      if (this.held && this.held.until > b.time && Math.hypot(c.cx - this.held.x, c.cy - this.held.y) < 320) score *= 2.5;
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
    if (this.stances.every((s) => s === "hold") && !this.attack) return;
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
    // 2. Luftschutz über dem eigenen Sturm oder frisch genommenen Einbruch
    const a = this.attack;
    const focus =
      a && (a.stage === "storm" || a.stage === "smoke")
        ? { x: a.breach, y: b.terrain.frontY(1 - this.side, a.breach) }
        : this.held && this.held.until > b.time
          ? this.held
          : null;
    if (focus) {
      const near = (c: Company) => Math.hypot(c.cx - focus.x, c.cy - focus.y) < 350;
      const threat =
        foe.filter((c) => c.type === UNIT_MAGE && near(c)).sort((p, q) => q.alive - p.alive)[0] ??
        foe.filter((c) => c.type !== UNIT_MAGE && c.type !== UNIT_GUN && near(c) && c.order === "storm").sort((p, q) => q.alive - p.alive)[0];
      if (threat) {
        const flyers = all.filter((m) => m.mana >= 20 && m.alive >= m.initial * 0.5);
        if (flyers.length > 0) {
          flyers.forEach((m, k) => b.orderMove(m.id, threat.cx + (k - (flyers.length - 1) / 2) * 30, threat.cy - fwd * 40));
          return;
        }
      }
    }
    // 3. Eigene Ausfälle nur, solange die feindlichen Magier nicht eingreifen können
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
