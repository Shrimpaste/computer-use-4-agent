---
name: computer-use
description: Control any Windows desktop application - click buttons, type text, read screen content, take screenshots, navigate menus. Use when the user asks to interact with a Windows app, automate a desktop GUI, take a screenshot of a window, or control any Windows program through its UI.
---

# Windows Computer Use

Automate any Windows application through UI Automation, SendInput, and window screenshots.

## Prerequisites

Helper process must be running:

```powershell
Get-Process codex-computer-use -ErrorAction SilentlyContinue
```

If not running:

```powershell
$exe = Get-ChildItem "$env:USERPROFILE\.codex\plugins\cache\openai-bundled\computer-use\*\node_modules\@oai\sky\bin\windows\codex-computer-use.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
if ($exe) { Start-Process $exe.FullName -WindowStyle Hidden }
```

## Quick Reference

### CLI Commands

All commands use `<skill-root>/scripts/computer-use.mjs`:

```powershell
# Discovery
node <skill-root>/scripts/computer-use.mjs list-windows
node <skill-root>/scripts/computer-use.mjs list-apps

# Observe
node <skill-root>/scripts/computer-use.mjs tree <query>
node <skill-root>/scripts/computer-use.mjs screenshot <query> [out.png]
node <skill-root>/scripts/computer-use.mjs state <query>

# Interact
node <skill-root>/scripts/computer-use.mjs activate <query>
node <skill-root>/scripts/computer-use.mjs click <query> <elementIndex>
node <skill-root>/scripts/computer-use.mjs click-xy <query> <x> <y>
node <skill-root>/scripts/computer-use.mjs type <query> <text>
node <skill-root>/scripts/computer-use.mjs key <query> <key>

# Launch
node <skill-root>/scripts/computer-use.mjs launch <appId-or-exe-path>
```

### Module API (recommended for multi-step)

```javascript
import { ComputerUse } from 'file:///<skill-root>/scripts/computer-use.mjs';
const cu = await ComputerUse.session();
const wins = await cu.listWindows();
const win = ComputerUse.findWindow(wins, 'Notepad');
await cu.activateWindow(win);
const state = await cu.getWindowState(win, { text: true, screenshot: true });
await cu.click(win, { element_index: 2 });
await cu.typeText(win, 'Hello!');
await cu.pressKey(win, 'Return');
await cu.close();
```

## Workflow

1. **Discover** - `list-windows` to find the target
2. **Activate** - `activate <query>` to bring to foreground
3. **Observe** - `state <query>` for accessibility tree + screenshot
4. **Act** - `click`, `type`, `key` using element indexes from tree
5. **Verify** - `state` again to confirm

**Always call `state` before clicking.** Element indexes change when UI updates.

## Query Format

`<query>` matches window titles and app names (case-insensitive substring):
- `Notepad` - any window with "Notepad" in title
- `[12345]` - exact window-id match
- `process:C:\path\to\app.exe` - match by executable path

## Key Names

X11 keysym-style, +-separated for chords: `a` `space` `Return` `Escape` `Tab` `Control_L+a` `Alt_L+F4`

## Chat App Messaging

Chat apps use custom renderers (TextInputHost.exe) that block direct `typeText`. Use the chat helper:

```javascript
import { sendChatMessage, sendChatFile } from 'file:///<skill-root>/scripts/chat-helper.mjs';

// Send text
await sendChatMessage('QQ', 'contact', 'hello');
await sendChatMessage('Steam', 'Shrimpaste', 'test');
await sendChatMessage('WeChat', 'contact', 'hi');

// Send file
await sendChatFile('QQ', 'contact', 'C:\\report.md');
await sendChatFile('WeChat', 'contact', 'C:\\file.pdf');
```

### Supported Apps

| App | Window Match | Open Chat | Input | File Send |
|-----|-------------|-----------|-------|-----------|
| QQ | `qq.exe` + "QQ" | Search or session list | Clipboard + toolbar Down | Tree find + fallback coords |
| Steam | "好友列表" | Double-click avatar | Clipboard + toolbar Down | Not supported |
| WeChat | "微信" + Weixin.exe | Coordinate search | Clipboard + DPI-scaled coords | DPI-scaled coords |

### App-Specific Notes

- **QQ**: Single-click = context menu. Use session list or search. File icon via tree with (380,580) fallback.
- **Steam**: Single-click = context menu. Double-click avatar (element+1) to open chat.
- **WeChat**: Minimal accessibility tree. All interaction is coordinate-based. DPI-aware. Post-login: click "enter WeChat" first.

### Gotchas

- Each CLI call = new connection. Use module API for multi-step.
- Window may minimize between calls. Always activate first.
- Browser windows blocked by URL policy. Non-browser apps always work.
- Fullscreen apps block screenshots. Minimize with `key Escape` first.
- WeChat coordinates assume 1920x1080 base, auto-scaled for DPI.

## General Desktop Automation

Use the desktop helper for one-liner automation of any Windows app:

```javascript
import { screenshotWindow, typeInWindow, pressInWindow, clickInWindow, getWindowText, listWindows, getTree } from 'file:///<skill-root>/scripts/desktop-helper.mjs';

// Screenshot any window
await screenshotWindow('Clash Verge', 'output.png');

// Type in any app
await typeInWindow('Notepad', 'Hello World');

// Press keys (media controls, shortcuts, etc.)
await pressInWindow('NetEase Cloud Music', 'space');  // Play/pause
await pressInWindow('Notepad', 'Control_L+s');         // Save

// Click elements by index (get index from getTree first)
await clickInWindow('Clash Verge', 26);  // Toggle switch

// Read text content from any window
const text = await getWindowText('Notepad');

// List all windows
const wins = await listWindows();

// Get accessibility tree (for finding element indexes)
const tree = await getTree('Clash Verge');
```

### Workflow Examples

**Media control:**
```javascript
await pressInWindow('CloudMusic', 'space');      // Play/pause
await pressInWindow('CloudMusic', 'Right');       // Forward 5s
```

**File management (via Explorer):**
```javascript
await typeInWindow('Explorer', 'C:\\Users\\Lenovo\\Desktop');
await pressInWindow('Explorer', 'Return');
```

**System settings:**
```javascript
const tree = await getTree('Settings');
// Find toggle element index from tree, then:
await clickInWindow('Settings', toggleIdx);
```

## Wait & Dialog Detection

### waitUntil — Poll until condition is met

```javascript
import { ComputerUse } from 'file:///<skill-root>/scripts/computer-use.mjs';
const cu = await ComputerUse.session();

// Wait for a dialog to appear
const state = await cu.waitUntil(win, (s) => {
  return s.accessibility?.tree?.includes('确认');
}, { timeout: 10000, interval: 500, description: '确认对话框' });

// Wait for window to finish loading
await cu.waitUntil(win, (s) => {
  return (s.accessibility?.document_text || '').length > 100;
}, { timeout: 30000, description: '页面加载完成' });
```

Options: `{ timeout, interval, description, includeScreenshot, signal }`

### detectDialog — Match rules against accessibility tree

```javascript
const match = await cu.detectDialog(win, [
  {
    id: 'file-overwrite',
    match: { content: '是否覆盖' },
    action: { type: 'click', label: '是' },
  },
  {
    id: 'uac',
    match: { title: '用户帐户控制' },
    action: { type: 'report' },  // Don't auto-click, report to caller
  },
]);
if (match) {
  console.log(`Matched: ${match.rule.id}, element: ${match.elementIndex}`);
}
```

Match conditions: `{ title, content, custom(state) }` — supports string substring and RegExp.
Action types: `click` (find button by label), `press` (send key), `report` (return for caller), `ignore`.

### waitUntilWithDialog — Wait + auto-handle

```javascript
const result = await cu.waitUntilWithDialog(win, [
  {
    id: 'overwrite',
    match: { content: '是否覆盖' },
    action: { type: 'click', label: '是' },
  },
], { timeout: 15000, description: '文件覆盖确认' });
// Automatically clicked "是" when dialog appeared
```

### Convenience wrappers (desktop-helper.mjs)

```javascript
import { waitForWindow, detectDialogInWindow } from 'file:///<skill-root>/scripts/desktop-helper.mjs';

await waitForWindow('Notepad', (s) => s.accessibility?.tree?.includes('Save'), { timeout: 5000 });
const match = await detectDialogInWindow('MyApp', [{ id: 'x', match: { content: 'OK' }, action: { type: 'click', label: 'OK' } }]);
```

## Error Handling

The helpers include automatic retry (2 retries, 1s delay). For custom workflows:

```javascript
async function withRetry(fn, retries = 2) {
  for (let i = 0; i <= retries; i++) {
    try { return await fn(); }
    catch (err) { if (i === retries) throw err; await sleep(1000); }
  }
}
```
