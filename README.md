# Grabenfront

Strategiespiel im Stil eines Anime-Grabenkriegs (inspiriert von Serien wie *Saga of Tanya the Evil*,
eigenes Setting): ein alternatives Europa um 1914, riesige Schlachten mit Tausenden Soldaten wie in
*Songs of Syx* und eine Kampagne, in der man Stück für Stück Provinzen erobert. Läuft im Browser, auf
dem Handy wie am PC. Das Spielkonzept steht in [KONZEPT.md](KONZEPT.md).

## Stand (v0.2): Kampagnen-Prototyp

**Kampagne**
- Alternatives Europa 1914 aus echten Geodaten: 13 Nationen, 677 Provinzen. Kleine Länder sind
  zusammengefasst, und die Grenzen von 1914 sind nachgebildet (Elsass-Lothringen, Galizien,
  Kongresspolen …).
- Die Welt läuft **in Echtzeit** (1 Minute = 1 Tag). Pause und 1×/2×/4×/8× sind möglich, bei wichtigen
  Ereignissen **pausiert das Spiel automatisch**.
- Zwei Bündnisse: Die **Julikrise** löst eine Kettenreaktion aus. Verbündete rufen um Hilfe, und du
  entscheidest, ob du beitrittst.
- **Frontpunkte** entlang jeder Kriegsgrenze, je nach Grenzlänge 1–4 Stück. Jeder Punkt mit Truppen auf
  beiden Seiten ist eine **echte, laufende Schlacht**.
- **Einnahme nach der 70/30-Regel**: Wer ≥ 70 % der Gesamtstärke stellt, schiebt den Balken vor.
  Das dauert 15 bis 60 Minuten, je nach Übermacht. Ist der Balken voll, wechselt die Provinz den
  Besitzer. Eingekesselte Gebiete ergeben sich.
- **Truppen schicken**: Divisionen reisen über die Karte an Fronten, auch an die Fronten von
  Verbündeten. Unbewachte Punkte fallen kampflos.
- **KI-Offiziere pro Flanke** (Halten / Defensiv / Ausgewogen / Aggressiv). Sie führen jede Schlacht,
  auch wenn du nicht hinschaust.
- Einfache Wirtschaft (Gold, Nahrung, Material, Rekruten) und Ausbildung von Infanterie, MGs,
  Artillerie und Magiern.
- Diplomatie: Meinungen, Bündnisse, Krieg erklären, Frieden anbieten. Computer-Nationen handeln
  selbstständig.

**Schlacht** (für jeden Frontpunkt einzeln, v0.3)
- 5 Landschaften: Flandern (Schlamm, Wassertrichter), Champagne (Kreide), Argonnen (Wald),
  Karpaten (Schnee), Dorfkampf (Ruinen im Niemandsland). Jede Karte ist zufällig erzeugt, mit
  geschwungenen Grabensystemen, Sappen, Bunkern, Stacheldraht, Hohlwegen, Bächen, Ruinen, Wracks
  und Minenfeldern.
- Einzeln erkennbare Pixel-Soldaten (stehend, rennend, liegend, im Graben). Jeder hat einen eigenen
  Platz, und unter Beschuss geht es von Trichter zu Trichter. Maßstab in Metern.
- Truppen: Schützen, MGs, Tankgewehre, Flammenwerfer, Panzer (Rhombus-Typ), Feldgeschütze mit
  sichtbarem Granatenflug, Magier. Dazu Minen, Brände, Gegenbatteriefeuer und Panzer, die
  Stacheldraht niederwalzen und liegen bleiben können.
- Effekte: Mündungsfeuer, Leuchtspuren, Erd- und Blutspritzer, Blut, das langsam verblasst,
  Gefallene, Explosionen mit Druckwelle und Trümmern, Rauch, Kamerawackeln, synthetischer Ton.
- Drei Darstellungen zum Umschalten (Taste V): Klassisch, Deutlich (Farbmarker für kleine Bildschirme),
  Punkte (Übersicht).
- Die Offiziere führen die Schlacht, du kannst jederzeit einzelne Kompanien übernehmen (✋) und
  wieder abgeben.
- Nachschub marschiert vom hinteren Kartenrand ein. Verluste fließen zurück in die Divisionen der
  Kampagne.
- Im Menü gibt es außerdem **„Nur ein schnelles Gefecht“** zum Ausprobieren.

## Starten

Voraussetzung: [Node.js](https://nodejs.org) 22 oder neuer.

```bash
npm install
npm run dev        # Entwicklung, mit automatischem Neuladen
```

Die Konsole zeigt eine Adresse wie `http://192.168.x.x:5173`. Die kannst du **auf dem Handy im
selben WLAN** öffnen.

### Auf dem Home-PC als Server

```bash
npm start          # baut das Spiel und startet es auf Port 8080
```

Dann auf dem Handy `http://<IP-deines-PCs>:8080` öffnen.

> Noch gibt es **kein Speichern**. Das kommt mit Schritt 3 (Server und Speichern), siehe KONZEPT.md.

### Steuerung

| Aktion                | Handy                       | PC                   |
| --------------------- | --------------------------- | -------------------- |
| Karte verschieben     | Ziehen                      | Ziehen               |
| Zoom                  | Zwei Finger                 | Mausrad              |
| Pause / Tempo         | ⏸ 1× 2× 4× 8×               | Leertaste, 1–4       |
| Frontpunkt öffnen     | Balken auf der Grenze       | Klick                |
| Zurück zur Karte      | 🗺                          | Esc                  |
| In der Schlacht       | Kompanie antippen, dann Ziel | H / S / R / O / A   |

## Aufbau des Codes

```
src/world/        Kampagne ohne Grafik (läuft auch in Node, später auf dem Server)
  world.ts        Welt: Nationen, Divisionen, Kriege, Frontpunkte, Einnahme, Wirtschaft
  fronts.ts       Frontpunkte entlang der Grenzen berechnen
  frontBattle.ts  verbindet einen Frontpunkt mit einer echten Schlacht
  worldAI.ts      Computer-Nationen
  scenario.ts     Startaufstellung 1914, Bündnisse, Julikrise
  config.ts       Balancing der Kampagne (70/30-Regel, Kosten, Tempo …)
  mapData.ts      Kartenformat
src/sim/          Schlacht-Simulation (Soldaten, Gelände, KI-Offiziere)
src/campaign/     Kampagnenkarte (Darstellung und Menüs)
src/render/       WebGL-Darstellung der Schlacht, Gelände, Kamera
src/ui/           Schlachtansicht, Fahnen, Gesten
src/main.ts       Menü, Spielschleife, Wechsel zwischen Karte und Schlacht
scripts/
  genmap.ts       erzeugt public/maps/europa.json aus Natural-Earth-Daten
  mapdef.ts       Nationen 1914, Zuordnung der heutigen Länder, Grenzkorrekturen
  headless.ts     eine Schlacht KI gegen KI ohne Grafik
  worldsim.ts     die ganze Kampagne ohne Grafik (Balancing, Performance)
```

```bash
npm run genmap              # Karte neu erzeugen (nach Änderungen an mapdef.ts)
npm run worldsim -- 60      # 60 Minuten Kampagne ohne Grafik
npm run sim -- 1 40         # eine Schlacht ohne Grafik
```

Kartendaten: [Natural Earth](https://www.naturalearthdata.com/) (gemeinfrei), über das Paket `world-atlas`.
