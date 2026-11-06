'use strict';
/**
 * 推箱子联机自测：两个浏览器实例，协作推同一张图
 *   node tools/test-sokoban-net.js
 */
const fs = require('fs');
const { sleep, launchChrome, waitPort, newPage, waitFor } = require('./cdp-lib');

const BASE = process.argv[2] || 'http://127.0.0.1:8080';
const P1 = 9341, P2 = 9343;

let pass = 0, fail = 0;
const ok = (n, c, x) => {
  if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (x !== undefined ? '  → ' + JSON.stringify(x) : '')); }
};

const press = (page, code) => page.eval(
  `document.dispatchEvent(new KeyboardEvent('keydown', { code: '${code}', bubbles: true, cancelable: true })); true`
);

/** 朝四个方向试一遍，返回真正走了一步之后的状态 */
async function step(page) {
  const before = await page.eval('__sokState()');
  for (const k of ['KeyD', 'KeyS', 'KeyW', 'KeyA']) {
    await press(page, k);
    const after = await page.eval('__sokState()');
    const moved = after.players.some((p, i) => p.x !== before.players[i].x || p.y !== before.players[i].y);
    if (moved) return after;
  }
  return before;
}

(async function () {
  console.log('\n推箱子联机自测 · ' + BASE + '\n');
  const a = launchChrome(P1);
  const b = launchChrome(P2);
  let A = null, B = null;

  try {
    if (!(await waitPort(P1)) || !(await waitPort(P2))) throw new Error('Chrome 没起来');

    A = await newPage(P1, BASE + '/sokoban/');
    await waitFor(A, '!!document.querySelector("[data-mode=net]")', 15000);
    await A.eval('document.querySelector("[data-mode=net]").click()');
    await waitFor(A, '!!document.getElementById("grName")');
    await A.eval(`
      document.getElementById('grName').value = '推箱甲';
      document.querySelector('[data-act=create]').click();
      true
    `);
    await waitFor(A, '!!document.querySelector(".gr-code-box b")');
    const code = (await A.eval('document.querySelector(".gr-code-box b").textContent.trim()')).toUpperCase();
    ok('房主建出房间', /^[A-Z0-9]{4}$/.test(code), code);

    B = await newPage(P2, BASE + '/sokoban/?room=' + code);
    await waitFor(B, '!!document.querySelector("[data-act=join]")', 15000);
    await B.eval(`
      document.getElementById('grName').value = '推箱乙';
      document.querySelector('[data-act=join]').click();
      true
    `);
    await waitFor(A, 'document.querySelectorAll(".gr-seat").length === 2 && !document.querySelector(".gr-seat.gr-empty")');
    ok('队友进来了', true);

    await B.eval('document.querySelector("[data-act=ready]").click()');
    await waitFor(A, 'document.querySelector("[data-act=start]") && !document.querySelector("[data-act=start]").disabled');
    await A.eval('document.querySelector("[data-act=start]").click()');

    await waitFor(A, '__sokState().mode === "net"', 12000);
    await waitFor(B, '__sokState().mode === "net"', 12000);
    ok('双方进入联机协作', true);

    await sleep(700);

    // 第 1 关只有 1 个箱子、一步就通关，先换到第 3 关再测操作与同步
    await A.eval('document.getElementById("btnLv").click(); true');
    await sleep(200);
    await A.eval('document.getElementById("lvGrid").children[2].click(); true');
    await sleep(900);

    const sa0 = await A.eval('__sokState()');
    const sb0 = await B.eval('__sokState()');
    ok('双方在同一关', sa0.index === sb0.index && sa0.index === 2, [sa0.index, sb0.index]);
    ok('场上两个工人', sa0.players.length === 2 && sb0.players.length === 2);
    ok('换关后棋盘一致', JSON.stringify(sa0.boxes) === JSON.stringify(sb0.boxes), { a: sa0.boxes, b: sb0.boxes });
    await A.shot('C:/Users/EDY/Desktop/项目/game/arcade/sokoban/preview-net.png');

    // ---- 房主走一步，队友那边要跟着动 ----
    const moved = await step(A);
    const aMoved = moved.players[0];
    await sleep(600);
    const sb1 = await B.eval('__sokState()');
    if (process.env.DEBUG) {
      console.log('  [dbg] A shared:', await A.eval('window.__room && JSON.stringify(window.__room.snap.shared).slice(0,160)'));
      console.log('  [dbg] B shared:', await B.eval('window.__room && JSON.stringify(window.__room.snap.shared).slice(0,160)'));
      console.log('  [dbg] A state :', JSON.stringify(moved).slice(0, 200));
      console.log('  [dbg] B state :', JSON.stringify(sb1).slice(0, 200));
    }
    ok('房主能控制自己的工人', aMoved.x !== sa0.players[0].x || aMoved.y !== sa0.players[0].y || moved.moves > sa0.moves, aMoved);
    ok('队友看到房主的位置', sb1.players[0].x === aMoved.x && sb1.players[0].y === aMoved.y, { b: sb1.players[0], a: aMoved });
    ok('队友看到相同的棋盘', JSON.stringify(sb1.boxes) === JSON.stringify(moved.boxes));

    // ---- 队友走一步，房主那边要跟着动 ----
    const movedB = await step(B);
    await sleep(600);
    const sa2 = await A.eval('__sokState()');
    ok('队友控制的是另一个工人', movedB.players[1].x !== sb1.players[1].x || movedB.players[1].y !== sb1.players[1].y || movedB.moves > sb1.moves, movedB.players[1]);
    ok('房主看到队友的位置', sa2.players[1].x === movedB.players[1].x && sa2.players[1].y === movedB.players[1].y, { a: sa2.players[1], b: movedB.players[1] });
    ok('双方棋盘仍然一致', JSON.stringify(sa2.boxes) === JSON.stringify(movedB.boxes));

    // ---- 房主换关，队友跟着换 ----
    await A.eval('document.getElementById("btnLv").click(); true');
    await sleep(200);
    await A.eval('document.getElementById("lvGrid").children[4].click(); true');
    await sleep(900);
    const sa3 = await A.eval('__sokState()');
    const sb3 = await B.eval('__sokState()');
    ok('房主换关后队友同步到同一关', sa3.index === sb3.index && sa3.index === 4, [sa3.index, sb3.index]);
    ok('新关卡棋盘一致', JSON.stringify(sa3.boxes) === JSON.stringify(sb3.boxes));

    // ---- 重来：双方一起回到起点 ----
    const beforeReset = await A.eval('__sokState()');
    await A.eval('document.getElementById("btnReset").click(); true');
    await sleep(700);
    const afterReset = await B.eval('__sokState()');
    ok('重来会同步到队友', afterReset.moves === 0, { moves: afterReset.moves, before: beforeReset.moves });
  } catch (err) {
    fail++;
    console.log('  ERROR  ' + err.message);
  } finally {
    try { a.proc.kill(); } catch (_) { /* ignore */ }
    try { b.proc.kill(); } catch (_) { /* ignore */ }
    await sleep(300);
    try { fs.rmSync(a.profile, { recursive: true, force: true }); } catch (_) { /* ignore */ }
    try { fs.rmSync(b.profile, { recursive: true, force: true }); } catch (_) { /* ignore */ }
  }

  console.log('\n  结果: ' + pass + ' 通过 / ' + fail + ' 失败\n');
  process.exit(fail ? 1 : 0);
})();
