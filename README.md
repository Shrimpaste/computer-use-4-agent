# computer-use-4-agent

> 把 codex-computer-use 的桌面操控能力泛化为 agent 普适 skill。

## 一键安装

```bash
# 方式一：git clone（推荐）
git clone https://github.com/Shrimpaste/computer-use-4-agent.git ~/.claude/skills/computer-use

# 方式二：直接复制
cp -r computer-use-4-agent ~/.claude/skills/computer-use
```

**无需 Codex、无需任何前置 exe。** helper 已打包在 `bin/` 目录中，首次使用时自动启动。

## 快速开始

### 作为 Claude Code Skill

安装后直接使用 `/cu` 命令：

```
/cu list                           # 列出所有窗口
/cu screenshot Notepad shot.png    # 截图
/cu type Notepad "Hello"           # 输入文字
/cu send QQ 我的手机 hello          # 发消息
/cu file WeChat 文件传输助手 C:\x.xlsx  # 发文件
```

### 作为 Node.js 模块

```javascript
import { sendChatMessage, sendChatFile } from 'file:///~/.claude/skills/computer-use/scripts/chat-helper.mjs';
import { screenshotWindow, getWindowText } from 'file:///~/.claude/skills/computer-use/scripts/desktop-helper.mjs';

// 发消息
await sendChatMessage('QQ', '我的手机', 'hello');

// 发文件
await sendChatFile('WeChat', '文件传输助手', 'C:\\report.md');

// 截图
await screenshotWindow('Notepad', 'output.png');

// 读取窗口文本
const text = await getWindowText('Notepad');
```

### 作为 CLI 工具

```bash
node ~/.claude/skills/computer-use/scripts/cu.mjs list
node ~/.claude/skills/computer-use/scripts/cu.mjs screenshot Notepad
node ~/.claude/skills/computer-use/scripts/cu.mjs send QQ 我的手机 hello
```

## 前置条件

| 条件 | 说明 |
|------|------|
| Windows 10/11 | 仅支持 Windows |
| Node.js >= 18 | 运行脚本需要 |
| codex-computer-use.exe | **已打包在 bin/ 目录，自动启动** |

### 验证安装

```bash
node ~/.claude/skills/computer-use/scripts/cu.mjs list
# 应该输出当前所有窗口列表
```

## 让你的 Agent 连接此 Skill

### 方式一：Claude Code（推荐）

1. 将仓库克隆到 `~/.claude/skills/computer-use`
2. 在对话中使用 `/cu` 命令，agent 会自动调用 skill

### 方式二：任意 AI Agent

在你的 agent 代码中导入模块：

```javascript
// 1. 导入核心库
import { ComputerUse } from 'file:///path/to/computer-use/scripts/computer-use.mjs';

// 2. 建立连接（自动发现 helper 管道）
const cu = await ComputerUse.session();

// 3. 使用
const wins = await cu.listWindows();
await cu.activateWindow(wins[0]);
const state = await cu.getWindowState(wins[0], { screenshot: true });

// 4. 关闭
await cu.close();
```

### 方式三：CLI 集成

你的 agent 可以通过 shell 调用 CLI：

```bash
# 列出窗口
node /path/to/cu.mjs list

# 截图
node /path/to/cu.mjs screenshot Notepad output.png

# 发消息
node /path/to/cu.mjs send QQ contact "hello"

# 发文件
node /path/to/cu.mjs file WeChat contact "C:\file.md"
```

## 命令参考

```
/cu list                          列出所有窗口
/cu apps                          列出所有应用
/cu screenshot <query> [path]     截图
/cu text <query>                  读取窗口文本
/cu type <query> <text>           输入文字
/cu key <query> <key>             按键
/cu click <query> <index>         点击元素
/cu send <app> <contact> <msg>    发消息
/cu file <app> <contact> <path>   发文件
/cu open <app>                    启动应用
/cu wait <query> <condition>      等待条件
```

## 支持的应用

| 应用 | 文本消息 | 文件发送 | 截图 | 输入 | 点击 |
|------|:---:|:---:|:---:|:---:|:---:|
| QQ | ✅ | ✅ | ✅ | ✅ | ✅ |
| WeChat | ✅ | ✅ | ✅ | ✅ | ✅ |
| Steam | ✅ | — | ✅ | ✅ | ✅ |
| 任意应用 | — | — | ✅ | ✅ | ✅ |

## 已知局限

| 问题 | 说明 |
|------|------|
| Helper 进程不稳定 | 重试机制自动恢复 |
| 元素索引变化 | 每次操作前重新获取 state |
| 文件对话框难交互 | 用剪贴板粘贴替代 |
| 部分应用无无障碍树 | 用坐标点击替代 |
| 不支持浏览器 | 用 kimi-webbridge 替代 |

## License

MIT
