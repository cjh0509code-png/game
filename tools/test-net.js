'use strict';
/**
 * 联机双端自测：真·两个浏览器标签，走完整流程
 *   node tools/test-net.js
 *
 * 需要本机装有 Chrome，服务已在 8080 运行。
 * 只测跑酷（跑酷是最吃同步的一个）。
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9333;
const BASE = process.argv[2] || 'http://127.0.0.1:8080';
const PROFILE = path.join(os.tmpdir(), 'neon-cdp-' + Date.now());

let pass = 0, fail = 0;
const ok = (n, c, x) => {
  if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (x !== undefined ? '  → ' + JSON.stringify(x) : '')); }
};
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
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description));
    return r.result.value;
  }
  async shot(file) {
    const r = await this.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
  }
}

async function waitFor(page, expr, timeout) {
  const t0 = Date.now();
  while (Date.now() - t0 < (timeout || 12000)) {
    if (await page.eval(expr)) return true;
    await sleep(120);
  }
  throw new Error('等待超时: ' + expr);
}

async function newPage(port, url) {
  const r = await fetch('http://127.0.0.1:' + port + '/json/new?' + encodeURIComponent(url), { method: 'PUT' });
  const info = await r.json();
  const page = await CDP.connect(info.webSocketDebuggerUrl);
  await page.send('Page.enable');
  await page.send('Runtime.enable');
  return page;
}

function launchChrome(port, profile) {
  return spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--mute-audio', '--window-size=1100,760',
    '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding',
    '--remote-debugging-port=' + port, '--user-data-dir=' + profile, 'about:blank'
  ], { stdio: 'ignore' });
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

(async function () {
  if (!fs.existsSync(CHROME)) {
    console.log('  找不到 Chrome，跳过浏览器联调：' + CHROME);
    process.exit(0);
  }

  console.log('\n联机双端自测 · ' + BASE + '\n');

  // 两个独立浏览器实例，模拟两台设备（同一浏览器的两个标签会被后台节流，测不准）
  const chromeA = launchChrome(PORT, PROFILE);
  const chromeB = launchChrome(PORT + 2, PROFILE + '-b');

  let A = null, B = null;
  try {
    if (!(await waitPort(PORT)) || !(await waitPort(PORT + 2))) throw new Error('Chrome 调试端口没起来');

    A = await newPage(PORT, BASE + '/games/neon-runner/');
    await waitFor(A, '!!document.getElementById("btnNet")', 15000);

    // ---- A 建房 ----
    await A.eval('document.getElementById("btnNet").click()');
    await waitFor(A, '!!document.getElementById("grName")');
    await A.eval(`
      document.getElementById('grName').value = '房主小明';
      document.querySelector('[data-act=create]').click();
      true
    `);
    await waitFor(A, '!!document.querySelector(".gr-code-box b")');
    const code = (await A.eval('document.querySelector(".gr-code-box b").textContent.trim()')).toUpperCase();
    ok('房主建出房间', /^[A-Z0-9]{4}$/.test(code), code);
    ok('房主看到自己是房主', await A.eval('!!document.querySelector(".gr-badge.gr-host")'));
    ok('空位提示还在', await A.eval('!!document.querySelector(".gr-seat.gr-empty")'));

    // ---- B 通过邀请链接进来 ----
    B = await newPage(PORT + 2, BASE + '/games/neon-runner/?room=' + code);
    await waitFor(B, '!!document.querySelector("[data-act=join]")', 15000);
    await B.eval(`
      document.getElementById('grName').value = '队友阿强';
      document.querySelector('[data-act=join]').click();
      true
    `);
    await sleep(1000);
    if (process.env.DEBUG) {
      console.log('  [dbg] B err  :', await B.eval('(document.querySelector(".gr-err")||{}).textContent'));
      console.log('  [dbg] B seat :', await B.eval('document.querySelectorAll(".gr-seat").length'));
      console.log('  [dbg] A seat :', await A.eval('document.querySelectorAll(".gr-seat").length'));
      console.log('  [dbg] B net  :', JSON.stringify(await B.eval('__neonState().net')));
      console.log('  [dbg] A net  :', JSON.stringify(await A.eval('__neonState().net')));
    }
    await waitFor(A, 'document.querySelectorAll(".gr-seat").length === 2 && !document.querySelector(".gr-seat.gr-empty")');
    ok('房主看到队友进来了', await A.eval('document.querySelectorAll(".gr-seat").length === 2'));

    const earlyDisabled = await A.eval('document.querySelector("[data-act=start]").disabled');
    ok('队友没准备时，开始按钮是灰的', earlyDisabled === true);

    // ---- B 准备 ----
    await B.eval('document.querySelector("[data-act=ready]").click()');
    await waitFor(A, 'document.querySelector("[data-act=start]") && !document.querySelector("[data-act=start]").disabled');
    ok('准备后房主可以开始', true);

    await A.shot(path.join(__dirname, '..', 'games', 'neon-runner', 'preview-lobby.png'));

    // ---- 房主开局 ----
    const t0 = Date.now();
    await A.eval('document.querySelector("[data-act=start]").click()');
    await waitFor(A, '__neonState().state === "play"', 12000);
    await waitFor(B, '__neonState().state === "play"', 12000);
    const lag = Date.now() - t0;
    ok('双方都进入对局', true);
    ok('开局不超过 5 秒（含 3 秒倒计时）', lag < 5200, lag);

    await sleep(1200);
    const sa = await A.eval('__neonState()');
    const sb = await B.eval('__neonState()');

    ok('双方都是联机模式', sa.mode === 'net' && sb.mode === 'net');
    ok('双方拿到同一个种子', sa.seed === sb.seed && sa.seed > 0, [sa.seed, sb.seed]);
    ok('起跑时间基本对齐（<0.5s）', Math.abs(sa.elapsed - sb.elapsed) < 0.5, [sa.elapsed, sb.elapsed]);

    // 两台设备屏幕宽度未必一样，生成位置会按各自宽度缩放；
    // 公平性靠的是同一套"剧本"，所以比类型序列，不比像素坐标
    const obsA = (sa.lanes[0].obs || []).slice(0, 6).map((o) => o.type);
    const obsB = (sb.lanes[0].obs || []).slice(0, 6).map((o) => o.type);
    ok('两边障碍剧本一致', JSON.stringify(obsA) === JSON.stringify(obsB), { obsA, obsB });

    // ---- 一方掉完血：服务端裁定，双方同一结果 ----
    const aId = sa.net.selfId;
    await fetch(BASE + '/api/room/state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, player: aId, patch: { alive: false, hp: 0, finalScore: 640, dist: 260 } })
    });
    await waitFor(A, '__neonState().state === "over"', 8000);
    await waitFor(B, '__neonState().state === "over"', 8000);

    await sleep(700);
    const titleA = await A.eval('document.getElementById("overTitle").textContent');
    const titleB = await B.eval('document.getElementById("overTitle").textContent');
    ok('房主（先掉血）看到出局', titleA.replace(/\s/g, '').indexOf('出局') >= 0, titleA);
    ok('队友看到自己赢', titleB.replace(/\s/g, '').indexOf('赢') >= 0, titleB);

    await B.shot(path.join(__dirname, '..', 'games', 'neon-runner', 'preview-win.png'));

    // ---- 房主重开，双方回到房间 ----
    await A.eval('document.getElementById("btnRetry").click()');
    await waitFor(A, '!!document.querySelector("[data-act=start]")', 8000);
    await waitFor(B, '!!document.querySelector("[data-act=ready]")', 8000);
    ok('重开后双方都回到房间面板', true);
    ok('重开后队友需要重新准备', await B.eval('!!document.querySelector("[data-act=ready]")'));

    await A.shot(path.join(__dirname, '..', 'games', 'neon-runner', 'preview-lobby.png'));
  } catch (err) {
    fail++;
    console.log('  ERROR  ' + err.message);
  } finally {
    try { chromeA.kill(); } catch (_) { /* ignore */ }
    try { chromeB.kill(); } catch (_) { /* ignore */ }
    await sleep(300);
    try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch (_) { /* ignore */ }
    try { fs.rmSync(PROFILE + '-b', { recursive: true, force: true }); } catch (_) { /* ignore */ }
  }

  console.log('\n  结果: ' + pass + ' 通过 / ' + fail + ' 失败\n');
  process.exit(fail ? 1 : 0);
})();
