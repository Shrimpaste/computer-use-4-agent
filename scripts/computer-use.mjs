#!/usr/bin/env node
/**
 * windows-computer-use — Standalone Windows desktop automation via named pipe
 *
 * Zero-dependency Node.js module that communicates with the computer-use helper
 * through its named-pipe JSON-RPC 2.0 protocol. Works as both a CLI tool and
 * an importable library for any AI agent (Claude, GPT, Gemini, etc.).
 *
 * ─── As a library ───
 *   import { ComputerUse } from './computer-use.mjs';
 *   const cu = new ComputerUse();
 *   await cu.connect();
 *   const apps = await cu.listApps();
 *   await cu.close();
 *
 * ─── As a CLI ───
 *   node computer-use.mjs list-apps
 *   node computer-use.mjs list-windows
 *   node computer-use.mjs state <query> [--screenshot] [--text]
 *   node computer-use.mjs screenshot <query> [out.png]
 *   node computer-use.mjs tree <query>
 *   node computer-use.mjs click <query> <elementIndex>
 *   node computer-use.mjs click-xy <query> <x> <y>
 *   node computer-use.mjs type <query> <text>
 *   node computer-use.mjs key <query> <key>
 *   node computer-use.mjs activate <query>
 *   node computer-use.mjs launch <appId>
 *   node computer-use.mjs set-value <query> <elementIndex> <value>
 *   node computer-use.mjs scroll <query> <x> <y> <scrollX> <scrollY>
 *   node computer-use.mjs drag <query> <fromX> <fromY> <toX> <toY>
 *   node computer-use.mjs secondary <query> <elementIndex> [action]
 *
 * ─── Wire Protocol ───
 * Transport: Named pipe (Windows) — path auto-discovered from config or pipe scan.
 * Framing:   4-byte LE length prefix + UTF-8 JSON payload.
 * Protocol:  JSON-RPC 2.0 — { id, jsonrpc: "2.0", method, params }
 * Methods:   request → { method: "<rpc_method>", params: { ... } }
 * Server push: "requestComputerUseApproval" → auto-respond { action: "accept", persist: "global" }
 *
 * ─── Prerequisites ───
 * - Windows 10/11
 * - the computer-use helper running (installed with the desktop app)
 * - Node.js >= 18
 *
 * @license MIT
 * @version 1.0.0
 */

import { readFileSync, readdirSync, writeFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { createConnection } from 'node:net';
import { execSync } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { endianness } from 'node:os';

// ═══════════════════════════════════════════════════════════════════════════════
// §1  COMPUTER USE CLIENT CLASS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Main client class for controlling Windows desktop applications.
 *
 * All methods accept plain objects with `window` handles obtained from
 * `listWindows()` or `listApps()`. Coordinates are in logical (DPI-scaled)
 * pixels relative to the window.
 *
 * @example
 *   const cu = new ComputerUse();
 *   await cu.connect();
 *
 *   const wins = await cu.listWindows();
 *   const notepad = wins.find(w => w.title?.includes('Notepad'));
 *   if (notepad) {
 *     await cu.activateWindow(notepad);
 *     const state = await cu.getWindowState(notepad, { text: true, screenshot: true });
 *     console.log(state.accessibility.tree);
 *     await cu.typeText(notepad, 'Hello from agent!');
 *     await cu.pressKey(notepad, 'Return');
 *   }
 *
 *   await cu.close();
 */
export class ComputerUse {
  #socket = null;
  #nextId = 0;
  #pending = new Map();
  #pendingData = Buffer.alloc(0);
  #pipePath = null;
  #connected = false;

  // ─── Connection ───────────────────────────────────────────────────────────

  /**
   * Connect to the the computer-use helper named pipe.
   * @param {string} [pipePath] — Explicit pipe path. Auto-discovered if omitted.
   * @returns {Promise<void>}
   */
  async connect(pipePath) {
    this.#pipePath = pipePath || ComputerUse.discoverPipePath();

    return new Promise((resolve, reject) => {
      const onError = (err) => {
        this.#connected = false;
        this.#socket = null;
        reject(err);
      };
      this.#socket = createConnection(this.#pipePath, () => {
        this.#socket.removeListener('error', onError);
        this.#connected = true;
        this.#socket.on('error', (err) => {
          this.#connected = false;
          this.#rejectAll(err);
        });
        this.#socket.on('close', () => {
          this.#connected = false;
          this.#rejectAll(new Error('Pipe closed'));
        });
        this.#socket.on('data', (chunk) => this.#handleData(chunk));
        resolve();
      });
      this.#socket.once('error', onError);
    });
  }

  /** Gracefully close the connection. */
  async close() {
    if (!this.#socket) return;
    try {
      await this.request('close', {});
    } catch {}
    this.#socket.end();
    this.#socket = null;
    this.#connected = false;
  }

  /** Whether the client is currently connected. */
  get connected() { return this.#connected; }

  // ─── Low-level Transport ──────────────────────────────────────────────────

  /** Send a raw JSON-RPC request and return the result. */
  async request(method, params, timeoutMs = 30_000) {
    if (!this.#socket) throw new Error('Not connected');
    const id = ++this.#nextId;
    const payload = JSON.stringify({
      id,
      jsonrpc: '2.0',
      method: 'request',
      params: { method, params },
    });
    const frame = ComputerUse.#encodeFrame(payload);

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`Timeout waiting for ${method} (id=${id})`));
      }, timeoutMs);

      this.#pending.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v); },
        reject:  (e) => { clearTimeout(timer); reject(e); },
      });
      this.#socket.write(frame);
    });
  }

  #handleData(chunk) {
    this.#pendingData = Buffer.concat([this.#pendingData, Buffer.from(chunk)]);
    let offset = 0;
    while (this.#pendingData.length - offset >= 4) {
      const len = this.#pendingData.readUInt32LE(offset);
      if (this.#pendingData.length - offset < 4 + len) break;
      const msg = JSON.parse(
        this.#pendingData.subarray(offset + 4, offset + 4 + len).toString('utf8')
      );
      offset += 4 + len;
      this.#handleMessage(msg);
    }
    this.#pendingData = this.#pendingData.subarray(offset);
  }

  #handleMessage(msg) {
    // Server-initiated approval request → auto-accept
    if (msg.method === 'requestComputerUseApproval' && msg.id != null) {
      this.#writeMessage({ id: msg.id, jsonrpc: '2.0', result: { action: 'accept', persist: 'global' } });
      return;
    }
    // Response to our request
    if (typeof msg.id === 'number' && this.#pending.has(msg.id)) {
      const p = this.#pending.get(msg.id);
      this.#pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error.message || JSON.stringify(msg.error)));
      else p.resolve(msg.result);
    }
  }

  #writeMessage(obj) {
    if (!this.#socket) return;
    this.#socket.write(ComputerUse.#encodeFrame(JSON.stringify(obj)));
  }

  #rejectAll(err) {
    for (const p of this.#pending.values()) p.reject(err);
    this.#pending.clear();
  }

  static #encodeFrame(json) {
    const payload = Buffer.from(json, 'utf8');
    const frame = Buffer.alloc(4 + payload.length);
    frame.writeUInt32LE(payload.length, 0);
    payload.copy(frame, 4);
    return frame;
  }

  // ─── Pipe Discovery ───────────────────────────────────────────────────────

  /**
   * Discover the the computer-use helper named pipe path.
   * Tries: 1) config.toml  2) pipe enumeration  3) environment variable
   * @returns {string} Pipe path like `\\.\pipe\the computer-use helper-<uuid>`
   */
  static discoverPipePath() {
    // 1. Environment variable (highest priority for agent integration)
    if (process.env.SKY_CUA_NATIVE_PIPE_DIRECTORY) {
      return process.env.SKY_CUA_NATIVE_PIPE_DIRECTORY.trim();
    }

    // 2. config.toml
    try {
      const toml = readFileSync(join(homedir(), '.codex', 'config.toml'), 'utf8');
      const m = toml.match(/SKY_CUA_NATIVE_PIPE_DIRECTORY\s*=\s*['"]([^'"]+)['"]/);
      if (m) return m[1];
    } catch {}

    // 3. Enumerate named pipes
    try {
      const entries = readdirSync('\\\\?\\pipe\\');
      const match = entries.find(e => e.startsWith('the computer-use helper-'));
      if (match) return `\\\\.\\pipe\\${match}`;
    } catch {}

    // 4. Try to auto-start from bundled bin/
    try {
      const binDir = join(dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')), '..', 'bin');
      const exePath = join(binDir, 'codex-computer-use.exe');
      statSync(exePath);
      const { spawnSync } = require('node:child_process');
      spawnSync(exePath, { detached: true, stdio: 'ignore', windowsHide: true }).unref();
      // Synchronous wait for pipe to appear (up to 5s)
      const start = Date.now();
      while (Date.now() - start < 5000) {
        try {
          const entries2 = readdirSync('\\\\?\\pipe\\');
          const match2 = entries2.find(e => e.startsWith('the computer-use helper-'));
          if (match2) return `\\\\.\\pipe\\${match2}`;
        } catch {}
        // Busy-wait 100ms
        constSyncWait(100);
      }
    } catch {}

    throw new Error(
      'Cannot discover Computer Use pipe path.\n' +
      'Ensure the computer-use helper is running.\n' +
      'Options:\n' +
      '  1. Set SKY_CUA_NATIVE_PIPE_DIRECTORY env var\n' +
      '  2. Set SKY_CUA_NATIVE_PIPE_DIRECTORY in ~/.codex/config.toml\n' +
      '  3. Ensure the pipe exists in \\\\?\\pipe\\\n' +
      '  4. Place codex-computer-use.exe in <skill-root>/bin/'
    );
  }

  // ─── App & Window Listing ─────────────────────────────────────────────────

  /** List all registered apps with their windows. */
  async listApps() {
    const raw = await this.request('list_apps', {});
    return Array.isArray(raw) ? raw.map(normalizeApp).filter(Boolean) : [];
  }

  /** List all visible windows across all apps. */
  async listWindows() {
    const raw = await this.request('list_windows', {});
    return Array.isArray(raw) ? raw.map(w => normalizeWindow(w)).filter(Boolean) : [];
  }

  /** Get a specific window by id (and optionally app). */
  async getWindow(id, app) {
    const params = { id };
    if (app) params.app = app;
    const raw = await this.request('get_window', params);
    const win = normalizeWindow(raw);
    if (!win) throw new Error('Window not found');
    return win;
  }

  // ─── Window Interaction ───────────────────────────────────────────────────

  /** Bring a window to the foreground. */
  async activateWindow(window) {
    return this.request('activate_window', { window: toWire(window) });
  }

  /**
   * Capture the current state of a window.
   * @param {object} window — Window handle from listWindows().
   * @param {object} opts
   * @param {boolean} [opts.screenshot=true] — Include screenshot.
   * @param {boolean} [opts.text=false] — Include accessibility tree.
   * @returns {Promise<WindowState>}
   */
  async getWindowState(window, { screenshot = true, text = false } = {}) {
    if (!screenshot && !text) {
      throw new Error('Must request at least one of: screenshot, text');
    }
    const raw = await this.request('get_window_state', {
      window: toWire(window),
      include_screenshot: screenshot,
      include_text: text,
    });
    return normalizeWindowState(raw, window);
  }

  /**
   * Click in a window — by element index or pixel coordinates.
   * @param {object} window — Window handle.
   * @param {object} opts
   * @param {number} [opts.element_index] — From accessibility tree.
   * @param {number} [opts.x] — X coordinate (window-relative).
   * @param {number} [opts.y] — Y coordinate (window-relative).
   * @param {number} [opts.click_count=1] — 1=single, 2=double, 3=triple.
   * @param {string} [opts.mouse_button='left'] — 'left'/'right'/'middle'.
   * @param {string} [opts.screenshotId] — From get_window_state().
   */
  async click(window, opts = {}) {
    const wire = { window: toWire(window) };
    const idx = opts.element_index ?? opts.elementIndex;

    if (idx != null) {
      wire.element_index = toInt(idx, 'element_index');
      wire.click_count = toPositiveInt(opts.click_count ?? 1, 'click_count');
      wire.mouse_button = opts.mouse_button || 'left';
      return this.request('click_element', wire);
    }

    if (opts.x == null || opts.y == null) {
      throw new Error('click() requires element_index or both x and y');
    }
    wire.x = toInt(opts.x, 'x');
    wire.y = toInt(opts.y, 'y');
    wire.click_count = toPositiveInt(opts.click_count ?? 1, 'click_count');
    wire.mouse_button = opts.mouse_button || 'left';
    if (opts.screenshotId) wire.screenshotId = opts.screenshotId;
    return this.request('click', wire);
  }

  /** Press a key chord in a window. Keys use X11 keysym names separated by '+'. */
  async pressKey(window, key) {
    if (!key) throw new Error('key is required');
    return this.request('press_key', { window: toWire(window), key: normalizeKey(key) });
  }

  /** Type text into the focused element of a window.
   *  Uses clipboard paste for text containing backslashes to avoid IME issues. */
  async typeText(window, text) {
    const s = String(text);
    if (!s.includes('\\')) {
      return this.request('type_text', { window: toWire(window), text: s });
    }
    // Clipboard approach: set clipboard → Ctrl+V → restore clipboard
    const wire = toWire(window);

    // Save current clipboard
    let oldClip = '';
    try { oldClip = execSync('powershell -Command "Get-Clipboard"', { encoding: 'utf8' }).trim(); } catch {}

    // Set clipboard with our text
    const safe = s.replace(/"/g, '""');
    const encoded = Buffer.from(`Set-Clipboard -Value "${safe}"`, 'utf16le').toString('base64');
    execSync(`powershell -EncodedCommand ${encoded}`, { encoding: 'utf8', stdio: 'pipe' });

    // Paste
    await this.request('press_key', { window: wire, key: 'Control_L+v' });
    await new Promise(r => setTimeout(r, 200));

    // Restore old clipboard
    try {
      const restoreSafe = oldClip.replace(/"/g, '""');
      const restoreEncoded = Buffer.from(`Set-Clipboard -Value "${restoreSafe}"`, 'utf16le').toString('base64');
      execSync(`powershell -EncodedCommand ${restoreEncoded}`, { encoding: 'utf8', stdio: 'pipe' });
    } catch {}
  }

  /** Scroll in a window at the given coordinates. */
  async scroll(window, x, y, scrollX, scrollY, screenshotId) {
    const params = {
      window: toWire(window),
      x: toInt(x, 'x'), y: toInt(y, 'y'),
      scrollX: toInt(scrollX, 'scrollX'), scrollY: toInt(scrollY, 'scrollY'),
    };
    if (screenshotId) params.screenshotId = screenshotId;
    return this.request('scroll', params);
  }

  /** Drag from (fromX,fromY) to (toX,toY) in a window. */
  async drag(window, fromX, fromY, toX, toY, screenshotId) {
    const params = {
      window: toWire(window),
      from_x: toInt(fromX, 'from_x'), from_y: toInt(fromY, 'from_y'),
      to_x: toInt(toX, 'to_x'), to_y: toInt(toY, 'to_y'),
    };
    if (screenshotId) params.screenshotId = screenshotId;
    return this.request('drag', params);
  }

  /** Replace the value of an editable element. */
  async setValue(window, elementIndex, value) {
    return this.request('set_value', {
      window: toWire(window),
      element_index: toInt(elementIndex, 'element_index'),
      value: String(value),
    });
  }

  /** Invoke a secondary action (e.g. context menu) on an element. */
  async performSecondaryAction(window, elementIndex, action = 'Raise') {
    return this.request('perform_secondary_action', {
      window: toWire(window),
      element_index: toInt(elementIndex, 'element_index'),
      action,
    });
  }

  /** Launch an app by id or exe path. */
  async launchApp(appId) {
    return this.request('launch_app', { app: String(appId) });
  }

  // ─── Convenience Helpers ──────────────────────────────────────────────────

  /**
   * Find a window by fuzzy-matching title, app name, or window id.
   * Supports: substring match, "[12345]" for exact id, "process:path" for app.
   */
  static findWindow(windows, query) {
    if (!query || !windows?.length) return null;
    const q = query.toLowerCase().trim();

    // [id] exact match
    const idMatch = q.match(/^\[(\d+)\]$/);
    if (idMatch) {
      const id = parseInt(idMatch[1], 10);
      const exact = windows.find(w => w.id === id);
      if (exact) return exact;
    }

    // Exact title match first (highest priority)
    const exactTitle = windows.find(w => w.title?.toLowerCase() === q);
    if (exactTitle) return exactTitle;

    // Substring match on title
    const titleMatch = windows.find(w => w.title?.toLowerCase().includes(q));
    if (titleMatch) return titleMatch;

    // Substring match on app
    const appMatch = windows.find(w => w.app?.toLowerCase().includes(q));
    if (appMatch) return appMatch;

    return null;
  }

  /** Find an app by fuzzy-matching id, displayName. */
  static findApp(apps, query) {
    if (!query || !apps?.length) return null;
    const q = query.toLowerCase().trim();
    return apps.find(a =>
      a.id?.toLowerCase().includes(q) ||
      a.displayName?.toLowerCase().includes(q)
    ) || null;
  }

  /** Save a screenshot from getWindowState() to a PNG file. Returns the path. */
  static saveScreenshot(state, outPath = 'cu-screenshot.png') {
    const url = state?.screenshots?.[0]?.url;
    if (!url) return null;
    const base64 = url.includes(',') ? url.split(',')[1] : url;
    const absPath = resolve(outPath);
    writeFileSync(absPath, Buffer.from(base64, 'base64'));
    return absPath;
  }

  /**
   * Create a one-shot helper: connect, run a function, close.
   * Great for agent scripts that need a single interaction.
   *
   * @example
   *   const result = await ComputerUse.with(async cu => {
   *     const wins = await cu.listWindows();
   *     return wins.map(w => w.title);
   *   });
   */
  static async with(fn, pipePath) {
    const cu = new ComputerUse();
    try {
      await cu.connect(pipePath);
      return await fn(cu);
    } finally {
      await cu.close();
    }
  }

  /**
   * Create a persistent session that keeps the connection open.
   * Useful for agents that need multiple interactions in sequence.
   *
   * @example
   *   const session = await ComputerUse.session();
   *   const wins = await session.listWindows();
   *   // ... more operations ...
   *   await session.close();
   */
  static async session(pipePath) {
    const cu = new ComputerUse();
    await cu.connect(pipePath);
    return cu;
  }

  /**
   * Poll window state until conditionFn returns true or timeout expires.
   * @param {object} window - Window handle
   * @param {function} conditionFn - Receives WindowState, returns boolean
   * @param {object} [options] - { timeout, interval, description, includeScreenshot, signal }
   * @returns {Promise<WindowState>} The state that satisfied the condition
   */
  async waitUntil(window, conditionFn, options = {}) {
    const {
      timeout = 30_000,
      interval = 1_000,
      description = '',
      includeScreenshot = false,
      signal,
    } = options;

    if (typeof conditionFn !== 'function') {
      throw new TypeError('conditionFn must be a function');
    }

    const deadline = Date.now() + timeout;

    if (signal?.aborted) {
      throw new DOMException('waitUntil aborted', 'AbortError');
    }

    let onAbort;
    const abortPromise = signal
      ? new Promise((_, reject) => {
          onAbort = () => reject(new DOMException('waitUntil aborted', 'AbortError'));
          signal.addEventListener('abort', onAbort, { once: true });
        })
      : null;

    try {
      while (true) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) {
          const label = description ? ` waiting for "${description}"` : '';
          throw new TimeoutError(`waitUntil timed out after ${timeout}ms${label}`, timeout);
        }

        let state;
        try {
          state = await this.getWindowState(window, {
            screenshot: includeScreenshot,
            text: true,
          });
        } catch (err) {
          if (err.message?.includes('not found') || err.message?.includes('closed')) {
            throw new Error(`waitUntil: window disappeared${description ? ` while waiting for "${description}"` : ''}: ${err.message}`);
          }
          throw err;
        }

        const result = await conditionFn(state);
        if (result === true) return state;

        if (abortPromise) {
          await Promise.race([sleep(Math.min(interval, remaining)), abortPromise]);
        } else {
          await sleep(Math.min(interval, remaining));
        }
      }
    } finally {
      if (signal && onAbort) {
        signal.removeEventListener('abort', onAbort);
      }
    }
  }

  /**
   * Detect a dialog by matching rules against accessibility tree.
   * Pure detection — does NOT perform actions.
   * @param {object} window - Window handle
   * @param {Array} rules - [{ id, match: { title, content, custom }, action: { type, label, key } }]
   * @returns {Promise<{ rule, elementIndex, state } | null>}
   */
  async detectDialog(window, rules) {
    if (!Array.isArray(rules) || rules.length === 0) {
      throw new TypeError('rules must be a non-empty array');
    }

    const state = await this.getWindowState(window, { screenshot: false, text: true });
    const tree = state.accessibility?.tree || '';
    const docText = state.accessibility?.document_text || '';
    const title = state.window?.title || '';

    for (const rule of rules) {
      const { match, action } = rule;
      let matched = false;
      let elementIndex = null;

      if (match.title != null) matched = matchString(title, match.title);
      if (!matched && match.content != null) {
        matched = matchString(tree, match.content) || matchString(docText, match.content);
      }
      if (!matched && typeof match.custom === 'function') {
        matched = await match.custom(state);
      }

      if (!matched) continue;

      if (action?.type === 'click' && action.label && action.elementIndex == null) {
        elementIndex = findElementByLabel(tree, action.label);
      } else if (action?.elementIndex != null) {
        elementIndex = action.elementIndex;
      }

      if (action?.type === 'click' && elementIndex == null && action.label) continue;

      return { rule, elementIndex, state };
    }
    return null;
  }

  /**
   * Wait for a dialog to appear, then optionally execute its action.
   * Combines waitUntil polling with detectDialog rule matching.
   * @param {object} window - Window handle
   * @param {Array} rules - Dialog detection rules
   * @param {object} [options] - { timeout, interval, executeAction, description }
   * @returns {Promise<{ rule, elementIndex, state }>}
   */
  async waitUntilWithDialog(window, rules, options = {}) {
    const { timeout = 30_000, interval = 1_000, executeAction = true, description = 'dialog' } = options;

    await this.waitUntil(window, async (state) => {
      const tree = state.accessibility?.tree || '';
      const docText = state.accessibility?.document_text || '';
      const winTitle = state.window?.title || '';

      for (const rule of rules) {
        const { match } = rule;
        let matched = false;
        if (match.title != null) matched = matchString(winTitle, match.title);
        if (!matched && match.content != null) {
          matched = matchString(tree, match.content) || matchString(docText, match.content);
        }
        if (!matched && typeof match.custom === 'function') {
          matched = await match.custom(state);
        }
        if (matched) return true;
      }
      return false;
    }, { timeout, interval, description });

    const match = await this.detectDialog(window, rules);
    if (!match) {
      throw new Error(`waitUntilWithDialog: dialog appeared then disappeared`);
    }

    if (executeAction && match.rule.action) {
      const { action } = match.rule;
      switch (action.type) {
        case 'click':
          if (match.elementIndex != null) {
            await this.click(window, { element_index: match.elementIndex });
          } else if (action.elementIndex != null) {
            await this.click(window, { element_index: action.elementIndex });
          } else {
            throw new Error(`Dialog rule "${match.rule.id}": no element found to click`);
          }
          break;
        case 'press':
          await this.pressKey(window, action.key || 'Return');
          break;
        case 'report':
        case 'ignore':
          break;
      }
    }

    return match;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// §2  NORMALIZATION HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

function normalizeApp(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = str(raw.id);
  if (!id) return null;
  const app = { id };
  opt(app, 'displayName', str(raw.displayName));
  opt(app, 'lastUsedDate', str(raw.lastUsedDate));
  opt(app, 'useCount', num(raw.useCount));
  opt(app, 'isRunning', typeof raw.isRunning === 'boolean' ? raw.isRunning : undefined);
  if (Array.isArray(raw.windows)) {
    app.windows = raw.windows.map(w => normalizeWindow(w, id)).filter(Boolean);
  }
  return app;
}

function normalizeWindow(raw, fallbackApp) {
  if (!raw || typeof raw !== 'object') return null;
  const id = intId(raw.id);
  if (id == null) return null;
  const app = str(raw.app) || fallbackApp;
  if (!app) return null;
  const win = { app, id };
  opt(win, 'title', str(raw.title));
  return win;
}

function normalizeWindowState(raw, requestedWindow) {
  if (!raw || typeof raw !== 'object') {
    throw new Error('the computer-use helper did not return window state');
  }
  const state = {};
  state.window = normalizeWindow(raw.window, requestedWindow?.app) || requestedWindow;

  // Screenshots
  state.screenshots = Array.isArray(raw.screenshots)
    ? raw.screenshots.map(normalizeScreenshot) : [];

  // Accessibility
  if (raw.accessibility && typeof raw.accessibility === 'object') {
    const a = raw.accessibility;
    state.accessibility = { tree: a.tree || '' };
    opt(state.accessibility, 'focused_element', str(a.focused_element));
    opt(state.accessibility, 'selected_text', str(a.selected_text));
    opt(state.accessibility, 'document_text', str(a.document_text));
    if (Array.isArray(a.selected_elements)) {
      state.accessibility.selected_elements = a.selected_elements;
    }
  } else {
    state.accessibility = null;
  }

  return state;
}

function normalizeScreenshot(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('Invalid screenshot');
  const s = { url: raw.url, id: str(raw.id) || 'screenshot-0', zIndex: num(raw.zIndex) ?? 0 };
  opt(s, 'originX', num(raw.originX));
  opt(s, 'originY', num(raw.originY));
  opt(s, 'width', num(raw.width));
  opt(s, 'height', num(raw.height));
  return s;
}

// ═══════════════════════════════════════════════════════════════════════════════
// §3  WIRE FORMAT HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

/** Convert a window handle to the wire format expected by the computer-use helper */
function toWire(win) {
  if (!win || typeof win !== 'object') throw new Error('window handle required');
  const app = str(win.app);
  const id = typeof win.id === 'number' ? win.id : parseInt(win.id, 10);
  if (!app || isNaN(id) || id < 0) throw new Error(`Invalid window: ${JSON.stringify(win)}`);
  return { app, id };
}

function normalizeKey(key) {
  return key.split('+').map(s => s.trim()).filter(Boolean).join('+');
}

// ═══════════════════════════════════════════════════════════════════════════════
// §4  TYPE HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

function str(v) { return typeof v === 'string' ? v : undefined; }
function num(v) { return typeof v === 'number' && Number.isFinite(v) ? v : undefined; }
function intId(v) {
  if (typeof v === 'number' && Number.isInteger(v) && v >= 0) return v;
  if (typeof v === 'string') { const n = Number(v); if (Number.isInteger(n) && n >= 0) return n; }
  return undefined;
}
function toInt(v, name) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) throw new TypeError(`${name} must be a finite number`);
  return n;
}
function toPositiveInt(v, name) {
  const n = toInt(v, name);
  if (n < 1) throw new TypeError(`${name} must be >= 1`);
  return n;
}
function opt(obj, key, val) { if (val !== undefined) obj[key] = val; }
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
function constSyncWait(ms) { const end = Date.now() + ms; while (Date.now() < end) {} }

// ═══════════════════════════════════════════════════════════════════════════════
// §5  WAIT & DIALOG PRIMITIVES
// ═══════════════════════════════════════════════════════════════════════════════

export class TimeoutError extends Error {
  constructor(message, timeout) {
    super(message);
    this.name = 'TimeoutError';
    this.timeout = timeout;
  }
}

function matchString(text, pattern) {
  if (!text) return false;
  if (pattern instanceof RegExp) return pattern.test(text);
  return text.includes(String(pattern));
}

const INTERACTIVE_ROLES = new Set([
  'button', 'checkbox', 'radiobutton', 'combobox',
  'menuitem', 'menuitemcheckbox', 'menuitemradio',
  'hyperlink', 'link', 'tab', 'treeitem',
  'splitbutton', 'togglebutton', 'spinbutton',
]);

function isInteractiveRole(role) {
  return INTERACTIVE_ROLES.has(role.toLowerCase());
}

function findElementByLabel(tree, label) {
  if (!tree || !label) return null;
  const lines = tree.split('\n');
  const lowerLabel = label.toLowerCase();

  // Prefer interactive elements
  for (const line of lines) {
    const m = line.match(/^\s*(\d+)\s+(\S+)\s+(.*)/);
    if (!m) continue;
    const [, idx, role, name] = m;
    if (name.toLowerCase().includes(lowerLabel) && isInteractiveRole(role)) {
      return parseInt(idx, 10);
    }
  }

  // Fallback: any element with the label
  for (const line of lines) {
    const m = line.match(/^\s*(\d+)\s+(.*)/);
    if (!m) continue;
    const [, idx, rest] = m;
    if (rest.toLowerCase().includes(lowerLabel)) {
      return parseInt(idx, 10);
    }
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// §6  DEFAULT EXPORT (backward-compatible with cu.mjs)
// ═══════════════════════════════════════════════════════════════════════════════

const instance = new ComputerUse();

/** Convenience default export matching the old cu.mjs interface */
const CU = {
  connect:             (p) => instance.connect(p),
  close:               () => instance.close(),
  listApps:            () => instance.listApps(),
  listWindows:         () => instance.listWindows(),
  activateWindow:      (w) => instance.activateWindow(w),
  getWindowState:      (w, o) => instance.getWindowState(w, o),
  click:               (w, o) => instance.click(w, o),
  pressKey:            (w, k) => instance.pressKey(w, k),
  typeText:            (w, t) => instance.typeText(w, t),
  scroll:              (w, x, y, sx, y2, sid) => instance.scroll(w, x, y, sx, y2, sid),
  drag:                (w, fx, fy, tx, ty, sid) => instance.drag(w, fx, fy, tx, ty, sid),
  setValue:            (w, i, v) => instance.setValue(w, i, v),
  performSecondaryAction: (w, i, a) => instance.performSecondaryAction(w, i, a),
  launchApp:           (a) => instance.launchApp(a),
  findWindow:          ComputerUse.findWindow,
  findApp:             ComputerUse.findApp,
  saveScreenshot:      ComputerUse.saveScreenshot,
  discoverPipePath:    ComputerUse.discoverPipePath,
  with:                ComputerUse.with,
  session:             ComputerUse.session,
  waitUntil:           (w, fn, o) => instance.waitUntil(w, fn, o),
  detectDialog:        (w, r) => instance.detectDialog(w, r),
  waitUntilWithDialog: (w, r, o) => instance.waitUntilWithDialog(w, r, o),
  ComputerUse,
  TimeoutError,
};
export default CU;

// ═══════════════════════════════════════════════════════════════════════════════
// §6  CLI
// ═══════════════════════════════════════════════════════════════════════════════

const isMain = process.argv[1] && (
  process.argv[1].endsWith('computer-use.mjs') ||
  process.argv[1].endsWith('computer-use.js')
);

if (isMain) {
  const args = process.argv.slice(2);
  const cmd = args[0]?.toLowerCase();

  if (!cmd || cmd === '--help' || cmd === '-h') {
    console.log(`
windows-computer-use — Control Windows desktop apps from any AI agent

USAGE
  node computer-use.mjs <command> [args...]

COMMANDS
  list-apps                          List all registered apps
  list-windows                       List all visible windows
  state <query> [--text] [--screenshot]  Window state (default: screenshot+text)
  screenshot <query> [out.png]       Save window screenshot
  tree <query>                       Print accessibility tree
  activate <query>                   Bring window to foreground
  click <query> <elementIndex>       Click an element by index
  click-xy <query> <x> <y>          Click at pixel coordinates
  type <query> <text>                Type text into focused element
  key <query> <key>                  Press a key chord
  launch <appId>                     Launch an app
  set-value <query> <idx> <value>    Set editable element value
  scroll <query> <x> <y> <sx> <sy>  Scroll at coordinates
  drag <query> <fx> <fy> <tx> <ty>  Drag between coordinates
  secondary <query> <idx> [action]   Secondary action on element

QUERY FORMAT
  Substring match against window title, app name, or app id.
  Use "[12345]" for exact window-id match.
  Use "process:path" for app path match.

KEY NAMES (X11 keysym style)
  a, space, Return, Escape, Tab, BackSpace, Delete,
  Up, Down, Left, Right, F1-F12,
  Control_L+a, Alt_L+F4, Shift_L+Tab, etc.

ENVIRONMENT
  SKY_CUA_NATIVE_PIPE_DIRECTORY    Override pipe path auto-discovery

EXAMPLES
  node computer-use.mjs list-windows
  node computer-use.mjs state Notepad --text --screenshot
  node computer-use.mjs click Notepad 5
  node computer-use.mjs type Notepad "Hello World"
  node computer-use.mjs key Notepad Return
  node computer-use.mjs screenshot "QQ" qq.png
  node computer-use.mjs click-xy "[132940]" 22 390
`.trim());
    process.exit(0);
  }

  cli().catch(e => { console.error(`Error: ${e.message}`); process.exit(1); });
}

async function cli() {
  const args = process.argv.slice(2);
  const cmd = args[0]?.toLowerCase();
  const q = args[1];

  // Helpers
  const getWin = async (query) => {
    const wins = await instance.listWindows();
    const win = ComputerUse.findWindow(wins, query);
    if (!win) throw new Error(`No window matching "${query}". Use "list-windows" to see available windows.`);
    return win;
  };

  const hasFlag = (f) => args.includes(f);

  await instance.connect();

  try {
    switch (cmd) {
      case 'list-apps': {
        const apps = await instance.listApps();
        for (const app of apps) {
          const wins = app.windows?.length || 0;
          console.log(`${app.id}${app.displayName ? ` (${app.displayName})` : ''} — ${wins} window(s)`);
          for (const w of app.windows || []) {
            console.log(`  [${w.id}] ${w.title || '(untitled)'}`);
          }
        }
        break;
      }

      case 'list-windows': {
        const wins = await instance.listWindows();
        for (const w of wins) {
          console.log(`[${w.id}] ${w.title || '(untitled)'} — ${w.app}`);
        }
        break;
      }

      case 'state': {
        if (!q) throw new Error('Usage: state <query> [--text] [--screenshot]');
        const win = await getWin(q);
        const text = hasFlag('--text') || hasFlag('-t');
        const ss = hasFlag('--screenshot') || hasFlag('-s');
        const state = await instance.getWindowState(win, {
          screenshot: ss || !text, // default to screenshot if neither flag
          text: text || !ss,       // default to text if neither flag
        });
        if (state.accessibility?.tree) {
          console.log('=== Accessibility Tree ===');
          console.log(state.accessibility.tree);
        }
        if (state.screenshots?.[0]) {
          const outPath = `${q.replace(/[^a-z0-9]/gi, '_')}-state.png`;
          ComputerUse.saveScreenshot(state, outPath);
          console.log(`\nScreenshot saved: ${outPath}`);
        }
        break;
      }

      case 'screenshot': {
        if (!q) throw new Error('Usage: screenshot <query> [out.png]');
        const outPath = args[2] || 'cu-screenshot.png';
        const win = await getWin(q);
        const state = await instance.getWindowState(win, { screenshot: true, text: false });
        const saved = ComputerUse.saveScreenshot(state, outPath);
        console.log(saved ? `Saved to ${saved}` : 'No screenshot returned');
        break;
      }

      case 'tree': {
        if (!q) throw new Error('Usage: tree <query>');
        const win = await getWin(q);
        const state = await instance.getWindowState(win, { screenshot: false, text: true });
        console.log(state?.accessibility?.tree || '(no tree)');
        break;
      }

      case 'activate': {
        if (!q) throw new Error('Usage: activate <query>');
        const win = await getWin(q);
        await instance.activateWindow(win);
        console.log(`Activated: ${win.title || win.app}`);
        break;
      }

      case 'click': {
        const idx = parseInt(args[2], 10);
        if (!q || isNaN(idx)) throw new Error('Usage: click <query> <elementIndex>');
        const win = await getWin(q);
        await instance.click(win, { element_index: idx });
        console.log(`Clicked element ${idx} in ${win.title || win.app}`);
        break;
      }

      case 'click-xy': {
        const x = parseInt(args[2], 10), y = parseInt(args[3], 10);
        if (!q || isNaN(x) || isNaN(y)) throw new Error('Usage: click-xy <query> <x> <y>');
        const win = await getWin(q);
        await instance.click(win, { x, y });
        console.log(`Clicked (${x},${y}) in ${win.title || win.app}`);
        break;
      }

      case 'type': {
        const text = args.slice(2).join(' ');
        if (!q || !text) throw new Error('Usage: type <query> <text>');
        const win = await getWin(q);
        await instance.typeText(win, text);
        console.log(`Typed to ${win.title || win.app}`);
        break;
      }

      case 'key': {
        const key = args[2];
        if (!q || !key) throw new Error('Usage: key <query> <key>');
        const win = await getWin(q);
        await instance.pressKey(win, key);
        console.log(`Sent ${key} to ${win.title || win.app}`);
        break;
      }

      case 'launch': {
        if (!q) throw new Error('Usage: launch <appId>');
        await instance.launchApp(q);
        console.log(`Launched: ${q}`);
        break;
      }

      case 'set-value': {
        const idx = parseInt(args[2], 10);
        const value = args.slice(3).join(' ');
        if (!q || isNaN(idx) || !value) throw new Error('Usage: set-value <query> <elementIndex> <value>');
        const win = await getWin(q);
        await instance.setValue(win, idx, value);
        console.log(`Set value on element ${idx} in ${win.title || win.app}`);
        break;
      }

      case 'scroll': {
        const x = parseInt(args[2], 10), y = parseInt(args[3], 10);
        const sx = parseInt(args[4], 10), sy = parseInt(args[5], 10);
        if (!q || isNaN(x) || isNaN(y) || isNaN(sx) || isNaN(sy))
          throw new Error('Usage: scroll <query> <x> <y> <scrollX> <scrollY>');
        const win = await getWin(q);
        await instance.scroll(win, x, y, sx, sy);
        console.log(`Scrolled at (${x},${y}) in ${win.title || win.app}`);
        break;
      }

      case 'drag': {
        const fx = parseInt(args[2], 10), fy = parseInt(args[3], 10);
        const tx = parseInt(args[4], 10), ty = parseInt(args[5], 10);
        if (!q || isNaN(fx) || isNaN(fy) || isNaN(tx) || isNaN(ty))
          throw new Error('Usage: drag <query> <fromX> <fromY> <toX> <toY>');
        const win = await getWin(q);
        await instance.drag(win, fx, fy, tx, ty);
        console.log(`Dragged (${fx},${fy})→(${tx},${ty}) in ${win.title || win.app}`);
        break;
      }

      case 'secondary': {
        const idx = parseInt(args[2], 10);
        const action = args[3] || 'Raise';
        if (!q || isNaN(idx)) throw new Error('Usage: secondary <query> <elementIndex> [action]');
        const win = await getWin(q);
        await instance.performSecondaryAction(win, idx, action);
        console.log(`Performed "${action}" on element ${idx} in ${win.title || win.app}`);
        break;
      }

      default:
        console.error(`Unknown command: ${cmd}. Run with --help for usage.`);
        process.exit(1);
    }
  } finally {
    await instance.close();
  }
}