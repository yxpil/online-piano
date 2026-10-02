/* ============================================================
 *  Player —— MIDI 多轨播放器（前瞻式调度）
 *  支持：每通道音色覆盖、轨道静音、进度拖动、变速
 * ============================================================ */
class Player {
  constructor(synth) {
    this.synth = synth;
    this.song = null;
    this.events = [];          // 绝对时间（秒）事件
    this.index = 0;
    this.playing = false;
    this.startCtxTime = 0;
    this.offset = 0;           // 起点（秒）
    this.duration = 0;
    this.rate = 1;
    this.lookahead = 0.35;     // 秒
    this.interval = 40;        // ms
    this._timer = null;
    this._listeners = {};
    this.channelPreset = {};   // 通道 → 音色 id（覆盖文件自带的）
    this.mutedTracks = {};
    this.mutedChannels = {};
  }

  on(evt, fn) { (this._listeners[evt] = this._listeners[evt] || []).push(fn); }
  _emit(evt, a, b) { (this._listeners[evt] || []).forEach(function (f) { f(a, b); }); }

  /* 载入已解析的 MIDI */
  load(midi) {
    this.stop();
    this.song = midi;
    this.offset = 0;
    this.duration = midi.duration;
    this.channelPreset = {};
    this.mutedTracks = {};
    this.mutedChannels = {};

    // 每通道默认音色：优先用文件内音色号，10 通道为打击乐
    Object.keys(midi.channels).forEach(function (chKey) {
      const ch = midi.channels[chKey];
      const self = this;
      self.channelPreset[ch.channel] = ch.isDrum ? 'drums' : InstrumentLib.gmToPreset(ch.program || 0);
    }, this);

    this._buildEvents();
    this._emit('loaded', midi);
    this._emit('progress', 0);
  }

  _buildEvents() {
    const midi = this.song;
    if (!midi) { this.events = []; return; }
    const evts = [];
    const muted = this.mutedChannels;
    const byIndex = {};
    (midi.tracks || []).forEach(function (t) { byIndex[t.index] = t; });
    midi.notes.forEach(function (n) {
      if (muted[n.channel]) return;
      const trk = byIndex[n.track];
      const trkIndex = trk ? trk.index : n.track;
      evts.push({ time: n.start, type: 'on', note: n.note, velocity: n.vel, channel: n.channel, track: trkIndex, dur: n.end - n.start });
      evts.push({ time: n.end, type: 'off', note: n.note, velocity: 0, channel: n.channel, track: trkIndex });
    });
    // 起始音色变更
    Object.keys(this.channelPreset).forEach(function (ch) {
      evts.push({ time: 0, type: 'prog', channel: +ch, program: this.channelPreset[ch] });
    }, this);
    // 文件内的延音踏板（CC64）
    (midi.sustain || []).forEach(function (s) {
      evts.push({ time: s.time, type: 'sustain', on: s.on });
    });
    evts.sort(function (a, b) {
      if (a.time !== b.time) return a.time - b.time;
      return (a.type === 'off' ? 0 : 1) - (b.type === 'off' ? 0 : 1);
    });
    this.events = evts;
  }

  setChannelPreset(ch, presetId) {
    this.channelPreset[ch] = presetId;
    this._buildEvents();
    this._emit('preset', ch, presetId);
  }

  setTrackMuted(trackIndex, muted) {
    this.mutedTracks[trackIndex] = !!muted;
    this._buildEvents();
  }

  setChannelMuted(ch, muted) {
    this.mutedChannels[ch] = !!muted;
    this._buildEvents();
    this._emit('preset', ch, this.channelPreset[ch]);
  }

  /* ---------- 播放控制 ---------- */
  play(from) {
    if (!this.song) return;
    if (this.playing) return;
    if (from != null) this.offset = Math.max(0, Math.min(this.duration, from));
    this.synth.resume();
    this.index = 0;
    // 定位到起点之后
    while (this.index < this.events.length && this.events[this.index].time < this.offset) this.index++;
    this.startCtxTime = this.synth.ctx.currentTime + 0.06;
    this.playing = true;
    this._tick();
    this._timer = setInterval(this._tick.bind(this), this.interval);
    this._emit('state', true);
  }

  pause() {
    if (!this.playing) return;
    const pos = this.position;
    this.stop(true);
    this.offset = pos;
    this._emit('progress', pos);
  }

  stop(keepPosition) {
    this.playing = false;
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
    this.synth.allNotesOff();
    this.synth.setSustain(false);   // 清除文件内 CC64 造成的延音残留
    if (!keepPosition) { this.offset = 0; this._emit('progress', 0); }
    this._emit('alloff');
    this._emit('state', false);
  }

  get position() {
    if (!this.playing) return this.offset;
    return this.offset + (this.synth.ctx.currentTime - this.startCtxTime);
  }

  seek(sec) {
    const wasPlaying = this.playing;
    this.stop(true);
    this.offset = Math.max(0, Math.min(this.duration, sec));
    this._emit('progress', this.offset);
    if (wasPlaying) this.play();
  }

  _tick() {
    if (!this.playing) return;
    const now = this.synth.ctx.currentTime;
    const base = this.startCtxTime;
    const limit = now + this.lookahead;
    while (this.index < this.events.length) {
      const e = this.events[this.index];
      const at = base + (e.time - this.offset);
      if (at > limit) break;
      this.index++;
      const when = Math.max(now, at);
      const presetId = this.channelPreset[e.channel] || 'grand';
      const preset = InstrumentLib.get(presetId);
      if (e.type === 'on') {
        const trk = this.song.tracks ? this.song.tracks.find(function (t) { return t.index === e.track; }) : null;
        if (!(trk && trk.muted)) {
          this.synth.noteOn(e.note, e.velocity, when, preset, e.channel);
          this._emit('noteOn', e.note, { channel: e.channel, preset: presetId, time: e.time, dur: e.dur, track: e.track });
        }
      } else if (e.type === 'off') {
        this.synth.noteOff(e.note, when, e.channel);
        this._emit('noteOff', e.note, { channel: e.channel });
      } else if (e.type === 'sustain') {
        this.synth.setSustain(e.on);
      }
    }
    const pos = this.position;
    this._emit('progress', pos);
    if (this.index >= this.events.length && pos > this.duration + 0.15) {
      this.stop();
      this.offset = 0;
      this._emit('ended');
    }
  }
}
