/**
 * chat-helper.mjs — Optimized message sending for common chat apps.
 *
 * Handles TextInputHost.exe and CEF quirks automatically.
 * Supports: QQ, Steam, WeChat.
 *
 * Usage:
 *   import { sendChatMessage } from './chat-helper.mjs';
 *   await sendChatMessage('QQ', 'contact', 'hello!');
 *   await sendChatMessage('Steam', 'Shrimpaste', 'test');
 *   await sendChatMessage('WeChat', '文件传输助手', 'hi');
 */

import { ComputerUse } from './computer-use.mjs';
import { execSync } from 'child_process';

// ─── Clipboard ───────────────────────────────────────────────────────
function setClipboard(text) {
  const safe = text.replace(/"/g, '""');
  const encoded = Buffer.from(`Set-Clipboard -Value "${safe}"`, 'utf16le').toString('base64');
  execSync(`powershell -EncodedCommand ${encoded}`, { encoding: 'utf8', stdio: 'pipe' });
}

// ─── Sleep helper ────────────────────────────────────────────────────
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function dpiScale(x, y) {
  try {
    const raw = execSync('powershell -Command "[System.Windows.Forms.Screen]::PrimaryScreen.Bounds.Width"', { encoding: 'utf8' }).trim();
    const screenW = parseInt(raw) || 1920;
    const scale = screenW / 1920;
    return { x: Math.round(x * scale), y: Math.round(y * scale) };
  } catch { return { x, y }; }
}

function parseIdx(line) {
  const m = line.match(/^\s*(\d+)\s/);
  return m ? parseInt(m[1]) : null;
}

// ─── App Profiles ────────────────────────────────────────────────────
const PROFILES = {
  QQ: {
    matchWindow: (w) => w.app?.toLowerCase().includes('qq.exe') && w.title === 'QQ',

    async openChat(cu, win, contact) {
      let state = await cu.getWindowState(win, { text: true });
      const tree = state?.accessibility?.tree || '';
      const lines = tree.split('\n');

      // Check if contact already visible in session list
      for (const line of lines) {
        if (line.includes(contact) && (line.includes('组') || line.includes('文本'))) {
          const m = line.match(/^\s*(\d+)\s/);
          if (m) { await cu.click(win, { element_index: parseInt(m[1]) }); await sleep(1000); return; }
        }
      }

      // Use search
      for (const line of lines) {
        if (line.includes('编辑') && line.includes('搜索')) {
          const m = line.match(/^\s*(\d+)\s/);
          if (m) { await cu.click(win, { element_index: parseInt(m[1]) }); await sleep(500); break; }
        }
      }
      await cu.typeText(win, contact);
      await sleep(1000);

      state = await cu.getWindowState(win, { text: true });
      for (const line of state.accessibility.tree.split('\n')) {
        if (line.includes('选项') && line.includes(contact)) {
          const m = line.match(/^\s*(\d+)\s/);
          if (m) { await cu.click(win, { element_index: parseInt(m[1]) }); await sleep(1000); return; }
        }
      }
    },

    async focusInput(cu, chatWin) {
      let state = await cu.getWindowState(chatWin, { text: true });
      for (const line of state.accessibility.tree.split('\n')) {
        if (line.includes('工具栏') && line.includes('会话')) {
          const m = line.match(/^\s*(\d+)\s/);
          if (m) { await cu.click(chatWin, { element_index: parseInt(m[1]) }); await sleep(200); break; }
        }
      }
      await cu.pressKey(chatWin, 'Down');
      await sleep(200);
    },

    sendKey: 'Return',
    async clickFileIcon(cu, win) {
      let state = await cu.getWindowState(win, { text: true });
      for (const line of state.accessibility.tree.split('\n')) {
        if (line.includes('按钮') && line.includes('文件') && !line.includes('文件名')) {
          const idx = parseIdx(line);
          if (idx != null) { await cu.click(win, { element_index: idx }); return; }
        }
      }
      await cu.click(win, { x: 380, y: 580 });
    },
    async clickSend(cu, win) {
      let state = await cu.getWindowState(win, { text: true });
      for (const line of state.accessibility.tree.split('\n')) {
        if (line.includes('按钮') && line.includes('发送') && !line.includes('disabled')) {
          const idx = parseIdx(line);
          if (idx != null) { await cu.click(win, { element_index: idx }); return; }
        }
      }
      await cu.pressKey(win, 'Return');
    },
  },

  Steam: {
    matchWindow: (w) => w.title === '好友列表',

    async openChat(cu, friendList, contact) {
      let state = await cu.getWindowState(friendList, { text: true });
      const lines = state.accessibility.tree.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes(contact) && lines[i].includes('按钮')) {
          const m = lines[i].match(/^\s*(\d+)\s/);
          if (m) {
            await cu.click(friendList, { element_index: parseInt(m[1]) + 1, click_count: 2 });
            await sleep(2000);
            return;
          }
        }
      }
    },

    async focusInput(cu, chatWin) {
      let state = await cu.getWindowState(chatWin, { text: true });
      for (const line of state.accessibility.tree.split('\n')) {
        if (line.includes('工具栏') && !line.includes('disabled')) {
          const m = line.match(/^\s*(\d+)\s/);
          if (m) { await cu.click(chatWin, { element_index: parseInt(m[1]) }); await sleep(200); break; }
        }
      }
      await cu.pressKey(chatWin, 'Down');
      await sleep(200);
    },

    sendKey: 'Return',
  },

  WeChat: {
    matchWindow: (w) => w.title === '微信' && (w.app?.toLowerCase().includes('weixin') || w.app?.toLowerCase().includes('wechat')),

    async openChat(cu, win, contact) {
      let state = await cu.getWindowState(win, { text: true });
      const tree = state?.accessibility?.tree || '';

      // If shows "进入微信" button, click it first (post-login screen)
      if (tree.includes('进入微信')) {
        const lines = tree.split('\n');
        for (const line of lines) {
          if (line.includes('进入微信') && line.includes('按钮')) {
            const m = line.match(/^\s*(\d+)\s/);
            if (m) { await cu.click(win, { element_index: parseInt(m[1]) }); await sleep(2000); break; }
          }
        }
        state = await cu.getWindowState(win, { text: true });
      }

      // WeChat has minimal accessibility tree — use coordinate-based search
      // Search box is at top of left sidebar (~x=170, y=55)
      const sb = dpiScale(170, 55);
      await cu.click(win, { x: sb.x, y: sb.y });
      await sleep(500);
      await cu.typeText(win, contact);
      await sleep(1500);

      // Click first search result (~x=230, y=330)
      const fr = dpiScale(230, 330);
      await cu.click(win, { x: fr.x, y: fr.y });
      await sleep(1500);
    },

    async focusInput(cu, chatWin) {
      // WeChat input is at bottom of chat area — coordinate-based
      // Input area is approximately at x=550, y=535 (varies by window size)
      const ip = dpiScale(550, 535);
      await cu.click(chatWin, { x: ip.x, y: ip.y });
      await sleep(300);
    },

    sendKey: 'Return',
    async clickFileIcon(cu, win) {
      const fi = dpiScale(400, 595);
      await cu.click(win, { x: fi.x, y: fi.y });
    },
    async clickSend(cu, win) {
      const sb = dpiScale(840, 597);
      await cu.click(win, { x: sb.x, y: sb.y });
    },
  },
};

// ─── Main API ────────────────────────────────────────────────────────

/**
 * Send a message to a contact in a chat app.
 * @param {string} app - 'QQ', 'Steam', 'WeChat'
 * @param {string} contact - Contact name
 * @param {string} message - Message text
 * @returns {Promise<boolean>}
 */
async function retry(fn, maxRetries = 2, delayMs = 1000) {
  for (let i = 0; i <= maxRetries; i++) {
    try { return await fn(); }
    catch (err) {
      if (i === maxRetries) throw err;
      console.log('Retry ' + (i+1) + '/' + maxRetries + ': ' + err.message);
      await sleep(delayMs);
    }
  }
}

export async function sendChatMessage(app, contact, message) {
  return retry(async () => {
  const profile = PROFILES[app];
  if (!profile) throw new Error(`Unsupported: ${app}. Use: ${Object.keys(PROFILES).join(', ')}`);

  const cu = await ComputerUse.session();
  try {
    const wins = await cu.listWindows();
    const mainWin = wins.find(profile.matchWindow);
    if (!mainWin) throw new Error(`${app} window not found`);

    await cu.activateWindow(mainWin);
    await profile.openChat(cu, mainWin, contact);

    // Find chat window (may be separate or same)
    const wins2 = await cu.listWindows();
    const chatWin = wins2.find(w =>
      w.title?.includes(contact) ||
      (w.title === mainWin.title && w.app === mainWin.app)
    );
    const targetWin = chatWin || mainWin;
    await cu.activateWindow(targetWin);

    setClipboard(message);
    await profile.focusInput(cu, targetWin);
    await cu.pressKey(targetWin, 'Control_L+a');
    await cu.pressKey(targetWin, 'Delete');
    await cu.pressKey(targetWin, 'Control_L+v');
    await sleep(500);
    await cu.pressKey(targetWin, profile.sendKey);
    await sleep(500);

    console.log("Sent to " + contact + " on " + app);
      return true;
    } finally { await cu.close(); }
  });
}


// ─── File Sending ────────────────────────────────────────────────────

/**
 * Send a file via a chat app's file transfer feature.
 * @param {string} app - 'QQ', 'Steam', 'WeChat'
 * @param {string} contact - Contact name (e.g. '文件传输助手')
 * @param {string} filePath - Absolute path to the file
 * @returns {Promise<boolean>}
 */
export function listSupportedApps() {
  return Object.keys(PROFILES);
}

// ─── File Sending ────────────────────────────────────────────────────

/**
 * Send a file via a chat app's file transfer feature.
 * @param {string} app - 'QQ', 'Steam', 'WeChat'
 * @param {string} contact - Contact name (e.g. '文件传输助手')
 * @param {string} filePath - Absolute path to the file
 * @returns {Promise<boolean>}
 */
export async function sendChatFile(app, contact, filePath) {
  const profile = PROFILES[app];
  if (!profile) throw new Error("Unsupported: " + app);
  if (!profile.clickFileIcon) throw new Error(app + " file sending not supported");
  return retry(async () => {
    const cu = await ComputerUse.session();
    try {
      const wins = await cu.listWindows();
      const mainWin = wins.find(profile.matchWindow);
      if (!mainWin) throw new Error(app + " window not found");
      await cu.activateWindow(mainWin);
      await profile.openChat(cu, mainWin, contact);
      const wins2 = await cu.listWindows();
      const chatWin = wins2.find(w => w.title?.includes(contact) || (w.title === mainWin.title && w.app === mainWin.app));
      const targetWin = chatWin || mainWin;
      await cu.activateWindow(targetWin);
      await cu.getWindowState(targetWin, { text: true });
      await profile.clickFileIcon(cu, targetWin);
      await sleep(2000);
      await cu.typeText(targetWin, filePath);
      await sleep(300);
      await cu.pressKey(targetWin, "Return");
      await sleep(2000);
      await cu.getWindowState(targetWin, { text: true });
      await profile.clickSend(cu, targetWin);
      await sleep(1000);
      console.log("File sent to " + contact + " on " + app + ": " + filePath);
      return true;
    } finally { await cu.close(); }
  });
}
