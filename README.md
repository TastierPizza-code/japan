# Grabenfront

Strategiespiel im Stil eines Anime-Grabenkriegs (inspiriert von Serien wie *Saga of Tanya the Evil*,
eigenes Setting): ein alternatives Europa um 1914, riesige Schlachten mit Tausenden Soldaten wie in
*Songs of Syx* und eine Kampagne, in der man Stück für Stück Provinzen erobert. Läuft im Browser, auf
dem Handy wie am PC. Das Spielkonzept steht in [KONZEPT.md](KONZEPT.md).

## Stand (v0.4): Kampagne und taktische Schlachten

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

**Schlacht** (für jeden Frontpunkt einzeln, v0.4)
- 5 Landschaften: Flandern (Schlamm, Wassertrichter), Champagne (Kreide), Argonnen (Wald),
  Karpaten (Schnee), Dorfkampf (Ruinen im Niemandsland). Jede Karte ist zufällig erzeugt, mit
  geschwungenen Grabensystemen, Sappen, Bunkern, Stacheldraht, Hohlwegen, Bächen, Ruinen, Wracks
  und Minenfeldern.
- Einzeln erkennbare Pixel-Soldaten (stehend, rennend, liegend, im Graben). Jeder hat einen eigenen
  Platz, und unter Beschuss geht es von Trichter zu Trichter. Maßstab in Metern.
- Truppen: Schützen, Stoßtrupps, MGs, Tankgewehre, Flammenwerfer, Panzer (Rhombus-Typ), Feldgeschütze mit
  sichtbarem Granatenflug, Magier. Dazu Minen, Brände, Gegenbatteriefeuer und Panzer, die
  Stacheldraht niederwalzen und liegen bleiben können.
- Effekte: Mündungsfeuer, Leuchtspuren, Erd- und Blutspritzer, Blut, das langsam verblasst,
  Gefallene, Explosionen mit Druckwelle und Trümmern, Rauch, Kamerawackeln, synthetischer Ton.
- Drei Darstellungen zum Umschalten (Taste V): Klassisch, Deutlich (Farbmarker für kleine Bildschirme),
  Punkte (Übersicht).
- **Du führst die Magier**, alles andere führen deine Offiziere.
  - Magier-Befehle: Luftschutz, Begleiten, Jagd, oder du führst sie direkt.
  - Fähigkeiten: **Sprengzauber** (Z) und **Schutzkuppel** (X).
  - Den Offizieren gibst du Haltungen je Flanke, befiehlst Angriffe oder den **Generalangriff** (G)
    und steuerst die Artillerie.
- **Artillerie** reicht nur bis knapp hinter den feindlichen vorderen Graben. Im Graben hält sie
  vor allem nieder, tödlich ist sie für Truppen im Freien.
- **Überlegenheit gewinnt**: Wer örtlich klar überlegen ist, behält beim Sturm die Nerven. Wer
  unterlegen im Graben sitzt, bricht. Laufende Stürmer sind schwerer zu treffen. Im Test bricht
  ein Generalangriff mit 1,5-facher Stärke den Gegner in wenigen Minuten. Bei Gleichstand ist er
  ein Glücksspiel.
- **Taktik lohnt sich** – alles wirkt nur über Beschuss, Treffer und Moral, es gibt keine Boni:
  - **Angriff planen** (Taste P): Abschnitt antippen, und der Offizier führt den ganzen Angriff aus.
    Er zerschießt den Draht und vergast den feindlichen Unterstützungsgraben. Panzer rollen voraus,
    Nebel fällt auf den Graben, Stoßtrupps führen den Sturm. Die zweite Welle stürmt nach, sobald
    der Einbruch steht, und Begleit-MGs rücken nach. Nochmal drücken bricht den Angriff ab.
  - **Nebel** (N): Die Verteidiger sehen erst auf wenige Meter. **Gas** (K): Die Wolke treibt im
    Wind, zwingt unter die Maske, hält nieder und kostet Ausfälle. Gut gegen Reserven und Batterien,
    aber es trifft auch die eigenen Leute.
  - **Stoßtrupps** (⚔) schießen im Vorgehen und werfen Handgranaten in Gräben und Trichter.
  - **MGs** beherrschen das freie Feld. **Flankenfeuer** trifft Männer in Trichtern und Ruinen.
    Gräben schützen ihre Traversen: Längs durch einen Graben sieht man nur wenige Meter weit,
    dort hilft nur die Handgranate.
  - **Moral**: Stürme brechen bei hohen Verlusten zusammen. Wer in guter Deckung liegt, hält
    länger aus.
  - **Magier** sind über der eigenen Stellung am stärksten, weil Gewehre und MGs dort mithelfen.
    Tief über feindlichen Linien sind sie verwundbar.
- **KI-Offiziere pro Flanke**, auch im schnellen Gefecht: Halten, Defensiv, Ausgewogen, Aggressiv.
  Du kannst jederzeit einzelne Kompanien übernehmen und wieder abgeben. Solange du zuschaust,
  halten sie eine Batterie für dich frei.
  - **Erfahrene Offiziere** suchen Schwachstellen und greifen dort an, wo der Gegner gerade
    geblutet hat. Sind sie insgesamt unterlegen, verteidigen sie lieber.
  - Sie brechen festgefahrene Angriffe ab und halten ihre Magier als Luftabwehr zurück.
  - Im Test gewinnen sie 7 bis 8 von 8 Großschlachten gegen unerfahrene Offiziere, die einfach
    losstürmen. Im schnellen Gefecht kannst du wählen, wie erfahren der Gegner ist.
- **Meldungen** der Offiziere, zum Beispiel „Feind stürmt links!“, „Gas Mitte!“ oder „Einbruch
  rechts gesichert“. Antippen bringt die Kamera hin.
- **Ton**: Trillerpfeifen, wenn ein Sturm losbricht, und Gasalarm.
- **Übersicht**: Der eigene Angriffsplan erscheint als blauer Pfeil, stürmende Feinde als rote
  Pfeile. Die Taktik-Hilfe (?) steht in der oberen Leiste. Nach dem Gefecht zeigt eine Auswertung,
  welche Waffe wie viele Gegner ausgeschaltet hat.
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
| In der Schlacht       | Kompanie antippen, dann Ziel | G / P / A / N / K / H / R / O |

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
