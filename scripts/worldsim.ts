// Lässt die Kampagne ohne Grafik laufen (alle Nationen KI) – für Balancing und Performance.
//   npm run worldsim -- [minuten]
import { readFileSync } from "node:fs";
import { TICK } from "../src/sim/config.ts";
import { decodeMap, type MapFile } from "../src/world/mapData.ts";
import { World } from "../src/world/world.ts";

const minutes = Number(process.argv[2] ?? 30);
const map = decodeMap(JSON.parse(readFileSync("public/maps/europa.json", "utf8")) as MapFile);
const w = new World(map, -1);
w.onEvent = (e) => {
  if (e.kind === "war" || e.text.includes("Frieden") || e.text.includes("existieren"))
    console.log(`[${w.dateString()}] ${e.text}`);
};
let ticks = 0;
let next = 60;
let lastT = performance.now();
let lastTicks = 0;
while (w.time < minutes * 60) {
  w.update(TICK);
  ticks++;
  if (w.time >= next) {
    next += 300;
    const battles = w.points.filter((p) => p.battle).length;
    const units = w.points.reduce((s, p) => s + (p.battle ? p.battle.battle.n : 0), 0);
    const ms = (performance.now() - lastT) / (ticks - lastTicks);
    lastT = performance.now();
    lastTicks = ticks;
    const owners = new Map<string, number>();
    for (let p = 0; p < w.owner.length; p++) {
      const k = w.nations[w.owner[p]].short;
      owners.set(k, (owners.get(k) ?? 0) + 1);
    }
    console.log(
      `-- ${w.dateString()} (${(w.time / 60).toFixed(0)} min): ${w.wars.length} Kriege, ${w.points.length} Frontpunkte, ` +
        `${battles} Schlachten (${units} Plätze belegt), ${ms.toFixed(2)} ms/Tick`,
    );
    console.log("   Provinzen: " + [...owners].map(([k, v]) => `${k} ${v}`).join(", "));
    const bars = w.points
      .filter((p) => p.battle || Math.abs(p.bar) > 1)
      .map((p) => `${w.nations[p.a].short}-${w.nations[p.b].short} ${p.bar.toFixed(0)} [${p.strength.map((s) => Math.round(s)).join(":")}]`);
    console.log("   " + bars.join(" | "));
  }
}
