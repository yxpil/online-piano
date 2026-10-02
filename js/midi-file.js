/* ============================================================
 *  MidiFile —— 标准 MIDI 文件 (SMF) 解析与导出
 *  · parse():  支持 Format 0 / 1，变速 tempo map，running status，
 *              文件内自带多通道 → 多音色自动分配
 *  · write():  导出 Format 1（速度轨 + 每通道一条轨）
 * ============================================================ */
const MidiFile = (function () {
  'use strict';

  const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const DRUM_CHANNEL = 9;

  function nameOfNote(n) {
    return NOTE_NAMES[((n % 12) + 12) % 12] + (Math.floor(n / 12) - 1);
  }

  /* ---------------- 解析 ---------------- */
  function parse(arrayBuffer) {
    const dv = new DataView(arrayBuffer);
    let pos = 0;

    function u8() { return dv.getUint8(pos++); }
    function u16() { const v = dv.getUint16(pos); pos += 2; return v; }
    function u32() { const v = dv.getUint32(pos); pos += 4; return v; }
    function str(n) {
      let s = '';
      for (let i = 0; i < n; i++) s += String.fromCharCode(dv.getUint8(pos++));
      return s;
    }
    function varLen() {
      let v = 0, b;
      do { b = u8(); v = (v << 7) | (b & 0x7f); } while (b & 0x80);
      return v;
    }

    if (str(4) !== 'MThd') throw new Error('不是有效的 MIDI 文件（缺少 MThd 头）');
    const headerLen = u32();
    const format = u16();
    const ntrks = u16();
    const division = u16();
    pos += Math.max(0, headerLen - 6);

    let ppq = division & 0x8000 ? 480 : (division || 480);
    // SMPTE 时间格式（极少见）：frame-based
    const smpte = (division & 0x8000) ? {
      fps: 256 - ((division >> 8) & 0xff),
      ticksPerFrame: division & 0xff
    } : null;
    if (smpte) ppq = smpte.fps * smpte.ticksPerFrame;

    const rawTracks = [];
    const tempoMap = [{ tick: 0, usPerBeat: 500000 }];   // 默认 120 BPM
    const sustainTicks = [];                             // CC64 延音踏板

    for (let t = 0; t < ntrks && pos + 8 <= arrayBuffer.byteLength; t++) {
      const id = str(4);
      const len = u32();
      const end = pos + len;
      if (id !== 'MTrk') { pos = end; continue; }

      const evts = [];
      let tick = 0;
      let running = 0;
      let name = '';
      while (pos < end) {
        tick += varLen();
        let status = dv.getUint8(pos);
        if (status & 0x80) { pos++; running = status; }
        else { status = running; }
        if (!status) break;

        const type = status & 0xf0;
        const ch = status & 0x0f;
        if (type === 0x80 || type === 0x90 || type === 0xA0 || type === 0xB0 || type === 0xE0) {
          const d1 = u8(), d2 = u8();
          if (type === 0xB0 && d1 === 64) sustainTicks.push({ tick: tick, on: d2 >= 64 });
          evts.push({ tick: tick, type: type, ch: ch, d1: d1, d2: d2 });
        } else if (type === 0xC0 || type === 0xD0) {
          const d1 = u8();
          evts.push({ tick: tick, type: type, ch: ch, d1: d1, d2: 0 });
        } else if (status === 0xFF) {
          const meta = u8();
          const mlen = varLen();
          const start = pos;
          if (meta === 0x51 && mlen === 3) {
            const us = (dv.getUint8(pos) << 16) | (dv.getUint8(pos + 1) << 8) | dv.getUint8(pos + 2);
            tempoMap.push({ tick: tick, usPerBeat: us });
          } else if (meta === 0x03) {
            let s = '';
            for (let i = 0; i < mlen; i++) s += String.fromCharCode(dv.getUint8(pos + i));
            name = s;
          } else if (meta === 0x2F) { pos += mlen; break; }
          pos = start + mlen;
        } else if (status === 0xF0 || status === 0xF7) {
          const slen = varLen();
          pos += slen;
        } else {
          break; // 未知数据，终止该轨解析
        }
      }
      pos = end;
      rawTracks.push({ name: name, events: evts });
    }

    tempoMap.sort((a, b) => a.tick - b.tick);
    // 去重：同 tick 保留最后一个
    const tempos = [];
    tempoMap.forEach(function (t) {
      if (tempos.length && tempos[tempos.length - 1].tick === t.tick) tempos[tempos.length - 1] = t;
      else tempos.push(t);
    });

    // tick → 秒
    function tickToSec(tick) {
      let sec = 0, last = 0, us = 500000;
      for (let i = 0; i < tempos.length; i++) {
        const tm = tempos[i];
        if (tm.tick >= tick) break;
        sec += (tm.tick - last) / ppq * (us / 1000000);
        last = tm.tick;
        us = tm.usPerBeat;
      }
      sec += (tick - last) / ppq * (us / 1000000);
      return sec;
    }

    // 组装音符
    const tracks = [];
    const notes = [];                 // 全局音符列表
    const channelProgram = {};        // 通道 → 音色号

    rawTracks.forEach(function (rt, ti) {
      const pending = {};             // "ch:note" → 事件
      const trackNotes = [];
      let program = 0;

      rt.events.forEach(function (e) {
        if (e.type === 0x90 && e.d2 > 0) {
          const k = e.ch + ':' + e.d1;
          if (!pending[k]) pending[k] = [];
          pending[k].push(e);
        } else if (e.type === 0x80 || (e.type === 0x90 && e.d2 === 0)) {
          const k = e.ch + ':' + e.d1;
          const arr = pending[k];
          const on = arr && arr.shift();
          if (on) {
            trackNotes.push({
              note: e.d1,
              vel: on.d2 / 127,
              startTick: on.tick,
              endTick: e.tick,
              start: tickToSec(on.tick),
              end: tickToSec(e.tick),
              channel: e.ch,
              track: ti,
              trackName: rt.name
            });
          }
        } else if (e.type === 0xC0) {
          program = e.d1;
          if (!(e.ch in channelProgram)) channelProgram[e.ch] = e.d1;
        }
      });
      // 未闭合的音符（缺 note-off）
      Object.keys(pending).forEach(function (k) {
        pending[k].forEach(function (on) {
          trackNotes.push({
            note: on.d1, vel: on.d2 / 127,
            startTick: on.tick, endTick: on.tick + ppq / 4,
            start: tickToSec(on.tick), end: tickToSec(on.tick + ppq / 4),
            channel: on.ch, track: ti, trackName: rt.name
          });
        });
      });

      // 判断该轨主导通道
      const chCount = {};
      trackNotes.forEach(function (n) { chCount[n.channel] = (chCount[n.channel] || 0) + 1; });
      let mainCh = 0, best = -1;
      Object.keys(chCount).forEach(function (c) { if (chCount[c] > best) { best = chCount[c]; mainCh = +c; } });

      trackNotes.forEach(function (n) { notes.push(n); });
      tracks.push({
        index: ti,
        name: rt.name || ('轨道 ' + (ti + 1)),
        channel: mainCh,
        program: channelProgram[mainCh] == null ? 0 : channelProgram[mainCh],
        noteCount: trackNotes.length,
        notes: trackNotes,
        muted: false
      });
    });

    // 收集每通道音色
    const channels = {};
    notes.forEach(function (n) {
      if (!channels[n.channel]) {
        channels[n.channel] = {
          channel: n.channel,
          isDrum: n.channel === DRUM_CHANNEL,
          program: channelProgram[n.channel] == null ? 0 : channelProgram[n.channel],
          noteCount: 0
        };
      }
      channels[n.channel].noteCount++;
    });

    let duration = 0;
    notes.forEach(function (n) { if (n.end > duration) duration = n.end; });

    const sustain = sustainTicks
      .sort(function (a, b) { return a.tick - b.tick; })
      .map(function (e) { return { time: tickToSec(e.tick), on: e.on }; });

    return {
      format: format,
      ppq: ppq,
      name: (rawTracks[0] && rawTracks[0].name) || '未命名乐曲',
      tracks: tracks.filter(function (t) { return t.noteCount > 0; }),
      channels: channels,
      notes: notes,
      tempos: tempos,
      sustain: sustain,
      duration: duration,
      tickToSec: tickToSec
    };
  }

  /* ---------------- 导出 ---------------- */
  function varLenBytes(value) {
    const buf = [value & 0x7f];
    value >>= 7;
    while (value > 0) {
      buf.unshift((value & 0x7f) | 0x80);
      value >>= 7;
    }
    return buf;
  }

  /**
   * events: [{time(秒), type:'on'|'off'|'program', channel, note, velocity, program}]
   * opts:   {ppq, bpm, name}
   */
  function write(events, opts) {
    opts = opts || {};
    const ppq = opts.ppq || 480;
    const bpm = opts.bpm || 120;
    const usPerBeat = Math.round(60000000 / bpm);
    const secPerTick = (usPerBeat / 1000000) / ppq;

    // 整理为每通道事件
    const byCh = {};
    let chOrder = [];
    events.forEach(function (e) {
      const ch = e.channel == null ? 0 : e.channel;
      if (!byCh[ch]) { byCh[ch] = []; chOrder.push(ch); }
      byCh[ch].push(e);
    });
    chOrder.sort(function (a, b) {
      const da = a === DRUM_CHANNEL ? 1 : 0, db = b === DRUM_CHANNEL ? 1 : 0;
      return (da - db) || (a - b);
    });

    function chunk(id, bytes) {
      const out = [];
      for (let i = 0; i < id.length; i++) out.push(id.charCodeAt(i));
      out.push((bytes.length >>> 24) & 0xff, (bytes.length >>> 16) & 0xff, (bytes.length >>> 8) & 0xff, bytes.length & 0xff);
      return out.concat(bytes);
    }

    const tracksBytes = [];

    // --- 速度轨 ---
    (function () {
      const b = [];
      const name = opts.name || 'Piano Recording';
      b.push(0, 0xff, 0x03, name.length); for (let i = 0; i < name.length; i++) b.push(name.charCodeAt(i) & 0xff);
      b.push(0, 0xff, 0x51, 0x03, (usPerBeat >> 16) & 0xff, (usPerBeat >> 8) & 0xff, usPerBeat & 0xff);
      b.push(0, 0xff, 0x2f, 0x00);
      tracksBytes.push(chunk('MTrk', b));
    })();

    // --- 每通道一轨 ---
    chOrder.forEach(function (ch) {
      const list = byCh[ch];
      const msgs = [];
      let program = 0;
      list.forEach(function (e) {
        const tick = Math.max(0, Math.round((e.time || 0) / secPerTick));
        if (e.type === 'program') msgs.push({ tick: tick, bytes: [0xc0 | ch, (e.program || 0) & 0x7f] });
        else if (e.type === 'on' && e.velocity > 0) {
          const v = Math.max(1, Math.min(127, Math.round(e.velocity * 127)));
          msgs.push({ tick: tick, bytes: [0x90 | ch, e.note & 0x7f, v] });
        } else msgs.push({ tick: tick, bytes: [0x80 | ch, e.note & 0x7f, 0] });
      });
      // 起始音色：若已显式给出 tick 0 的音色变更则不再插入默认值
      const hasInitProg = list.some(function (e) {
        return e.type === 'program' && (e.time || 0) < 1e-6;
      });
      if (!hasInitProg) {
        msgs.push({ tick: 0, bytes: [0xc0 | ch, 0] });
      }
      msgs.sort(function (a, b) {
        if (a.tick !== b.tick) return a.tick - b.tick;
        const wa = (a.bytes[0] & 0xf0) === 0xc0 ? 0 : 1;   // 音色变更先于音符
        const wb = (b.bytes[0] & 0xf0) === 0xc0 ? 0 : 1;
        return (wa - wb) || ((a.bytes[0] & 0xf0) - (b.bytes[0] & 0xf0));
      });

      const b = [];
      const tname = 'Ch ' + (ch + 1);
      b.push(0, 0xff, 0x03, tname.length); for (let i = 0; i < tname.length; i++) b.push(tname.charCodeAt(i) & 0xff);
      let last = 0;
      msgs.forEach(function (m) {
        const delta = Math.max(0, m.tick - last);
        last = m.tick;
        b.push.apply(b, varLenBytes(delta));
        b.push.apply(b, m.bytes);
      });
      b.push(0, 0xff, 0x2f, 0x00);
      tracksBytes.push(chunk('MTrk', b));
    });

    const bytes = [];
    const head = chunk('MThd', [0, 1, 0, tracksBytes.length, (ppq >> 8) & 0xff, ppq & 0xff]);
    bytes.push.apply(bytes, head);
    tracksBytes.forEach(function (t) { bytes.push.apply(bytes, t); });
    return new Uint8Array(bytes);
  }

  return {
    parse: parse,
    write: write,
    nameOfNote: nameOfNote,
    DRUM_CHANNEL: DRUM_CHANNEL
  };
})();
