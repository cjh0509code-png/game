'use strict';
/**
 * 房间流程自测（零依赖）
 *   node tools/test-room.js [baseUrl]
 *
 * 覆盖：建房 → 加入 → 未准备不能开 → 准备 → 开局 → 倒计时 → 有人掉血判负 → 重开
 */
const BASE = process.argv[2] || 'http://127.0.0.1:8080';

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '  → ' + JSON.stringify(extra) : '')); }
}

async function post(action, body) {
  const r = await fetch(BASE + '/api/room/' + action, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {})
  });
  return { status: r.status, body: await r.json() };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async function () {
  console.log('\n房间流程自测 · ' + BASE + '\n');

  const created = await post('create', { game: 'neon-runner', name: '房主' });
  ok('建房成功', created.body.ok === true, created.body);
  const code = created.body.room.code;
  const host = created.body.playerId;
  ok('房主是第一个进来的人', created.body.room.hostId === host);
  ok('房间号是 4 位', /^[A-Z0-9]{4}$/.test(code), code);
  ok('初始状态 lobby', created.body.room.status === 'lobby');

  const joinNoCode = await post('join', { game: 'neon-runner', code: 'ZZZZ', name: '路人' });
  ok('错误房间号会被拒绝', joinNoCode.body.ok === false);

  const joined = await post('join', { game: 'neon-runner', code: code, name: '队友' });
  ok('第二个人能加入', joined.body.ok === true, joined.body);
  const guest = joined.body.playerId;
  ok('加入者不是房主', joined.body.room.hostId === host);
  ok('房间里有 2 个人', joined.body.room.players.length === 2);

  const early = await post('start', { code: code, player: host });
  ok('队友没准备时不能开局', early.body.ok === false, early.body);

  const guestStart = await post('start', { code: code, player: guest });
  ok('非房主不能开局', guestStart.body.ok === false, guestStart.body);

  await post('ready', { code: code, player: guest, ready: true });
  const info1 = await (await fetch(BASE + '/api/room/info?code=' + code)).json();
  ok('准备状态已记录', info1.room.players.find((p) => p.id === guest).ready === true);

  const started = await post('start', { code: code, player: host });
  ok('房主开局成功', started.body.ok === true, started.body);
  ok('进入倒计时', started.body.room.status === 'countdown');
  ok('有统一起跑时间', started.body.room.startAt > Date.now() - 100);

  await sleep(3600);
  const info2 = await (await fetch(BASE + '/api/room/info?code=' + code)).json();
  ok('倒计时结束进入对局', info2.room.status === 'playing', info2.room.status);

  await post('state', { code: code, player: guest, patch: { score: 320, dist: 110, hp: 2 } });
  const info3 = await (await fetch(BASE + '/api/room/info?code=' + code)).json();
  const gp = info3.room.players.find((p) => p.id === guest);
  ok('分数能同步到服务端', gp.score === 320 && gp.dist === 110, gp);

  await post('state', { code: code, player: host, patch: { alive: false, hp: 0, finalScore: 480, dist: 150 } });
  await sleep(80);
  const info4 = await (await fetch(BASE + '/api/room/info?code=' + code)).json();
  ok('有人血掉完，对局立刻结束', info4.room.status === 'ended', info4.room.status);
  ok('判负对象正确', info4.room.result && info4.room.result.loserId === host, info4.room.result);

  const badRestart = await post('restart', { code: code, player: guest });
  ok('非房主不能重开', badRestart.body.ok === false);

  const re = await post('restart', { code: code, player: host });
  ok('房主可以重开', re.body.ok === true, re.body);
  ok('重开后回到大厅', re.body.room.status === 'lobby');
  ok('重开后准备状态清零', re.body.room.players.every((p) => !p.ready));

  await post('leave', { code: code, player: guest });
  const info5 = await (await fetch(BASE + '/api/room/info?code=' + code)).json();
  ok('离开后房间只剩 1 人', info5.room.players.length === 1);
  ok('房主还在', info5.room.hostId === host);

  await post('leave', { code: code, player: host });
  const info6 = await fetch(BASE + '/api/room/info?code=' + code);
  if (info6.status === 404) {
    ok('最后一人离开后房间失效', true);
  } else {
    const j6 = await info6.json();
    // 房间会留 60 秒给刷新重连，但必须已经没人、也不能再被当成有人的房
    ok('最后一人离开后房间清空', j6.room && j6.room.players.length === 0, j6.room && j6.room.players);
  }

  console.log('\n  结果: ' + pass + ' 通过 / ' + fail + ' 失败\n');
  process.exit(fail ? 1 : 0);
})();
