/* ============================================================
 *  PianoKeyboard —— 屏幕键盘（多点触控 / 鼠标滑奏）
 *  + 电脑 QWERTY 映射
 *  + Web MIDI 输入 / 输出
 * ============================================================ */
class PianoKeyboard {
  /**
   * @param {HTMLElement} container 键盘容器
   * @param {object} opts {startNote, octaves, onNoteOn, onNoteOff, getVelocity}
   */
  constructor(container, opts) {
    this.el = container;
    this.opts = opts || {};
    this.startNote = this.opts.startNote == null ? 36 : this.opts.startNote;   // C2
    this.octaves = this.opts.octaves || 4;
    this.whiteKeys = [];
    this.keyEls = {};              // note → element
    this.pointers = {};            // pointerId → {note, el}
    this.pressed = {};             // source+note → true
    this.keyboardMap = {};         // code → note offset
    this.octaveShift = 0;
    this.heldByComputer = {};
    this.midiAccess = null;
    this.midiInputs = [];
    this.midiOutput = null;
    this._build();
  }

  get firstNote() { return this.startNote + this.octaveShift * 12; }
  get lastNote() { return this.firstNote + this.octaves * 12 - 1; }

  /* ---------------- 构建 DOM ---------------- */
  _build() {
    const el = this.el;
    el.innerHTML = '';
    el.classList.add('piano');
    const totalWhite = this.octaves * 7;
    const WHITE_OFFSETS = [0, 2, 4, 5, 7, 9, 11];
    const BLACK_DEFS = [
      { offset: 1, afterWhite: 0 }, { offset: 3, afterWhite: 1 },
      { offset: 6, afterWhite: 3 }, { offset: 8, afterWhite: 4 }, { offset: 10, afterWhite: 5 }
    ];

    const whites = document.createElement('div');
    whites.className = 'keys-white';
    const blacks = document.createElement('div');
    blacks.className = 'keys-black';

    const base = this.firstNote;
    for (let o = 0; o < this.octaves; o++) {
      WHITE_OFFSETS.forEach(function (off, i) {
        const note = base + o * 12 + off;
        const k = document.createElement('div');
        k.className = 'key white';
        k.dataset.note = note;
        k.innerHTML = (off === 0 ? '<span class="klabel">' + MidiFile.nameOfNote(note) + '</span>' : '');
        whites.appendChild(k);
      });
    }
    // 黑键
    const whitePct = 100 / totalWhite;
    for (let o = 0; o < this.octaves; o++) {
      BLACK_DEFS.forEach(function (b) {
        const note = base + o * 12 + b.offset;
        const k = document.createElement('div');
        k.className = 'key black';
        k.dataset.note = note;
        const left = (o * 7 + b.afterWhite + 1) * whitePct;
        k.style.left = left + '%';
        k.style.width = (whitePct * 0.62) + '%';
        blacks.appendChild(k);
      });
    }
    el.appendChild(whites);
    el.appendChild(blacks);

    this.keyEls = {};
    Array.prototype.forEach.call(el.querySelectorAll('.key'), (k) => {
      this.keyEls[k.dataset.note] = k;
    });
    this._updateLabels();
  }

  _updateLabels() {
    const base = this.firstNote;
    this.el.querySelectorAll('.key.white').forEach(function (k) {
      const note = +k.dataset.note;
      const isC = note % 12 === 0;
      k.innerHTML = isC ? '<span class="klabel">' + MidiFile.nameOfNote(note) + '</span>' : '';
    });
  }

  setOctaveShift(n) {
    this.releaseAll();
    this.octaveShift = Math.max(-3, Math.min(3, n));
    this._build();
  }

  setRange(startNote, octaves) {
    this.releaseAll();
    this.startNote = startNote;
    this.octaves = octaves;
    this._build();
  }

  /* ---------------- 高点亮 ---------------- */
  highlight(note, on) {
    const el = this.keyEls[note];
    if (!el) return;
    if (on) el.classList.add('active');
    else if (!this._isNoteHeld(note)) el.classList.remove('active');
  }

  _isNoteHeld(note) {
    for (const k in this.pointers) if (this.pointers[k].note === note) return true;
    for (const k in this.heldByComputer) if (this.heldByComputer[k] === note) return true;
    return false;
  }

  clearHighlights() {
    Object.keys(this.keyEls).forEach((n) => this.keyEls[n].classList.remove('active'));
  }

  /* ---------------- 指针交互 ---------------- */
  attachPointer() {
    const el = this.el;
    const self = this;

    el.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      // 释放隐式指针捕获，使 elementFromPoint 能跨键滑动
      try { el.setPointerCapture(e.pointerId); } catch (err) { }
      const hit = self._hit(e.clientX, e.clientY);
      if (!hit) return;
      self.pointers[e.pointerId] = { note: hit.note, el: hit.el };
      self._press(hit.note, hit.velocity, 'touch');
    }, { passive: false });

    el.addEventListener('pointermove', function (e) {
      const p = self.pointers[e.pointerId];
      if (!p) return;
      e.preventDefault();
      const hit = self._hit(e.clientX, e.clientY);
      if (!hit) {
        const old = p.note;
        p.note = null;
        if (old != null) self._release(old, 'touch');
        return;
      }
      if (hit.note !== p.note) {
        const old = p.note;
        p.note = hit.note;                 // 先更新指针归属，再释放旧键，避免高亮残留
        if (old != null) self._release(old, 'touch');
        self._press(hit.note, hit.velocity, 'touch');
      } else {
        // 同一键上滑动：实时调整力度
        if (self.opts.forceVelocity) self.opts.forceVelocity(hit.note, hit.velocity, 'touch');
      }
    }, { passive: false });

    function up(e) {
      const p = self.pointers[e.pointerId];
      if (!p) return;
      const note = p.note;
      delete self.pointers[e.pointerId];
      if (note != null) self._release(note, 'touch');
    }
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('pointerleave', function (e) {
      const p = self.pointers[e.pointerId];
      if (p && p.note != null && e.pointerType === 'mouse') {
        const note = p.note;
        p.note = null;
        self._release(note, 'touch');
      }
    });
    // 阻止右键菜单 / 长按选择
    el.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  }

  _hit(x, y) {
    const el = document.elementFromPoint(x, y);
    if (!el) return null;
    const key = el.closest ? el.closest('.key') : null;
    if (!key || !this.el.contains(key)) return null;
    const r = key.getBoundingClientRect();
    const rel = Math.max(0, Math.min(1, (y - r.top) / r.height));
    // 触键位置越靠下 → 力度越大
    const velocity = 0.32 + 0.68 * rel;
    return { note: +key.dataset.note, el: key, velocity: velocity };
  }

  _press(note, vel, source) {
    this.highlight(note, true);
    if (this.opts.onNoteOn) this.opts.onNoteOn(note, vel, source);
  }

  _release(note, source) {
    if (this.opts.onNoteOff) this.opts.onNoteOff(note, source);
    if (!this._isNoteHeld(note)) {
      const el = this.keyEls[note];
      if (el) el.classList.remove('active');
    }
  }

  releaseAll() {
    const self = this;
    Object.keys(this.pointers).forEach(function (id) {
      const p = self.pointers[id];
      if (p.note != null) self._release(p.note, 'touch');
    });
    this.pointers = {};
    Object.keys(this.heldByComputer).forEach(function (code) {
      self._release(self.heldByComputer[code], 'kbd');
      delete self.heldByComputer[code];
    });
    this.clearHighlights();
  }

  /* ---------------- 电脑键盘 ---------------- */
  static get KEYMAP() {
    // 音名偏移：第 1 行为中音区，第 2 行为高八度
    return {
      'KeyZ': 0, 'KeyS': 1, 'KeyX': 2, 'KeyD': 3, 'KeyC': 4, 'KeyV': 5, 'KeyG': 6,
      'KeyB': 7, 'KeyH': 8, 'KeyN': 9, 'KeyJ': 10, 'KeyM': 11,
      'Comma': 12, 'KeyL': 13, 'Period': 14, 'Semicolon': 15, 'Slash': 16,
      'KeyQ': 12, 'Digit2': 13, 'KeyW': 14, 'Digit3': 15, 'KeyE': 16, 'KeyR': 17, 'Digit5': 18,
      'KeyT': 19, 'Digit6': 20, 'KeyY': 21, 'Digit7': 22, 'KeyU': 23,
      'KeyI': 24, 'Digit9': 25, 'KeyO': 26, 'Digit0': 27, 'KeyP': 28, 'BracketLeft': 29,
      'BracketRight': 30, 'Equal': 31
    };
  }

  attachComputerKeyboard(velocity) {
    const self = this;
    const baseOffset = 12;   // 电脑键盘最低音比键盘左端高一个八度
    function down(e) {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      const tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      const off = PianoKeyboard.KEYMAP[e.code];
      if (off == null) return;
      e.preventDefault();
      const note = self.startNote + 12 + off;
      if (self.heldByComputer[e.code]) return;
      self.heldByComputer[e.code] = note;
      self._press(note, velocity == null ? 0.82 : velocity, 'kbd');
    }
    function up(e) {
      const note = self.heldByComputer[e.code];
      if (note == null) return;
      delete self.heldByComputer[e.code];
      self._release(note, 'kbd');
    }
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', function () { self.releaseAll(); });
  }

  /* ---------------- Web MIDI ---------------- */
  async initMidi() {
    if (!navigator.requestMIDIAccess) {
      return { ok: false, reason: 'unsupported' };
    }
    try {
      const access = await navigator.requestMIDIAccess({ sysex: false });
      this.midiAccess = access;
      const self = this;
      access.onstatechange = function () { self._refreshMidiPorts(); };
      this._refreshMidiPorts();
      return { ok: true, inputs: this.midiInputs.length };
    } catch (err) {
      return { ok: false, reason: err && err.name === 'SecurityError' ? 'insecure' : 'denied', error: err };
    }
  }

  _refreshMidiPorts() {
    if (!this.midiAccess) return;
    const self = this;
    this.midiInputs = [];
    this.midiAccess.inputs.forEach(function (inp) {
      self.midiInputs.push(inp);
      inp.onmidimessage = function (ev) { self._onMidiMessage(ev); };
      inp.open && inp.open();
    });
    if (this._onPortsChanged) this._onPortsChanged(this.midiInputs, this.midiAccess.outputs);
  }

  _onMidiMessage(ev) {
    const d = ev.data;
    if (!d || d.length < 2) return;
    const status = d[0];
    const type = status & 0xf0;
    const ch = status & 0x0f;
    if (type === 0x90 && d[2] > 0) {
      this._press(d[1], d[2] / 127, 'midi');
    } else if (type === 0x80 || (type === 0x90 && d[2] === 0)) {
      this._release(d[1], 'midi');
    } else if (type === 0xb0) {
      if (d[1] === 64) { this._onSustain && this._onSustain(d[2] >= 64); }
      else if (d[1] === 123 || d[1] === 120) { this.releaseAll(); this._onAllOff && this._onAllOff(); }
    } else if (type === 0xe0) {
      const bend = ((d[2] << 7) | d[1]) - 8192;
      this._onPitchBend && this._onPitchBend(bend / 8192);
    }
  }

  selectMidiOutput(id) {
    if (!this.midiAccess) return;
    let out = null;
    this.midiAccess.outputs.forEach(function (o) { if (o.id === id) out = o; });
    this.midiOutput = out;
  }

  sendMidi(bytes) {
    if (!this.midiOutput) return;
    try { this.midiOutput.send(bytes); } catch (e) { }
  }
}
