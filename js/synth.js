/* ============================================================
 *  PianoSynth —— Web Audio 复音合成引擎
 *  复音管理 / 抢音 / 延音踏板 / 混响总线 / 母线限制器 / 振荡器可视化
 * ============================================================ */
class PianoSynth {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.voices = [];            // 正在发声的声音
    this.sustained = [];         // 踏板保持中的声音
    this.sustainOn = false;
    this.maxVoices = 64;
    this.reverbAmount = 0.5;
    this.masterVolume = 0.85;
    this.analyser = null;
    this._noiseBuf = null;
    this._listeners = {};
  }

  /* ---------- 事件 ---------- */
  on(evt, fn) { (this._listeners[evt] = this._listeners[evt] || []).push(fn); }
  _emit(evt, a, b) { (this._listeners[evt] || []).forEach(function (f) { f(a, b); }); }

  /* ---------- 初始化 ---------- */
  init() {
    if (this.ctx) return this.ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    const ctx = this.ctx = new AC({ latencyHint: 'interactive' });

    // 母线
    this.master = ctx.createGain();
    this.master.gain.value = this.masterVolume;

    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -8;
    this.limiter.knee.value = 6;
    this.limiter.ratio.value = 12;
    this.limiter.attack.value = 0.003;
    this.limiter.release.value = 0.25;

    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.75;

    // 混响总线
    this.convolver = ctx.createConvolver();
    this.convolver.buffer = this._makeImpulse(2.6, 2.8);
    this.wet = ctx.createGain();
    this.wet.gain.value = this.reverbAmount;
    this.wetSend = ctx.createGain();   // 各声部送入
    this.wetSend.gain.value = 1;

    this.dry = ctx.createGain();
    this.dry.gain.value = 1;

    this.dry.connect(this.master);
    this.wetSend.connect(this.convolver);
    this.convolver.connect(this.wet);
    this.wet.connect(this.master);
    this.master.connect(this.limiter);
    this.limiter.connect(this.analyser);
    this.analyser.connect(ctx.destination);

    this._noiseBuf = this._makeNoise(2.0);
    this.ready = true;
    this._emit('ready');
    return ctx;
  }

  resume() {
    if (!this.ctx) this.init();
    if (this.ctx.state === 'suspended') return this.ctx.resume();
    return Promise.resolve();
  }

  /* ---------- 缓冲生成 ---------- */
  _makeNoise(sec) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * sec);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  _makeImpulse(sec, decay) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * sec);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        // 前 12ms 为直达声，之后为指数衰减的扩散混响
        const env = i < ctx.sampleRate * 0.012 ? 1 : Math.pow(1 - t, decay);
        d[i] = (Math.random() * 2 - 1) * env;
      }
    }
    return buf;
  }

  /* ---------- 全局参数 ---------- */
  setMasterVolume(v) {
    this.masterVolume = v;
    if (this.master) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);
  }
  setReverb(v) {
    this.reverbAmount = v;
    if (this.wet) this.wet.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  /* ---------- 音符编号 → 频率 ---------- */
  static freq(note) { return 440 * Math.pow(2, (note - 69) / 12); }

  /* ---------- 发声 ---------- */
  noteOn(note, velocity, when, preset, channel) {
    if (!this.ready) return;
    const ctx = this.ctx;
    if (when == null) when = ctx.currentTime;
    if (velocity == null) velocity = 0.8;
    channel = channel == null ? 0 : channel;
    const vel = Math.max(0.02, Math.min(1, velocity));

    // 同一音符重复触发：快速释放旧的
    const existing = this.voices.filter(v => v.note === note && v.channel === channel && !v.released);
    existing.forEach(v => this._releaseVoice(v, 0.04));

    if (preset.drum) { this._playDrum(note, vel, when); return; }
    if (this.voices.length >= this.maxVoices) this._steal();

    const v = this._buildVoice(preset, note, vel, when, channel);
    if (!v) return;
    this.voices.push(v);
    this._emit('noteon', note, vel);
  }

  noteOff(note, when, channel) {
    channel = channel == null ? 0 : channel;
    const list = this.voices.filter(v => v.note === note && v.channel === channel && !v.released);
    list.forEach(v => {
      if (this.sustainOn) {
        v.held = true;
        this.sustained.push(v);
      } else {
        this._releaseVoice(v, v.preset.amp.r);
      }
    });
  }

  setSustain(on) {
    this.sustainOn = !!on;
    if (!on) {
      const list = this.sustained.slice();
      this.sustained = [];
      list.forEach(v => { if (v.held && !v.released) this._releaseVoice(v, v.preset.amp.r); });
    }
  }

  allNotesOff() {
    this.sustained = [];
    this.voices.forEach(v => this._releaseVoice(v, 0.06));
  }

  _steal() {
    // 优先抢走已释放/最旧的声音
    let idx = 0;
    for (let i = 0; i < this.voices.length; i++) {
      if (this.voices[i].released) { idx = i; break; }
    }
    const v = this.voices[idx];
    if (v) this._releaseVoice(v, 0.02, true);
  }

  /* ---------- 构建单个音色 ---------- */
  _buildVoice(preset, note, vel, when, channel) {
    const ctx = this.ctx;
    const base = PianoSynth.freq(note);
    const velCurve = Math.pow(vel, 0.85);
    const peak = (preset.gain || 1) * (0.25 + 0.75 * velCurve);

    const out = ctx.createGain();          // 声部输出
    out.gain.value = preset.gain || 1;

    const amp = ctx.createGain();
    amp.gain.value = 0;

    const filt = ctx.createBiquadFilter();
    const fc = preset.filt || {};
    const fBase = Math.min(18000, Math.max(60, (fc.f || 3000) * (0.55 + 0.45 * vel)) + (fc.velAmount || 0));
    const fAmount = fc.envAmount || 0;
    filt.type = fc.type || 'lowpass';
    filt.Q.value = fc.q || 0.6;
    filt.frequency.setValueAtTime(Math.min(18000, fBase + fAmount), when);
    if (fAmount > 0) {
      filt.frequency.exponentialRampToValueAtTime(Math.max(60, fBase), when + (fc.envDecay || 0.5) + 0.001);
    }
    // 力度→亮度
    if (preset.velF) {
      filt.frequency.setValueAtTime(Math.min(18000, fBase + fAmount + preset.velF * vel * vel), when);
      if (fAmount > 0) {
        filt.frequency.exponentialRampToValueAtTime(Math.max(60, fBase + preset.velF * vel * vel * 0.35), when + (fc.envDecay || 0.5) + 0.001);
      }
    }

    filt.connect(amp);
    amp.connect(out);
    out.connect(this.dry);
    const send = ctx.createGain();
    send.gain.value = preset.reverb == null ? 0.25 : preset.reverb;
    out.connect(send);
    send.connect(this.wetSend);

    // 包络
    const A = preset.amp.a, D = preset.amp.d, S = preset.amp.s;
    const peakLevel = Math.max(0.0005, peak);
    const sustainLevel = Math.max(0.0004, peakLevel * S);
    amp.gain.setValueAtTime(0, when);
    amp.gain.linearRampToValueAtTime(peakLevel, when + Math.max(0.001, A));
    amp.gain.exponentialRampToValueAtTime(sustainLevel, when + Math.max(0.001, A) + Math.max(0.01, D));

    const oscillators = [];

    // ---- FM 调制 ----
    if (preset.fm && preset.osc.length) {
      const modOsc = ctx.createOscillator();
      modOsc.type = 'sine';
      modOsc.frequency.value = base * preset.fm.ratio;
      const modGain = ctx.createGain();
      const idx = preset.fm.index * base;
      modGain.gain.setValueAtTime(idx, when);
      modGain.gain.exponentialRampToValueAtTime(Math.max(0.001, idx * 0.02), when + preset.fm.decay);
      modOsc.connect(modGain);
      // 与基频层共享：加到第 0 层振荡器频率上
      this._fmTarget = modGain;
      modOsc.start(when);
      modOsc.stop(when + 30);
      oscillators.push(modOsc);
    }

    // ---- 振荡器层 ----
    preset.osc.forEach(function (o, i) {
      const osc = ctx.createOscillator();
      osc.type = o.type;
      osc.frequency.value = base * o.ratio;
      if (o.detune) osc.detune.value = o.detune;
      const g = ctx.createGain();
      g.gain.value = o.gain;
      // 钢琴类：高次泛音衰减更快
      osc.connect(g);
      g.connect(filt);
      if (i === 0 && preset.fm && this._fmTarget) {
        this._fmTarget.connect(osc.frequency);
      }
      osc.start(when);
      oscillators.push(osc);
    }, this);
    this._fmTarget = null;

    // ---- 起音噪声（槌子/拨弦/气声）----
    if (preset.noise) {
      const src = ctx.createBufferSource();
      src.buffer = this._noiseBuf;
      src.loop = true;
      const nf = ctx.createBiquadFilter();
      nf.type = preset.noise.decay > 2 ? 'bandpass' : 'bandpass';
      nf.frequency.value = Math.min(16000, preset.noise.f * (0.7 + 0.6 * vel));
      nf.Q.value = preset.noise.q || 1;
      const ng = ctx.createGain();
      const ngPeak = preset.noise.gain * (0.3 + 0.7 * vel);
      ng.gain.setValueAtTime(0, when);
      ng.gain.linearRampToValueAtTime(ngPeak, when + 0.004);
      ng.gain.exponentialRampToValueAtTime(0.0001, when + preset.noise.decay);
      src.connect(nf); nf.connect(ng); ng.connect(amp);
      src.start(when);
      try { src.stop(when + preset.noise.decay + 0.05); } catch (e) { }
      oscillators.push(src);
    }

    // ---- 颤音 LFO ----
    let lfo = null, lfoGain = null;
    if (preset.lfo) {
      lfo = ctx.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.value = preset.lfo.rate;
      lfoGain = ctx.createGain();
      lfoGain.gain.setValueAtTime(0, when);
      // 稍有延迟后加入颤音，更自然
      lfoGain.gain.linearRampToValueAtTime(preset.lfo.depth, when + Math.max(0.15, A + 0.12));
      lfo.connect(lfoGain);
      oscillators.forEach(function (o) {
        if (o.detune) lfoGain.connect(o.detune);
      });
      lfo.start(when);
      oscillators.push(lfo);
    }

    const voice = {
      note: note, channel: channel, preset: preset, amp: amp, filt: filt, out: out,
      oscillators: oscillators, lfo: lfo, lfoGain: lfoGain, send: send,
      startTime: when, released: false, held: false
    };
    voice.stopAt = function (t) {
      voice.oscillators.forEach(function (o) { try { o.stop(t); } catch (e) { } });
    };
    return voice;
  }

  _releaseVoice(v, release, immediate) {
    if (v.released && !immediate) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const t = Math.max(now, v.startTime + 0.01);
    const r = Math.max(0.02, release || 0.3);
    const g = v.amp.gain;
    let cur = 0;
    try { cur = g.value; } catch (e) { cur = 0; }
    g.cancelScheduledValues(t);
    g.setValueAtTime(cur, t);
    g.linearRampToValueAtTime(0, t + r);
    if (v.send) {
      v.send.gain.cancelScheduledValues(t);
      v.send.gain.setValueAtTime(v.send.gain.value, t);
      v.send.gain.linearRampToValueAtTime(0, t + r);
    }
    v.released = true;
    v.held = false;
    const stopAt = t + r + 0.05;
    v.oscillators.forEach(function (o) { try { o.stop(stopAt); } catch (e) { } });
    const self = this;
    const dur = (r + 0.15) * 1000;
    setTimeout(function () {
      const i = self.voices.indexOf(v);
      if (i >= 0) self.voices.splice(i, 1);
      try { v.out.disconnect(); } catch (e) { }
      try { v.filt.disconnect(); } catch (e) { }
    }, dur);
  }

  /* ---------- 打击乐 ---------- */
  _playDrum(note, vel, when) {
    const ctx = this.ctx;
    const out = ctx.createGain();
    out.gain.value = 0.9;
    out.connect(this.dry);
    const send = ctx.createGain();
    send.gain.value = 0.18;
    out.connect(send); send.connect(this.wetSend);

    const n = note;
    let kind = 'kick', dur = 0.4;
    if (n === 35 || n === 36) kind = 'kick';
    else if (n === 38 || n === 40 || n === 37) kind = 'snare';
    else if (n === 39) kind = 'clap';
    else if (n === 42 || n === 44) kind = 'hihat';
    else if (n === 46) { kind = 'openhat'; dur = 0.45; }
    else if (n === 49 || n === 57) { kind = 'crash'; dur = 1.6; }
    else if (n === 51 || n === 59) { kind = 'ride'; dur = 1.0; }
    else if (n >= 41 && n <= 50) { kind = 'tom'; dur = 0.5; }
    else { kind = 'snare'; }

    const now = when;
    if (kind === 'kick') {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      const f0 = 155 * (0.85 + vel * 0.3);
      osc.frequency.setValueAtTime(f0, now);
      osc.frequency.exponentialRampToValueAtTime(42, now + 0.11);
      const g = ctx.createGain();
      g.gain.setValueAtTime(vel * 1.1, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.42);
      osc.connect(g); g.connect(out);
      osc.start(now); osc.stop(now + 0.5);
      // 点击
      const cl = ctx.createBufferSource(); cl.buffer = this._noiseBuf; cl.loop = true;
      const cf = ctx.createBiquadFilter(); cf.type = 'lowpass'; cf.frequency.value = 3000;
      const cg = ctx.createGain();
      cg.gain.setValueAtTime(vel * 0.4, now);
      cg.gain.exponentialRampToValueAtTime(0.001, now + 0.03);
      cl.connect(cf); cf.connect(cg); cg.connect(out); cl.start(now); cl.stop(now + 0.06);
    } else if (kind === 'snare' || kind === 'clap') {
      const src = ctx.createBufferSource(); src.buffer = this._noiseBuf; src.loop = true;
      const bp = ctx.createBiquadFilter(); bp.type = 'highpass'; bp.frequency.value = kind === 'clap' ? 1200 : 900;
      const g = ctx.createGain();
      const d = kind === 'clap' ? 0.18 : 0.22;
      g.gain.setValueAtTime(vel * (kind === 'clap' ? 0.5 : 0.7), now);
      g.gain.exponentialRampToValueAtTime(0.001, now + d);
      src.connect(bp); bp.connect(g); g.connect(out); src.start(now); src.stop(now + d + 0.05);
      const osc = ctx.createOscillator(); osc.type = 'triangle';
      osc.frequency.setValueAtTime(210, now);
      osc.frequency.exponentialRampToValueAtTime(120, now + 0.1);
      const og = ctx.createGain();
      og.gain.setValueAtTime(vel * 0.35, now);
      og.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
      osc.connect(og); og.connect(out); osc.start(now); osc.stop(now + 0.2);
    } else if (kind === 'hihat' || kind === 'openhat' || kind === 'crash' || kind === 'ride') {
      const src = ctx.createBufferSource(); src.buffer = this._noiseBuf; src.loop = true;
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass';
      hp.frequency.value = kind === 'hihat' || kind === 'openhat' ? 7000 : (kind === 'crash' ? 3500 : 5000);
      const g = ctx.createGain();
      const d = dur * (0.4 + vel * 0.6);
      g.gain.setValueAtTime(vel * (kind === 'crash' ? 0.5 : 0.35), now);
      g.gain.exponentialRampToValueAtTime(0.0008, now + d);
      src.connect(hp); hp.connect(g); g.connect(out); src.start(now); src.stop(now + d + 0.05);
    } else if (kind === 'tom') {
      const osc = ctx.createOscillator(); osc.type = 'sine';
      const f0 = 200 * Math.pow(2, (n - 45) / 12);
      osc.frequency.setValueAtTime(f0 * (0.9 + vel * 0.25), now);
      osc.frequency.exponentialRampToValueAtTime(f0 * 0.55, now + 0.25);
      const g = ctx.createGain();
      g.gain.setValueAtTime(vel * 0.8, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + dur);
      osc.connect(g); g.connect(out); osc.start(now); osc.stop(now + dur + 0.05);
    }
    setTimeout(() => { try { out.disconnect(); } catch (e) { } }, (dur + 2.0) * 1000);
    this._emit('noteon', note, vel);
  }

  /* ---------- 可视化数据 ---------- */
  getWaveform(arr) {
    if (!this.analyser) return null;
    this.analyser.getByteTimeDomainData(arr);
    return arr;
  }
  getSpectrum(arr) {
    if (!this.analyser) return null;
    this.analyser.getByteFrequencyData(arr);
    return arr;
  }
  get voiceCount() { return this.voices.length; }
}
