'use strict';
/**
 * 推箱子求解核心（被 verify-levels.js 与 gen-levels.js 共用）
 * 状态压缩：箱子集合 + 玩家可达区域的最小格号
 * 剪枝：角落死锁、2×2 死锁
 */
const DIRS = [
  { dx: 0, dy: -1, ch: '↑' },
  { dx: 0, dy: 1, ch: '↓' },
  { dx: -1, dy: 0, ch: '←' },
  { dx: 1, dy: 0, ch: '→' }
];

function parse(level) {
  const rows = level.map;
  const H = rows.length;
  const W = Math.max(...rows.map((r) => r.length));
  const wall = new Uint8Array(W * H);
  const goal = new Uint8Array(W * H);
  const boxes = [];
  let player = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const ch = rows[y][x] || ' ';
      const i = y * W + x;
      if (ch === '#') wall[i] = 1;
      if (ch === '.' || ch === '*' || ch === '+') goal[i] = 1;
      if (ch === '$' || ch === '*') boxes.push(i);
      if (ch === '@' || ch === '+') player = i;
    }
  }
  return { W, H, wall, goal, boxes, player, rows };
}

function validate(level, b) {
  const problems = [];
  if (b.player < 0) problems.push('没有玩家 @');
  const goals = b.goal.reduce((n, v) => n + v, 0);
  if (goals !== b.boxes.length) problems.push(`箱子 ${b.boxes.length} 个 / 目标 ${goals} 个 不匹配`);
  if (!goals) problems.push('没有目标');

  const seen = new Uint8Array(b.W * b.H);
  const stack = [b.player >= 0 ? b.player : 0];
  seen[stack[0]] = 1;
  while (stack.length) {
    const cur = stack.pop();
    const cx = cur % b.W, cy = (cur - cx) / b.W;
    for (const d of DIRS) {
      const nx = cx + d.dx, ny = cy + d.dy;
      if (nx < 0 || ny < 0 || nx >= b.W || ny >= b.H) {
        problems.push('地图边界未封闭，存在可走出的缺口');
        stack.length = 0;
        break;
      }
      const ni = ny * b.W + nx;
      if (b.wall[ni] || seen[ni]) continue;
      seen[ni] = 1;
      stack.push(ni);
    }
  }
  for (const g of b.boxes.concat([...b.goal.keys()].filter((i) => b.goal[i]))) {
    if (!seen[g] && !b.goal[g]) problems.push('有箱子在墙外区域');
  }
  return problems;
}

function reachable(b, player, boxSet) {
  const { W, H, wall } = b;
  const seen = new Uint8Array(W * H);
  const stack = [player];
  seen[player] = 1;
  const cells = [];
  while (stack.length) {
    const cur = stack.pop();
    cells.push(cur);
    const cx = cur % W, cy = (cur - cx) / W;
    for (const d of DIRS) {
      const nx = cx + d.dx, ny = cy + d.dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const ni = ny * W + nx;
      if (wall[ni] || seen[ni] || boxSet.has(ni)) continue;
      seen[ni] = 1;
      stack.push(ni);
    }
  }
  cells.sort((a, c) => a - c);
  return { seen, min: cells[0], count: cells.length };
}

function isCornerDeadlock(b, cell) {
  const { W, H, wall, goal } = b;
  if (goal[cell]) return false;
  const cx = cell % W, cy = (cell - cx) / W;
  const up = cy === 0 || wall[cell - W];
  const down = cy === H - 1 || wall[cell + W];
  const left = cx === 0 || wall[cell - 1];
  const right = cx === W - 1 || wall[cell + 1];
  return (up || down) && (left || right);
}

/** 2×2 死锁：2×2 被墙/箱子填满，且其中存在不在目标上的箱子 */
function is2x2Deadlock(b, boxSet, cell) {
  const { W, H, wall, goal } = b;
  const cx = cell % W, cy = (cell - cx) / W;
  const SPD = [[-1, -1], [0, -1], [-1, 0], [0, 0]];
  for (let k = 0; k < 4; k++) {
    const x0 = cx + SPD[k][0], y0 = cy + SPD[k][1];
    if (x0 < 0 || y0 < 0 || x0 + 1 >= W || y0 + 1 >= H) continue;
    let filled = true, badBox = false;
    for (let i = 0; i < 2 && filled; i++) {
      for (let j = 0; j < 2; j++) {
        const c = (y0 + j) * W + (x0 + i);
        if (!wall[c] && !boxSet.has(c)) { filled = false; break; }
        if (boxSet.has(c) && !goal[c]) badBox = true;
      }
    }
    if (filled && badBox) return true;
  }
  return false;
}

/**
 * BFS 求解（按推动次数计费）
 * @param maxStates  状态数上限 —— 确定性判据，同一关卡在任何机器上结论一致
 * @param timeoutMs  时间上限 —— 仅供生成器防卡死；校验必须传 0（不限），
 *                   否则慢机器上会误报"无解"
 */
function solve(level, maxStates = 2500000, timeoutMs = 0) {
  const b = parse(level);
  const problems = validate(level, b);
  if (problems.length) return { ok: false, problems, b };

  const startBoxes = b.boxes.slice().sort((x, z) => x - z);
  const goalCount = b.boxes.length;
  const key = (boxes, min) => boxes.join(',') + '|' + min;

  const q = [{ boxes: startBoxes, player: b.player, dist: 0, path: '' }];
  const visited = new Set();
  const boxSet = new Set(startBoxes);

  {
    const r0 = reachable(b, b.player, boxSet);
    visited.add(key(startBoxes, r0.min));
  }

  let states = 0;
  let head = 0;
  const t0 = Date.now();
  while (head < q.length) {
    const state = q[head++];
    states++;
    if (states > maxStates) return { ok: false, problems: ['搜索状态超限，关卡可能过于复杂'], b, states };
    // 时间上限只给生成器用，避免卡死在一个巨大状态空间上
    if (timeoutMs > 0 && (states & 4095) === 0 && Date.now() - t0 > timeoutMs) {
      return { ok: false, problems: ['求解超时（' + Math.round(timeoutMs / 1000) + ' 秒）'], b, states };
    }

    boxSet.clear();
    for (const v of state.boxes) boxSet.add(v);

    const onGoal = state.boxes.filter((v) => b.goal[v]).length;
    if (onGoal === goalCount) return { ok: true, par: state.dist, path: state.path, states, b };

    const reach = reachable(b, state.player, boxSet);

    for (let bi = 0; bi < state.boxes.length; bi++) {
      const box = state.boxes[bi];
      const bx = box % b.W, by = (box - bx) / b.W;
      for (const d of DIRS) {
        const px = bx - d.dx, py = by - d.dy;
        const gx = bx + d.dx, gy = by + d.dy;
        if (px < 0 || py < 0 || px >= b.W || py >= b.H) continue;
        if (gx < 0 || gy < 0 || gx >= b.W || gy >= b.H) continue;
        const pCell = py * b.W + px;
        const gCell = gy * b.W + gx;
        if (!reach.seen[pCell]) continue;
        if (b.wall[gCell] || boxSet.has(gCell)) continue;
        if (isCornerDeadlock(b, gCell)) continue;

        const nextBoxes = state.boxes.slice();
        nextBoxes[bi] = gCell;
        nextBoxes.sort((x, z) => x - z);

        const nextSet = new Set(nextBoxes);
        if (is2x2Deadlock(b, nextSet, gCell)) continue;
        const r2 = reachable(b, box, nextSet);
        const k = key(nextBoxes, r2.min);
        if (visited.has(k)) continue;
        visited.add(k);
        q.push({ boxes: nextBoxes, player: box, dist: state.dist + 1, path: state.path + d.ch });
      }
    }
  }
  return { ok: false, unsolvable: true, problems: ['无解（穷尽所有推法都到不了）'], b, states };
}

module.exports = { DIRS, parse, validate, reachable, isCornerDeadlock, is2x2Deadlock, solve };
