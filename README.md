# computer-use-4-agent

> 把 codex-computer-use 的桌面操控能力泛化为 agent 普适 skill。

## 安装

```bash
# 方式一：直接复制
cp -r computer-use-4-agent ~/.claude/skills/computer-use

# 方式二：git clone
git clone https://github.com/yourname/computer-use-4-agent.git ~/.claude/skills/computer-use
```

### 前置条件

- Windows 10/11
- Node.js >= 18
- `codex-computer-use.exe` 运行中（随 Codex 桌面端安装）

```powershell
# 检查 helper 是否运行
Get-Process codex-computer-use -ErrorAction SilentlyContinue
```

## 快速使用

### 发消息

```javascript
import { sendChatMessage } from 'file:///~/.claude/skills/computer-use/scripts/chat-helper.mjs';

await sendChatMessage('QQ', '我的手机', 'hello');
await sendChatMessage('WeChat', '文件传输助手', 'hi');
await sendChatMessage('Steam', 'Shrimpaste', 'test');
```

### 发文件

```javascript
import { sendChatFile } from 'file:///~/.claude/skills/computer-use/scripts/chat-helper.mjs';

await sendChatFile('QQ', '我的手机', 'C:\\report.md');
await sendChatFile('WeChat', '文件传输助手', 'C:\\file.xlsx');
```

### 截图 / 读取 / 点击

```javascript
import { screenshotWindow, getWindowText, typeInWindow, pressInWindow } from 'file:///~/.claude/skills/computer-use/scripts/desktop-helper.mjs';

await screenshotWindow('Notepad', 'output.png');
const text = await getWindowText('Notepad');
await typeInWindow('Notepad', 'Hello World');
await pressInWindow('NetEase Cloud Music', 'space');  // 播放/暂停
```

### 等待 + 弹窗处理

```javascript
import { ComputerUse } from 'file:///~/.claude/skills/computer-use/scripts/computer-use.mjs';
const cu = await ComputerUse.session();

// 等待条件满足
await cu.waitUntil(win, (s) => s.accessibility?.tree?.includes('确认'), { timeout: 10000 });

// 检测并处理弹窗
await cu.detectDialog(win, [
  { id: 'overwrite', match: { content: '是否覆盖' }, action: { type: 'click', label: '是' } },
  { id: 'uac', match: { title: '用户帐户控制' }, action: { type: 'report' } },
]);
```

## 支持的应用

| 应用 | 文本消息 | 文件发送 | 截图 | 输入 | 点击 |
|------|:---:|:---:|:---:|:---:|:---:|
| QQ | ✅ | ✅ | ✅ | ✅ | ✅ |
| WeChat | ✅ | ✅ | ✅ | ✅ | ✅ |
| Steam | ✅ | — | ✅ | ✅ | ✅ |
| 任意应用 | — | — | ✅ | ✅ | ✅ |

## 模块说明

| 模块 | 职责 |
|------|------|
| `computer-use.mjs` | 核心库：窗口管理、无障碍树、截图、waitUntil、detectDialog |
| `chat-helper.mjs` | 聊天软件：消息发送、文件传输（QQ/Steam/WeChat） |
| `desktop-helper.mjs` | 通用自动化：截图、输入、按键、点击、读取文本 |

## 设计理念

### 泛化目标

codex-computer-use 的原始接口面向单一应用（Codex CLI）。本插件将其泛化为**任何 agent 可调用的桌面操控 skill**：

- **统一接口** — `sendChatMessage('QQ', 'contact', 'msg')` 一行代码完成
- **应用无关** — 同一套 API 操控 QQ、WeChat、Steam、记事本、Excel...
- **组合式** — 原语可任意组合：搜索→截图→分析→发送

### 技术决策

| 决策 | 理由 |
|------|------|
| 剪贴板粘贴替代 typeText | TextInputHost.exe 拦截键盘输入 |
| 坐标点击替代无障碍树 | WeChat 等应用无障碍树极简 |
| DPI 自适应 | 不同分辨率屏幕坐标自动缩放 |
| 重试机制 | Helper 进程不稳定，自动恢复 |
| PS1 脚本设置剪贴板 | Bash shell 吃掉反斜杠 |

## 已知局限

**诚实地说，这个插件基于 codex-computer-use.exe，存在以下根本性限制：**

| 问题 | 影响 | 规避方式 |
|------|------|---------|
| Helper 进程不稳定 | 操作中途可能崩溃 | 重试机制自动恢复 |
| 元素索引变化 | UI 更新后索引失效 | 每次操作前重新获取 state |
| 文件对话框难交互 | 独立窗口，坐标偏移 | 用剪贴板粘贴替代 |
| 部分应用无无障碍树 | QQ 输入框、WeChat 内容 | 用坐标点击替代 |
| 截图不含覆盖层 | "Agent is using..." 不在截图中 | 这是设计如此（安全特性） |
| 不支持浏览器 | URL 策略拦截 | 用 kimi-webbridge 替代 |

**核心瓶颈是 codex-computer-use.exe 的稳定性。** 所有上层优化都是在绕过它的缺陷。如果需要更可靠的桌面自动化，建议评估 pywinauto 或 AutoIt 方案。

## 架构

```
computer-use-4-agent/
├── SKILL.md              # Claude Code skill 定义
├── scripts/
│   ├── computer-use.mjs  # 核心库（named pipe IPC）
│   ├── chat-helper.mjs   # 聊天软件工作流
│   └── desktop-helper.mjs # 通用自动化
├── README.md
├── LICENSE               # MIT
└── package.json
```

## 工作原理

1. `computer-use.mjs` 通过 Windows named pipe 与 `codex-computer-use.exe` 通信（JSON-RPC 2.0）
2. Helper 进程使用 UI Automation 和 SendInput 控制桌面
3. `chat-helper.mjs` 增加剪贴板粘贴（绕过 TextInputHost.exe）和应用特定工作流
4. `desktop-helper.mjs` 提供可组合的自动化构建块

## License

MIT
