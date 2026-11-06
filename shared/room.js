/**
 * GameRoom —— 公用联机房间客户端
 *
 * 任何多人游戏只要引这一行：
 *   <script src="../../shared/room.js"></script>
 *
 * 然后：
 *   GameRoom.open({
 *     game: 'neon-runner',
 *     onStart: function (ctx) { ... },     // 所有人同一时刻收到，ctx.seed / ctx.startAt / ctx.self / ctx.players
 *     onSnapshot: function (snap) { ... },// 房间快照变化（含对手分数、血量）
 *     onEnd: function (snap) { ... },     // 有人先倒下，本局结束
 *     onEnter: function (room) { ... }    // 真正进了房间（可选）
 *   }).then(function (room) { roomRef = room; });
 *
 * 房间对象：
 *   room.selfId / room.isHost() / room.self() / room.opponent() / room.players()
 *   room.ready(true|false) / room.start() / room.restart() / room.leave()
 *   room.report({score, dist, hp, alive, finalScore})   游戏内状态上报（自动节流）
 *   room.elapsed()  从统一起跑线到现在过了几秒
 *   room.title / room.code
 */
(function (global) {
  'use strict';

  var API = '/api/room/';
  var CSS_ID = 'groom-style';
  var $ = function (s, r) { return (r || document).querySelector(s); };

  var CSS = [
    '#grRoot{position:fixed;inset:0;z-index:9000;display:flex;align-items:center;justify-content:center;',
    'font:14px/1.5 system-ui,-apple-system,"Segoe UI","Noto Sans SC",sans-serif;color:#e8f2ff;',
    '-webkit-tap-highlight-color:transparent}',
    '#grRoot.gr-off{display:none}',
    '#grRoot .gr-mask{position:absolute;inset:0;background:rgba(4,8,18,.86);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px)}',
    '#grRoot .gr-card{position:relative;width:min(430px,calc(100vw - 32px));max-height:calc(100vh - 40px);overflow:auto;',
    'background:linear-gradient(180deg,#0e1730,#0a1024);border:1px solid rgba(94,240,255,.22);border-radius:20px;',
    'padding:26px 24px 24px;box-shadow:0 24px 70px rgba(0,0,0,.6),0 0 0 1px rgba(255,255,255,.03) inset,0 0 60px rgba(94,240,255,.06)}',
    '#grRoot h2{margin:0 0 4px;font-size:20px;letter-spacing:2px;font-weight:800}',
    '#grRoot .gr-sub{margin:0 0 20px;font-size:12px;color:#7d90b3;letter-spacing:.5px}',
    '#grRoot .gr-field{display:flex;gap:8px;margin-bottom:12px}',
    '#grRoot input{flex:1;min-width:0;background:#0a1224;border:1px solid rgba(120,160,220,.22);border-radius:11px;',
    'padding:12px 14px;color:#e8f2ff;font:inherit;outline:none;transition:border-color .15s,box-shadow .15s}',
    '#grRoot input:focus{border-color:#5ef0ff;box-shadow:0 0 0 3px rgba(94,240,255,.12)}',
    '#grRoot input::placeholder{color:#55688a}',
    '#grRoot input.gr-code{text-transform:uppercase;letter-spacing:6px;text-align:center;font-weight:800;font-size:16px}',
    '#grRoot input.gr-code::placeholder{letter-spacing:1px;font-weight:500;font-size:14px;text-transform:none}',
    '#grRoot button{font:inherit;border:0;cursor:pointer;border-radius:11px;padding:12px 16px;transition:transform .12s,filter .15s,opacity .15s}',
    '#grRoot button:active{transform:scale(.97)}',
    '#grRoot .gr-primary{width:100%;background:linear-gradient(135deg,#5ef0ff,#4a9bff);color:#04121e;font-weight:800;letter-spacing:1px}',
    '#grRoot .gr-primary:hover{filter:brightness(1.08)}',
    '#grRoot .gr-primary[disabled]{opacity:.4;cursor:not-allowed;filter:none;transform:none}',
    '#grRoot .gr-ghost{background:rgba(120,160,220,.10);color:#b9cbe8;border:1px solid rgba(120,160,220,.18)}',
    '#grRoot .gr-ghost:hover{background:rgba(120,160,220,.18)}',
    '#grRoot .gr-split{display:flex;align-items:center;gap:12px;margin:18px 0 14px;color:#4f6183;font-size:11px;letter-spacing:2px}',
    '#grRoot .gr-split::before,#grRoot .gr-split::after{content:"";flex:1;height:1px;background:rgba(120,160,220,.16)}',
    '#grRoot .gr-tip{margin:16px 0 0;font-size:11.5px;line-height:1.7;color:#64789b}',
    '#grRoot .gr-err{color:#ff7a9c;font-size:12px;margin:0 0 12px;min-height:16px}',
    '#grRoot .gr-code-box{display:flex;align-items:center;justify-content:space-between;gap:12px;',
    'background:rgba(94,240,255,.06);border:1px dashed rgba(94,240,255,.32);border-radius:14px;padding:14px 16px;margin-bottom:16px}',
    '#grRoot .gr-code-box span{font-size:11px;color:#7d90b3;letter-spacing:2px}',
    '#grRoot .gr-code-box b{display:block;font-size:27px;letter-spacing:8px;color:#5ef0ff;font-weight:900;line-height:1.15}',
    '#grRoot .gr-copy{padding:9px 12px;font-size:12px;white-space:nowrap}',
    '#grRoot .gr-seat{display:flex;align-items:center;gap:11px;padding:12px 14px;border-radius:13px;margin-bottom:9px;',
    'background:rgba(255,255,255,.035);border:1px solid rgba(120,160,220,.12)}',
    '#grRoot .gr-seat.gr-empty{border-style:dashed;color:#5a6c8c;background:transparent}',
    '#grRoot .gr-seat.gr-me{border-color:rgba(94,240,255,.38);background:rgba(94,240,255,.07)}',
    '#grRoot .gr-av{width:34px;height:34px;border-radius:10px;display:grid;place-items:center;font-weight:900;font-size:14px;',
    'background:linear-gradient(135deg,#1d3054,#152342);color:#8fb6e8;flex:none}',
    '#grRoot .gr-seat.gr-me .gr-av{background:linear-gradient(135deg,#5ef0ff,#3f7dff);color:#04121e}',
    '#grRoot .gr-nm{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600}',
    '#grRoot .gr-badge{font-size:10px;padding:2px 8px;border-radius:999px;letter-spacing:1px;flex:none}',
    '#grRoot .gr-host{background:rgba(255,196,92,.15);color:#ffc45c;border:1px solid rgba(255,196,92,.35)}',
    '#grRoot .gr-rdy{background:rgba(94,240,255,.14);color:#5ef0ff;border:1px solid rgba(94,240,255,.3)}',
    '#grRoot .gr-wait{color:#5a6c8c;font-size:11px}',
    '#grRoot .gr-actions{display:flex;gap:9px;margin-top:18px}',
    '#grRoot .gr-actions button{flex:1}',
    '#grRoot .gr-count{position:absolute;inset:0;display:none;align-items:center;justify-content:center;pointer-events:none}',
    '#grRoot .gr-count.on{display:flex}',
    '#grRoot .gr-count b{font-size:clamp(80px,22vw,150px);font-weight:900;color:#eafcff;',
    'text-shadow:0 0 40px rgba(94,240,255,.75),0 0 90px rgba(94,240,255,.35);animation:grPop .5s ease-out}',
    '@keyframes grPop{from{transform:scale(.55);opacity:.1}to{transform:scale(1);opacity:1}}',
    '#grRoot .gr-toast{position:absolute;left:50%;bottom:40px;transform:translateX(-50%);background:rgba(10,18,36,.95);',
    'border:1px solid rgba(94,240,255,.28);color:#cfe8ff;padding:10px 18px;border-radius:999px;font-size:12.5px;',
    'opacity:0;transition:opacity .2s,transform .2s;pointer-events:none}',
    '#grRoot .gr-toast.on{opacity:1;transform:translateX(-50%) translateY(-6px)}',
    '#grRoot .gr-back{position:absolute;top:14px;right:16px;background:none;color:#5a6c8c;font-size:12px;padding:4px 8px}',
    '#grRoot .gr-back:hover{color:#b9cbe8}'
  ].join('');

  function injectStyle() {
    if (document.getElementById(CSS_ID)) return;
    var st = document.createElement('style');
    st.id = CSS_ID;
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  function post(action, body) {
    return fetch(API + action, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
    }).then(function (r) {
      return r.json().catch(function () { return { ok: false, error: '服务没有响应' }; });
    }).catch(function () {
      return { ok: false, error: '连不上服务器' };
    });
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function nameKey() { return 'arcade.name'; }
  function pidKey(code) { return 'arcade.pid.' + code; }

  /* ---------------------------------------------------------------------- */

  function Room(opts) {
    this.opts = opts || {};
    this.game = this.opts.game;
    this.title = this.opts.title || '';
    this.snap = null;
    this.selfId = null;
    this.code = '';
    this.err = '';
    this.name = localStorage.getItem(nameKey()) || '';
    this.raf = 0;
    this.lastN = null;
    this.started = false;
    this.startAtClient = 0;
    this.recvAt = 0;
    this.es = null;
    this.reportCache = null;
    this.reportTimer = 0;
    this.destroyed = false;
    this.busy = false;
  }

  Room.prototype.mount = function () {
    injectStyle();
    var root = document.createElement('div');
    root.id = 'grRoot';
    root.innerHTML =
      '<div class="gr-mask"></div>' +
      '<div class="gr-card" id="grCard"></div>' +
      '<div class="gr-count" id="grCount"><b>3</b></div>' +
      '<div class="gr-toast" id="grToast"></div>';
    document.body.appendChild(root);
    this.root = root;
    this.card = $('#grCard', root);
    this.countEl = $('#grCount', root);
    this.countNum = $('#grCount b', root);
    this.toastEl = $('#grToast', root);

    root.addEventListener('click', this.onClick.bind(this));

    var q = new URLSearchParams(location.search).get('room');
    if (q) this.pendingCode = q.toUpperCase().slice(0, 4);

    this.render();
    var self = this;
    var loop = function () {
      if (self.destroyed) return;
      self.tick();
      self.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);

    window.addEventListener('pagehide', function () { self.leave(true); });
  };

  Room.prototype.onClick = function (e) {
    var btn = e.target.closest('[data-act]');
    if (!btn || this.busy) return;
    var act = btn.getAttribute('data-act');
    var self = this;

    if (act === 'name') return;

    if (act === 'create') {
      this.busy = true;
      var nm = this.readName();
      post('create', { game: this.game, name: nm }).then(function (r) {
        self.busy = false;
        if (!r.ok) { self.err = r.error || '创建失败'; self.render(); return; }
        sessionStorage.setItem(pidKey(r.room.code), r.playerId);
        self.enter(r.room.code, r.playerId);
      });
    } else if (act === 'join') {
      var code = (this.pendingCode || '').toUpperCase();
      if (!/^[A-Z0-9]{4}$/.test(code)) { this.err = '房间号是 4 位'; this.render(); return; }
      this.busy = true;
      post('join', { game: this.game, code: code, name: this.readName(), playerId: sessionStorage.getItem(pidKey(code)) }).then(function (r) {
        self.busy = false;
        if (!r.ok) { self.err = r.error || '加入失败'; self.render(); return; }
        sessionStorage.setItem(pidKey(code), r.playerId);
        self.enter(code, r.playerId);
      });
    } else if (act === 'ready') {
      var on = !this.self() || !this.self().ready;
      post('ready', { code: this.code, player: this.selfId, ready: on });
    } else if (act === 'start') {
      this.busy = true;
      post('start', { code: this.code, player: this.selfId }).then(function (r) {
        self.busy = false;
        if (!r.ok) { self.toast(r.error || '还开不了'); }
      });
    } else if (act === 'copy') {
      var url = location.origin + location.pathname + '?room=' + this.code;
      var done = function () { self.toast('邀请链接已复制'); };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(done, function () { self.toast(url); });
      } else {
        self.toast(url);
      }
    } else if (act === 'back' || act === 'leave-room') {
      this.destroy();
    }
  };

  Room.prototype.readName = function () {
    var inp = $('#grName', this.root);
    var v = inp ? inp.value.trim().slice(0, 12) : this.name;
    if (v) { this.name = v; localStorage.setItem(nameKey(), v); }
    return this.name;
  };

  Room.prototype.enter = function (code, playerId) {
    this.code = code;
    this.selfId = playerId;
    this.err = '';
    this.openStream();
    this.render();
  };

  Room.prototype.openStream = function () {
    if (this.es) this.es.close();
    var self = this;
    var es = new EventSource(API + 'events?code=' + encodeURIComponent(this.code) + '&player=' + encodeURIComponent(this.selfId));
    this.es = es;
    es.onmessage = function (ev) {
      var snap;
      try { snap = JSON.parse(ev.data); } catch (_) { return; }
      self.apply(snap);
    };
    es.onerror = function () {
      // EventSource 会自己重连；这里只提示，不销毁界面
      if (es.readyState === 2) self.toast('连接断开，正在重连…');
    };
  };

  Room.prototype.apply = function (snap) {
    var prev = this.snap;
    this.snap = snap;
    this.recvAt = performance.now();
    if (typeof snap.startAt === 'number' && snap.startAt > 0) {
      this.startAtClient = this.recvAt + Math.max(0, snap.startAt - snap.serverNow);
    }

    if (snap.status === 'countdown' && (!prev || prev.status !== 'countdown')) {
      this.started = false;
      this.lastN = null;
      this.countEl.classList.add('on');
      this.render();
    }

    if (snap.status === 'playing' && !this.started) this.beginPlay();

    if (snap.status === 'ended' && (!prev || prev.status !== 'ended')) {
      var self = this;
      setTimeout(function () {
        if (self.destroyed || !self.snap || self.snap.status !== 'ended') return;
        if (self.opts.onEnd) self.opts.onEnd(self.snap);
      }, 560);
    }

    if (snap.status === 'lobby' && (!prev || prev.status !== 'lobby')) {
      this.started = false;
      this.countEl.classList.remove('on');
      this.root && this.root.classList.remove('gr-off');
      this.render();
    }

    if (this.opts.onSnapshot) this.opts.onSnapshot(snap);
    this.renderIfNeeded(prev);
  };

  /** 大厅里的玩家/准备变化需要重渲染，但倒计时与对局中不要打断 */
  Room.prototype.renderIfNeeded = function (prev) {
    if (!this.snap) return;
    var st = this.snap.status;
    if (st === 'countdown' || st === 'playing' || st === 'ended') return;
    var sig = JSON.stringify(this.snap.players) + this.snap.hostId + this.snap.status;
    if (sig === this.lastSig) return;
    this.lastSig = sig;
    this.render();
  };

  Room.prototype.beginPlay = function () {
    if (this.started) return;
    this.started = true;
    this.countEl.classList.remove('on');
    this.root.classList.add('gr-off');
    if (this.opts.onStart) {
      this.opts.onStart({
        room: this,
        seed: this.snap.seed,
        round: this.snap.round,
        self: this.self(),
        players: this.players(),
        opponent: this.opponent()
      });
    }
  };

  Room.prototype.tick = function () {
    var s = this.snap;
    if (!s) return;
    if (s.status === 'countdown') {
      var remain = s.startAt - s.serverNow - (performance.now() - this.recvAt);
      if (remain <= 0) { this.beginPlay(); return; }
      var n = Math.ceil(remain / 1000);
      if (n !== this.lastN) {
        this.lastN = n;
        this.countNum.textContent = String(n);
        this.countNum.style.animation = 'none';
        void this.countNum.offsetWidth;
        this.countNum.style.animation = '';
      }
    }
  };

  Room.prototype.elapsed = function () {
    if (!this.startAtClient) return 0;
    return Math.max(0, (performance.now() - this.startAtClient) / 1000);
  };

  Room.prototype.self = function () {
    if (!this.snap) return null;
    return this.snap.players.filter(function (p) { return p.id === this.selfId; }, this)[0] || null;
  };

  Room.prototype.isHost = function () {
    return !!this.snap && this.snap.hostId === this.selfId;
  };

  Room.prototype.players = function () {
    return this.snap ? this.snap.players.slice() : [];
  };

  Room.prototype.opponent = function () {
    if (!this.snap) return null;
    return this.snap.players.filter(function (p) { return p.id !== this.selfId; }, this)[0] || null;
  };

  Room.prototype.ready = function (on) {
    if (!this.snap) return Promise.resolve();
    return post('ready', { code: this.code, player: this.selfId, ready: !!on });
  };

  Room.prototype.start = function () {
    return post('start', { code: this.code, player: this.selfId });
  };

  Room.prototype.restart = function () {
    var self = this;
    return post('restart', { code: this.code, player: this.selfId }).then(function (r) {
      if (!r.ok) { self.toast(r.error || '只有房主能开下一局'); return r; }
      self.started = false;
      self.root.classList.remove('gr-off');
      self.render();
      return r;
    });
  };

  /** 游戏内状态上报：80ms 合并一次，避免刷爆连接 */
  Room.prototype.report = function (patch) {
    if (!this.snap || this.snap.status !== 'playing') return;
    this.reportCache = Object.assign(this.reportCache || {}, patch);
    if (this.reportTimer) return;
    var self = this;
    this.reportTimer = setTimeout(function () {
      self.reportTimer = 0;
      var body = self.reportCache || {};
      self.reportCache = null;
      post('state', { code: self.code, player: self.selfId, patch: body });
    }, 80);
  };

  Room.prototype.leave = function (silent) {
    if (!this.code || !this.selfId) return;
    var payload = JSON.stringify({ code: this.code, player: this.selfId });
    try {
      if (silent && navigator.sendBeacon) {
        navigator.sendBeacon(API + 'leave', new Blob([payload], { type: 'application/json' }));
      } else {
        post('leave', { code: this.code, player: this.selfId });
      }
    } catch (_) { /* ignore */ }
  };

  Room.prototype.toast = function (msg) {
    if (!this.toastEl) return;
    this.toastEl.textContent = msg;
    this.toastEl.classList.add('on');
    clearTimeout(this._tt);
    var self = this;
    this._tt = setTimeout(function () { self.toastEl.classList.remove('on'); }, 2200);
  };

  Room.prototype.destroy = function () {
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    if (this.es) this.es.close();
    this.leave(false);
    if (this.root && this.root.parentNode) this.root.parentNode.removeChild(this.root);
    if (this.opts.onClose) this.opts.onClose();
  };

  /* ------------------------------ 渲染 ------------------------------ */

  Room.prototype.render = function () {
    if (!this.card || this.destroyed) return;
    this.lastSig = this.snap ? JSON.stringify(this.snap.players) + this.snap.hostId + this.snap.status : '';
    if (!this.snap) return this.renderEntry();

    var st = this.snap.status;
    if (st === 'countdown' || st === 'playing') {
      this.card.style.display = 'none';
      this.root.classList.remove('gr-off');
      return;
    }
    if (st === 'ended') {
      this.card.style.display = 'none';
      this.root.classList.add('gr-off');
      return;
    }
    this.card.style.display = '';
    this.root.classList.remove('gr-off');
    this.renderLobby();
  };

  Room.prototype.renderEntry = function () {
    var code = this.pendingCode || '';
    var needCode = !!this.pendingCode;
    this.card.innerHTML =
      '<h2>联机对战</h2>' +
      '<p class="gr-sub">' + esc(this.title || '') + ' · 房主开局，所有人同时出发</p>' +
      '<div class="gr-field"><input id="grName" maxlength="12" placeholder="你的名字" value="' + esc(this.name) + '" autocomplete="off"></div>' +
      '<p class="gr-err">' + esc(this.err) + '</p>' +
      (needCode
        ? '<div class="gr-field"><input class="gr-code" id="grCode" maxlength="4" placeholder="房间号" value="' + esc(code) + '" autocomplete="off"></div>' +
          '<button class="gr-primary" data-act="join">加 入 房 间</button>' +
          '<p class="gr-tip">还没拿到房间号？让房主把邀请链接发给你，直接点开就行。</p>'
        : '<button class="gr-primary" data-act="create">创 建 房 间</button>' +
          '<div class="gr-split">或</div>' +
          '<div class="gr-field"><input class="gr-code" id="grCode" maxlength="4" placeholder="房间号" autocomplete="off">' +
          '<button class="gr-ghost" data-act="join" style="flex:none">加入</button></div>' +
          '<p class="gr-tip">第一个进房间的人是房主。其他人进来点“准备”，房主点开始，全队同一秒出发。</p>') +
      '<button class="gr-back" data-act="back">返回</button>';
  };

  Room.prototype.renderLobby = function () {
    var s = this.snap;
    var me = this.self();
    var host = this.isHost();
    var online = s.players;
    var others = online.filter(function (p) { return p.id !== s.hostId; });
    var readyN = others.filter(function (p) { return p.ready; }).length;
    var canStart = host && online.length >= 2 && others.length > 0 && others.every(function (p) { return p.ready; });

    var seats = '';
    for (var i = 0; i < s.maxPlayers; i++) {
      var p = online[i];
      if (!p) {
        seats += '<div class="gr-seat gr-empty"><div class="gr-av">+</div><div class="gr-nm">等待玩家加入…</div></div>';
        continue;
      }
      var isMe = p.id === this.selfId;
      var isHost = p.id === s.hostId;
      seats += '<div class="gr-seat' + (isMe ? ' gr-me' : '') + '">' +
        '<div class="gr-av">' + esc((p.name || '?').slice(0, 1).toUpperCase()) + '</div>' +
        '<div class="gr-nm">' + esc(p.name) + (isMe ? ' <span class="gr-wait">(你)</span>' : '') + '</div>' +
        (isHost ? '<span class="gr-badge gr-host">房主</span>' : '') +
        (isHost ? '' : (p.ready ? '<span class="gr-badge gr-rdy">已准备</span>' : '<span class="gr-wait">未准备</span>')) +
        '</div>';
    }

    var hint = '';
    if (online.length < 2) hint = '再等一个人进来就能开局';
    else if (!host) hint = readyN >= others.length ? '都准备好了，等房主开始' : '准备好后等房主开始';

    var actions = '';
    if (host) {
      actions = '<div class="gr-actions">' +
        '<button class="gr-primary" data-act="start"' + (canStart ? '' : ' disabled') + '>' +
        (canStart ? '开 始 游 戏' : '等 待 准 备') + '</button></div>';
    } else {
      var mine = me && me.ready;
      actions = '<div class="gr-actions">' +
        '<button class="' + (mine ? 'gr-ghost' : 'gr-primary') + '" data-act="ready">' + (mine ? '取 消 准 备' : '准 备 好 了') + '</button></div>';
    }

    this.card.innerHTML =
      '<h2>' + esc(this.title || '联机房间') + '</h2>' +
      '<p class="gr-sub">' + (s.status === 'ended' ? '上一局结束了' : '等所有人到齐，房主开局') + '</p>' +
      '<div class="gr-code-box"><div><span>房间号 · 发给队友</span><b>' + esc(s.code) + '</b></div>' +
      '<button class="gr-ghost gr-copy" data-act="copy">复制邀请链接</button></div>' +
      seats +
      (hint ? '<p class="gr-tip" style="margin-top:12px">' + esc(hint) + '</p>' : '') +
      actions +
      '<p class="gr-tip">开始后 3 秒倒计时，双方同一时刻起跑；比的是谁撑得更久。</p>' +
      '<button class="gr-back" data-act="leave-room">退出房间</button>';
  };

  /* ------------------------------ 入口 ------------------------------ */

  function open(opts) {
    return new Promise(function (resolve) {
      var room = new Room(opts);
      room.mount();
      resolve(room);
    });
  }

  global.GameRoom = {
    open: open,
    version: '1.0.0'
  };
})(window);
