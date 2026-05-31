#!/usr/bin/env node
/**
 * cu.mjs — CLI entry point for /cu commands.
 *
 * Usage:
 *   node cu.mjs list
 *   node cu.mjs screenshot Notepad output.png
 *   node cu.mjs send QQ 我的手机 hello
 *   node cu.mjs file WeChat 文件传输助手 C:\report.md
 */

import { ComputerUse } from './computer-use.mjs';
import { sendChatMessage, sendChatFile } from './chat-helper.mjs';
import { screenshotWindow, getWindowText, typeInWindow, pressInWindow, listWindows } from './desktop-helper.mjs';
import { execSync } from 'node:child_process';

const [,, cmd, ...args] = process.argv;

async function main() {
  switch (cmd) {
    case 'list': {
      const wins = await listWindows();
      for (const w of wins) {
        console.log(`[${w.id}] ${w.title || '(untitled)'} — ${w.app?.split('\\').pop() || ''}`);
      }
      break;
    }

    case 'screenshot': {
      const query = args[0];
      const path = args[1] || `cu-screenshot-${Date.now()}.png`;
      if (!query) { console.error('Usage: cu screenshot <query> [path]'); process.exit(1); }
      const saved = await screenshotWindow(query, path);
      console.log(`Saved: ${saved}`);
      break;
    }

    case 'text': {
      const query = args[0];
      if (!query) { console.error('Usage: cu text <query>'); process.exit(1); }
      const text = await getWindowText(query);
      console.log(text || '(no text)');
      break;
    }

    case 'type': {
      const query = args[0];
      const text = args.slice(1).join(' ');
      if (!query || !text) { console.error('Usage: cu type <query> <text>'); process.exit(1); }
      await typeInWindow(query, text);
      console.log(`Typed in ${query}`);
      break;
    }

    case 'key': {
      const query = args[0];
      const key = args[1];
      if (!query || !key) { console.error('Usage: cu key <query> <key>'); process.exit(1); }
      await pressInWindow(query, key);
      console.log(`Pressed ${key} in ${query}`);
      break;
    }

    case 'send': {
      const [app, contact, ...msgParts] = args;
      const message = msgParts.join(' ');
      if (!app || !contact || !message) { console.error('Usage: cu send <app> <contact> <message>'); process.exit(1); }
      await sendChatMessage(app, contact, message);
      console.log(`Sent to ${contact} on ${app}`);
      break;
    }

    case 'file': {
      const [app, contact, filePath] = args;
      if (!app || !contact || !filePath) { console.error('Usage: cu file <app> <contact> <path>'); process.exit(1); }
      await sendChatFile(app, contact, filePath);
      console.log(`File sent to ${contact} on ${app}`);
      break;
    }

    case 'open': {
      const target = args[0];
      if (!target) { console.error('Usage: cu open <app-or-path>'); process.exit(1); }
      const cu = await ComputerUse.session();
      try {
        await cu.launchApp(target);
        console.log(`Launched: ${target}`);
      } finally {
        await cu.close();
      }
      break;
    }

    case 'wait': {
      const query = args[0];
      const condition = args[1];
      const timeoutMatch = args.find(a => a.startsWith('--timeout'));
      const timeout = timeoutMatch ? parseInt(args[args.indexOf(timeoutMatch) + 1]) || 30000 : 30000;
      if (!query || !condition) { console.error('Usage: cu wait <query> <condition> [--timeout ms]'); process.exit(1); }
      const cu = await ComputerUse.session();
      try {
        const wins = await cu.listWindows();
        const win = ComputerUse.findWindow(wins, query);
        if (!win) throw new Error(`Window "${query}" not found`);
        await cu.waitUntil(win, (s) => {
          const tree = s.accessibility?.tree || '';
          const text = s.accessibility?.document_text || '';
          return tree.includes(condition) || text.includes(condition);
        }, { timeout, description: condition });
        console.log(`Condition met: "${condition}"`);
      } finally {
        await cu.close();
      }
      break;
    }

    default:
      console.log(`cu — Windows Desktop Automation

Commands:
  list                          List all windows
  screenshot <query> [path]     Take screenshot
  text <query>                  Read window text
  type <query> <text>           Type text
  key <query> <key>             Press key
  send <app> <contact> <msg>    Send message
  file <app> <contact> <path>   Send file
  open <app>                    Launch app
  wait <query> <condition>      Wait for condition`);
  }
}

main().catch(err => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
