---
name: computer-use
description: >
  Windows desktop automation via /cu command. Control any app — screenshots,
  typing, clicking, chat messages, file sending. Use when user says "desktop",
  "screenshot", "open app", "send message", "automate", or invokes /cu.
---

# /cu — Windows Desktop Automation

Control any Windows application from the command line.

## Command Reference

### Discovery
```
/cu list                    List all visible windows
/cu apps                    List all registered apps
```

### Observe
```
/cu tree <query>            Print accessibility tree of a window
/cu screenshot <query> [path]   Take screenshot (default: temp.png)
/cu text <query>            Read all text from a window
```

### Interact
```
/cu type <query> <text>     Type text into a window
/cu key <query> <key>       Press a key (e.g. Return, Escape, Control_L+s)
/cu click <query> <index>   Click element by index from tree
```

### Chat Messaging
```
/cu send <app> <contact> <message>    Send text message
/cu file <app> <contact> <path>       Send file
```
Apps: QQ, WeChat, Steam

### Wait & Dialog
```
/cu wait <query> <condition> [--timeout 30000]    Wait for condition
/cu detect <query> <rules-json>                    Detect dialog
```

### Launch
```
/cu open <app-or-path>      Launch an application
```

## Query Format

`<query>` matches window titles or app names (case-insensitive):
- `Notepad` — any window with "Notepad" in title
- `[12345]` — exact window id
- `process:C:\path\app.exe` — match by executable

## Examples

```
/cu list
/cu screenshot Notepad ~/desktop/shot.png
/cu type Notepad "Hello World"
/cu key Notepad Return
/cu send QQ 我的手机 hello
/cu file WeChat 文件传输助手 C:\report.md
/cu wait Notepad "text appears" --timeout 10000
/cu open excel
```

## Key Names

X11 keysym: `a` `space` `Return` `Escape` `Tab` `Control_L+a` `Alt_L+F4`

## Prerequisites

- Windows 10/11, Node.js >= 18
- Helper auto-starts from `bin/codex-computer-use.exe` (bundled)
- Or with Codex: `Get-Process codex-computer-use`
