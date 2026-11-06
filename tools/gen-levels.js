'use strict';
/**
 * 推箱子关卡生成器（反向拉箱法）
 *   node tools/gen-levels.js [数量]
 *
 * 原理：从"箱子全在目标上"的完成态出发，随机做反向的"拉箱"操作。
 * 反向路径天然就是一条可行解，因此生成的关卡一定可解；
 * 再由 verify-levels 的 BFS 算出真正的最优推数。
 */
const fs = require('fs');
const path = require('path');
const levelsMod = require(path.join(__dirname, '..', 'games', 'sokoban', 'levels.js'));

/* ---------- 可复现随机 ---------- */
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FAIL = {};
function fail(reason) { FAIL[reason] = (FAIL[reason] || 0) + 1; return null; }

const DIRS = [
  { dx: 0, dy: -1 }, { dx: 0, dy: 1 },
  { dx: -1, dy: 0 }, { dx: 1, dy: 0 }
];

/* ---------- 复用求解器 ---------- */
const verify = require('./solver.js');

function makeMap(W, H, rng, wallCount) {
  const g = [];
  for (let y = 0; y < H; y++) {
    const row = [];
    for (let x = 0; x < W; x++) {
      row.push(x === 0 || y === 0 || x === W - 1 || y === H - 1 ? '#' : ' ');
    }
    g.push(row);
  }

  const freeCells = () => {
    const out = [];
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) if (g[y][x] === ' ') out.push([x, y]);
    }
    return out;
  };

  const connected = () => {
    const seen = new Set();
    const all = freeCells();
    if (!all.length) return false;
    const stack = [all[0]];
    seen.add(all[0][0] + ',' + all[0][1]);
    while (stack.length) {
      const [x, y] = stack.pop();
      for (const d of DIRS) {
        const nx = x + d.dx, ny = y + d.dy;
        if (nx <= 0 || ny <= 0 || nx >= W - 1 || ny >= H - 1) continue;
        if (g[ny][nx] !== ' ') continue;
        const k = nx + ',' + ny;
        if (seen.has(k)) continue;
        seen.add(k);
        stack.push([nx, ny]);
      }
    }
    return seen.size === all.length;
  };

  let placed = 0, guard = 0;
  while (placed < wallCount && guard++ < 120) {
    const x = 1 + Math.floor(rng() * (W - 2));
    const y = 1 + Math.floor(rng() * (H - 2));
    if (g[y][x] !== ' ') continue;
    const horizontal = rng() < 0.5;
    const len = rng() < 0.45 ? 2 : 1;
    let ok = true;
    for (let i = 0; i < len; i++) {
      const nx = x + (horizontal ? i : 0);
      const ny = y + (horizontal ? 0 : i);
      if (nx <= 0 || ny <= 0 || nx >= W - 1 || ny >= H - 1 || g[ny][nx] !== ' ') { ok = false; break; }
    }
    if (!ok) continue;
    for (let i = 0; i < len; i++) g[y + (horizontal ? 0 : i)][x + (horizontal ? i : 0)] = '#';
    if (!connected()) {
      for (let i = 0; i < len; i++) g[y + (horizontal ? 0 : i)][x + (horizontal ? i : 0)] = ' ';
      continue;
    }
    placed++;
  }
  return g;
}

function generate(seed, cfg) {
  const rng = mulberry32(seed);
  const W = cfg.W, H = cfg.H;
  const g = makeMap(W, H, rng, cfg.walls);

  const cells = [];
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) if (g[y][x] === ' ') cells.push(y * W + x);
  }
  if (cells.length < cfg.boxes + 6) return fail('cells');

  const pick = (arr) => arr[Math.floor(rng() * arr.length)];
  const distTo = (a, c) =>
    Math.abs((a % W) - (c % W)) + Math.abs(Math.floor(a / W) - Math.floor(c / W));

  // 目标集中在同一片区域：箱子被反向拉到各处后，正向就要跨半个房间运输
  const goals = new Set();
  const anchor = pick(cells);
  goals.add(anchor);
  let guard = 0;
  const spread = rng() < 0.5 ? 4 : 6;
  while (goals.size < cfg.boxes && guard++ < 600) {
    const c = pick(cells);
    if (distTo(anchor, c) > spread) continue;
    let tooClose = false;
    for (const v of goals) {
      if (distTo(v, c) <= 1) { tooClose = true; break; }
    }
    if (!tooClose) goals.add(c);
  }
  if (goals.size < cfg.boxes) return fail('goals');

  const boxes = new Set(goals);
  let player = pick(cells);
  if (boxes.has(player)) {
    const alt = cells.filter((c) => !boxes.has(c));
    if (!alt.length) return fail('player');
    player = pick(alt);
  }

  const isFree = (c, extraSkip) => {
    if (g[Math.floor(c / W)][c % W] === '#') return false;
    if (boxes.has(c)) return false;
    if (c === extraSkip) return false;
    return true;
  };

  const reachable = (from, skipPlayer) => {
    const seen = new Set([from]);
    const stack = [from];
    while (stack.length) {
      const cur = stack.pop();
      const cx = cur % W, cy = Math.floor(cur / W);
      for (const d of DIRS) {
        const nx = cx + d.dx, ny = cy + d.dy;
        if (nx <= 0 || ny <= 0 || nx >= W - 1 || ny >= H - 1) continue;
        const nc = ny * W + nx;
        if (g[ny][nx] === '#' || boxes.has(nc) || seen.has(nc)) continue;
        seen.add(nc);
        stack.push(nc);
      }
    }
    return seen;
  };

  // 反向拉箱
  let steps = 0;
  let lastBox = -1;
  let sameCount = 0;
  for (let i = 0; i < cfg.walk; i++) {
    const reach = reachable(player);
    const cands = [];
    for (const b of boxes) {
      const bx = b % W, by = Math.floor(b / W);
      for (const d of DIRS) {
        // 反向拉箱：玩家站在箱子「后方」B-d，后退到 B-2d，
        // 箱子跟到玩家原位 B-d。正向就是从这里把箱子推到 B。
        const px = bx - d.dx, py = by - d.dy;
        const nx = bx - d.dx * 2, ny = by - d.dy * 2;
        if (px <= 0 || py <= 0 || px >= W - 1 || py >= H - 1) continue;
        if (nx <= 0 || ny <= 0 || nx >= W - 1 || ny >= H - 1) continue;
        const pCell = py * W + px;
        const nCell = ny * W + nx;
        if (!reach.has(pCell) || pCell === player) continue;
        if (g[ny][nx] === '#' || boxes.has(nCell)) continue;
        if (b === lastBox && sameCount >= 2) continue;
        cands.push({ b, pCell, nCell });
      }
    }
    if (!cands.length) break;
    const pickOne = pick(cands);
    boxes.delete(pickOne.b);
    boxes.add(pickOne.pCell);
    player = pickOne.nCell;
    sameCount = pickOne.b === lastBox ? sameCount + 1 : 1;
    lastBox = pickOne.b;
    steps++;
  }

  if (steps < cfg.minSteps) return fail('steps');

  // 初始状态里箱子不能已经在目标上，否则白给
  let onGoal = 0;
  for (const b of boxes) if (goals.has(b)) onGoal++;
  if (onGoal > Math.floor(boxes.size / 3)) return fail('onGoal');

  const rows = g.map((row) => row.slice());
  for (const c of goals) rows[Math.floor(c / W)][c % W] = '.';
  for (const b of boxes) {
    if (rows[Math.floor(b / W)][b % W] === '.') return fail('goalConflict');
    rows[Math.floor(b / W)][b % W] = '$';
  }
  rows[Math.floor(player / W)][player % W] = '@';

  // 裁掉空白边缘
  let minX = W, maxX = 0, minY = H, maxY = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (rows[y][x] !== ' ') {
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      }
    }
  }
  const map = rows.slice(minY, maxY + 1).map((r) => r.slice(minX, maxX + 1).join(''));
  return { map, boxes: boxes.size, steps };
}

function main() {
  const want = Number(process.argv[2] || 400);
  const cfgs = [
    { W: 9, H: 7, boxes: 3, walls: 1, walk: 120, minSteps: 40 },
    { W: 9, H: 7, boxes: 3, walls: 2, walk: 160, minSteps: 50 },
    { W: 11, H: 7, boxes: 3, walls: 2, walk: 190, minSteps: 60 },
    { W: 11, H: 8, boxes: 4, walls: 2, walk: 230, minSteps: 70 },
    { W: 11, H: 8, boxes: 4, walls: 3, walk: 270, minSteps: 80 },
    { W: 12, H: 8, boxes: 4, walls: 4, walk: 310, minSteps: 90 }
  ];

  const seen = new Set();
  const out = [];
  let tries = 0;
  const t0 = Date.now();

  while (out.length < want && tries < want * 60 && Date.now() - t0 < 210000) {
    tries++;
    const cfg = cfgs[tries % cfgs.length];
    const g = generate(1000 + tries * 7919, cfg);
    if (!g) continue;
    const key = g.map.join('\n');
    if (seen.has(key)) continue;
    seen.add(key);

    const level = { id: 0, name: 'cand', par: 0, map: g.map };
    const res = verify.solve(level, 900000, 20000);   // 生成时允许 20 秒，防止卡死
    if (!res.ok) continue;
    if (res.par < 14 || res.par > 55) continue;
    if (res.states > 1200000) continue;
    out.push({ map: g.map, boxes: g.boxes, par: res.par, states: res.states, steps: g.steps });
    process.stderr.write('.');
  }

  out.sort((a, b) => a.par - b.par);
  fs.writeFileSync(path.join(__dirname, '_candidates.json'), JSON.stringify(out, null, 2));
  console.log('\n失败原因: ' + JSON.stringify(FAIL));
  console.log('\n生成 ' + out.length + ' 关 / 尝试 ' + tries + ' 次 / 用时 ' + ((Date.now() - t0) / 1000).toFixed(1) + 's');
  for (const o of out) {
    console.log('\n--- par ' + o.par + ' | 箱子 ' + o.boxes + ' | 状态 ' + o.states + ' ---');
    console.log(o.map.map((r) => '  ' + r).join('\n'));
  }
}

main();
