'use strict';
/**
 * 游戏架服务（零依赖）
 *   node server/serve.js         → 默认 8080，被占用自动顺延
 *
 * 两部分：
 *   1) 静态资源：只对外提供 index.html、games/、shared/
 *   2) 联机房间 API：任一多人游戏共用同一套"房主 - 准备 - 开局"规则
 *        POST /api/room/create   {game, name}
 *        POST /api/room/join     {game, code, name}
 *        POST /api/room/ready    {code, player, ready}
 *        POST /api/room/start    {code, player}     仅房主
 *        POST /api/room/restart  {code, player}     仅房主
 *        POST /api/room/leave    {code, player}
 *        POST /api/room/state    {code, player, patch}
 *        GET  /api/room/info?code=
 *        GET  /api/room/events?code=&player=        SSE 实时快照
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const BASE_PORT = Number(process.env.PORT || 8080);
const MAX_TRIES = 10;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav'
};

/** 白名单根：只允许这些目录下的文件 */
const ALLOWED_DIRS = ['games/neon-runner', 'games/sokoban', 'shared'].map((d) => path.join(ROOT, d));
const ALLOWED_FILES = [path.join(ROOT, 'index.html')];

function isInside(file, dir) {
  const rel = path.relative(dir, file);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function resolveTarget(pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  const clean = path.normalize(rel).replace(/^([/\\])+/, '');
  let full = path.join(ROOT, clean);

  // 目录先落到 index.html，再统一过白名单，避免绕过白名单读到目录入口
  if (fs.existsSync(full) && fs.statSync(full).isDirectory()) {
    full = path.join(full, 'index.html');
  }
  if (!fs.existsSync(full)) return null;

  if (ALLOWED_FILES.includes(full)) return full;
  for (const dir of ALLOWED_DIRS) {
    if (isInside(full, dir)) return full;
  }
  return null;
}

function lanAddresses() {
  const VIRTUAL = ['vethernet', 'hyper-v', 'wsl', 'vmware', 'virtualbox', 'atrust', 'vpn', 'tap-', 'loopback', 'tailscale', 'zerotier', 'docker'];
  const out = [];
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    const lower = name.toLowerCase();
    const virtual = VIRTUAL.some((k) => lower.includes(k));
    for (const net of nets[name] || []) {
      if (net.family !== 'IPv4' || net.internal) continue;
      out.push({ name, address: net.address, virtual });
    }
  }
  out.sort((a, b) => (a.virtual === b.virtual ? 0 : a.virtual ? 1 : -1));
  return out;
}

/* ==========================================================================
 *  联机房间
 *  规则：第一个进来的人是房主；其他人点准备；房主点开始，所有人同一时刻出发。
 *  这里只做"房间与开局"，具体玩法数据由各游戏通过 state 上报。
 * ========================================================================== */

const GAMES = {
  'neon-runner': { maxPlayers: 2, title: '霓虹疾走' },
  sokoban: { maxPlayers: 2, title: '仓库推箱' }
};

const ROOM_TTL = 2 * 60 * 60 * 1000;   // 空房间保留时长
const OFFLINE_GRACE = 15000;            // 断线宽限：期间重连仍是原来那个座位
const COUNTDOWN_MS = 3200;              // 房主点开始 → 真正起跑
const CODE_AB = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const rooms = new Map();

function uid() {
  return crypto.randomBytes(9).toString('hex');
}

function newCode() {
  let code = '';
  do {
    code = '';
    for (let i = 0; i < 4; i++) code += CODE_AB[Math.floor(Math.random() * CODE_AB.length)];
  } while (rooms.has(code));
  return code;
}

function cleanName(name, fallback) {
  const s = String(name == null ? '' : name).replace(/[\r\n\t]/g, ' ').trim().slice(0, 12);
  return s || fallback;
}

function snapshot(room) {
  return {
    code: room.code,
    game: room.game,
    title: (GAMES[room.game] || {}).title || '',
    hostId: room.hostId,
    status: room.status,          // lobby | countdown | playing | ended
    seed: room.seed,
    startAt: room.startAt,
    countdownMs: COUNTDOWN_MS,
    serverNow: Date.now(),
    createdAt: room.createdAt,
    maxPlayers: room.maxPlayers,
    round: room.round,
    result: room.result,
    shared: room.shared || null,
    players: room.players.map((p) => ({
      id: p.id,
      name: p.name,
      ready: p.ready,
      online: p.online,
      seat: p.seat,
      alive: p.alive,
      score: p.score,
      dist: p.dist,
      hp: p.hp,
      finalScore: p.finalScore,
      finishedAt: p.finishedAt
    }))
  };
}

function writeEvent(res, obj) {
  try {
    res.write('data: ' + JSON.stringify(obj) + '\n\n');
  } catch (_) { /* 连接已断，交给 close 处理 */ }
}

function broadcast(room) {
  room.touchedAt = Date.now();
  const snap = snapshot(room);
  for (const client of room.clients) writeEvent(client.res, snap);
}

function findRoom(code) {
  if (!code) return null;
  return rooms.get(String(code).toUpperCase()) || null;
}

function findPlayer(room, id) {
  if (!room) return null;
  return room.players.find((p) => p.id === id) || null;
}

function addPlayer(room, name) {
  const seat = room.players.length
    ? Math.max.apply(null, room.players.map((p) => p.seat)) + 1
    : 0;
  const p = {
    id: uid(),
    name: cleanName(name, '玩家' + (seat + 1)),
    ready: false,
    online: true,
    alive: true,
    score: 0,
    dist: 0,
    hp: 3,
    finalScore: 0,
    finishedAt: 0,
    seat: seat,
    joinedAt: Date.now()
  };
  room.players.push(p);
  if (!room.hostId) room.hostId = p.id;
  return p;
}

/** 房主走了就顺位交接，避免房间变成没人能开局的死局 */
function promoteHost(room) {
  if (findPlayer(room, room.hostId) && findPlayer(room, room.hostId).online) return;
  const next = room.players.filter((p) => p.online)[0] || room.players[0];
  room.hostId = next ? next.id : null;
}

function allReady(room) {
  const others = room.players.filter((p) => p.id !== room.hostId && p.online);
  return others.length > 0 && others.every((p) => p.ready);
}

function canStart(room) {
  const online = room.players.filter((p) => p.online);
  return online.length >= 2 && allReady(room);
}

function resetRound(room, keepPlayers) {
  room.status = 'lobby';
  room.result = null;
  room.startAt = 0;
  room.shared = null;
  room.round = (room.round || 0) + 1;
  for (const p of room.players) {
    p.ready = false;
    p.alive = true;
    p.score = 0;
    p.dist = 0;
    p.hp = 3;
    p.finalScore = 0;
    p.finishedAt = 0;
    if (!keepPlayers) p.online = p.online;
  }
}

function startRound(room) {
  room.status = 'countdown';
  room.result = null;
  room.shared = null;
  room.startAt = Date.now() + COUNTDOWN_MS;
  room.round = (room.round || 0) + 1;
  for (const p of room.players) {
    p.alive = true;
    p.score = 0;
    p.dist = 0;
    p.hp = 3;
    p.finalScore = 0;
    p.finishedAt = 0;
  }
  broadcast(room);

  setTimeout(() => {
    if (room.status !== 'countdown') return;
    room.status = 'playing';
    broadcast(room);
  }, COUNTDOWN_MS + 40);
}

/** 第一个把生命打空的人判负，对局立即结束（没有加时） */
function finishRound(room, loser) {
  if (room.status === 'ended') return;
  room.status = 'ended';
  room.result = {
    loserId: loser.id,
    loserName: loser.name,
    at: Date.now()
  };
  broadcast(room);

  // 双方在这 500ms 内各自补报最终分，之后客户端再渲染结算
  setTimeout(() => broadcast(room), 520);
}

function reapRoom(room) {
  if (room.status === 'playing' || room.status === 'countdown') return;
  const alive = room.players.filter((p) => p.online);
  if (alive.length === 0 && Date.now() - room.touchedAt > 60000) {
    rooms.delete(room.code);
  }
}

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*'
  });
  res.end(body);
}

function readJson(req) {
  return new Promise((resolve) => {
    let buf = '';
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 64 * 1024) { req.destroy(); resolve(null); return; }
      buf += chunk;
    });
    req.on('end', () => {
      if (!buf) return resolve({});
      try { resolve(JSON.parse(buf)); } catch (_) { resolve(null); }
    });
    req.on('error', () => resolve(null));
  });
}

function handleApi(req, res, pathname, query) {
  /* ---------- 房间快照（加入前先确认房间还在不在） ---------- */
  if (pathname === '/api/room/info' && req.method === 'GET') {
    const room = findRoom(query.get('code'));
    if (!room) return sendJson(res, 404, { ok: false, error: '房间不存在或已过期' });
    return sendJson(res, 200, { ok: true, room: snapshot(room) });
  }

  /* ---------- SSE 实时推送 ---------- */
  if (pathname === '/api/room/events' && req.method === 'GET') {
    const room = findRoom(query.get('code'));
    const player = findPlayer(room, query.get('player'));
    if (!room || !player) return sendJson(res, 404, { ok: false, error: '房间或座位已失效' });

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    res.write('retry: 1500\n\n');

    const client = { res: res, playerId: player.id };
    room.clients.add(client);
    player.online = true;
    room.touchedAt = Date.now();

    writeEvent(res, snapshot(room));
    // 让同房间其他人立刻看到"有人上线"
    broadcast(room);

    const ping = setInterval(() => {
      try { res.write(': ping\n\n'); } catch (_) { /* ignore */ }
    }, 20000);

    req.on('close', () => {
      clearInterval(ping);
      room.clients.delete(client);
      const p = findPlayer(room, client.playerId);
      if (p && !room.clients.has(client)) {
        p.online = false;
        p.ready = false;
        promoteHost(room);
        broadcast(room);
        setTimeout(() => {
          const still = room.players.find((x) => x.id === p.id);
          if (still && !still.online) {
            const wasActive = room.status === 'playing' || room.status === 'countdown';
            room.players = room.players.filter((x) => x.id !== still.id);
            room.players.forEach((x, i) => { x.seat = i; });
            if (wasActive && room.players.filter((x) => x.online).length > 0 && room.status !== 'ended') {
              room.status = 'ended';
              room.result = { loserId: still.id, loserName: still.name, at: Date.now(), reason: 'offline' };
            }
            promoteHost(room);
            broadcast(room);
            reapRoom(room);
          }
        }, OFFLINE_GRACE);
      }
    });
    return;
  }

  if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'method not allowed' });

  readJson(req).then((body) => {
    if (!body) return sendJson(res, 400, { ok: false, error: '请求格式错误' });
    const action = pathname.replace('/api/room/', '');

    /* ---------- 建房 ---------- */
    if (action === 'create') {
      const game = String(body.game || '');
      if (!GAMES[game]) return sendJson(res, 400, { ok: false, error: '未知的游戏' });
      const room = {
        code: newCode(),
        game: game,
        hostId: null,
        status: 'lobby',
        seed: (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0,
        startAt: 0,
        createdAt: Date.now(),
        touchedAt: Date.now(),
        maxPlayers: GAMES[game].maxPlayers,
        round: 0,
        result: null,
        players: [],
        clients: new Set()
      };
      rooms.set(room.code, room);
      const player = addPlayer(room, body.name);
      room.hostId = player.id;
      return sendJson(res, 200, { ok: true, playerId: player.id, room: snapshot(room) });
    }

    /* ---------- 加入 ---------- */
    if (action === 'join') {
      const room = findRoom(body.code);
      if (!room) return sendJson(res, 404, { ok: false, error: '房间号不对，或者房间已经关了' });
      if (body.game && body.game !== room.game) {
        return sendJson(res, 400, { ok: false, error: '这是另一个游戏的房间' });
      }

      // 同一浏览器重连同一个座位
      const back = findPlayer(room, body.playerId);
      if (back) {
        back.online = true;
        back.name = cleanName(body.name, back.name);
        broadcast(room);
        return sendJson(res, 200, { ok: true, playerId: back.id, room: snapshot(room) });
      }

      if (room.players.filter((p) => p.online || p.id).length >= room.maxPlayers) {
        return sendJson(res, 409, { ok: false, error: '房间满了' });
      }
      if (room.status !== 'lobby' && room.status !== 'ended') {
        return sendJson(res, 409, { ok: false, error: '这局已经开始了，等下一局吧' });
      }
      const player = addPlayer(room, body.name);
      broadcast(room);
      return sendJson(res, 200, { ok: true, playerId: player.id, room: snapshot(room) });
    }

    const room = findRoom(body.code);
    const player = findPlayer(room, body.player);
    if (!room || !player) return sendJson(res, 404, { ok: false, error: '房间或座位已失效' });

    /* ---------- 准备 / 取消准备 ---------- */
    if (action === 'ready') {
      if (room.status !== 'lobby' && room.status !== 'ended') {
        return sendJson(res, 409, { ok: false, error: '对局进行中' });
      }
      player.ready = !!body.ready;
      if (room.status === 'ended') resetRound(room, true);
      broadcast(room);
      return sendJson(res, 200, { ok: true, room: snapshot(room) });
    }

    /* ---------- 房主开局 ---------- */
    if (action === 'start') {
      if (room.hostId !== player.id) return sendJson(res, 403, { ok: false, error: '只有房主能开始' });
      if (room.status === 'countdown' || room.status === 'playing') {
        return sendJson(res, 409, { ok: false, error: '已经开局了' });
      }
      if (!canStart(room)) {
        return sendJson(res, 409, { ok: false, error: '至少 2 人，且其他人都准备好' });
      }
      startRound(room);
      return sendJson(res, 200, { ok: true, room: snapshot(room) });
    }

    /* ---------- 房主重开 ---------- */
    if (action === 'restart') {
      if (room.hostId !== player.id) return sendJson(res, 403, { ok: false, error: '只有房主能重开' });
      resetRound(room, true);
      broadcast(room);
      return sendJson(res, 200, { ok: true, room: snapshot(room) });
    }

    /* ---------- 离开 ---------- */
    if (action === 'leave') {
      const wasActive = room.status === 'playing' || room.status === 'countdown';
      room.players = room.players.filter((p) => p.id !== player.id);
      room.players.forEach((p, i) => { p.seat = i; });
      // 对局中途退出按弃权处理，对面直接赢
      if (wasActive && room.status !== 'ended' && room.players.filter((p) => p.online).length > 0) {
        room.status = 'ended';
        room.result = { loserId: player.id, loserName: player.name, at: Date.now(), reason: 'left' };
      }
      promoteHost(room);
      broadcast(room);
      reapRoom(room);
      return sendJson(res, 200, { ok: true });
    }

    /* ---------- 对局状态上报 ---------- */
    if (action === 'state') {
      const patch = body.patch || {};
      if (typeof patch.score === 'number') player.score = Math.max(0, Math.round(patch.score));
      if (typeof patch.dist === 'number') player.dist = Math.max(0, Math.round(patch.dist));
      if (typeof patch.hp === 'number') player.hp = Math.max(0, Math.round(patch.hp));
      if (typeof patch.finalScore === 'number') player.finalScore = Math.max(0, Math.round(patch.finalScore));
      // 回合制游戏（推箱子）用 shared 同步整张棋盘，谁操作谁上报
      if (patch.shared && typeof patch.shared === 'object') {
        let raw = '';
        try { raw = JSON.stringify(patch.shared); } catch (_) { raw = ''; }
        if (raw && raw.length <= 32768) {
          room.shared = patch.shared;
          room.sharedAt = Date.now();
        }
      }
      if (patch.alive === false && player.alive && room.status === 'playing') {
        player.alive = false;
        player.finishedAt = Date.now();
        finishRound(room, player);
      }
      broadcast(room);
      return sendJson(res, 200, { ok: true });
    }

    return sendJson(res, 404, { ok: false, error: 'unknown action' });
  });
}

/* ========================================================================== */

const server = http.createServer((req, res) => {
  let pathname = '/';
  let query = new URLSearchParams();
  try {
    const u = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
    pathname = u.pathname;
    query = u.searchParams;
  } catch (_) {
    res.writeHead(400); res.end('bad request'); return;
  }

  if (pathname.startsWith('/api/room/')) {
    handleApi(req, res, pathname, query);
    return;
  }

  // 目录跳转：/games/sokoban → /games/sokoban/
  if (!pathname.endsWith('/') && !path.extname(pathname)) {
    const probe = path.join(ROOT, pathname.replace(/^\/+/, ''));
    if (fs.existsSync(probe) && fs.statSync(probe).isDirectory()) {
      res.writeHead(302, { Location: pathname + '/' });
      res.end();
      return;
    }
  }

  const file = resolveTarget(pathname);
  if (!file) {
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<meta charset="utf-8"><body style="font:14px system-ui;padding:40px">404 · 没有这个页面<br><br><a href="/">回到游戏架</a></body>');
    return;
  }

  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(500); res.end('read error'); return; }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff'
    });
    res.end(buf);
  });
});

/* 定期清理彻底没人、且过了保留期的房间 */
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    const online = room.players.filter((p) => p.online).length;
    if (online === 0 && now - room.touchedAt > ROOM_TTL) rooms.delete(code);
  }
}, 5 * 60 * 1000).unref();

let port = BASE_PORT;

server.on('error', (err) => {
  if (err && err.code === 'EADDRINUSE' && port < BASE_PORT + MAX_TRIES) {
    console.log('  [提示] 端口 ' + port + ' 已被占用，改用 ' + (port + 1) + ' 重试…');
    port += 1;
    setTimeout(() => server.listen(port, '0.0.0.0'), 120);
    return;
  }
  console.error('  启动失败：' + (err && err.message));
  process.exit(1);
});

server.listen(port, '0.0.0.0', () => {
  const real = lanAddresses();
  const shown = real.filter((x) => !x.virtual);
  const list = shown.length ? shown : real;
  const p = server.address().port;
  console.log('');
  console.log('  游戏架 · 已启动');
  console.log('  ---------------------------------------------');
  console.log('  本机访问:  http://localhost:' + p);
  for (const item of list) {
    console.log('  局域网:    http://' + item.address + ':' + p + '   (' + item.name + ')');
  }
  console.log('  ---------------------------------------------');
  if (p !== BASE_PORT) console.log('  注意: 默认端口被占用，本次实际使用 ' + p + '。');
  console.log('  把上面的局域网地址发给别人，打开就能玩');
  console.log('  联机房间: 先进房间的人是房主，其他人准备后由房主开局');
  console.log('  停止服务: Ctrl + C');
  console.log('');
});
