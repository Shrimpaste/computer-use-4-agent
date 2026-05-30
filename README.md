# computer-use-4-agent

Windows desktop automation for AI agents. Control any application — click, type, read screen, send messages, transfer files.

## Features

- **Universal** — Works with any Windows app (QQ, WeChat, Steam, Notepad, etc.)
- **Chat messaging** — Send texts and files via QQ, Steam, WeChat
- **Desktop automation** — Screenshots, typing, clicking, key presses
- **DPI-aware** — Auto-scales coordinates for different screen resolutions
- **Retry logic** — Automatic retry on transient failures

## Quick Start

### As a Claude Code Skill

```bash
# Copy to your skills directory
cp -r computer-use-4-agent ~/.claude/skills/computer-use
```

### Prerequisites

- Windows 10/11
- Node.js >= 18
- `codex-computer-use.exe` helper process running

### Send a Message

```javascript
import { sendChatMessage } from './scripts/chat-helper.mjs';
await sendChatMessage('QQ', 'contact', 'Hello!');
await sendChatMessage('WeChat', 'contact', 'Hi!');
```

### Send a File

```javascript
import { sendChatFile } from './scripts/chat-helper.mjs';
await sendChatFile('WeChat', 'contact', 'C:\\report.md');
```

### Screenshot Any Window

```javascript
import { screenshotWindow } from './scripts/desktop-helper.mjs';
await screenshotWindow('Notepad', 'output.png');
```

### Read Window Text

```javascript
import { getWindowText } from './scripts/desktop-helper.mjs';
const text = await getWindowText('Notepad');
```

## Supported Apps

| App | Text Message | File Send | Screenshot | Type | Click |
|-----|:---:|:---:|:---:|:---:|:---:|
| QQ | ✅ | ✅ | ✅ | ✅ | ✅ |
| WeChat | ✅ | ✅ | ✅ | ✅ | ✅ |
| Steam | ✅ | — | ✅ | ✅ | ✅ |
| Any app | — | — | ✅ | ✅ | ✅ |

## Modules

| Module | Purpose |
|--------|---------|
| `computer-use.mjs` | Core library — window management, screenshots, accessibility tree |
| `chat-helper.mjs` | Chat app messaging and file sending |
| `desktop-helper.mjs` | General desktop automation workflows |

## Architecture

```
computer-use-4-agent/
├── SKILL.md              # Claude Code skill definition
├── scripts/
│   ├── computer-use.mjs  # Core library (named pipe IPC)
│   ├── chat-helper.mjs   # Chat app workflows
│   └── desktop-helper.mjs # General automation
├── README.md
├── LICENSE
└── package.json
```

## How It Works

1. **computer-use.mjs** communicates with `codex-computer-use.exe` via Windows named pipe
2. The helper process uses UI Automation and SendInput to control the desktop
3. **chat-helper.mjs** adds clipboard paste (bypasses TextInputHost.exe) and app-specific workflows
4. **desktop-helper.mjs** provides composable building blocks for any automation task

## License

MIT
