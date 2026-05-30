/**
 * desktop-helper.mjs — General-purpose desktop automation workflows.
 *
 * Composable building blocks for any Windows application.
 * Works with any app that exposes accessibility tree elements.
 *
 * Usage:
 *   import { screenshotWindow, typeInWindow, pressInWindow } from './desktop-helper.mjs';
 *   await screenshotWindow('Notepad', 'output.png');
 *   await typeInWindow('Notepad', 'Hello World');
 *   await pressInWindow('Minecraft', 'Escape');
 */

import { ComputerUse } from './computer-use.mjs';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * Find a window by query.
 * @param {string} query - Window title or app name substring
 * @returns {Promise<object>} Window handle
 */
async function findWindow(query) {
  const cu = await ComputerUse.session();
  try {
    const wins = await cu.listWindows();
    const win = wins.find(w =>
      w.title?.toLowerCase().includes(query.toLowerCase()) ||
      w.app?.toLowerCase().includes(query.toLowerCase())
    );
    return win || null;
  } finally {
    await cu.close();
  }
}

/**
 * Take a screenshot of a window.
 * @param {string} query - Window title or app name
 * @param {string} outputPath - Where to save the PNG
 * @returns {Promise<string>} Saved file path
 */
export async function screenshotWindow(query, outputPath) {
  const cu = await ComputerUse.session();
  try {
    const wins = await cu.listWindows();
    const win = wins.find(w =>
      w.title?.toLowerCase().includes(query.toLowerCase()) ||
      w.app?.toLowerCase().includes(query.toLowerCase())
    );
    if (!win) throw new Error(`Window matching "${query}" not found`);

    await cu.activateWindow(win);
    const state = await cu.getWindowState(win, { screenshot: true });
    const savedPath = ComputerUse.saveScreenshot(state, outputPath);
    console.log(`Screenshot saved: ${savedPath}`);
    return savedPath;
  } finally {
    await cu.close();
  }
}

/**
 * Focus a window and type text.
 * @param {string} query - Window title or app name
 * @param {string} text - Text to type
 */
export async function typeInWindow(query, text) {
  const cu = await ComputerUse.session();
  try {
    const wins = await cu.listWindows();
    const win = wins.find(w =>
      w.title?.toLowerCase().includes(query.toLowerCase()) ||
      w.app?.toLowerCase().includes(query.toLowerCase())
    );
    if (!win) throw new Error(`Window matching "${query}" not found`);

    await cu.activateWindow(win);
    await cu.getWindowState(win, { text: true });
    await cu.typeText(win, text);
    console.log(`Typed "${text}" in ${win.title || win.app}`);
  } finally {
    await cu.close();
  }
}

/**
 * Focus a window and press a key.
 * @param {string} query - Window title or app name
 * @param {string} key - Key name (X11 keysym style)
 */
export async function pressInWindow(query, key) {
  const cu = await ComputerUse.session();
  try {
    const wins = await cu.listWindows();
    const win = wins.find(w =>
      w.title?.toLowerCase().includes(query.toLowerCase()) ||
      w.app?.toLowerCase().includes(query.toLowerCase())
    );
    if (!win) throw new Error(`Window matching "${query}" not found`);

    await cu.activateWindow(win);
    await cu.getWindowState(win, { text: true });
    await cu.pressKey(win, key);
    console.log(`Pressed "${key}" in ${win.title || win.app}`);
  } finally {
    await cu.close();
  }
}

/**
 * Focus a window and click an element by index.
 * @param {string} query - Window title or app name
 * @param {number} elementIndex - Element index from accessibility tree
 */
export async function clickInWindow(query, elementIndex) {
  const cu = await ComputerUse.session();
  try {
    const wins = await cu.listWindows();
    const win = wins.find(w =>
      w.title?.toLowerCase().includes(query.toLowerCase()) ||
      w.app?.toLowerCase().includes(query.toLowerCase())
    );
    if (!win) throw new Error(`Window matching "${query}" not found`);

    await cu.activateWindow(win);
    await cu.getWindowState(win, { text: true });
    await cu.click(win, { element_index: elementIndex });
    console.log(`Clicked element ${elementIndex} in ${win.title || win.app}`);
  } finally {
    await cu.close();
  }
}

/**
 * Read text content from a window.
 * @param {string} query - Window title or app name
 * @returns {Promise<string>} Window text content
 */
export async function getWindowText(query) {
  const cu = await ComputerUse.session();
  try {
    const wins = await cu.listWindows();
    const win = wins.find(w =>
      w.title?.toLowerCase().includes(query.toLowerCase()) ||
      w.app?.toLowerCase().includes(query.toLowerCase())
    );
    if (!win) throw new Error(`Window matching "${query}" not found`);

    await cu.activateWindow(win);
    const state = await cu.getWindowState(win, { text: true });
    const text = state?.accessibility?.document_text || '';
    return text;
  } finally {
    await cu.close();
  }
}

/**
 * List all visible windows.
 * @returns {Promise<Array>} Array of window objects
 */
export async function listWindows() {
  const cu = await ComputerUse.session();
  try {
    return await cu.listWindows();
  } finally {
    await cu.close();
  }
}

/**
 * Get accessibility tree of a window.
 * @param {string} query - Window title or app name
 * @returns {Promise<string>} Accessibility tree text
 */
export async function getTree(query) {
  const cu = await ComputerUse.session();
  try {
    const wins = await cu.listWindows();
    const win = wins.find(w =>
      w.title?.toLowerCase().includes(query.toLowerCase()) ||
      w.app?.toLowerCase().includes(query.toLowerCase())
    );
    if (!win) throw new Error(`Window matching "${query}" not found`);

    await cu.activateWindow(win);
    const state = await cu.getWindowState(win, { text: true });
    return state?.accessibility?.tree || '';
  } finally {
    await cu.close();
  }
}
