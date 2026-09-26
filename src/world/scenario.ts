import type { UnitKind } from "./config.ts";
import type { World } from "./world.ts";

// Startaufstellung „Sommer 1914“ (alternative Geschichte).
// [Infanterie, MG, Artillerie, Magier] je Nation
const ARMIES: Record<string, [number, number, number, number]> = {
  VEL: [14, 4, 3, 2],
  CAR: [13, 3, 3, 1],
  BRY: [7, 2, 2, 1],
  DAN: [11, 3, 2, 1],
  VAL: [8, 2, 2, 1],
  VOS: [18, 3, 3, 1],
  ANA: [9, 2, 2, 0],
  IBE: [6, 1, 1, 0],
  NOR: [5, 1, 1, 0],
  BRA: [3, 1, 0, 0],
  ALP: [2, 1, 0, 0],
  BAL: [7, 1, 1, 0],
  PAR: [3, 0, 0, 0],
};

const ALLIANCES = [
  ["VEL", "DAN", "ANA"], // Mittelmächte
  ["CAR", "VOS", "BRY", "BAL"], // Entente
];

// Wer wen nicht leiden kann (Meinung von → über)
const GRUDGES: [string, string, number][] = [
  ["CAR", "VEL", -60],
  ["VEL", "CAR", -40],
  ["DAN", "BAL", -70],
  ["BAL", "DAN", -60],
  ["VOS", "DAN", -40],
  ["DAN", "VOS", -40],
  ["BRY", "VEL", -30],
  ["VEL", "VOS", -30],
  ["ANA", "VOS", -40],
  ["VOS", "ANA", -40],
  ["VAL", "DAN", -30],
  ["BAL", "ANA", -40],
];

export function SCENARIO_1914(w: World) {
  const key = (k: string) => w.nationByKey(k).id;
  for (const group of ALLIANCES) {
    for (const a of group) for (const b of group) if (a !== b) w.ally(key(a), key(b));
    for (const a of group) for (const b of group) if (a !== b) w.nations[key(a)].opinion[key(b)] = 60;
  }
  for (const [a, b, v] of GRUDGES) w.nations[key(a)].opinion[key(b)] = v;

  const kinds: UnitKind[] = ["infantry", "mg", "artillery", "mage"];
  for (const n of w.nations) {
    const army = ARMIES[n.key] ?? [2, 0, 0, 0];
    const provs = w.provincesOf(n.id);
    // Nur Provinzen, die über Land mit der Hauptstadt verbunden sind (keine Kolonien/Inseln)
    const home = connectedTo(w, n.capital, n.id);
    const pool = provs.filter((p) => home.has(p));
    kinds.forEach((kind, k) => {
      for (let i = 0; i < army[k]; i++) {
        const prov = i % 2 === 0 || kind !== "infantry" ? n.capital : pool[Math.floor(w.rng.next() * pool.length)];
        w.createDivision(n.id, kind, prov);
      }
    });
  }

  // Die Julikrise: Danubien erklärt dem Balkanbund den Krieg – außer der Spieler ist Danubien
  const dan = key("DAN");
  const bal = key("BAL");
  w.schedule(45, () => {
    if (w.player === dan || w.player === bal) {
      w.log("Julikrise: Die Spannungen zwischen Danubien und dem Balkanbund erreichen ihren Höhepunkt.", "war", true);
      return;
    }
    w.declareWar(dan, bal);
  });
}

function connectedTo(w: World, start: number, n: number): Set<number> {
  const seen = new Set([start]);
  const stack = [start];
  while (stack.length) {
    const p = stack.pop()!;
    for (const [q] of w.map.provinces[p].nb) {
      if (w.owner[q] === n && !seen.has(q)) {
        seen.add(q);
        stack.push(q);
      }
    }
  }
  return seen;
}
