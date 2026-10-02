/* ============================================================
 *  app.js —— 应用装配与交互逻辑
 * ============================================================ */
(function () {
  'use strict';

  const $ = (s) => document.querySelector(s);

  /* ---------------- 核心对象 ---------------- */
  const synth = new PianoSynth();
  const player = new Player(synth);
  let roll = null, scope = null, kbd = null;

  const state = {
    instrument: 'grand',
    mode: 'live',
    velocity: 0.82,
    recording: false,
    liveNotes: [],
    recEvents: [],
    recStart: 0,
    recChannel: 0,
    activeNotes: new Set(),
    audioReady: false,
    lastNote: -1
  };

  /* =========================================================
   *  音频启动
   * ========================================================= */
  function ensureAudio() {
    synth.init();
    return synth.resume().then(function () {
      if (!state.audioReady) {
        state.audioReady = true;
        const hint = $('#audioHint');
        if (hint) hint.classList.add('gone');
      }
    });
  }

  /* =========================================================
   *  发声：统一入口
   * ========================================================= */
  function noteOn(note, velocity, source) {
    ensureAudio();
    const preset = InstrumentLib.get(state.instrument);
    synth.noteOn(note, velocity, null, preset, 0);
    kbd.highlight(note, true);
    state.activeNotes.add(note);
    state.lastNote = note;

    // 转发到外部 MIDI 设备（把屏幕键盘当控制器用）
    if (source === 'touch' || source === 'kbd') {
      kbd.sendMidi([0x90, note, Math.round(velocity * 127)]);
    }
    // 实时卷帘
    if (state.mode === 'live') {
      const t = synth.ctx.currentTime;
      state.liveNotes.push({
        note: note, start: t, end: t + 0.08, channel: 0, vel: velocity
      });
      trimLive(t);
    }
    // 录音
    if (state.recording) {
      pushRec({ type: 'on', time: synth.ctx.currentTime - state.recStart, note: note, velocity: velocity, channel: state.recChannel });
    }
    updatePoly();
  }

  function noteOff(note, source) {
    synth.noteOff(note, null, 0);
    state.activeNotes.delete(note);
    if (!Object.values(kbd.pointers).some(p => p.note === note) &&
      !Object.values(kbd.heldByComputer).some(n => n === note)) {
      kbd.highlight(note, false);
    }
    if (source === 'touch' || source === 'kbd') kbd.sendMidi([0x80, note, 0]);
    if (state.mode === 'live') {
      const t = synth.ctx.currentTime;
      for (let i = state.liveNotes.length - 1; i >= 0; i--) {
        const n = state.liveNotes[i];
        if (n.note === note && n.end <= n.start + 0.081) { n.end = Math.max(t, n.start + 0.06); break; }
      }
    }
    if (state.recording) {
      pushRec({ type: 'off', time: synth.ctx.currentTime - state.recStart, note: note, velocity: 0, channel: state.recChannel });
    }
    updatePoly();
  }

  function trimLive(now) {
    const arr = state.liveNotes;
    const cut = now - 40;
    let i = 0;
    while (i < arr.length && arr[i].end < cut) i++;
    if (i > 0) arr.splice(0, i);
    if (arr.length > 900) arr.splice(0, arr.length - 600);
  }

  function pushRec(e) {
    if (!state.recEvents.length) {
      state.recEvents.push({ type: 'program', time: 0, channel: state.recChannel, program: gmProgramOf(state.instrument) });
    }
    state.recEvents.push(e);
  }

  function gmProgramOf(presetId) {
    const p = InstrumentLib.get(presetId);
    return p.gm == null ? 0 : p.gm;
  }

  function setPlayButton(playing) {
    $('#btnPlay').innerHTML = icon(playing ? 'i-pause' : 'i-play', 'h-4 w-4') +
      '<span>' + (playing ? '暂停' : '播放') + '</span>';
  }

  function setRecButton(recording) {
    const b = $('#btnRec');
    b.classList.toggle('is-on', recording);
    b.innerHTML = icon(recording ? 'i-stop' : 'i-record', 'h-4 w-4') +
      '<span>' + (recording ? '停止录音' : '录音') + '</span>';
  }

  function updatePoly() {
    const el = $('#polyStatus span');
    if (el) el.textContent = '复音 ' + synth.voiceCount + ' / ' + synth.maxVoices;
  }

  /** 停止一切发声，并同步清理界面上的按键状态 */
  function allNotesOffUI() {
    synth.allNotesOff();
    state.activeNotes.clear();
    if (kbd) {
      kbd.pointers = {};
      kbd.heldByComputer = {};
      kbd.clearHighlights();
    }
    updatePoly();
  }

  /* =========================================================
   *  图标（内联 SVG 雪碧图，不使用 emoji）
   * ========================================================= */
  const GROUP_ICON = {
    '键盘': 'i-piano', '音槌': 'i-bell', '风琴': 'i-pipes', '合奏': 'i-music',
    '拨弦': 'i-guitar', '贝斯': 'i-equalizer', '管乐': 'i-wind',
    '合成器': 'i-sliders', '打击乐': 'i-drum'
  };
  function icon(id, cls) {
    return '<svg class="' + (cls || 'h-4 w-4') + '"><use href="#' + id + '"/></svg>';
  }

  /* =========================================================
   *  音色面板
   * ========================================================= */
  function buildInstrumentPanel() {
    const wrap = $('#instGroups');
    wrap.innerHTML = '';
    InstrumentLib.groups.forEach(function (g) {
      const sec = document.createElement('div');
      sec.className = 'inst-group';

      const h = document.createElement('div');
      h.className = 'mb-1.5 flex items-center gap-1.5 pl-0.5 text-[11px] text-[#6b7793]';
      h.innerHTML = icon(GROUP_ICON[g] || 'i-music', 'h-3.5 w-3.5') + '<span>' + g + '</span>';
      sec.appendChild(h);

      const grid = document.createElement('div');
      grid.className = 'grid grid-cols-2 gap-1.5';
      InstrumentLib.all.filter(function (p) { return p.group === g; }).forEach(function (p) {
        const b = document.createElement('button');
        b.className = 'inst-chip';
        b.dataset.id = p.id;
        b.innerHTML = '<i style="color:' + p.color + '">' + icon(GROUP_ICON[g] || 'i-music', 'h-3.5 w-3.5') + '</i>' +
          '<span class="truncate">' + p.name + '</span>';
        b.addEventListener('click', function () { selectInstrument(p.id); });
        grid.appendChild(b);
      });
      sec.appendChild(grid);
      wrap.appendChild(sec);
    });
    selectInstrument('grand');
  }

  function selectInstrument(id) {
    state.instrument = id;
    const p = InstrumentLib.get(id);
    document.querySelectorAll('.inst-chip').forEach(function (b) {
      b.classList.toggle('active', b.dataset.id === id);
    });
    const now = $('#instNow');
    if (now) { now.textContent = p.name; now.style.color = p.color; }
    if (state.recording) {
      state.recEvents.push({ type: 'program', time: synth.ctx.currentTime - state.recStart, channel: state.recChannel, program: gmProgramOf(id) });
    }
  }

  /* =========================================================
   *  多轨面板
   * ========================================================= */
  function buildTrackPanel(midi) {
    const panel = $('#trackPanel');
    const list = $('#trackList');
    list.innerHTML = '';
    const chKeys = Object.keys(midi.channels).sort(function (a, b) { return a - b; });
    if (!chKeys.length) { panel.hidden = true; return; }
    panel.hidden = false;

    chKeys.forEach(function (k) {
      const ch = midi.channels[k];
      const row = document.createElement('div');
      row.className = 'track-row flex items-center gap-2 rounded-[10px] border border-line bg-panel-2 px-2 py-1.5';

      const name = document.createElement('div');
      name.className = 'track-name flex w-[150px] shrink-0 items-baseline gap-1.5 overflow-hidden text-[11.5px]';
      // 轨道名若已是 "Ch N" / "Channel N" 就不再重复前缀
      const rawName = (midi.tracks.find(function (t) { return t.channel === ch.channel; }) || {}).name || ('通道 ' + (ch.channel + 1));
      const tname = /^ch(annel)?\s*\d+\s*$/i.test(rawName.trim()) ? '' : rawName;
      name.innerHTML = '<b class="font-mono text-blue">Ch' + (ch.channel + 1) + '</b>' +
        (ch.isDrum ? icon('i-drum', 'h-3 w-3 self-center text-dim-2') : '') +
        (tname ? '<span class="truncate text-[#b9c4da]">' + escapeHtml(tname) + '</span>' : '') +
        '<em class="shrink-0 text-[10.5px] not-italic text-dim-2">' + ch.noteCount + ' 音</em>';
      row.appendChild(name);

      const sel = document.createElement('select');
      sel.className = 'track-inst sel flex-1 py-[5px] text-[11.5px]';
      InstrumentLib.groups.forEach(function (g) {
        const og = document.createElement('optgroup');
        og.label = g;
        InstrumentLib.all.forEach(function (p) {
          if (p.group !== g) return;
          if (ch.isDrum && !p.drum) return;
          if (!ch.isDrum && p.id === 'drums') return;
          const o = document.createElement('option');
          o.value = p.id;
          o.textContent = p.name;
          og.appendChild(o);
        });
        sel.appendChild(og);
      });
      sel.value = player.channelPreset[ch.channel] || 'grand';
      sel.addEventListener('change', function () {
        player.setChannelPreset(ch.channel, sel.value);
        sel.style.borderColor = InstrumentLib.get(sel.value).color;
      });
      sel.style.borderColor = InstrumentLib.get(sel.value).color;
      row.appendChild(sel);

      const mute = document.createElement('button');
      mute.className = 'track-mute';
      mute.title = '静音该通道';
      mute.innerHTML = icon('i-volume', 'h-3.5 w-3.5');
      mute.addEventListener('click', function () {
        const m = !player.mutedChannels[ch.channel];
        player.setChannelMuted(ch.channel, m);
        mute.classList.toggle('on', m);
        mute.innerHTML = icon(m ? 'i-volume-off' : 'i-volume', 'h-3.5 w-3.5');
      });
      row.appendChild(mute);

      list.appendChild(row);
    });
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  /* =========================================================
   *  MIDI 载入 / 导出
   * ========================================================= */
  function loadMidiBuffer(buf, filename) {
    ensureAudio();
    let midi;
    try {
      midi = MidiFile.parse(buf);
    } catch (err) {
      toast('无法解析该 MIDI 文件：' + err.message, true);
      return;
    }
    if (!midi.notes.length) { toast('这个 MIDI 文件里没有音符', true); return; }
    player.load(midi);
    state.mode = 'song';
    roll.setNotes(midi.notes.map(function (n) {
      return { note: n.note, start: n.start, end: n.end, channel: n.channel };
    }), { lowNote: null, highNote: null });
    buildTrackPanel(midi);
    $('#songName').textContent = (filename || midi.name) + ' · ' + midi.notes.length + ' 音符 · ' + fmtTime(midi.duration);
    player.play(0);
    toast('已载入「' + (filename || midi.name) + '」，共 ' + midi.tracks.length + ' 轨 / ' + Object.keys(midi.channels).length + ' 个音色通道');
  }

  function fmtTime(s) {
    s = Math.max(0, s || 0);
    const m = Math.floor(s / 60);
    const ss = Math.floor(s % 60);
    return m + ':' + (ss < 10 ? '0' : '') + ss;
  }

  function exportMidi() {
    let events, name;
    if (state.recEvents.length > 8) {
      events = state.recEvents.slice().sort(function (a, b) { return a.time - b.time; });
      name = 'Piano Recording';
    } else if (player.song) {
      events = player.events.filter(function (e) { return e.type === 'on' || e.type === 'off'; }).map(function (e) {
        return { type: e.type, time: e.time, note: e.note, velocity: e.velocity, channel: e.channel };
      });
      Object.keys(player.channelPreset).forEach(function (c) {
        events.push({ type: 'program', time: 0, channel: +c, program: gmProgramOf(player.channelPreset[c]) });
      });
      name = player.song.name;
    } else {
      toast('还没有可导出的内容 —— 先演奏一段或载入 MIDI', true);
      return;
    }
    if (!events.length) { toast('没有可导出的音符', true); return; }
    const bytes = MidiFile.write(events, { bpm: 120, name: name });
    const blob = new Blob([bytes], { type: 'audio/midi' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name.replace(/[\\/:*?"<>|]/g, '_') + '.mid';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
    toast('已导出 MIDI 文件（' + (bytes.length / 1024).toFixed(1) + ' KB）');
  }

  /* =========================================================
   *  内置演示曲（同时验证写入/解析两条链路）
   * ========================================================= */
  function loadDemo() {
    const ev = [];
    function add(ch, time, note, vel, dur) {
      ev.push({ type: 'on', time: time, note: note, velocity: vel, channel: ch });
      ev.push({ type: 'off', time: time + dur, note: note, velocity: 0, channel: ch });
    }
    // I – V – vi – IV，4 小节
    const roots = [48, 55, 57, 53];          // C3 G3 A3 F3
    const chords = [[60, 64, 67], [59, 62, 67], [57, 60, 64], [57, 60, 65]];
    for (let i = 0; i < 4; i++) {
      const t0 = i * 4;
      add(1, t0, roots[i] - 12, 0.85, 3.6);
      add(1, t0 + 2, roots[i] - 5, 0.7, 1.6);
      add(2, t0, chords[i][0], 0.5, 3.8);
      add(2, t0, chords[i][1], 0.5, 3.8);
      add(2, t0, chords[i][2], 0.5, 3.8);
      const mel = [[0, 76, 0.5], [0.75, 79, 0.25], [1.25, 81, 0.75], [2.25, 79, 0.5], [3, 76, 0.75]];
      mel.forEach(function (m) { add(0, t0 + m[0], m[1] + (i === 2 ? 2 : (i === 3 ? 1 : 0)), m[2], 0.7); });
      for (let b = 0; b < 4; b++) add(9, t0 + b, b % 2 === 0 ? 36 : 38, 0.8, 0.2);
      for (let b = 0; b < 8; b++) add(9, t0 + b * 0.5, 42, 0.35, 0.1);
    }
    const bytes = MidiFile.write(ev, { bpm: 108, name: 'Demo' });
    loadMidiBuffer(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '内置演示曲');
  }

  /* =========================================================
   *  提示
   * ========================================================= */
  let toastTimer = null;
  function toast(msg, isErr) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.toggle('err', !!isErr);
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('show'); }, 3200);
  }

  /* =========================================================
   *  主循环
   * ========================================================= */
  function loop() {
    requestAnimationFrame(loop);
    if (!synth.ready) return;
    if (roll) {
      if (state.mode === 'song' && player.song) {
        roll.render(player.position, { activeNote: state.lastNote });
      } else {
        roll.render(synth.ctx.currentTime, { activeNote: state.lastNote });
      }
    }
    if (scope) scope.render(synth);
    if (player.playing) {
      const pos = player.position;
      const pct = player.duration ? (pos / player.duration) * 100 : 0;
      $('#progressFill').style.width = pct + '%';
      $('#timeNow').textContent = fmtTime(pos);
    }
    updatePoly();
  }

  /* =========================================================
   *  初始化
   * ========================================================= */
  document.addEventListener('DOMContentLoaded', function () {
    roll = new RollView($('#roll'));
    scope = new Scope($('#scope'));

    // 立即创建音频上下文（浏览器策略下会先处于 suspended），
    // 这样首个音符没有初始化延迟，卷帘/示波器也能马上工作。
    synth.init();
    buildInstrumentPanel();

    /* --- 键盘 --- */
    kbd = new PianoKeyboard($('#piano'), {
      startNote: 36, octaves: 4,
      onNoteOn: noteOn,
      onNoteOff: noteOff
    });
    kbd.attachPointer();
    kbd.attachComputerKeyboard(state.velocity);
    if (window.innerWidth < 760) kbd.setRange(48, 2);
    kbd._onSustain = function (on) {
      synth.setSustain(on);
      $('#sustainBtn').classList.toggle('on', on);
    };
    kbd._onAllOff = function () { allNotesOffUI(); };
    kbd._onPitchBend = function () { /* 弯音仅透传，合成器保持稳定音高 */ };
    kbd._onPortsChanged = refreshMidiUI;

    /* --- 全局首次交互解锁音频 --- */
    const unlock = function () {
      ensureAudio();
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);

    /* --- 音量 / 混响 --- */
    $('#masterVol').addEventListener('input', function (e) { synth.setMasterVolume(+e.target.value); });
    $('#reverbAmt').addEventListener('input', function (e) { synth.setReverb(+e.target.value); });
    $('#kbVel').addEventListener('input', function (e) { state.velocity = +e.target.value / 100; });

    /* --- 八度 --- */
    function shiftOct(d) {
      kbd.setOctaveShift(kbd.octaveShift + d);
      $('#octLabel').textContent = 'C' + (Math.floor(kbd.firstNote / 12) - 1) + ' – ' +
        MidiFile.nameOfNote(kbd.lastNote);
    }
    $('#octDown').addEventListener('click', function () { shiftOct(-1); });
    $('#octUp').addEventListener('click', function () { shiftOct(1); });
    $('#octLabel').textContent = 'C' + (Math.floor(kbd.firstNote / 12) - 1) + ' – ' + MidiFile.nameOfNote(kbd.lastNote);

    /* --- 延音 --- */
    $('#sustainBtn').addEventListener('click', function () {
      const on = !synth.sustainOn;
      synth.setSustain(on);
      this.classList.toggle('on', on);
    });

    /* --- 传输控制 --- */
    $('#btnPlay').addEventListener('click', function () {
      if (!player.song) { loadDemo(); return; }
      if (player.playing) player.pause(); else player.play();
    });
    $('#btnStop').addEventListener('click', function () {
      player.stop();
      allNotesOffUI();
      $('#progressFill').style.width = '0%';
      $('#timeNow').textContent = '0:00';
    });
    $('#progressBar').addEventListener('pointerdown', function (e) {
      if (!player.song) return;
      const r = this.getBoundingClientRect();
      const p = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
      player.seek(p * player.duration);
    });
    $('#btnDemo').addEventListener('click', loadDemo);

    $('#fileMidi').addEventListener('change', function (e) {
      const f = e.target.files[0];
      if (!f) return;
      const rd = new FileReader();
      rd.onload = function () { loadMidiBuffer(rd.result, f.name); };
      rd.readAsArrayBuffer(f);
      e.target.value = '';
    });
    $('#btnExport').addEventListener('click', exportMidi);

    /* --- 录音 --- */
    $('#btnRec').addEventListener('click', function () {
      ensureAudio();
      state.recording = !state.recording;
      if (state.recording) {
        state.recEvents = [];
        state.recStart = synth.ctx.currentTime;
        state.liveNotes = [];
        state.mode = 'live';
        player.stop();
        roll.setNotes(state.liveNotes, { lowNote: 36, highNote: 84 });
        $('#songName').innerHTML = '<span class="inline-flex items-center gap-1.5">' +
          '<span class="animate-blink h-2 w-2 rounded-full bg-rose"></span>录音中 · 弹奏后用「导出 MIDI」保存</span>';
        toast('开始录音，弹奏后用「导出 MIDI」保存');
      } else {
        $('#songName').textContent = '录音结束 · ' + state.recEvents.length + ' 个事件';
        toast('录音完成，可点击「导出 MIDI」');
      }
      setRecButton(state.recording);
    });

    /* --- 拖放 --- */
    const zone = document.body;
    ['dragenter', 'dragover'].forEach(function (t) {
      zone.addEventListener(t, function (e) {
        if (e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') >= 0) {
          e.preventDefault();
          $('#dropMask').classList.add('show');
        }
      });
    });
    zone.addEventListener('dragleave', function (e) {
      if (e.target === document) $('#dropMask').classList.remove('show');
    });
    zone.addEventListener('drop', function (e) {
      e.preventDefault();
      $('#dropMask').classList.remove('show');
      const f = e.dataTransfer.files && e.dataTransfer.files[0];
      if (!f) return;
      if (!/\.(mid|midi|smf)$/i.test(f.name)) { toast('请拖入 .mid / .midi 文件', true); return; }
      const rd = new FileReader();
      rd.onload = function () { loadMidiBuffer(rd.result, f.name); };
      rd.readAsArrayBuffer(f);
    });

    /* --- MIDI 设备 --- */
    $('#btnMidiScan').addEventListener('click', function () { initMidi(true); });
    $('#midiOutSelect').addEventListener('change', function () { kbd.selectMidiOutput(this.value); });

    /* --- 移动端抽屉 --- */
    $('#drawerBtn').addEventListener('click', function () {
      document.body.classList.toggle('drawer-open');
    });
    document.addEventListener('click', function (e) {
      if (document.body.classList.contains('drawer-open') &&
        !e.target.closest('.sidebar') && !e.target.closest('#drawerBtn')) {
        document.body.classList.remove('drawer-open');
      }
    });

    /* --- 快捷键 --- */
    window.addEventListener('keydown', function (e) {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
      if (e.code === 'Space') { e.preventDefault(); $('#btnPlay').click(); }
      else if (e.code === 'ArrowUp') { e.preventDefault(); shiftOct(1); }
      else if (e.code === 'ArrowDown') { e.preventDefault(); shiftOct(-1); }
      else if (e.code === 'Escape') { player.stop(); }
      else if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
        if (!e.repeat && !synth.sustainOn) { synth.setSustain(true); $('#sustainBtn').classList.add('on'); }
      }
    });
    window.addEventListener('keyup', function (e) {
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
        synth.setSustain(false); $('#sustainBtn').classList.remove('on');
      }
    });

    player.on('progress', function (pos) {
      if (!player.playing && player.song) {
        $('#progressFill').style.width = (player.duration ? pos / player.duration * 100 : 0) + '%';
        $('#timeNow').textContent = fmtTime(pos);
      }
    });
    player.on('noteOn', function (note) {
      kbd.highlight(note, true);
      state.lastNote = note;
      state.activeNotes.add(note);
    });
    player.on('noteOff', function (note) {
      state.activeNotes.delete(note);
      if (state.mode === 'song') kbd.highlight(note, false);
    });
    player.on('state', function (playing) {
      setPlayButton(playing);
    });
    player.on('ended', function () {
      kbd.clearHighlights();
      state.activeNotes.clear();
      state.mode = 'live';
    });
    player.on('alloff', function () {
      allNotesOffUI();
      synth.setSustain(false);
      $('#sustainBtn').classList.remove('on');
    });

    /* --- 自动尝试连接 MIDI --- */
    initMidi(false);
    loop();
  });

  let midiTried = false;

  /* ---------------- 对外接口（调试 / 自动化测试） ---------------- */
  window.PianoApp = {
    synth: synth,
    player: player,
    state: state,
    MidiFile: MidiFile,
    InstrumentLib: InstrumentLib,
    get keyboard() { return kbd; },
    get roll() { return roll; },
    noteOn: noteOn,
    noteOff: noteOff,
    selectInstrument: selectInstrument,
    loadDemo: loadDemo,
    loadMidiBuffer: loadMidiBuffer,
    exportMidi: exportMidi,
    ensureAudio: ensureAudio,
    gmProgramOf: gmProgramOf
  };

  function initMidi(userTriggered) {
    if (midiTried && !userTriggered) return;
    midiTried = true;
    PianoKeyboard.prototype.initMidi.call(kbd).then(function (res) {
      if (!res.ok) {
        const hint = $('#midiHint');
        if (res.reason === 'unsupported') hint.textContent = '当前浏览器不支持 Web MIDI（建议 Chrome / Edge）。屏幕键盘与电脑键盘不受影响。';
        else if (res.reason === 'insecure') hint.textContent = '需要 HTTPS 或 localhost 环境才能连接 MIDI 设备。';
        else hint.textContent = '未授权访问 MIDI 设备，点击「重新扫描」并允许权限。';
        refreshMidiUI([]);
        return;
      }
      refreshMidiUI(kbd.midiInputs, kbd.midiAccess ? kbd.midiAccess.outputs : null);
    });
  }

  function refreshMidiUI(inputs, outputs) {
    if (!inputs) inputs = kbd.midiInputs;
    const sel = $('#midiInSelect');
    const status = $('#midiStatus');
    const statusText = status.querySelector('span');
    const statusIcon = status.querySelector('use');
    sel.innerHTML = '';
    if (!inputs.length) {
      const o = document.createElement('option');
      o.textContent = '未检测到 MIDI 输入设备';
      sel.appendChild(o);
      statusText.textContent = 'MIDI 未连接';
      status.classList.remove('ok');
      statusIcon.setAttribute('href', '#i-midi');
    } else {
      inputs.forEach(function (i) {
        const o = document.createElement('option');
        o.value = i.id;
        o.textContent = (i.manufacturer || '') + ' ' + (i.name || 'MIDI 输入');
        sel.appendChild(o);
      });
      statusText.textContent = 'MIDI 已连接 · ' + inputs.length + ' 台';
      status.classList.add('ok');
      statusIcon.setAttribute('href', '#i-midi');
      if (!$('#midiHint').dataset.done) {
        $('#midiHint').dataset.done = '1';
        $('#midiHint').textContent = '已连接：' + inputs.map(function (i) { return i.name; }).join('、') + '。按键盘演奏即可自动使用当前音色。';
      }
    }
    const selOut = $('#midiOutSelect');
    selOut.innerHTML = '';
    const none = document.createElement('option');
    none.value = '';
    none.textContent = '不输出到外部设备';
    selOut.appendChild(none);
    if (outputs) {
      outputs.forEach(function (o) {
        const opt = document.createElement('option');
        opt.value = o.id;
        opt.textContent = o.name || 'MIDI 输出';
        selOut.appendChild(opt);
      });
    }
  }
})();
