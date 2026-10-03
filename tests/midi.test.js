// online-piano MidiFile 解析/导出 + 频率计算测试
// 运行: node --test --test-force-exit tests/midi.test.js
'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// 加载 midi-file.js（自包含 IIFE，const MidiFile 在 eval 作用域内）
const midiSrc = fs.readFileSync(path.join(__dirname, '..', 'js', 'midi-file.js'), 'utf8');
const MidiFile = eval(midiSrc + '; MidiFile;');

describe('音符名称转换', () => {
  test('nameOfNote 标准音名', () => {
    assert.strictEqual(MidiFile.nameOfNote(60), 'C4');
    assert.strictEqual(MidiFile.nameOfNote(69), 'A4');
    assert.strictEqual(MidiFile.nameOfNote(0), 'C-1');
    assert.strictEqual(MidiFile.nameOfNote(12), 'C0');
  });

  test('nameOfNote 升号', () => {
    assert.strictEqual(MidiFile.nameOfNote(61), 'C#4');
    assert.strictEqual(MidiFile.nameOfNote(70), 'A#4');
  });
});

describe('MIDI 导出 write', () => {
  test('write 生成有效 MThd/MTrk 头', () => {
    const events = [
      { time: 0, type: 'on', channel: 0, note: 60, velocity: 0.8 },
      { time: 0.5, type: 'off', channel: 0, note: 60 },
    ];
    const bytes = MidiFile.write(events, { ppq: 480, bpm: 120 });
    assert.ok(bytes instanceof Uint8Array);
    // MThd 头
    const header = String.fromCharCode(...bytes.subarray(0, 4));
    assert.strictEqual(header, 'MThd');
  });

  test('write 多个通道生成多轨', () => {
    const events = [
      { time: 0, type: 'on', channel: 0, note: 60, velocity: 0.8 },
      { time: 0, type: 'on', channel: 1, note: 64, velocity: 0.8 },
    ];
    const bytes = MidiFile.write(events, { ppq: 480, bpm: 120 });
    // MThd 后应有 header length + format + ntrks + division
    const ntrks = (bytes[10] << 8) | bytes[11];
    assert.ok(ntrks >= 2); // 至少速度轨 + 2个通道
  });

  test('write 空事件不崩溃', () => {
    const bytes = MidiFile.write([], { ppq: 480, bpm: 120 });
    assert.ok(bytes instanceof Uint8Array);
    assert.ok(bytes.length > 0);
  });
});

describe('MIDI 解析 parse（往返测试）', () => {
  test('write → parse 往返：音符数一致', () => {
    const events = [
      { time: 0, type: 'on', channel: 0, note: 60, velocity: 0.8 },
      { time: 0.5, type: 'off', channel: 0, note: 60 },
      { time: 1.0, type: 'on', channel: 0, note: 64, velocity: 0.6 },
      { time: 1.5, type: 'off', channel: 0, note: 64 },
    ];
    const bytes = MidiFile.write(events, { ppq: 480, bpm: 120 });
    const parsed = MidiFile.parse(bytes.buffer);
    assert.ok(parsed.notes.length >= 2);
    const notes = parsed.notes.map(n => n.note).sort();
    assert.deepStrictEqual(notes, [60, 64]);
  });

  test('parse 无效文件头抛异常', () => {
    const bad = new Uint8Array([0x00, 0x01, 0x02, 0x03]).buffer;
    assert.throws(() => MidiFile.parse(bad), /MIDI/);
  });

  test('parse 速度信息正确', () => {
    const events = [
      { time: 0, type: 'on', channel: 0, note: 60, velocity: 0.8 },
      { time: 1, type: 'off', channel: 0, note: 60 },
    ];
    const bytes = MidiFile.write(events, { ppq: 480, bpm: 120, name: 'Test' });
    const parsed = MidiFile.parse(bytes.buffer);
    assert.ok(parsed.duration > 0);
    assert.ok(parsed.ppq === 480);
  });
});

describe('频率计算（synth.freq 静态方法）', () => {
  test('PianoSynth.freq A4 = 440Hz', () => {
    const synthSrc = fs.readFileSync(path.join(__dirname, '..', 'js', 'synth.js'), 'utf8');
    const AC = eval(synthSrc + '; PianoSynth;');
    assert.strictEqual(AC.freq(69), 440);
    assert.strictEqual(AC.freq(57), 220); // A3
  });

  test('freq 半音频率比为 2^(1/12)', () => {
    const synthSrc = fs.readFileSync(path.join(__dirname, '..', 'js', 'synth.js'), 'utf8');
    const AC = eval(synthSrc + '; PianoSynth;');
    const ratio = AC.freq(70) / AC.freq(69);
    assert.ok(Math.abs(ratio - Math.pow(2, 1 / 12)) < 0.01);
  });
});

describe('注入测试：恶意 MIDI 数据不崩溃', () => {
  test('parse 截断的 MIDI 文件不崩溃', () => {
    // 只写 MThd 头但没有 MTrk
    const bytes = new Uint8Array(14);
    bytes.set([0x4d, 0x54, 0x68, 0x64], 0); // MThd
    bytes.set([0, 0, 0, 6], 4); // header len = 6
    bytes.set([0, 0, 0, 1, 0, 0], 8); // format=0, ntrks=1, division=0
    // 没有 MTrk 数据
    assert.doesNotThrow(() => {
      const parsed = MidiFile.parse(bytes.buffer);
      assert.strictEqual(parsed.notes.length, 0);
    });
  });

  test('write 恶意 note 值（负数/超大）被掩码处理', () => {
    const events = [
      { time: 0, type: 'on', channel: 0, note: -100, velocity: 0.8 },
      { time: 0.1, type: 'off', channel: 0, note: -100 },
      { time: 0.2, type: 'on', channel: 0, note: 999, velocity: 0.8 },
      { time: 0.3, type: 'off', channel: 0, note: 999 },
    ];
    const bytes = MidiFile.write(events, { ppq: 480, bpm: 120 });
    assert.ok(bytes.length > 0);
  });
});
