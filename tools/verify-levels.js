'use strict';
/**
 * 推箱子关卡校验器
 *   node tools/verify-levels.js [--map]
 *
 * 做三件事：
 *   1) 检查地图是否合法（墙体闭合、箱子数 = 目标数、玩家唯一）
 *   2) 用「按推数计费」的 BFS 求最优推数（par），证明每关可解
 *   3) 与 levels.js 里声明的 par 对比，不一致直接报错退出
 *
 * 求解逻辑在 solver.js，生成器 gen-levels.js 共用同一份代码。
 */
const path = require('path');
const { solve, parse } = require('./solver.js');
const levels = require(path.join(__dirname, '..', 'sokoban', 'levels.js'));

let failed = 0;
const rows = [];

for (const level of levels) {
  // 校验不设时间上限：只看搜索状态数，保证同一关卡在任何机器上结论一致
  const res = solve(level, 3000000, 0);
  const boxCount = res.b.boxes.length;
  const board = res.b.W + '×' + res.b.H;

  if (res.ok) {
    const match = res.par === level.par;
    if (!match) failed++;
    rows.push({
      关卡: `${level.id}. ${level.name}`,
      棋盘: board,
      箱子: boxCount,
      最优推数: res.par,
      声明par: level.par,
      结果: match ? 'PASS' : 'PAR 不符',
      解法: res.path,
      搜索状态: res.states
    });
  } else {
    failed++;
    rows.push({
      关卡: `${level.id}. ${level.name}`,
      棋盘: board,
      箱子: boxCount,
      最优推数: '-',
      声明par: level.par,
      结果: 'FAIL: ' + res.problems.join(' / '),
      解法: '',
      搜索状态: res.states || 0
    });
  }
}

console.table(rows);

if (process.argv.includes('--map')) {
  for (const level of levels) {
    const b = parse(level);
    console.log('\n--- ' + level.id + '. ' + level.name + ' ---');
    console.log(b.rows.map((row, y) => String.fromCharCode(65 + y) + ' ' + row).join('\n'));
  }
}

// 难度曲线：par 应随关卡号递增
const pars = levels.map((l) => l.par);
const dips = [];
for (let i = 1; i < pars.length; i++) {
  if (pars[i] < pars[i - 1]) dips.push(`${i}→${i + 1} 关 (${pars[i - 1]} → ${pars[i]})`);
}

console.log('\n共 ' + levels.length + ' 关，失败 ' + failed + ' 关');
if (dips.length) console.log('难度曲线有回落：' + dips.join('，'));
process.exit(failed ? 1 : 0);
