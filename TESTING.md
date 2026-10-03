# online-piano 测试说明
- 测试完成：是（2026-10-04）
- 测试日期：2026-10-04
- 测试内容：单元测试覆盖 js/midi-file.js 的 nameOfNote 音名转换、write 导出 MThd/MTrk 头与多轨生成、js/synth.js 的 PianoSynth.freq 频率计算；注入测试覆盖截断 MIDI 文件不崩溃、恶意 note 值（负数/超大）位掩码处理；钩子/集成测试覆盖 write→parse 往返一致性、无效文件头异常、速度时长信息解析、多通道导出轨道数
- 运行命令：npm test
- 测试框架：node:test（Node.js 内置测试运行器）
- 模型：豆包（Doubao）生成

## 测试目录

| 文件 | 说明 |
|------|------|
| `tests/midi.test.js` | MidiFile 解析/导出往返 + 频率计算 + 恶意数据注入测试 |

## 运行方式

```bash
npm test
```

## 覆盖说明

### 单元测试（6 个）
- nameOfNote 音名转换（C4/A4/升号/低八度）
- write 生成 MThd/MTrk 头、多通道多轨、空事件安全
- PianoSynth.freq A4=440Hz、半音频率比

### 注入测试（2 个）
- 截断 MIDI 文件不崩溃
- 恶意 note 值（负数/超大）被位掩码处理

### 钩子/交互测试（4 个）
- write→parse 往返音符数一致
- 无效文件头正确抛异常
- parse 速度/时长信息正确
- 多通道导出轨道数正确

## 预期结果：12 个用例全部通过
