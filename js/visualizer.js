/* ============================================================
 *  RollView —— 钢琴卷帘 / 波形示波器 canvas 渲染
 * ============================================================ */
class RollView {
  constructor(canvas) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.windowSec = 6.5;
    this.playX = 0.24;
    this.notes = [];
    this.lowNote = 36;
    this.highNote = 84;
    this.live = true;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this._resize();
    const self = this;
    window.addEventListener('resize', function () { self._resize(); });
    if (window.ResizeObserver) {
      new ResizeObserver(function () { self._resize(); }).observe(canvas.parentElement || canvas);
    }
  }

  _resize() {
    const r = this.cv.getBoundingClientRect();
    if (!r.width) return;
    this.w = r.width;
    this.h = r.height;
    this.cv.width = Math.floor(r.width * this.dpr);
    this.cv.height = Math.floor(r.height * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  setNotes(notes, opts) {
    this.notes = notes || [];
    this.live = !!(opts && opts.live);
    const lo = (opts && opts.lowNote), hi = (opts && opts.highNote);
    if (lo != null && hi != null) {
      this.lowNote = Math.max(0, lo - 2);
      this.highNote = Math.min(127, hi + 2);
    } else {
      let a = 127, b = 0;
      this.notes.forEach(function (n) { if (n.note < a) a = n.note; if (n.note > b) b = n.note; });
      if (b < a) { a = 48; b = 84; }
      this.lowNote = Math.max(0, a - 3);
      this.highNote = Math.min(127, b + 3);
    }
    if (this.highNote - this.lowNote < 12) this.highNote = this.lowNote + 12;
  }

  static channelColor(ch, a) {
    const hue = ((ch || 0) * 52 + 195) % 360;
    return 'hsla(' + hue + ', 82%, ' + (a ? 66 : 62) + '%, ' + (a || 1) + ')';
  }

  render(t, opts) {
    const ctx = this.ctx, W = this.w, H = this.h;
    if (!W || !H) return;
    opts = opts || {};
    const gutter = 38;
    const plotW = W - gutter;
    const rows = this.highNote - this.lowNote + 1;
    const rowH = H / rows;
    const pxPerSec = plotW / this.windowSec;
    const px = gutter + plotW * this.playX;

    ctx.clearRect(0, 0, W, H);
    // 背景
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, '#0d1119');
    grad.addColorStop(1, '#111621');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    // 横向音高行
    for (let n = this.lowNote; n <= this.highNote; n++) {
      const y = H - (n - this.lowNote + 1) * rowH;
      const black = [1, 3, 6, 8, 10].indexOf(((n % 12) + 12) % 12) >= 0;
      ctx.fillStyle = black ? 'rgba(255,255,255,0.018)' : 'rgba(255,255,255,0.045)';
      ctx.fillRect(gutter, y, plotW, rowH);
      if (n % 12 === 0) {
        ctx.fillStyle = 'rgba(255,255,255,0.13)';
        ctx.fillRect(gutter, y + rowH - 1, plotW, 1);
      }
    }
    // 纵向时间刻度
    const startT = t - this.playX * this.windowSec;
    const stepSec = this.windowSec > 8 ? 2 : 1;
    const first = Math.ceil(startT / stepSec) * stepSec;
    ctx.font = '10px ui-monospace, Menlo, monospace';
    ctx.textBaseline = 'top';
    for (let s = first; s < startT + this.windowSec; s += stepSec) {
      const x = gutter + (s - startT) * pxPerSec;
      if (x < gutter) continue;
      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      ctx.fillRect(Math.round(x), 0, 1, H);
      if (s >= 0) {
        ctx.fillStyle = 'rgba(255,255,255,0.22)';
        const mm = Math.floor(s / 60), ss = Math.floor(s % 60);
        ctx.fillText(mm + ':' + (ss < 10 ? '0' : '') + ss, x + 3, 3);
      }
    }

    // 左侧音名栏
    ctx.fillStyle = '#0a0d13';
    ctx.fillRect(0, 0, gutter, H);
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fillRect(gutter - 1, 0, 1, H);
    ctx.textAlign = 'right';
    for (let n = this.lowNote; n <= this.highNote; n++) {
      const y = H - (n - this.lowNote + 1) * rowH;
      const pc = ((n % 12) + 12) % 12;
      const black = [1, 3, 6, 8, 10].indexOf(pc) >= 0;
      if (pc === 0 || rowH > 7) {
        if (rowH > 7 && !black) {
          ctx.fillStyle = 'rgba(235,240,250,0.35)';
          ctx.fillText(MidiFile.nameOfNote(n), gutter - 6, y + rowH / 2 - 5);
        } else if (pc === 0) {
          ctx.fillStyle = 'rgba(242,181,68,0.85)';
          ctx.fillText(MidiFile.nameOfNote(n), gutter - 6, y + rowH / 2 - 5);
        }
      }
    }
    ctx.textAlign = 'left';

    // 音符
    const endT = startT + this.windowSec;
    this.notes.forEach(function (nt) {
      if (nt.end < startT - 0.5 || nt.start > endT) return;
      const a = nt.start, b = Math.max(nt.end, nt.start + 0.05);
      let x0 = gutter + (a - startT) * pxPerSec;
      let x1 = gutter + (b - startT) * pxPerSec;
      const y = H - (nt.note - this.lowNote + 1) * rowH;
      const w = Math.max(3, x1 - x0);
      const h = Math.max(2, rowH - 1);
      const col = RollView.channelColor(nt.channel);
      ctx.globalAlpha = nt.muted ? 0.22 : 1;
      ctx.fillStyle = col;
      if (ctx.roundRect) {
        ctx.beginPath();
        ctx.roundRect(x0, y + 0.5, w, h, Math.min(3, h / 2));
        ctx.fill();
      } else {
        ctx.fillRect(x0, y + 0.5, w, h);
      }
      // 高亮描边：正在发声
      if (opts.activeNote === nt.note) {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.2;
        ctx.strokeRect(x0 + 0.5, y + 1, w - 1, h - 1);
      }
      ctx.globalAlpha = 1;
    }, this);

    // 播放头
    ctx.fillStyle = 'rgba(242,181,68,0.95)';
    ctx.fillRect(px - 1, 0, 2, H);
    ctx.fillStyle = 'rgba(242,181,68,0.16)';
    ctx.fillRect(px, 0, Math.max(0, W - px), H);
    // 左区淡化
    ctx.fillStyle = 'rgba(8,10,15,0.45)';
    ctx.fillRect(gutter, 0, px - gutter, H);
  }
}

/* ---------------- 示波器 ---------------- */
class Scope {
  constructor(canvas) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.buf = null;
    this.spectrum = null;
    this._resize();
    const self = this;
    window.addEventListener('resize', function () { self._resize(); });
  }
  _resize() {
    const r = this.cv.getBoundingClientRect();
    if (!r.width) return;
    this.w = r.width; this.h = r.height;
    this.cv.width = Math.floor(r.width * this.dpr);
    this.cv.height = Math.floor(r.height * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }
  render(synth) {
    const ctx = this.ctx, W = this.w, H = this.h;
    if (!W || !H) return;
    ctx.clearRect(0, 0, W, H);
    if (!this.buf || this.buf.length !== synth.analyser.fftSize) {
      this.buf = new Uint8Array(synth.analyser.fftSize);
      this.spectrum = new Uint8Array(synth.analyser.frequencyBinCount);
    }
    synth.getSpectrum(this.spectrum);
    synth.getWaveform(this.buf);

    // 频谱柱
    const bars = 48;
    const bw = W / bars;
    for (let i = 0; i < bars; i++) {
      const idx = Math.floor(Math.pow(i / bars, 1.7) * (this.spectrum.length * 0.6));
      let v = 0;
      for (let k = 0; k < 3; k++) v = Math.max(v, this.spectrum[idx + k] || 0);
      const bh = (v / 255) * H * 0.92;
      const g = ctx.createLinearGradient(0, H, 0, H - bh);
      g.addColorStop(0, 'rgba(78,168,255,0.35)');
      g.addColorStop(1, 'rgba(242,181,68,0.75)');
      ctx.fillStyle = g;
      ctx.fillRect(i * bw + 1, H - bh, bw - 2, bh);
    }
    // 波形
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    const n = this.buf.length;
    for (let i = 0; i < n; i += 2) {
      const x = i / n * W;
      const y = H / 2 + ((this.buf[i] - 128) / 128) * H * 0.42;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}
