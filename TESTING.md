# online-piano 测试说明

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
