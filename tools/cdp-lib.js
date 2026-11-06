'use strict';
/**
 * 无头 Chrome 小工具（零依赖，Node 22 自带 WebSocket）
 * 只给 tools/ 下的自测脚本用，不对外暴露。
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.waiting = new Map();
    ws.addEventListener('message', (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch (_) { return; }
      if (msg.id && this.waiting.has(msg.id)) {
        const { resolve, reject } = this.waiting.get(msg.id);
        this.waiting.delete(msg.id);
        msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
      }
    });
  }

  static connect(url) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      ws.addEventListener('open', () => resolve(new CDP(ws)));
      ws.addEventListener('error', reject);
    });
  }

  send(method, params) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.waiting.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params: params || {} }));
      setTimeout(() => {
        if (this.waiting.has(id)) { this.waiting.delete(id); reject(new Error('cdp timeout ' + method)); }
      }, 15000);
    });
  }

  async eval(expression) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) {
      throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description));
    }
    return r.result.value;
  }

  async shot(file) {
    const r = await this.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
  }
}

function launchChrome(port, profile) {
  if (profile === undefined) profile = path.join(os.tmpdir(), 'cdp-' + Date.now() + '-' + port);
  return {
    proc: spawn(CHROME, [
      '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
      '--disable-extensions', '--mute-audio', '--window-size=1100,760',
      '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding',
      '--remote-debugging-port=' + port, '--user-data-dir=' + profile, 'about:blank'
    ], { stdio: 'ignore' }),
    profile: profile
  };
}

async function waitPort(port) {
  for (let i = 0; i < 80; i++) {
    try {
      const v = await fetch('http://127.0.0.1:' + port + '/json/version');
      if (v.ok) return true;
    } catch (_) { /* not up yet */ }
    await sleep(250);
  }
  return false;
}

async function newPage(port, url) {
  const r = await fetch('http://127.0.0.1:' + port + '/json/new?' + encodeURIComponent(url), { method: 'PUT' });
  const info = await r.json();
  const page = await CDP.connect(info.webSocketDebuggerUrl);
  await page.send('Page.enable');
  await page.send('Runtime.enable');
  return page;
}

async function waitFor(page, expr, timeout) {
  const t0 = Date.now();
  while (Date.now() - t0 < (timeout || 12000)) {
    if (await page.eval(expr)) return true;
    await sleep(120);
  }
  throw new Error('等待超时: ' + expr);
}

module.exports = { CHROME, sleep, CDP, launchChrome, waitPort, newPage, waitFor };
