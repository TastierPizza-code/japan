// Schlachtgeräusche, komplett synthetisch (WebAudio) – keine Audiodateien nötig.
// Browser erlauben Ton erst nach einer Nutzeraktion: unlock() beim ersten Klick aufrufen.

type Kind = "rifle" | "mg" | "at" | "gun" | "boom" | "mine" | "cannonHit" | "whistle" | "flame" | "magic" | "magicBoom" | "grenade" | "smokePop" | "whistleSignal" | "gasAlarm";

const MIN_GAP: Record<Kind, number> = {
  rifle: 0.025,
  mg: 0.03,
  at: 0.1,
  gun: 0.08,
  boom: 0.06,
  mine: 0.1,
  cannonHit: 0.08,
  whistle: 0.25,
  flame: 0.12,
  magic: 0.08,
  magicBoom: 0.08,
  grenade: 0.05,
  smokePop: 0.12,
  whistleSignal: 0.15,
  gasAlarm: 2,
};

export class BattleAudio {
  enabled = true;
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private last: Partial<Record<Kind, number>> = {};

  constructor() {
    try {
      this.enabled = localStorage.getItem("grabenfront.sound") !== "aus";
    } catch {
      /* ohne Speicher: Ton an */
    }
  }

  unlock() {
    if (this.ctx) {
      if (this.ctx.state === "suspended") void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 6;
    comp.connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.gain.value = 0.55;
    this.master.connect(comp);
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  toggle() {
    this.enabled = !this.enabled;
    try {
      localStorage.setItem("grabenfront.sound", this.enabled ? "an" : "aus");
    } catch {
      /* egal */
    }
    return this.enabled;
  }

  /** vol: 0..1 (Entfernung schon eingerechnet), pan: -1..1 */
  play(kind: string, vol: number, pan: number, big = 1) {
    const ctx = this.ctx;
    if (!this.enabled || !ctx || !this.master || !this.noise || vol < 0.02) return;
    const k = kind as Kind;
    const now = ctx.currentTime;
    if ((this.last[k] ?? -1) + MIN_GAP[k] > now) return;
    this.last[k] = now;
    const out = ctx.createStereoPanner();
    out.pan.value = Math.max(-1, Math.min(1, pan));
    out.connect(this.master);
    const jitter = 0.9 + Math.random() * 0.2;

    switch (k) {
      case "rifle":
        this.burst(out, now, 0.09, "bandpass", 1800 * jitter, 0.9, 0.35 * vol);
        this.burst(out, now, 0.25, "lowpass", 500, 0.5, 0.12 * vol);
        break;
      case "mg":
        this.burst(out, now, 0.06, "bandpass", 1200 * jitter, 1.2, 0.3 * vol);
        break;
      case "at":
        this.burst(out, now, 0.18, "bandpass", 900, 0.8, 0.5 * vol);
        this.thump(out, now, 90, 0.2, 0.3 * vol);
        break;
      case "gun":
        this.thump(out, now, 55 * jitter, 0.7, 0.8 * vol);
        this.burst(out, now, 0.5, "lowpass", 700, 0.7, 0.5 * vol);
        break;
      case "boom":
      case "mine":
      case "cannonHit": {
        const s = k === "boom" ? big : k === "mine" ? 0.7 : 0.45;
        this.thump(out, now, 45 * jitter, 0.9 * s + 0.3, 0.9 * vol * s);
        this.burst(out, now, 1.2 * s + 0.2, "lowpass", 380, 0.6, 0.8 * vol * s);
        this.burst(out, now + 0.03, 0.4, "bandpass", 1500, 0.6, 0.15 * vol);
        break;
      }
      case "whistle": {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = "sine";
        o.frequency.setValueAtTime(1500 * jitter, now);
        o.frequency.exponentialRampToValueAtTime(480, now + 1.2);
        g.gain.setValueAtTime(0.0001, now);
        g.gain.exponentialRampToValueAtTime(0.06 * vol, now + 0.4);
        g.gain.exponentialRampToValueAtTime(0.0001, now + 1.25);
        o.connect(g).connect(out);
        o.start(now);
        o.stop(now + 1.3);
        break;
      }
      case "flame":
        this.burst(out, now, 0.35, "bandpass", 500, 0.5, 0.35 * vol);
        break;
      case "magic": {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = "triangle";
        o.frequency.setValueAtTime(900, now);
        o.frequency.exponentialRampToValueAtTime(2400, now + 0.15);
        g.gain.setValueAtTime(0.12 * vol, now);
        g.gain.exponentialRampToValueAtTime(0.0001, now + 0.2);
        o.connect(g).connect(out);
        o.start(now);
        o.stop(now + 0.22);
        break;
      }
      case "grenade":
        this.thump(out, now, 80 * jitter, 0.25, 0.45 * vol);
        this.burst(out, now, 0.3, "lowpass", 900, 0.6, 0.4 * vol);
        break;
      case "smokePop":
        this.thump(out, now, 70, 0.2, 0.25 * vol);
        this.burst(out, now, 1.2, "highpass", 1200, 0.4, 0.12 * vol);
        break;
      case "whistleSignal": {
        // Trillerpfeife: hoher Ton mit schnellem Triller, zweimal kurz, einmal lang
        const o = ctx.createOscillator();
        const lfo = ctx.createOscillator();
        const depth = ctx.createGain();
        const g = ctx.createGain();
        o.type = "sine";
        o.frequency.value = 2900 * jitter;
        lfo.frequency.value = 28;
        depth.gain.value = 180;
        lfo.connect(depth).connect(o.frequency);
        g.gain.setValueAtTime(0.0001, now);
        for (const [t0, t1] of [[0, 0.18], [0.28, 0.46], [0.56, 1.3]]) {
          g.gain.setValueAtTime(0.0001, now + t0);
          g.gain.exponentialRampToValueAtTime(0.07 * vol, now + t0 + 0.03);
          g.gain.setValueAtTime(0.07 * vol, now + t1 - 0.04);
          g.gain.exponentialRampToValueAtTime(0.0001, now + t1);
        }
        o.connect(g).connect(out);
        o.start(now);
        lfo.start(now);
        o.stop(now + 1.35);
        lfo.stop(now + 1.35);
        break;
      }
      case "gasAlarm": {
        // Gasalarm: auf eine Granathülse oder einen Gong geschlagen, mehrmals
        for (let k = 0; k < 5; k++) {
          const t = now + k * 0.32;
          for (const f of [640, 1510, 2380]) {
            const o = ctx.createOscillator();
            const g = ctx.createGain();
            o.type = "sine";
            o.frequency.value = f * jitter;
            g.gain.setValueAtTime(0.0001, t);
            g.gain.exponentialRampToValueAtTime((f === 640 ? 0.08 : 0.04) * vol, t + 0.005);
            g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
            o.connect(g).connect(out);
            o.start(t);
            o.stop(t + 0.32);
          }
        }
        break;
      }
      case "magicBoom":
        this.thump(out, now, 120, 0.3, 0.4 * vol);
        this.burst(out, now, 0.3, "highpass", 2000, 0.5, 0.2 * vol);
        break;
    }
  }

  private burst(out: AudioNode, t: number, dur: number, type: BiquadFilterType, freq: number, q: number, vol: number) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(out);
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + 0.05);
  }

  private thump(out: AudioNode, t: number, freq: number, dur: number, vol: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(freq * 2, t);
    o.frequency.exponentialRampToValueAtTime(freq * 0.5, t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + dur + 0.05);
  }
}
