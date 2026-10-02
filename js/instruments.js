/* ============================================================
 *  InstrumentLib —— 实时合成音色库
 *  每种音色由若干基础振荡器层 + 可选 FM / 噪声 / 滤波包络 组成，
 *  全部由 Web Audio 实时计算，不依赖任何网络资源或采样文件。
 * ============================================================ */
const InstrumentLib = (function () {
  'use strict';

  const O = (type, ratio, gain, detune) => ({ type: type, ratio: ratio, gain: gain, detune: detune || 0 });

  /* ---------------------------------------------------------
   *  音色定义
   *  osc      振荡器层：[{type, ratio, gain, detune}] ratio 为基频的倍数
   *  fm       FM 调制：{ratio, index, decay} index 为调制深度（基频倍数）
   *  noise    起音噪声：{gain, decay, f, q}
   *  amp      ADSR：a 起音 d 衰减 s 延音比例 r 释放
   *  filt     滤波器：{type, f, q, envAmount, envDecay}
   *  lfo      颤音：{rate, depth(音分)}
   *  gain     整体音量  reverb 混响送出量  velF 力度→亮度
   * --------------------------------------------------------- */
  const DEFS = [
    /* ============ 键盘 ============ */
    {
      id: 'grand', name: '三角钢琴', group: '键盘', gm: 0, color: '#ffc94d',
      gain: 1.0, reverb: 0.26,
      osc: [O('triangle', 1, 1.0), O('sine', 2, 0.30, -3), O('sine', 3.01, 0.10, 4), O('sawtooth', 1, 0.08, 7)],
      noise: { gain: 0.075, decay: 0.05, f: 3400, q: 0.7 },
      amp: { a: 0.004, d: 3.2, s: 0.05, r: 0.35 },
      filt: { type: 'lowpass', f: 2400, q: 0.5, envAmount: 7000, envDecay: 1.0 }, velF: 3500
    },
    {
      id: 'bright', name: '明亮钢琴', group: '键盘', gm: 1, color: '#ffd97a',
      gain: 0.95, reverb: 0.22,
      osc: [O('triangle', 1, 1.0), O('sawtooth', 1, 0.16, 6), O('sine', 2.01, 0.34, 0), O('sine', 4, 0.12, 0)],
      noise: { gain: 0.09, decay: 0.04, f: 4200, q: 0.6 },
      amp: { a: 0.003, d: 2.6, s: 0.05, r: 0.3 },
      filt: { type: 'lowpass', f: 3600, q: 0.6, envAmount: 8000, envDecay: 0.85 }, velF: 4000
    },
    {
      id: 'epiano', name: '电钢琴', group: '键盘', gm: 4, color: '#7ee0c9',
      gain: 1.0, reverb: 0.28,
      osc: [O('sine', 1, 1.0), O('sine', 2, 0.22, 2), O('sine', 5.01, 0.05)],
      fm: { ratio: 3.0, index: 1.6, decay: 0.7, gain: 0.55 },
      amp: { a: 0.005, d: 2.6, s: 0.12, r: 0.4 },
      filt: { type: 'lowpass', f: 3000, q: 0.4, envAmount: 3000, envDecay: 0.8 }, velF: 2600
    },
    {
      id: 'dxep', name: '复古 FM 电钢', group: '键盘', gm: 5, color: '#6fd3ff',
      gain: 0.9, reverb: 0.3,
      osc: [O('sine', 1, 1.0), O('sine', 2, 0.14)],
      fm: { ratio: 14, index: 0.55, decay: 0.32, gain: 0.4 },
      amp: { a: 0.002, d: 2.2, s: 0.16, r: 0.45 },
      filt: { type: 'lowpass', f: 5200, q: 0.3, envAmount: 3000, envDecay: 0.5 }, velF: 3000
    },
    {
      id: 'harpsi', name: '羽管键琴', group: '键盘', gm: 6, color: '#e8c07d',
      gain: 0.8, reverb: 0.3,
      osc: [O('sawtooth', 1, 1.0), O('square', 1, 0.25, 5), O('sawtooth', 2, 0.3, 3)],
      noise: { gain: 0.06, decay: 0.03, f: 5000, q: 0.8 },
      amp: { a: 0.002, d: 1.3, s: 0.02, r: 0.16 },
      filt: { type: 'lowpass', f: 3800, q: 0.9, envAmount: 5000, envDecay: 0.5 }, velF: 2500
    },
    {
      id: 'clav', name: '击弦古钢琴', group: '键盘', gm: 7, color: '#d8b06a',
      gain: 0.85, reverb: 0.2,
      osc: [O('square', 1, 0.85), O('sawtooth', 1, 0.35, 8), O('sine', 3, 0.2)],
      amp: { a: 0.002, d: 0.9, s: 0.04, r: 0.14 },
      filt: { type: 'lowpass', f: 2600, q: 2.2, envAmount: 5000, envDecay: 0.28 }, velF: 3200
    },

    /* ============ 音槌 / 钟琴 ============ */
    {
      id: 'celesta', name: '钢片琴', group: '音槌', gm: 8, color: '#b8e6ff',
      gain: 0.8, reverb: 0.42,
      osc: [O('sine', 1, 1.0), O('sine', 4, 0.28), O('sine', 9, 0.08)],
      amp: { a: 0.002, d: 2.4, s: 0.02, r: 0.8 },
      filt: { type: 'lowpass', f: 6000, q: 0.3, envAmount: 2000, envDecay: 0.4 }, velF: 2000
    },
    {
      id: 'musicbox', name: '八音盒', group: '音槌', gm: 10, color: '#ffd6e8',
      gain: 0.7, reverb: 0.5,
      osc: [O('sine', 1, 1.0), O('sine', 6.02, 0.22), O('sine', 11, 0.06)],
      noise: { gain: 0.05, decay: 0.02, f: 7000, q: 1 },
      amp: { a: 0.001, d: 1.6, s: 0.0, r: 0.5 },
      filt: { type: 'lowpass', f: 8000, q: 0.2, envAmount: 1500, envDecay: 0.3 }, velF: 1500
    },
    {
      id: 'vibes', name: '颤音琴', group: '音槌', gm: 11, color: '#9fd8ff',
      gain: 0.8, reverb: 0.45,
      osc: [O('sine', 1, 1.0), O('sine', 4, 0.2), O('sine', 10, 0.05)],
      lfo: { rate: 5.2, depth: 8 },
      amp: { a: 0.003, d: 3.0, s: 0.05, r: 0.9 },
      filt: { type: 'lowpass', f: 5200, q: 0.3, envAmount: 2000, envDecay: 0.5 }, velF: 2200
    },
    {
      id: 'marimba', name: '马林巴', group: '音槌', gm: 12, color: '#d2a86a',
      gain: 0.9, reverb: 0.24,
      osc: [O('sine', 1, 1.0), O('sine', 3.9, 0.34), O('sine', 9.2, 0.08)],
      noise: { gain: 0.07, decay: 0.02, f: 2000, q: 0.9 },
      amp: { a: 0.002, d: 0.9, s: 0.0, r: 0.3 },
      filt: { type: 'lowpass', f: 3000, q: 0.4, envAmount: 4000, envDecay: 0.35 }, velF: 3000
    },
    {
      id: 'xylophone', name: '木琴', group: '音槌', gm: 13, color: '#e6b46a',
      gain: 0.75, reverb: 0.22,
      osc: [O('sine', 1, 1.0), O('sine', 3, 0.4), O('sine', 6.8, 0.14)],
      amp: { a: 0.001, d: 0.55, s: 0.0, r: 0.2 },
      filt: { type: 'lowpass', f: 4200, q: 0.4, envAmount: 3000, envDecay: 0.25 }, velF: 2500
    },
    {
      id: 'bell', name: '钟声', group: '音槌', gm: 14, color: '#ffe08a',
      gain: 0.7, reverb: 0.62,
      osc: [O('sine', 0.5, 0.4), O('sine', 1, 1.0), O('sine', 2.76, 0.3), O('sine', 5.4, 0.16), O('sine', 8.9, 0.08)],
      amp: { a: 0.002, d: 6.0, s: 0.03, r: 2.4 },
      filt: { type: 'lowpass', f: 4000, q: 0.3, envAmount: 2000, envDecay: 1.2 }, velF: 1800
    },

    /* ============ 风琴 ============ */
    {
      id: 'organ', name: '拉杆风琴', group: '风琴', gm: 16, color: '#ffa95e',
      gain: 0.62, reverb: 0.3,
      osc: [O('sine', 0.5, 0.5), O('sine', 1, 1.0), O('sine', 2, 0.6), O('sine', 3, 0.34), O('sine', 4, 0.24), O('sine', 6, 0.14), O('sine', 8, 0.1)],
      amp: { a: 0.012, d: 0.1, s: 0.95, r: 0.09 },
      filt: { type: 'lowpass', f: 6500, q: 0.2 }, velF: 1200,
      lfo: { rate: 6.0, depth: 4 }
    },
    {
      id: 'church', name: '教堂管风琴', group: '风琴', gm: 19, color: '#c79bff',
      gain: 0.6, reverb: 0.75,
      osc: [O('sine', 0.5, 0.55), O('sine', 1, 1.0), O('sine', 1.5, 0.3, 3), O('sine', 2, 0.5), O('sine', 3, 0.28), O('sine', 4, 0.2), O('sine', 8, 0.12)],
      amp: { a: 0.05, d: 0.2, s: 0.98, r: 0.35 },
      filt: { type: 'lowpass', f: 5200, q: 0.2 }, velF: 1000
    },
    {
      id: 'reed', name: '簧风琴', group: '风琴', gm: 20, color: '#ff9f7a',
      gain: 0.68, reverb: 0.28,
      osc: [O('sawtooth', 1, 0.7), O('square', 1, 0.35, -6), O('sine', 2, 0.3)],
      amp: { a: 0.03, d: 0.15, s: 0.9, r: 0.16 },
      filt: { type: 'lowpass', f: 2400, q: 1.2, envAmount: 900, envDecay: 0.4 }, velF: 2400
    },
    {
      id: 'accordion', name: '手风琴', group: '风琴', gm: 21, color: '#ff8fa3',
      gain: 0.68, reverb: 0.26,
      osc: [O('sawtooth', 1, 0.6, -8), O('sawtooth', 1, 0.6, 8), O('square', 2, 0.2)],
      amp: { a: 0.035, d: 0.12, s: 0.92, r: 0.15 },
      filt: { type: 'lowpass', f: 2600, q: 0.9, envAmount: 1200, envDecay: 0.5 }, velF: 2000
    },

    /* ============ 弦乐 / 合奏 ============ */
    {
      id: 'strings', name: '弦乐群', group: '合奏', gm: 48, color: '#8fb8ff',
      gain: 0.5, reverb: 0.48,
      osc: [O('sawtooth', 1, 0.55, -9), O('sawtooth', 1, 0.55, 9), O('sawtooth', 2, 0.16, -18), O('sine', 1, 0.3)],
      amp: { a: 0.16, d: 0.5, s: 0.9, r: 0.5 },
      filt: { type: 'lowpass', f: 2200, q: 0.5, envAmount: 1400, envDecay: 0.9 }, velF: 1800,
      lfo: { rate: 5.0, depth: 7 }
    },
    {
      id: 'slowstrings', name: '慢弦乐', group: '合奏', gm: 51, color: '#7aa6ff',
      gain: 0.5, reverb: 0.6,
      osc: [O('sawtooth', 1, 0.5, -12), O('sawtooth', 1, 0.5, 12), O('triangle', 2, 0.2)],
      amp: { a: 0.55, d: 1.2, s: 0.92, r: 1.1 },
      filt: { type: 'lowpass', f: 1500, q: 0.4, envAmount: 900, envDecay: 1.4 }, velF: 1200,
      lfo: { rate: 4.2, depth: 9 }
    },
    {
      id: 'choir', name: '人声合唱', group: '合奏', gm: 52, color: '#a7e0ff',
      gain: 0.5, reverb: 0.6,
      osc: [O('sine', 1, 0.7), O('triangle', 2, 0.28), O('sawtooth', 1, 0.14, 10), O('sine', 3, 0.1)],
      amp: { a: 0.25, d: 0.6, s: 0.9, r: 0.7 },
      filt: { type: 'lowpass', f: 1800, q: 1.4, envAmount: 900, envDecay: 0.8 }, velF: 1400,
      lfo: { rate: 5.6, depth: 11 }
    },
    {
      id: 'brass', name: '铜管乐', group: '合奏', gm: 61, color: '#ffc36b',
      gain: 0.6, reverb: 0.28,
      osc: [O('sawtooth', 1, 0.75), O('sawtooth', 1, 0.5, -10), O('square', 2, 0.2)],
      amp: { a: 0.05, d: 0.25, s: 0.85, r: 0.2 },
      filt: { type: 'lowpass', f: 1400, q: 2.0, envAmount: 3000, envDecay: 0.3 }, velF: 3600
    },

    /* ============ 吉他 / 拨弦 ============ */
    {
      id: 'nylon', name: '尼龙吉他', group: '拨弦', gm: 24, color: '#e3b574',
      gain: 0.85, reverb: 0.26,
      osc: [O('triangle', 1, 1.0), O('sawtooth', 1, 0.2, 5), O('sine', 2, 0.25), O('sine', 3.2, 0.1)],
      noise: { gain: 0.09, decay: 0.03, f: 2800, q: 0.8 },
      amp: { a: 0.004, d: 2.2, s: 0.04, r: 0.3 },
      filt: { type: 'lowpass', f: 2200, q: 0.7, envAmount: 4500, envDecay: 0.6 }, velF: 3000
    },
    {
      id: 'steelguitar', name: '钢弦吉他', group: '拨弦', gm: 25, color: '#f0c48a',
      gain: 0.8, reverb: 0.24,
      osc: [O('triangle', 1, 1.0), O('sawtooth', 1, 0.28, 8), O('sine', 2, 0.3), O('sine', 4, 0.12)],
      noise: { gain: 0.12, decay: 0.028, f: 3800, q: 0.7 },
      amp: { a: 0.003, d: 2.6, s: 0.04, r: 0.35 },
      filt: { type: 'lowpass', f: 2800, q: 0.8, envAmount: 5500, envDecay: 0.55 }, velF: 3400
    },
    {
      id: 'clean', name: '清音电吉他', group: '拨弦', gm: 27, color: '#9ee6a0',
      gain: 0.7, reverb: 0.3,
      osc: [O('triangle', 1, 0.9), O('sawtooth', 2, 0.18, 4), O('sine', 3, 0.1)],
      amp: { a: 0.006, d: 2.4, s: 0.1, r: 0.4 },
      filt: { type: 'lowpass', f: 2600, q: 1.6, envAmount: 2600, envDecay: 0.6 }, velF: 2600,
      lfo: { rate: 4.6, depth: 5 }
    },
    {
      id: 'overdrive', name: '失真吉他', group: '拨弦', gm: 29, color: '#ff8f6b',
      gain: 0.45, reverb: 0.22,
      osc: [O('sawtooth', 1, 0.7, -6), O('sawtooth', 1, 0.7, 6), O('square', 1, 0.3), O('sawtooth', 2, 0.2)],
      amp: { a: 0.008, d: 3.0, s: 0.35, r: 0.35 },
      filt: { type: 'lowpass', f: 1100, q: 3.2, envAmount: 4200, envDecay: 0.5 }, velF: 4200
    },
    {
      id: 'harp', name: '竖琴', group: '拨弦', gm: 46, color: '#ffd8a8',
      gain: 0.8, reverb: 0.4,
      osc: [O('triangle', 1, 1.0), O('sine', 2, 0.28), O('sine', 3, 0.12)],
      noise: { gain: 0.06, decay: 0.03, f: 3000, q: 0.8 },
      amp: { a: 0.003, d: 2.4, s: 0.03, r: 0.6 },
      filt: { type: 'lowpass', f: 3200, q: 0.5, envAmount: 4000, envDecay: 0.7 }, velF: 2800
    },

    /* ============ 贝斯 ============ */
    {
      id: 'acousticbass', name: '原声贝斯', group: '贝斯', gm: 32, color: '#b98b5e',
      gain: 1.0, reverb: 0.16,
      osc: [O('triangle', 1, 1.0), O('sine', 2, 0.3), O('sine', 3, 0.1)],
      noise: { gain: 0.1, decay: 0.03, f: 1200, q: 0.9 },
      amp: { a: 0.006, d: 2.0, s: 0.06, r: 0.28 },
      filt: { type: 'lowpass', f: 900, q: 0.8, envAmount: 2200, envDecay: 0.45 }, velF: 1600
    },
    {
      id: 'fingerbass', name: '指弹电贝斯', group: '贝斯', gm: 33, color: '#a8794e',
      gain: 1.0, reverb: 0.14,
      osc: [O('triangle', 1, 1.0), O('sawtooth', 1, 0.22, 4), O('sine', 2, 0.2)],
      amp: { a: 0.005, d: 1.8, s: 0.2, r: 0.22 },
      filt: { type: 'lowpass', f: 700, q: 2.4, envAmount: 2600, envDecay: 0.35 }, velF: 2200
    },
    {
      id: 'synthbass', name: '合成贝斯', group: '贝斯', gm: 38, color: '#c07aff',
      gain: 0.9, reverb: 0.14,
      osc: [O('sawtooth', 1, 0.8), O('square', 1, 0.4, -5), O('sine', 0.5, 0.4)],
      amp: { a: 0.006, d: 1.0, s: 0.55, r: 0.16 },
      filt: { type: 'lowpass', f: 420, q: 6.0, envAmount: 3800, envDecay: 0.28 }, velF: 3000
    },

    /* ============ 管乐 ============ */
    {
      id: 'sax', name: '萨克斯', group: '管乐', gm: 65, color: '#ffb04d',
      gain: 0.6, reverb: 0.3,
      osc: [O('sawtooth', 1, 0.7), O('square', 1, 0.28, -4), O('sine', 2, 0.25)],
      noise: { gain: 0.05, decay: 0.05, f: 2600, q: 1.2 },
      amp: { a: 0.045, d: 0.3, s: 0.85, r: 0.24 },
      filt: { type: 'lowpass', f: 1500, q: 2.2, envAmount: 2400, envDecay: 0.35 }, velF: 3200,
      lfo: { rate: 5.4, depth: 9 }
    },
    {
      id: 'clarinet', name: '单簧管', group: '管乐', gm: 71, color: '#c9a2ff',
      gain: 0.62, reverb: 0.3,
      osc: [O('square', 1, 0.7), O('sine', 3, 0.22), O('sine', 1, 0.4)],
      amp: { a: 0.04, d: 0.25, s: 0.9, r: 0.2 },
      filt: { type: 'lowpass', f: 1300, q: 1.6, envAmount: 1600, envDecay: 0.4 }, velF: 2400,
      lfo: { rate: 5.0, depth: 6 }
    },
    {
      id: 'flute', name: '长笛', group: '管乐', gm: 73, color: '#a8f0ff',
      gain: 0.6, reverb: 0.36,
      osc: [O('sine', 1, 1.0), O('triangle', 2, 0.16), O('sine', 3, 0.05)],
      noise: { gain: 0.16, decay: 9, f: 4200, q: 0.6 },
      amp: { a: 0.07, d: 0.3, s: 0.88, r: 0.22 },
      filt: { type: 'lowpass', f: 1900, q: 0.7, envAmount: 1200, envDecay: 0.5 }, velF: 1800,
      lfo: { rate: 5.2, depth: 10 }
    },

    /* ============ 合成器 ============ */
    {
      id: 'lead', name: '合成主音', group: '合成器', gm: 81, color: '#59e0ff',
      gain: 0.5, reverb: 0.28,
      osc: [O('sawtooth', 1, 0.6, -7), O('sawtooth', 1, 0.6, 7), O('square', 1, 0.25)],
      amp: { a: 0.012, d: 0.3, s: 0.8, r: 0.2 },
      filt: { type: 'lowpass', f: 1600, q: 7.0, envAmount: 4200, envDecay: 0.45 }, velF: 3200,
      lfo: { rate: 5.5, depth: 12 }
    },
    {
      id: 'supersaw', name: '超级锯齿波', group: '合成器', gm: 82, color: '#4fb6ff',
      gain: 0.42, reverb: 0.4,
      osc: [O('sawtooth', 1, 0.5, -18), O('sawtooth', 1, 0.5, -6), O('sawtooth', 1, 0.5, 6), O('sawtooth', 1, 0.5, 18), O('sawtooth', 2, 0.16)],
      amp: { a: 0.03, d: 0.5, s: 0.85, r: 0.35 },
      filt: { type: 'lowpass', f: 2600, q: 1.6, envAmount: 3000, envDecay: 0.7 }, velF: 2400
    },
    {
      id: 'pad', name: '合成铺底', group: '合成器', gm: 89, color: '#8fa8ff',
      gain: 0.45, reverb: 0.68,
      osc: [O('sawtooth', 1, 0.4, -10), O('sawtooth', 1, 0.4, 10), O('triangle', 2, 0.25), O('sine', 0.5, 0.3)],
      amp: { a: 0.6, d: 1.0, s: 0.9, r: 1.4 },
      filt: { type: 'lowpass', f: 1200, q: 0.8, envAmount: 1800, envDecay: 1.8 }, velF: 1400,
      lfo: { rate: 3.6, depth: 8 }
    },
    {
      id: 'squarelead', name: '方波主音', group: '合成器', gm: 80, color: '#67ffd0',
      gain: 0.4, reverb: 0.24,
      osc: [O('square', 1, 0.8), O('square', 2, 0.2, 3), O('sawtooth', 1, 0.15)],
      amp: { a: 0.008, d: 0.3, s: 0.82, r: 0.16 },
      filt: { type: 'lowpass', f: 2400, q: 3.0, envAmount: 2600, envDecay: 0.4 }, velF: 2600
    },

    /* ============ 打击乐 ============ */
    {
      id: 'drums', name: '打击乐组 (Ch10)', group: '打击乐', gm: 0, color: '#ff7a7a', drum: true,
      gain: 1.0, reverb: 0.2
    }
  ];

  /* ---------- GM 音色号 → 内置音色 映射 ---------- */
  function gmToPreset(prog) {
    const p = prog & 0x7f;
    if (p <= 3) return 'grand';
    if (p === 4) return 'epiano';
    if (p === 5) return 'dxep';
    if (p === 6) return 'harpsi';
    if (p === 7) return 'clav';
    if (p === 8) return 'celesta';
    if (p >= 9 && p <= 10) return 'musicbox';
    if (p === 11) return 'vibes';
    if (p === 12) return 'marimba';
    if (p === 13) return 'xylophone';
    if (p >= 14 && p <= 15) return 'bell';
    if (p <= 23) return 'organ';
    if (p === 24) return 'nylon';
    if (p === 25) return 'steelguitar';
    if (p <= 31) return 'clean';
    if (p === 32) return 'acousticbass';
    if (p <= 37) return 'fingerbass';
    if (p <= 39) return 'synthbass';
    if (p === 46 || p === 47) return 'harp';
    if (p <= 47) return 'strings';
    if (p <= 55) return 'strings';
    if (p <= 63) return 'brass';
    if (p <= 67) return 'sax';
    if (p <= 71) return 'clarinet';
    if (p <= 79) return 'flute';
    if (p === 80) return 'squarelead';
    if (p <= 87) return 'lead';
    if (p === 89) return 'pad';
    if (p <= 95) return 'pad';
    if (p <= 103) return 'bell';
    if (p <= 111) return 'harp';
    if (p <= 119) return 'marimba';
    return 'bell';
  }

  const byId = {};
  DEFS.forEach(function (d) { byId[d.id] = d; });

  const GROUPS = [];
  DEFS.forEach(function (d) {
    if (GROUPS.indexOf(d.group) < 0) GROUPS.push(d.group);
  });

  return {
    all: DEFS,
    groups: GROUPS,
    get: function (id) { return byId[id] || byId.grand; },
    byId: byId,
    gmToPreset: gmToPreset
  };
})();
