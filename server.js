'use strict';
// =====================================================
//  1인칭 팀전 총게임 서버 (외부 패키지 없이 Node.js만 사용)
// =====================================================
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ---------- 설정 ----------
const PORT = process.env.PORT || 3000;
const ENTRY_PASSWORD = process.env.ENTRY_PASSWORD || '0602';
// 관리자 비밀번호는 코드에 적지 않고, 호스팅 사이트의 환경변수 ADMIN_PASSWORD 로 넣어요.
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const ACCOUNTS_FILE = path.join(DATA_DIR, 'accounts.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

const TICK_MS = 50;              // 초당 20번 상태 전송
const MAX_HP = 100;
const BODY_DAMAGE = 25;
const HEAD_DAMAGE = 60;
const FIRE_INTERVAL = 110;       // ms
const MAG_SIZE = 25;
const RELOAD_MS = 1600;
const RESPAWN_MS = 3000;
const SPAWN_PROTECT_MS = 2000;
const KICK_BLOCK_MS = 60 * 1000; // 킥 당하면 1분 동안 재접속 금지
const MAX_PLAYERS = 10;

// ---------- 유틸 ----------
const now = () => Date.now();
const newToken = () => crypto.randomBytes(24).toString('hex');
function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}
function hashPassword(pw, salt) {
  return crypto.scryptSync(pw, salt, 64).toString('hex');
}
function clientIp(req) {
  const xf = req.headers['x-forwarded-for'];
  if (xf) return String(xf).split(',')[0].trim();
  return req.socket.remoteAddress || '?';
}

// ---------- 계정 저장 ----------
let accounts = {};
function loadAccounts() {
  try {
    accounts = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf8'));
  } catch { accounts = {}; }
}
function saveAccounts() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(ACCOUNTS_FILE + '.tmp', JSON.stringify(accounts));
    fs.renameSync(ACCOUNTS_FILE + '.tmp', ACCOUNTS_FILE);
  } catch (e) { console.error('계정 저장 실패', e); }
}
loadAccounts();

const sessions = new Map();      // token -> { username, expires }
const adminSessions = new Map(); // token -> expires
const kickBlocks = new Map();    // username -> until
let shutdown = false;

// ---------- 로그인 시도 제한 ----------
const attempts = new Map(); // ip -> { count, reset }
function tooMany(ip) {
  const a = attempts.get(ip);
  return a && a.reset > now() && a.count >= 10;
}
function failAttempt(ip) {
  let a = attempts.get(ip);
  if (!a || a.reset < now()) a = { count: 0, reset: now() + 60 * 1000 };
  a.count++;
  attempts.set(ip, a);
}

// =====================================================
//  맵
// =====================================================
function buildMap() {
  const S = 40;
  const boxes = [];
  const add = (x, z, w, d, h, kind, y = 0) =>
    boxes.push({ min: [x - w / 2, y, z - d / 2], max: [x + w / 2, y + h, z + d / 2], kind });
  // 바깥 벽
  add(0, -S, 2 * S + 1, 1, 5, 'wall');
  add(0, S, 2 * S + 1, 1, 5, 'wall');
  add(-S, 0, 1, 2 * S + 1, 5, 'wall');
  add(S, 0, 1, 2 * S + 1, 5, 'wall');
  // 가운데 구조물
  add(0, 0, 8, 2, 3, 'wall');
  add(-6, 0, 2, 2, 1, 'crate');
  add(6, 0, 2, 2, 1, 'crate');
  // 양쪽 팀이 똑같도록 대칭으로 배치
  const half = [
    [-14, 8, 6, 1, 3, 'wall'], [14, 8, 6, 1, 3, 'wall'],
    [-8, 14, 2, 2, 1, 'crate'], [8, 14, 2, 2, 1, 'crate'],
    [-22, 16, 1, 10, 3, 'wall'], [22, 16, 1, 10, 3, 'wall'],
    [0, 20, 10, 1, 2, 'wall'],
    [-30, 6, 3, 3, 2, 'crate'], [30, 6, 3, 3, 2, 'crate'],
    [-4, 26, 2, 2, 1, 'crate'], [4, 26, 2, 2, 1, 'crate'],
    [-32, 26, 6, 1, 3, 'wall'], [32, 26, 6, 1, 3, 'wall'],
    [-16, 30, 2, 2, 1, 'crate'], [16, 30, 2, 2, 1, 'crate'],
  ];
  for (const [x, z, w, d, h, k] of half) { add(x, z, w, d, h, k); add(x, -z, w, d, h, k); }
  // 사이드 기둥
  for (const x of [-26, 26]) add(x, 0, 2, 2, 4, 'wall');
  const spawns = {
    red: [[-6, 35], [-2, 35], [2, 35], [6, 35], [-10, 34], [10, 34]].map(([x, z]) => ({ x, z, yaw: 0 })),
    blue: [[-6, -35], [-2, -35], [2, -35], [6, -35], [-10, -34], [10, -34]].map(([x, z]) => ({ x, z, yaw: Math.PI })),
  };
  return { size: S, boxes, spawns };
}
const MAP = buildMap();

// 광선과 상자 충돌 (slab 방식). 맞으면 거리 t, 아니면 Infinity
function rayBox(o, d, min, max) {
  let tmin = 0, tmax = Infinity;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) {
      if (o[i] < min[i] || o[i] > max[i]) return Infinity;
    } else {
      let t1 = (min[i] - o[i]) / d[i], t2 = (max[i] - o[i]) / d[i];
      if (t1 > t2) [t1, t2] = [t2, t1];
      tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
      if (tmin > tmax) return Infinity;
    }
  }
  return tmin;
}

// =====================================================
//  게임 상태
// =====================================================
const players = new Map(); // id -> player
let nextId = 1;
const game = { scores: { red: 0, blue: 0 }, killTarget: 20, roundOver: false };

function teamCount(team) { let n = 0; for (const p of players.values()) if (p.team === team) n++; return n; }
function pickTeam() {
  const r = teamCount('red'), b = teamCount('blue');
  if (r !== b) return r < b ? 'red' : 'blue';
  return Math.random() < 0.5 ? 'red' : 'blue';
}
function spawn(p) {
  const list = MAP.spawns[p.team];
  const s = list[Math.floor(Math.random() * list.length)];
  p.x = s.x + (Math.random() - 0.5); p.y = 0; p.z = s.z; p.yaw = s.yaw; p.pitch = 0;
  p.hp = MAX_HP; p.alive = true; p.protectUntil = now() + SPAWN_PROTECT_MS;
  p.ammo = MAG_SIZE; p.reloadUntil = 0; p.lastMoveAt = now();
  sendTo(p, { t: 'respawn', x: p.x, y: p.y, z: p.z, yaw: p.yaw });
}
function sendTo(p, msg) { if (p.ws && p.ws.open) p.ws.send(msg); }
function broadcast(msg) { const s = JSON.stringify(msg); for (const p of players.values()) sendTo(p, s); }

function resetRound() {
  game.scores = { red: 0, blue: 0 };
  game.roundOver = false;
  for (const p of players.values()) { p.kills = 0; p.deaths = 0; spawn(p); }
  broadcast({ t: 'round' });
}

function kill(victim, killer, head) {
  victim.alive = false; victim.hp = 0; victim.deaths++;
  victim.respawnAt = now() + RESPAWN_MS;
  killer.kills++;
  game.scores[killer.team]++;
  broadcast({ t: 'kill', killer: killer.name, kteam: killer.team, victim: victim.name, vteam: victim.team, head });
  if (!game.roundOver && game.scores[killer.team] >= game.killTarget) {
    game.roundOver = true;
    broadcast({ t: 'win', team: killer.team });
    setTimeout(resetRound, 6000);
  }
}

function handleShoot(p, msg) {
  const t = now();
  if (!p.alive || game.roundOver) return;
  if (t - p.lastShot < FIRE_INTERVAL - 15) return;
  if (p.reloadUntil && t >= p.reloadUntil) { p.ammo = MAG_SIZE; p.reloadUntil = 0; }
  if (p.reloadUntil || p.ammo <= 0) return;
  let d = [Number(msg.dx), Number(msg.dy), Number(msg.dz)];
  if (!d.every(Number.isFinite)) return;
  const len = Math.hypot(d[0], d[1], d[2]);
  if (len < 0.5) return;
  d = d.map(v => v / len);
  p.lastShot = t; p.ammo--;
  p.protectUntil = 0; // 쏘면 부활 보호 해제

  const o = [p.x, p.y + 1.6, p.z];
  let best = 100, hitPlayer = null;
  for (const b of MAP.boxes) {
    const tt = rayBox(o, d, b.min, b.max);
    if (tt < best) best = tt;
  }
  for (const q of players.values()) {
    if (q === p || !q.alive || q.team === p.team) continue;
    const tt = rayBox(o, d, [q.x - 0.4, q.y, q.z - 0.4], [q.x + 0.4, q.y + 1.85, q.z + 0.4]);
    if (tt < best) { best = tt; hitPlayer = q; }
  }
  const end = [o[0] + d[0] * best, o[1] + d[1] * best, o[2] + d[2] * best];
  broadcast({ t: 'shot', id: p.id, o, e: end });

  if (hitPlayer) {
    const q = hitPlayer;
    if (q.protectUntil > t) return;
    const head = end[1] - q.y > 1.45;
    q.hp -= head ? HEAD_DAMAGE : BODY_DAMAGE;
    sendTo(q, { t: 'hurt', from: p.name });
    const dead = q.hp <= 0;
    sendTo(p, { t: 'hitmark', head, kill: dead });
    if (dead) kill(q, p, head);
  }
}

function handleMove(p, msg) {
  if (!p.alive) return;
  const x = Number(msg.x), y = Number(msg.y), z = Number(msg.z);
  const yaw = Number(msg.yaw), pitch = Number(msg.pitch);
  if (![x, y, z, yaw, pitch].every(Number.isFinite)) return;
  const t = now();
  const dt = Math.min(1, (t - p.lastMoveAt) / 1000);
  p.lastMoveAt = t;
  const maxStep = 8 * dt * 1.6 + 0.6;
  const dist = Math.hypot(x - p.x, z - p.z);
  const lim = MAP.size - 1;
  if (dist > maxStep || Math.abs(x) > lim || Math.abs(z) > lim || y < -0.5 || y > 8) {
    sendTo(p, { t: 'correct', x: p.x, y: p.y, z: p.z }); // 너무 빠르면 되돌리기
  } else {
    p.x = x; p.y = y; p.z = z;
  }
  p.yaw = yaw; p.pitch = Math.max(-1.6, Math.min(1.6, pitch));
}

function kickPlayer(p, reason, block) {
  if (block) kickBlocks.set(p.name, now() + KICK_BLOCK_MS);
  sendTo(p, { t: 'kicked', reason });
  setTimeout(() => p.ws.close(), 100);
}

// 주기적 업데이트
setInterval(() => {
  const t = now();
  for (const p of players.values()) {
    if (!p.alive && !game.roundOver && t >= p.respawnAt) spawn(p);
  }
  const state = {
    t: 'state',
    s: game.scores, target: game.killTarget,
    p: [...players.values()].map(p => ({
      id: p.id, n: p.name, tm: p.team,
      x: +p.x.toFixed(2), y: +p.y.toFixed(2), z: +p.z.toFixed(2),
      yw: +p.yaw.toFixed(3), pt: +p.pitch.toFixed(3),
      hp: p.hp, a: p.alive ? 1 : 0, k: p.kills, d: p.deaths,
    })),
  };
  broadcast(state);
}, TICK_MS);

// =====================================================
//  관리자
// =====================================================
const admins = new Set();
function adminSnapshot() {
  return {
    t: 'admin',
    shutdown,
    scores: game.scores, killTarget: game.killTarget,
    accounts: Object.keys(accounts).length,
    players: [...players.values()].map(p => ({
      id: p.id, name: p.name, team: p.team, kills: p.kills, deaths: p.deaths,
      hp: p.hp, alive: p.alive, ip: p.ip,
    })),
  };
}
setInterval(() => {
  if (!admins.size) return;
  const s = JSON.stringify(adminSnapshot());
  for (const a of admins) a.send(s);
}, 1000);

function handleAdminCommand(ws, msg) {
  switch (msg.t) {
    case 'kick': {
      const p = players.get(Number(msg.id));
      if (p) kickPlayer(p, '관리자가 퇴장시켰어요.', true);
      break;
    }
    case 'setTeam': {
      const p = players.get(Number(msg.id));
      if (p && (msg.team === 'red' || msg.team === 'blue') && p.team !== msg.team) {
        p.team = msg.team; spawn(p);
        sendTo(p, { t: 'team', team: p.team });
      }
      break;
    }
    case 'resetRound': resetRound(); break;
    case 'setTarget': {
      const n = Math.round(Number(msg.n));
      if (n >= 1 && n <= 200) game.killTarget = n;
      break;
    }
    case 'announce': {
      const text = String(msg.text || '').slice(0, 100).trim();
      if (text) broadcast({ t: 'announce', text });
      break;
    }
    case 'shutdown': {
      shutdown = true;
      for (const p of players.values()) kickPlayer(p, '관리자가 서버를 닫았어요.', false);
      for (const tok of sessions.keys()) sessions.delete(tok);
      break;
    }
    case 'reopen': shutdown = false; break;
    case 'deleteAccount': {
      const name = String(msg.name || '');
      if (accounts[name]) {
        for (const p of players.values()) if (p.name === name) kickPlayer(p, '계정이 삭제됐어요.', false);
        delete accounts[name]; saveAccounts();
      }
      break;
    }
  }
  ws.send(adminSnapshot());
}

// =====================================================
//  WebSocket (직접 구현)
// =====================================================
class WS {
  constructor(socket) {
    this.socket = socket; this.buf = Buffer.alloc(0); this.open = true;
    this.onmessage = null; this.onclose = null; this._done = false;
    socket.setNoDelay(true);
    socket.on('data', d => this._data(d));
    socket.on('close', () => this._closed());
    socket.on('error', () => this._closed());
  }
  _data(d) {
    this.buf = Buffer.concat([this.buf, d]);
    while (this.open) {
      if (this.buf.length < 2) return;
      const b0 = this.buf[0], b1 = this.buf[1];
      const op = b0 & 0x0f, fin = b0 & 0x80, masked = b1 & 0x80;
      let len = b1 & 0x7f, off = 2;
      if (len === 126) { if (this.buf.length < 4) return; len = this.buf.readUInt16BE(2); off = 4; }
      else if (len === 127) {
        if (this.buf.length < 10) return;
        if (this.buf.readUInt32BE(2) !== 0) return this.close();
        len = this.buf.readUInt32BE(6); off = 10;
      }
      if (len > 64 * 1024 || !masked) return this.close();
      if (this.buf.length < off + 4 + len) return;
      const mask = this.buf.subarray(off, off + 4);
      const payload = Buffer.from(this.buf.subarray(off + 4, off + 4 + len));
      for (let i = 0; i < len; i++) payload[i] ^= mask[i & 3];
      this.buf = this.buf.subarray(off + 4 + len);
      if (op === 0x8) return this.close();
      if (op === 0x9) { this._frame(0xA, payload); continue; }
      if (op === 0x1 && fin && this.onmessage) {
        try { this.onmessage(payload.toString('utf8')); } catch (e) { console.error(e); }
      }
    }
  }
  _frame(op, payload) {
    if (!this.open) return;
    const len = payload.length;
    let h;
    if (len < 126) h = Buffer.from([0x80 | op, len]);
    else if (len < 65536) { h = Buffer.alloc(4); h[0] = 0x80 | op; h[1] = 126; h.writeUInt16BE(len, 2); }
    else { h = Buffer.alloc(10); h[0] = 0x80 | op; h[1] = 127; h.writeUInt32BE(0, 2); h.writeUInt32BE(len, 6); }
    try { this.socket.write(Buffer.concat([h, payload])); } catch { }
  }
  send(msg) { this._frame(0x1, Buffer.from(typeof msg === 'string' ? msg : JSON.stringify(msg))); }
  close() {
    if (!this.open) return;
    const p = Buffer.alloc(2); p.writeUInt16BE(1000, 0);
    this._frame(0x8, p);
    this.open = false;
    try { this.socket.end(); } catch { }
    setTimeout(() => this._closed(), 500);
  }
  _closed() {
    this.open = false;
    if (this._done) return;
    this._done = true;
    try { this.socket.destroy(); } catch { }
    if (this.onclose) this.onclose();
  }
}

function handlePlayer(ws, token, ip) {
  const fail = reason => { ws.send({ t: 'kicked', reason }); setTimeout(() => ws.close(), 100); };
  if (shutdown) return fail('서버가 닫혀 있어요.');
  const sess = sessions.get(token);
  if (!sess || sess.expires < now()) return fail('다시 로그인해 주세요.');
  const name = sess.username;
  if (!accounts[name]) return fail('계정이 없어요.');
  const block = kickBlocks.get(name);
  if (block && block > now()) return fail('퇴장당해서 잠시 후에 다시 들어올 수 있어요.');
  // 같은 계정이 이미 접속 중이면 이전 접속을 끊기
  for (const p of players.values()) if (p.name === name) kickPlayer(p, '다른 곳에서 같은 계정으로 접속했어요.', false);
  if (players.size >= MAX_PLAYERS) return fail(`방이 꽉 찼어요 (최대 ${MAX_PLAYERS}명).`);

  const p = {
    id: nextId++, name, ip, ws, team: pickTeam(),
    x: 0, y: 0, z: 0, yaw: 0, pitch: 0, hp: MAX_HP, alive: false,
    kills: 0, deaths: 0, lastShot: 0, ammo: MAG_SIZE, reloadUntil: 0,
    respawnAt: 0, protectUntil: 0, lastMoveAt: now(),
  };
  players.set(p.id, p);
  ws.send({
    t: 'welcome', id: p.id, name, team: p.team, map: MAP,
    cfg: { maxHp: MAX_HP, mag: MAG_SIZE, reloadMs: RELOAD_MS, fireMs: FIRE_INTERVAL },
  });
  spawn(p);
  broadcast({ t: 'joined', name, team: p.team });

  ws.onmessage = raw => {
    let msg; try { msg = JSON.parse(raw); } catch { return; }
    if (msg.t === 'move') handleMove(p, msg);
    else if (msg.t === 'shoot') handleShoot(p, msg);
    else if (msg.t === 'reload') {
      if (!p.reloadUntil && p.ammo < MAG_SIZE) p.reloadUntil = now() + RELOAD_MS;
    }
  };
  ws.onclose = () => {
    if (players.get(p.id) === p) {
      players.delete(p.id);
      broadcast({ t: 'left', name });
    }
  };
}

function handleAdminWs(ws, token) {
  const exp = adminSessions.get(token);
  if (!exp || exp < now()) { ws.send({ t: 'denied' }); setTimeout(() => ws.close(), 100); return; }
  admins.add(ws);
  ws.send(adminSnapshot());
  ws.onmessage = raw => {
    const e = adminSessions.get(token);
    if (!e || e < now()) return ws.close();
    let msg; try { msg = JSON.parse(raw); } catch { return; }
    handleAdminCommand(ws, msg);
  };
  ws.onclose = () => admins.delete(ws);
}

// =====================================================
//  HTTP
// =====================================================
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.ico': 'image/x-icon', '.svg': 'image/svg+xml',
};
function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}
function readBody(req) {
  return new Promise(resolve => {
    let data = '';
    req.on('data', c => { data += c; if (data.length > 10000) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch { resolve({}); } });
  });
}
const NAME_RE = /^[가-힣A-Za-z0-9_]{2,12}$/;

async function api(req, res, pathname) {
  const ip = clientIp(req);
  if (tooMany(ip)) return json(res, 429, { error: '너무 많이 틀렸어요. 1분 뒤에 다시 해 주세요.' });
  const body = await readBody(req);

  if (pathname === '/api/admin/login') {
    if (!ADMIN_PASSWORD) return json(res, 500, { error: '서버에 관리자 비밀번호(ADMIN_PASSWORD)가 설정되지 않았어요.' });
    if (!safeEqual(body.password || '', ADMIN_PASSWORD)) { failAttempt(ip); return json(res, 401, { error: '관리자 비밀번호가 틀렸어요.' }); }
    const tok = newToken();
    adminSessions.set(tok, now() + 12 * 3600 * 1000);
    return json(res, 200, { ok: true, token: tok });
  }

  if (shutdown) return json(res, 503, { error: '서버가 닫혀 있어요.' });
  if (!safeEqual(body.code || '', ENTRY_PASSWORD)) { failAttempt(ip); return json(res, 401, { error: '입장 비밀번호가 틀렸어요.' }); }

  if (pathname === '/api/entry') return json(res, 200, { ok: true });

  const username = String(body.username || '').trim();
  const password = String(body.password || '');
  if (pathname === '/api/signup') {
    if (!NAME_RE.test(username)) return json(res, 400, { error: '아이디는 한글/영어/숫자/_ 로 2~12글자여야 해요.' });
    if (password.length < 4 || password.length > 50) return json(res, 400, { error: '비밀번호는 4글자 이상이어야 해요.' });
    const lower = username.toLowerCase();
    if (Object.keys(accounts).some(n => n.toLowerCase() === lower)) return json(res, 409, { error: '이미 있는 아이디예요.' });
    const salt = crypto.randomBytes(16).toString('hex');
    accounts[username] = { salt, hash: hashPassword(password, salt), created: new Date().toISOString() };
    saveAccounts();
  } else if (pathname === '/api/login') {
    const acc = accounts[username];
    if (!acc || !safeEqual(hashPassword(password, acc.salt), acc.hash)) {
      failAttempt(ip); return json(res, 401, { error: '아이디나 비밀번호가 틀렸어요.' });
    }
  } else {
    return json(res, 404, { error: 'not found' });
  }
  const tok = newToken();
  sessions.set(tok, { username, expires: now() + 12 * 3600 * 1000 });
  return json(res, 200, { ok: true, token: tok, username });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (req.method === 'POST' && url.pathname.startsWith('/api/')) return api(req, res, url.pathname);
  if (req.method !== 'GET') { res.writeHead(405); return res.end(); }
  let p = url.pathname === '/' ? '/index.html' : url.pathname === '/admin' ? '/admin.html' : url.pathname;
  const file = path.normalize(path.join(PUBLIC_DIR, p));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('없는 페이지예요'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

server.on('upgrade', (req, socket) => {
  const url = new URL(req.url, 'http://localhost');
  const key = req.headers['sec-websocket-key'];
  if (!key || String(req.headers.upgrade || '').toLowerCase() !== 'websocket') return socket.destroy();
  const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
    'Sec-WebSocket-Accept: ' + accept + '\r\n\r\n');
  const ws = new WS(socket);
  const token = url.searchParams.get('token') || '';
  if (url.pathname === '/ws') handlePlayer(ws, token, clientIp(req));
  else if (url.pathname === '/admin-ws') handleAdminWs(ws, token);
  else ws.close();
});

server.listen(PORT, () => {
  console.log(`게임 서버 실행 중: http://localhost:${PORT}`);
  if (!ADMIN_PASSWORD) console.log('⚠️  ADMIN_PASSWORD 환경변수가 없어서 관리자 로그인이 꺼져 있어요.');
});
