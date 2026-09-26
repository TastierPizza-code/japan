// Lässt eine Schlacht ohne Grafik laufen: Computer gegen Computer.
// Gut zum Balancing und um die Performance zu messen.
//   npm run sim -- [seed] [minuten]
import { BattleAI } from "../src/sim/ai.ts";
import { Battle } from "../src/sim/battle.ts";
import { TICK } from "../src/sim/config.ts";

declare const process: { argv: string[] };

const seed = Number(process.argv[2] ?? 1);
const maxMinutes = Number(process.argv[3] ?? 40);

const b = new Battle(seed);
const ais = [new BattleAI(0), new BattleAI(1)];
const t0 = performance.now();
let ticks = 0;
let lastReport = 0;
let shots = 0;
let peakUnits = 0;

while (!b.result && b.time < maxMinutes * 60) {
  for (const ai of ais) ai.update(b, TICK);
  b.update(TICK);
  shots += b.events.shots.length / 6;
  b.clearEvents();
  ticks++;
  peakUnits = Math.max(peakUnits, b.groundStrength(0) + b.groundStrength(1));
  if (b.time - lastReport >= 60) {
    lastReport = b.time;
    const obj = b.objectives.map((o) => o.owner).join("");
    const orders = b.companies
      .filter((c) => c.alive > 0 && c.type === 0)
      .map((c) => `${c.side}${c.order[0]}${Math.round(c.morale)}`)
      .join(" ");
    console.log(
      `t=${(b.time / 60).toFixed(0).padStart(2)}min  Stärke ${b.groundStrength(0)} : ${b.groundStrength(1)}  Ziele ${obj}  ${orders}`,
    );
  }
}
const ms = performance.now() - t0;
console.log(b.result ? `Sieger: Seite ${b.result.winner} (${b.result.reason})` : "Kein Ergebnis (Zeitlimit)");
console.log(
  `Dauer ${(b.time / 60).toFixed(1)} min Spielzeit, ${shots} Schüsse, max ${peakUnits} Soldaten, ` +
    `${(ms / ticks).toFixed(3)} ms pro Tick (Budget bei 1x: 50 ms)`,
);
