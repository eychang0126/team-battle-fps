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
// 관리자 계정 닉네임 (게임 안에서 이름 옆에 👑, 코인 무한)
const ADMIN_NAME = process.env.ADMIN_NAME || '은영';
const isAdminName = n => String(n).toLowerCase() === ADMIN_NAME.toLowerCase();
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
// Upstash(무료 데이터베이스) 주소와 토큰이 있으면 거기에 저장해서 서버가 다시 켜져도 계정이 남아요.
// 없으면 서버 컴퓨터의 파일에 저장해요 (Render 무료 서버에서는 다시 켜지면 지워져요).
const UPSTASH_URL = (process.env.UPSTASH_REDIS_REST_URL || '').replace(/\/+$/, '');
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || '';
const DB_KEY = 'teambattle:accounts';
let accounts = {};

async function upstash(cmd) {
  const r = await fetch(UPSTASH_URL, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + UPSTASH_TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd),
  });
  const j = await r.json();
  if (!r.ok || j.error) throw new Error(j.error || 'HTTP ' + r.status);
  return j.result;
}
async function loadAccounts() {
  if (UPSTASH_URL && UPSTASH_TOKEN) {
    for (let i = 1; i <= 5; i++) {
      try {
        const v = await upstash(['GET', DB_KEY]);
        accounts = v ? JSON.parse(v) : {};
        console.log(`데이터베이스에서 계정 ${Object.keys(accounts).length}개를 불러왔어요.`);
        return;
      } catch (e) {
        console.error(`데이터베이스 연결 실패 (${i}/5):`, e.message);
        await new Promise(r => setTimeout(r, 2000));
      }
    }
    // 불러오지 못한 채로 시작하면 빈 계정으로 덮어쓸 수 있어서, 서버를 멈추고 다시 시도하게 해요.
    console.error('데이터베이스에 연결할 수 없어서 서버를 멈춰요. UPSTASH 주소/토큰을 확인하세요.');
    process.exit(1);
  }
  console.log('⚠️  UPSTASH 설정이 없어서 계정을 파일에 저장해요. (서버가 다시 켜지면 지워질 수 있어요)');
  try { accounts = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf8')); } catch { accounts = {}; }
}
let saveTimer = null, saving = false;
function saveAccounts() {
  if (!saveTimer) saveTimer = setTimeout(flushAccounts, 800);
}
async function flushAccounts() {
  saveTimer = null;
  if (saving) { saveAccounts(); return; }
  saving = true;
  const data = JSON.stringify(accounts);
  try {
    if (UPSTASH_URL && UPSTASH_TOKEN) await upstash(['SET', DB_KEY, data]);
    else {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(ACCOUNTS_FILE + '.tmp', data);
      fs.renameSync(ACCOUNTS_FILE + '.tmp', ACCOUNTS_FILE);
    }
  } catch (e) {
    console.error('계정 저장 실패, 5초 뒤 다시 시도:', e.message);
    if (!saveTimer) saveTimer = setTimeout(flushAccounts, 5000);
  }
  saving = false;
}

// ---------- 코인 / 상점 ----------
const WIN_COINS = 20;
const SHOP = [
  { id: 'cap', type: 'hat', name: '야구모자', icon: '🧢', price: 40 },
  { id: 'beanie', type: 'hat', name: '비니', icon: '🧶', price: 40 },
  { id: 'party', type: 'hat', name: '고깔모자', icon: '🥳', price: 60 },
  { id: 'helmet', type: 'hat', name: '군인 헬멧', icon: '🪖', price: 80 },
  { id: 'tophat', type: 'hat', name: '신사 모자', icon: '🎩', price: 100 },
  { id: 'bunny', type: 'hat', name: '토끼 귀', icon: '🐰', price: 120 },
  { id: 'crown', type: 'hat', name: '왕관', icon: '👑', price: 99999999999999999999999999, priceText: '99999999999999999999999999' },
  { id: 'v_red', type: 'visor', name: '빨간 고글', color: '#ff3b3b', price: 30 },
  { id: 'v_blue', type: 'visor', name: '파란 고글', color: '#3bb0ff', price: 30 },
  { id: 'v_pink', type: 'visor', name: '분홍 고글', color: '#ff7ad9', price: 30 },
  { id: 'v_gold', type: 'visor', name: '금색 고글', color: '#ffd34d', price: 80 },
  { id: 's_1', type: 'skin', name: '피부색 1', color: '#ffe3cf', price: 0 },
  { id: 's_2', type: 'skin', name: '피부색 2', color: '#c68a5a', price: 0 },
  { id: 's_3', type: 'skin', name: '피부색 3', color: '#8a5a3a', price: 0 },
  { id: 's_robot', type: 'skin', name: '로봇 은색', color: '#b8c2cc', price: 100 },
  { id: 's_alien', type: 'skin', name: '외계인 파랑', color: '#7fd4ff', price: 150 },
  { id: 's_gold', type: 'skin', name: '황금 피부', color: '#ffc83d', price: 300 },
  // 머리 스타일 (모두 무료)
  { id: 'h_short', type: 'hair', name: '짧은 머리', icon: '✂️', price: 0 },
  { id: 'h_long', type: 'hair', name: '긴 머리', icon: '🌊', price: 0 },
  { id: 'h_bob', type: 'hair', name: '단발', icon: '🍄', price: 0 },
  { id: 'h_pony', type: 'hair', name: '포니테일', icon: '🎀', price: 0 },
  { id: 'h_twin', type: 'hair', name: '양갈래', icon: '🎎', price: 0 },
  { id: 'h_spiky', type: 'hair', name: '뾰족 머리', icon: '⚡', price: 0 },
  { id: 'h_curly', type: 'hair', name: '뽀글 머리', icon: '☁️', price: 0 },
  { id: 'h_bald', type: 'hair', name: '민머리', icon: '🥚', price: 0 },
  // 머리 색
  { id: 'hc_black', type: 'hcolor', name: '검정', color: '#2b2b2b', price: 0 },
  { id: 'hc_blonde', type: 'hcolor', name: '금발', color: '#f2c94c', price: 0 },
  { id: 'hc_red', type: 'hcolor', name: '빨강', color: '#b5452f', price: 0 },
  { id: 'hc_pink', type: 'hcolor', name: '분홍', color: '#ff8fc8', price: 30 },
  { id: 'hc_blue', type: 'hcolor', name: '파랑', color: '#4d9bff', price: 30 },
  { id: 'hc_purple', type: 'hcolor', name: '보라', color: '#9b6bff', price: 30 },
  { id: 'hc_mint', type: 'hcolor', name: '민트', color: '#6ee7c8', price: 30 },
  { id: 'hc_silver', type: 'hcolor', name: '은색', color: '#d9dde3', price: 50 },
];
const SHOP_BY_ID = new Map(SHOP.map(i => [i.id, i]));
// 관리자 계정이 없으면 만들어 두기 (원래 있던 같은 이름 계정이면 그대로 관리자 계정으로 써요)
function ensureAdminAccount() {
  const existing = Object.keys(accounts).find(isAdminName);
  if (existing && existing !== ADMIN_NAME) { accounts[ADMIN_NAME] = accounts[existing]; delete accounts[existing]; }
  if (!accounts[ADMIN_NAME]) accounts[ADMIN_NAME] = { created: new Date().toISOString(), coins: 0, owned: [], equip: { hat: 'crown', visor: null, skin: null } };
  accounts[ADMIN_NAME].admin = true;
}
function acct(name) {
  const a = accounts[name];
  if (!a) return null;
  if (typeof a.coins !== 'number') a.coins = 0;
  if (!Array.isArray(a.owned)) a.owned = [];
  if (!a.equip) a.equip = { hat: null, visor: null, skin: null };
  if (!['m', 'f', 'n'].includes(a.gender)) a.gender = 'n';
  return a;
}
// 관리자는 상점 물건을 전부 가진 걸로 쳐요
const owns = (a, item) => item.price === 0 || !!a.admin || a.owned.includes(item.id);
const ADMIN_COINS = 999999; // 관리자는 코인 무한
const coinsOf = name => isAdminName(name) ? ADMIN_COINS : (acct(name)?.coins ?? 0);
function meInfo(name) {
  const a = acct(name);
  return { t: 'me', coins: coinsOf(name), inf: isAdminName(name), owned: a.admin ? SHOP.map(i => i.id) : a.owned, equip: a.equip, gender: a.gender, trophies: a.trophies || 0, rank: rankOf(name) };
}
function lookOf(name) {
  const a = acct(name);
  return a ? [a.equip.hat || '', a.equip.visor || '', a.equip.skin || '', a.equip.hair || '', a.equip.hcolor || '', a.gender]
    : ['', '', '', '', '', 'n'];
}
function handleShop(c, msg) {
  const a = acct(c.name);
  if (!a) return;
  if (msg.t === 'buy') {
    const item = SHOP_BY_ID.get(String(msg.item));
    if (!item || owns(a, item)) return;
    if (coinsOf(c.name) < item.price) return sendTo(c, { t: 'notice', text: '코인이 부족해요.' });
    if (!isAdminName(c.name)) a.coins -= item.price;
    a.owned.push(item.id);
    a.equip[item.type] = item.id; // 사면 바로 착용
    saveAccounts();
    sendTo(c, { t: 'notice', text: `${item.name}을(를) 샀어요! 🎉` });
  } else if (msg.t === 'gender') {
    if (!['m', 'f', 'n'].includes(msg.g)) return;
    a.gender = msg.g;
    saveAccounts();
  } else if (msg.t === 'equip') {
    const type = String(msg.type);
    if (!['hat', 'visor', 'skin', 'hair', 'hcolor'].includes(type)) return;
    if (msg.item == null) a.equip[type] = null;
    else {
      const item = SHOP_BY_ID.get(String(msg.item));
      if (!item || item.type !== type || !owns(a, item)) return;
      a.equip[type] = item.id;
    }
    saveAccounts();
  }
  sendTo(c, meInfo(c.name));
}
function awardWinners(room, team) {
  giveCoins([...room.players.values()].filter(p => p.team === team));
}
// 이기면 코인 20 + 트로피 1 (관리자는 코인이 무한이라 트로피만)
function giveCoins(list) {
  for (const p of list) {
    const a = acct(p.name);
    if (!a) continue;
    a.trophies = (a.trophies || 0) + 1;
    if (!isAdminName(p.name)) a.coins += WIN_COINS;
    sendTo(p, { t: 'coins', delta: isAdminName(p.name) ? 0 : WIN_COINS, coins: coinsOf(p.name), inf: isAdminName(p.name), trophy: 1, trophies: a.trophies });
    sendTo(p, meInfo(p.name));
  }
  saveAccounts();
}

// ---------- 트로피 순위 ----------
function ranking() {
  return Object.entries(accounts)
    .filter(([, a]) => !a.banned)
    .map(([name, a]) => ({ name, trophies: a.trophies || 0 }))
    .sort((x, y) => y.trophies - x.trophies || x.name.localeCompare(y.name, 'ko'));
}
function rankOf(name) {
  const i = ranking().findIndex(r => r.name === name);
  return i < 0 ? null : i + 1;
}

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
MAP.id = 'basic';

// 크리스마스 맵: 구조는 기본 맵과 똑같고(공평하게), 크리스마스 트리가 더 있어요.
function buildXmas() {
  const trees = [[34, 12], [-34, 12], [34, -12], [-34, -12], [12, 22], [-12, 22], [12, -22], [-12, -22]].map(([x, z]) => ({ x, z }));
  const trunks = trees.map(({ x, z }) => ({ min: [x - 0.35, 0, z - 0.35], max: [x + 0.35, 1.6, z + 0.35], kind: 'tree' }));
  return { ...MAP, id: 'xmas', theme: 'xmas', boxes: [...MAP.boxes, ...trunks], trees };
}
const BATTLE_MAPS = { basic: MAP, xmas: buildXmas() };
const MAP_LIST = [
  { id: 'basic', name: '기본 맵', icon: '🌳' },
  { id: 'xmas', name: '크리스마스 맵', icon: '🎄' },
];

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
//  점프맵
// =====================================================
function buildObby() {
  const boxes = [], checkpoints = [];
  const plat = (x, y, z, w, d, kind) => boxes.push({ min: [x - w / 2, y - 1, z - d / 2], max: [x + w / 2, y, z + d / 2], kind });
  plat(0, 0, 0, 10, 10, 'start');
  checkpoints.push({ x: 0, y: 0, z: 0, w: 10, d: 10 });
  let edge = -5, y = 0; // edge = 마지막 발판의 앞쪽 끝
  const next = (x, dy, gap, w, d, kind = 'plat') => {
    y += dy;
    const z = edge - gap - d / 2;
    plat(x, y, z, w, d, kind);
    edge = z - d / 2;
    return { x, y, z, w, d };
  };
  const cp = (gap = 2.5) => checkpoints.push(next(0, 0, gap, 6, 6, 'cp'));
  // 1구간: 쉬운 계단
  for (let i = 0; i < 5; i++) next(0, 0.5, 2.2, 3, 3);
  cp();
  // 2구간: 지그재그
  for (let i = 0; i < 6; i++) next(i % 2 ? 2.5 : -2.5, 0.4, 2.0, 2.2, 2.2);
  cp();
  // 3구간: 좁은 다리 + 높은 계단
  next(0, 0, 2.5, 1, 8, 'beam'); next(0, 0.5, 2.5, 1, 8, 'beam'); next(0, 0, 2.5, 0.8, 6, 'beam');
  for (let i = 0; i < 4; i++) next(0, 0.9, 1.8, 2.5, 2.5);
  cp();
  // 4구간: 작은 발판
  for (const x of [0, 1, -1, 0, 1, 0]) next(x, 0, 2.8, 1.4, 1.4);
  cp();
  // 5구간: 마지막 오르막
  for (const x of [-2, 0, 2, 0]) next(x, 0.8, 2.2, 1.8, 1.8);
  const goal = next(0, 0.5, 2.8, 8, 8, 'goal');
  return { size: Math.ceil(Math.abs(edge)) + 30, boxes, noFloor: true, checkpoints, goal };
}
const OBBY = buildObby();
const OBBY_ROUND_MS = 4 * 60 * 1000;
const OBBY_COUNTDOWN_MS = 10 * 1000;
const OBBY_END_MS = 8 * 1000;

// 좀비 모드용 출발 위치
const ZSPAWNS = {
  human: [[-10, -4], [10, -4], [-10, 4], [10, 4], [0, -6], [0, 6], [-18, 0], [18, 0]].map(([x, z]) => ({ x, z, yaw: Math.random() * 6.28 })),
  zombie: [...MAP.spawns.red, ...MAP.spawns.blue],
};
const ZOMBIE_HP = 250;
const ZOMBIE_ROUND_MS = 3 * 60 * 1000;
const ZOMBIE_COUNTDOWN_MS = 10 * 1000;
const ZOMBIE_END_MS = 7 * 1000;
const ATTACK_MS = 600;
const ATTACK_RANGE = 2.0;

// =====================================================
//  방(게임) 목록
// =====================================================
const ROOM_DEFS = [
  { id: 'fps', mode: 'fps', icon: '🔫', title: '팀 배틀 FPS', desc: '빨강 팀 vs 파랑 팀! 먼저 목표 킬을 채우는 팀이 이겨요.' },
  { id: 'zombie', mode: 'zombie', icon: '🧟', title: '좀비 모드', desc: '좀비에게 잡히면 나도 좀비! 3분 동안 살아남으세요.' },
  { id: 'obby', mode: 'obby', icon: '🏃', title: '점프맵', desc: '발판을 건너 먼저 골인하면 승리! 떨어지면 체크포인트에서 다시 시작해요.' },
];
const rooms = new Map();
for (const d of ROOM_DEFS) {
  rooms.set(d.id, {
    ...d, players: new Map(), map: d.mode === 'obby' ? OBBY : MAP,
    mapId: 'basic', votes: new Map(), adminPick: null,                  // 맵 투표 (팀전/좀비)
    scores: { red: 0, blue: 0 }, killTarget: 20, roundOver: false,      // 팀전
    phase: 'waiting', phaseEnd: 0, wins: { human: 0, zombie: 0 },       // 좀비
  });
}

const clients = new Map(); // id -> 접속한 사람 (로비에 있거나 방 안에 있음)
let nextId = 1;

function sendTo(p, msg) { if (p.ws && p.ws.open) p.ws.send(msg); }
function roomBroadcast(room, msg) { const s = JSON.stringify(msg); for (const p of room.players.values()) sendTo(p, s); }
function broadcastAll(msg) { const s = JSON.stringify(msg); for (const c of clients.values()) sendTo(c, s); }
function countTeam(room, team) { let n = 0; for (const p of room.players.values()) if (p.team === team) n++; return n; }

function pickTeam(room) {
  if (room.mode === 'zombie') return room.phase === 'playing' ? 'zombie' : 'human';
  if (room.mode === 'obby') return 'runner';
  const r = countTeam(room, 'red'), b = countTeam(room, 'blue');
  if (r !== b) return r < b ? 'red' : 'blue';
  return Math.random() < 0.5 ? 'red' : 'blue';
}

function spawn(room, p) {
  if (room.mode === 'obby') {
    const c = OBBY.checkpoints[p.cp || 0];
    p.x = c.x + (Math.random() - 0.5) * (c.w - 2); p.y = c.y; p.z = c.z + (Math.random() - 0.5) * (c.d - 2);
    p.yaw = 0; p.pitch = 0;
  } else {
    const list = room.mode === 'fps' ? MAP.spawns[p.team] : ZSPAWNS[p.team];
    const s = list[Math.floor(Math.random() * list.length)];
    p.x = s.x + (Math.random() - 0.5); p.y = 0; p.z = s.z; p.yaw = s.yaw; p.pitch = 0;
  }
  p.hp = p.team === 'zombie' ? ZOMBIE_HP : MAX_HP;
  p.alive = true; p.protectUntil = now() + SPAWN_PROTECT_MS;
  p.ammo = MAG_SIZE; p.reloadUntil = 0; p.lastMoveAt = now();
  sendTo(p, { t: 'respawn', x: p.x, y: p.y, z: p.z, yaw: p.yaw, hp: p.hp });
}

function setRole(p, role) {
  p.team = role;
  sendTo(p, { t: 'role', role });
}

// ---------- 방 들어가기 / 나가기 ----------
function joinRoom(c, roomId) {
  const room = rooms.get(roomId);
  if (!room || c.room) return;
  if (room.players.size >= MAX_PLAYERS) return sendTo(c, { t: 'notice', text: `방이 꽉 찼어요 (최대 ${MAX_PLAYERS}명).` });
  if (room.players.size === 0) applyNextMap(room); // 아무도 없던 방이면 정해 둔 맵으로
  c.room = room;
  Object.assign(c, {
    team: pickTeam(room), x: 0, y: 0, z: 0, yaw: 0, pitch: 0, hp: MAX_HP, alive: false,
    kills: 0, deaths: 0, lastShot: 0, lastAttack: 0, ammo: MAG_SIZE, reloadUntil: 0,
    respawnAt: 0, protectUntil: 0, lastMoveAt: now(), cp: 0,
  });
  room.players.set(c.id, c);
  sendTo(c, {
    t: 'welcome', id: c.id, name: c.name, team: c.team, map: room.map, adminName: ADMIN_NAME,
    mode: room.mode, roomTitle: room.title,
    cfg: { maxHp: MAX_HP, zombieHp: ZOMBIE_HP, mag: MAG_SIZE, reloadMs: RELOAD_MS, fireMs: FIRE_INTERVAL, attackMs: ATTACK_MS },
  });
  spawn(room, c);
  if (hasVote(room)) sendTo(c, voteInfo(room));
  roomBroadcast(room, { t: 'joined', name: c.name });
}
function leaveRoom(c) {
  const room = c.room;
  if (!room) return;
  room.players.delete(c.id);
  if (room.votes.delete(c.name)) roomBroadcast(room, voteInfo(room));
  c.room = null;
  roomBroadcast(room, { t: 'left', name: c.name });
}

// =====================================================
//  팀전 규칙
// =====================================================
// ---------- 맵 투표 ----------
// 관리자가 고르면 관리자 맵, 아니면 투표 다수결 (같으면 지금 맵 유지)
const hasVote = room => room.mode === 'fps' || room.mode === 'zombie';
function decideNextMap(room) {
  if (room.adminPick) return room.adminPick;
  const count = {};
  for (const v of room.votes.values()) count[v] = (count[v] || 0) + 1;
  let best = room.mapId, bestN = count[room.mapId] || 0;
  for (const m of MAP_LIST) if ((count[m.id] || 0) > bestN) { best = m.id; bestN = count[m.id]; }
  return best;
}
function voteInfo(room) {
  const count = {};
  for (const v of room.votes.values()) count[v] = (count[v] || 0) + 1;
  return {
    t: 'vote', current: room.mapId, next: decideNextMap(room), adminPick: room.adminPick,
    maps: MAP_LIST.map(m => ({ ...m, count: count[m.id] || 0 })),
  };
}
function handleVote(c, mapId) {
  const room = c.room;
  if (!room || !hasVote(room) || !MAP_LIST.some(m => m.id === mapId)) return;
  if (isAdminName(c.name)) {
    room.adminPick = mapId;
    const m = MAP_LIST.find(x => x.id === mapId);
    roomBroadcast(room, { t: 'notice', text: `👑 관리자가 다음 맵을 ${m.icon} ${m.name}으로 정했어요!` });
  } else room.votes.set(c.name, mapId);
  roomBroadcast(room, voteInfo(room));
}
// 라운드가 새로 시작할 때 다음 맵으로 바꾸기. 바뀌면 true
function applyNextMap(room) {
  if (!hasVote(room)) return false;
  const next = decideNextMap(room);
  room.votes.clear(); room.adminPick = null;
  const changed = next !== room.mapId;
  if (changed) {
    room.mapId = next; room.map = BATTLE_MAPS[next];
    const m = MAP_LIST.find(x => x.id === next);
    roomBroadcast(room, { t: 'map', map: room.map, name: `${m.icon} ${m.name}` });
  }
  roomBroadcast(room, voteInfo(room));
  return changed;
}

function resetFps(room) {
  applyNextMap(room);
  room.scores = { red: 0, blue: 0 };
  room.roundOver = false;
  for (const p of room.players.values()) { p.kills = 0; p.deaths = 0; spawn(room, p); }
  roomBroadcast(room, { t: 'round' });
}
function fpsKill(room, victim, killer, head) {
  victim.alive = false; victim.hp = 0; victim.deaths++;
  victim.respawnAt = now() + RESPAWN_MS;
  killer.kills++;
  room.scores[killer.team]++;
  roomBroadcast(room, { t: 'kill', killer: killer.name, kteam: killer.team, victim: victim.name, vteam: victim.team, head });
  if (!room.roundOver && room.scores[killer.team] >= room.killTarget) {
    room.roundOver = true;
    roomBroadcast(room, { t: 'win', team: killer.team });
    awardWinners(room, killer.team);
    setTimeout(() => resetFps(room), 6000);
  }
}

// =====================================================
//  좀비 모드 규칙
// =====================================================
function setPhase(room, phase, ms) {
  room.phase = phase; room.phaseEnd = now() + (ms || 0);
  roomBroadcast(room, { t: 'phase', phase });
}
function resetZombie(room) {
  applyNextMap(room);
  for (const p of room.players.values()) { setRole(p, 'human'); p.kills = 0; p.deaths = 0; spawn(room, p); }
  if (room.players.size >= 2) setPhase(room, 'countdown', ZOMBIE_COUNTDOWN_MS);
  else setPhase(room, 'waiting');
}
function startZombieRound(room) {
  const list = [...room.players.values()];
  for (const p of list) { setRole(p, 'human'); spawn(room, p); }
  const k = Math.max(1, Math.floor(list.length / 5));
  for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; }
  for (const p of list.slice(0, k)) { setRole(p, 'zombie'); spawn(room, p); }
  setPhase(room, 'playing', ZOMBIE_ROUND_MS);
  roomBroadcast(room, { t: 'zstart', zombies: list.slice(0, k).map(p => p.name) });
}
function endZombie(room, winner) {
  if (winner) room.wins[winner]++;
  setPhase(room, 'ended', ZOMBIE_END_MS);
  roomBroadcast(room, { t: 'win', team: winner });
  if (winner) awardWinners(room, winner);
}
function zombieTick(room, t) {
  const n = room.players.size;
  switch (room.phase) {
    case 'waiting':
      if (n >= 2) {
        if (applyNextMap(room)) for (const p of room.players.values()) spawn(room, p);
        setPhase(room, 'countdown', ZOMBIE_COUNTDOWN_MS);
      }
      break;
    case 'countdown':
      if (n < 2) setPhase(room, 'waiting');
      else if (t >= room.phaseEnd) startZombieRound(room);
      break;
    case 'playing': {
      const humans = countTeam(room, 'human'), zombies = countTeam(room, 'zombie');
      if (n < 2) endZombie(room, null);
      else if (humans === 0) endZombie(room, 'zombie');
      else if (zombies === 0 || t >= room.phaseEnd) endZombie(room, 'human');
      break;
    }
    case 'ended':
      if (t >= room.phaseEnd) resetZombie(room);
      break;
  }
}
function handleAttack(room, p) {
  const t = now();
  if (room.mode !== 'zombie' || p.team !== 'zombie' || !p.alive || room.phase !== 'playing') return;
  if (t - p.lastAttack < ATTACK_MS - 30) return;
  p.lastAttack = t;
  roomBroadcast(room, { t: 'swing', id: p.id });
  const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
  let best = null, bestD = ATTACK_RANGE;
  for (const q of room.players.values()) {
    if (q.team !== 'human' || !q.alive) continue;
    const dx = q.x - p.x, dz = q.z - p.z, d = Math.hypot(dx, dz);
    if (d > bestD || Math.abs(q.y - p.y) > 1.6) continue;
    if (d > 0.9 && (dx * fx + dz * fz) / d < 0.2) continue; // 앞쪽에 있어야 해요
    best = q; bestD = d;
  }
  if (!best) return;
  best.deaths++; p.kills++;
  setRole(best, 'zombie');
  best.hp = ZOMBIE_HP; best.protectUntil = t + 1000;
  sendTo(best, { t: 'hurt', from: p.name });
  sendTo(p, { t: 'hitmark', head: false, kill: true });
  roomBroadcast(room, { t: 'infect', zombie: p.name, human: best.name });
}

// =====================================================
//  점프맵 규칙
// =====================================================
const onPad = (p, pad, m = 0.3) =>
  Math.abs(p.x - pad.x) <= pad.w / 2 + m && Math.abs(p.z - pad.z) <= pad.d / 2 + m && Math.abs(p.y - pad.y) < 0.4;
function obbyStartCountdown(room) {
  for (const p of room.players.values()) { p.cp = 0; spawn(room, p); }
  room.winner = null;
  setPhase(room, 'countdown', OBBY_COUNTDOWN_MS);
}
function obbyTick(room, t) {
  const n = room.players.size;
  switch (room.phase) {
    case 'waiting':
      if (n >= 2) obbyStartCountdown(room);
      break;
    case 'countdown':
      if (n < 2) setPhase(room, 'waiting');
      else if (t >= room.phaseEnd) { room.raceStart = t; room.winner = null; setPhase(room, 'playing', OBBY_ROUND_MS); }
      break;
    case 'playing':
      if (n === 0) setPhase(room, 'waiting');
      else if (t >= room.phaseEnd) { setPhase(room, 'ended', OBBY_END_MS); roomBroadcast(room, { t: 'obbywin', name: null }); }
      break;
    case 'ended':
      if (t >= room.phaseEnd) {
        if (n >= 2) obbyStartCountdown(room);
        else { for (const p of room.players.values()) { p.cp = 0; spawn(room, p); } setPhase(room, 'waiting'); }
      }
      break;
  }
}
function obbyCheck(room, p) {
  if (p.y < -12) { spawn(room, p); return; } // 떨어지면 체크포인트로
  const start = OBBY.checkpoints[0];
  if (room.phase === 'countdown' && !(Math.abs(p.x - start.x) < 6 && Math.abs(p.z - start.z) < 6)) {
    sendTo(p, { t: 'correct', x: start.x, y: start.y, z: start.z }); // 출발 전에는 출발선에서 기다리기
    p.x = start.x; p.y = start.y; p.z = start.z;
    return;
  }
  const cps = OBBY.checkpoints;
  for (let i = cps.length - 1; i > p.cp; i--) {
    if (onPad(p, cps[i])) { p.cp = i; sendTo(p, { t: 'checkpoint', i, total: cps.length - 1 }); break; }
  }
  if (onPad(p, OBBY.goal)) {
    if (room.phase === 'playing' && !room.winner) {
      room.winner = p.name;
      const secs = Math.round((now() - room.raceStart) / 100) / 10;
      roomBroadcast(room, { t: 'obbywin', name: p.name, time: secs });
      giveCoins([p]);
      setPhase(room, 'ended', OBBY_END_MS);
    } else if (room.phase !== 'playing' && room.phase !== 'ended') {
      sendTo(p, { t: 'practice' }); // 연습 완주
      p.cp = 0; spawn(room, p);
    }
  }
}

// =====================================================
//  공통: 사격 / 이동
// =====================================================
function handleShoot(room, p, msg) {
  const t = now();
  if (!p.alive || room.mode === 'obby') return;
  if (room.mode === 'fps' && room.roundOver) return;
  if (room.mode === 'zombie' && p.team === 'zombie') return;
  if (t - p.lastShot < FIRE_INTERVAL - 15) return;
  if (p.reloadUntil && t >= p.reloadUntil) { p.ammo = MAG_SIZE; p.reloadUntil = 0; }
  if (p.reloadUntil || p.ammo <= 0) return;
  let d = [Number(msg.dx), Number(msg.dy), Number(msg.dz)];
  if (!d.every(Number.isFinite)) return;
  const len = Math.hypot(d[0], d[1], d[2]);
  if (len < 0.5) return;
  d = d.map(v => v / len);
  p.lastShot = t; p.ammo--;
  p.protectUntil = 0;

  const canHit = q => room.mode === 'fps' ? q.team !== p.team : (room.phase === 'playing' && q.team === 'zombie');
  const o = [p.x, p.y + 1.6, p.z];
  let best = 100, hitPlayer = null;
  for (const b of room.map.boxes) {
    const tt = rayBox(o, d, b.min, b.max);
    if (tt < best) best = tt;
  }
  for (const q of room.players.values()) {
    if (q === p || !q.alive || !canHit(q)) continue;
    const tt = rayBox(o, d, [q.x - 0.4, q.y, q.z - 0.4], [q.x + 0.4, q.y + 1.85, q.z + 0.4]);
    if (tt < best) { best = tt; hitPlayer = q; }
  }
  const end = [o[0] + d[0] * best, o[1] + d[1] * best, o[2] + d[2] * best];
  roomBroadcast(room, { t: 'shot', id: p.id, o, e: end });

  if (hitPlayer) {
    const q = hitPlayer;
    if (q.protectUntil > t) return;
    const head = end[1] - q.y > 1.15; // 동글이 캐릭터는 머리가 커요
    q.hp -= head ? HEAD_DAMAGE : BODY_DAMAGE;
    sendTo(q, { t: 'hurt', from: p.name });
    const dead = q.hp <= 0;
    sendTo(p, { t: 'hitmark', head, kill: dead });
    if (dead) {
      if (room.mode === 'fps') fpsKill(room, q, p, head);
      else {
        q.alive = false; q.hp = 0; q.deaths++; q.respawnAt = t + RESPAWN_MS; p.kills++;
        roomBroadcast(room, { t: 'kill', killer: p.name, kteam: 'human', victim: q.name, vteam: 'zombie', head });
      }
    }
  }
}

function handleMove(room, p, msg) {
  if (!p.alive) return;
  const x = Number(msg.x), y = Number(msg.y), z = Number(msg.z);
  const yaw = Number(msg.yaw), pitch = Number(msg.pitch);
  if (![x, y, z, yaw, pitch].every(Number.isFinite)) return;
  const t = now();
  const dt = Math.min(1, (t - p.lastMoveAt) / 1000);
  p.lastMoveAt = t;
  const maxStep = 8 * dt * 1.6 + 0.6;
  const dist = Math.hypot(x - p.x, z - p.z);
  const lim = room.map.size - 1;
  const [ymin, ymax] = room.map.noFloor ? [-40, 80] : [-0.5, 8];
  if (dist > maxStep || Math.abs(x) > lim || Math.abs(z) > lim || y < ymin || y > ymax) {
    sendTo(p, { t: 'correct', x: p.x, y: p.y, z: p.z });
  } else {
    p.x = x; p.y = y; p.z = z;
  }
  p.yaw = yaw; p.pitch = Math.max(-1.6, Math.min(1.6, pitch));
  if (room.mode === 'obby') obbyCheck(room, p);
}

// =====================================================
//  채팅
// =====================================================
const chatLog = [];
function handleChat(c, msg) {
  const a = acct(c.name);
  if (a && a.muted) return sendTo(c, { t: 'notice', text: '관리자가 채팅을 막았어요.' });
  const text = String(msg.text || '').replace(/\s+/g, ' ').trim().slice(0, 100);
  if (!text) return;
  const t = now();
  c.chatTimes = (c.chatTimes || []).filter(x => t - x < 5000);
  if (c.chatTimes.length >= 5 || (c.lastChat && t - c.lastChat < 600)) {
    return sendTo(c, { t: 'notice', text: '너무 빨라요! 잠깐 쉬었다 보내 주세요.' });
  }
  c.chatTimes.push(t); c.lastChat = t;
  if (text.startsWith('/')) return chatCommand(c, text);
  const room = c.room;
  const team = !!msg.team && !!room && room.mode !== 'obby';
  const out = { t: 'chat', from: c.name, text, scope: !room ? 'lobby' : team ? 'team' : 'all', team: room ? c.team : null };
  if (!room) { for (const x of clients.values()) if (!x.room) sendTo(x, out); }
  else if (team) { for (const p of room.players.values()) if (p.team === c.team) sendTo(p, out); }
  else roomBroadcast(room, out);
  chatLog.push({ time: new Date().toISOString(), from: c.name, where: !room ? '로비' : room.title + (team ? ' (팀)' : ''), text });
  if (chatLog.length > 100) chatLog.shift();
}

// 채팅 명령어: /코인 아이디 개수  (내 코인을 친구에게 보내기)
function chatCommand(c, text) {
  const [cmd, who, num] = text.split(' ');
  if (cmd === '/코인' || cmd === '/give') {
    const n = Math.floor(Number(num));
    const target = who && Object.keys(accounts).find(k => k.toLowerCase() === who.toLowerCase());
    if (!who || !Number.isFinite(n)) return sendTo(c, { t: 'notice', text: '사용법: /코인 아이디 개수  (예: /코인 철수 20)' });
    if (!target) return sendTo(c, { t: 'notice', text: `'${who}' 계정이 없어요.` });
    if (target === c.name) return sendTo(c, { t: 'notice', text: '나에게는 보낼 수 없어요.' });
    if (n < 1 || n > 100000) return sendTo(c, { t: 'notice', text: '1 이상의 숫자를 써 주세요.' });
    if (coinsOf(c.name) < n) return sendTo(c, { t: 'notice', text: `코인이 부족해요. (가진 코인: ${coinsOf(c.name)})` });
    if (isAdminName(target)) return sendTo(c, { t: 'notice', text: '관리자는 코인이 무한이라 받을 필요가 없어요 😄' });
    if (!isAdminName(c.name)) acct(c.name).coins -= n;
    acct(target).coins += n;
    saveAccounts();
    sendTo(c, { t: 'notice', text: `${target} 님에게 🪙 ${n}코인을 보냈어요!` });
    sendTo(c, meInfo(c.name));
    sendTo(c, { t: 'coins', delta: 0, coins: coinsOf(c.name), inf: isAdminName(c.name) });
    for (const x of clients.values()) if (x.name === target) {
      sendTo(x, { t: 'notice', text: `${c.name} 님이 🪙 ${n}코인을 보냈어요! 🎁` });
      sendTo(x, meInfo(x.name));
      sendTo(x, { t: 'coins', delta: n, coins: coinsOf(x.name) });
    }
    chatLog.push({ time: new Date().toISOString(), from: c.name, where: '코인 보내기', text: `${target}에게 ${n}코인` });
    if (chatLog.length > 100) chatLog.shift();
    return;
  }
  sendTo(c, { t: 'notice', text: '명령어: /코인 아이디 개수  (친구에게 코인 보내기)' });
}

function kickClient(c, reason, block) {
  if (block) kickBlocks.set(c.name, now() + KICK_BLOCK_MS);
  sendTo(c, { t: 'kicked', reason });
  setTimeout(() => c.ws.close(), 100);
}

function lobbyInfo() {
  return {
    t: 'lobby', top: ranking().slice(0, 10),
    rooms: [...rooms.values()].map(r => ({ id: r.id, icon: r.icon, title: r.title, desc: r.desc, count: r.players.size, max: MAX_PLAYERS })),
  };
}

// 주기적 업데이트
setInterval(() => {
  const t = now();
  for (const room of rooms.values()) {
    if (room.mode === 'zombie') zombieTick(room, t);
    if (room.mode === 'obby') obbyTick(room, t);
    for (const p of room.players.values()) {
      if (!p.alive && t >= p.respawnAt && !(room.mode === 'fps' && room.roundOver)) spawn(room, p);
    }
    if (!room.players.size) continue;
    const state = {
      t: 'state',
      p: [...room.players.values()].map(p => ({
        id: p.id, n: p.name, tm: p.team,
        x: +p.x.toFixed(2), y: +p.y.toFixed(2), z: +p.z.toFixed(2),
        yw: +p.yaw.toFixed(3), pt: +p.pitch.toFixed(3),
        hp: Math.max(0, p.hp), a: p.alive ? 1 : 0, k: p.kills, d: p.deaths, lk: lookOf(p.name), c: p.cp || 0,
      })),
    };
    if (room.mode === 'fps') { state.s = room.scores; state.target = room.killTarget; }
    else {
      state.ph = room.phase; state.w = room.wins;
      state.tl = Math.max(0, Math.ceil((room.phaseEnd - t) / 1000));
    }
    roomBroadcast(room, state);
  }
}, TICK_MS);

// 로비 정보 (1초마다)
setInterval(() => {
  const s = JSON.stringify(lobbyInfo());
  for (const c of clients.values()) if (!c.room) sendTo(c, s);
}, 1000);

// =====================================================
//  관리자
// =====================================================
const admins = new Set();
function adminSnapshot() {
  return {
    t: 'admin',
    shutdown,
    accounts: Object.keys(accounts).length,
    rooms: [...rooms.values()].map(r => ({
      id: r.id, title: r.title, mode: r.mode, count: r.players.size,
      scores: r.scores, killTarget: r.killTarget, phase: r.phase, wins: r.wins,
      ...(hasVote(r) ? { vote: voteInfo(r) } : {}),
    })),
    maps: MAP_LIST,
    players: [...clients.values()].map(c => ({
      id: c.id, name: c.name, room: c.room ? c.room.id : null, roomTitle: c.room ? c.room.title : '로비',
      team: c.room ? c.team : null, kills: c.kills || 0, deaths: c.deaths || 0, hp: c.hp, alive: !!c.alive,
      coins: isAdminName(c.name) ? '∞' : coinsOf(c.name), muted: !!(acct(c.name) && acct(c.name).muted),
    })),
    chat: chatLog.slice(-40),
    accountList: (() => {
      const r = ranking(), online = new Set([...clients.values()].map(c => c.name));
      return Object.entries(accounts).map(([name, a]) => ({
        name, coins: isAdminName(name) ? '∞' : (a.coins || 0), trophies: a.trophies || 0,
        rank: a.banned ? null : r.findIndex(x => x.name === name) + 1,
        banned: !!a.banned, muted: !!a.muted, admin: isAdminName(name), online: online.has(name), created: a.created,
      })).sort((x, y) => (x.rank || 1e9) - (y.rank || 1e9));
    })(),
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
      const c = clients.get(Number(msg.id));
      if (c) kickClient(c, '관리자가 퇴장시켰어요.', true);
      break;
    }
    case 'setTeam': {
      const c = clients.get(Number(msg.id));
      if (c && c.room && c.room.mode === 'fps' && (msg.team === 'red' || msg.team === 'blue') && c.team !== msg.team) {
        setRole(c, msg.team); spawn(c.room, c);
      }
      break;
    }
    case 'resetRound': {
      const room = rooms.get(msg.room);
      if (room) room.mode === 'fps' ? resetFps(room) : room.mode === 'zombie' ? resetZombie(room) : obbyStartCountdown(room);
      break;
    }
    case 'setTarget': {
      const n = Math.round(Number(msg.n));
      const room = rooms.get('fps');
      if (n >= 1 && n <= 200) room.killTarget = n;
      break;
    }
    case 'announce': {
      const text = String(msg.text || '').slice(0, 100).trim();
      if (text) broadcastAll({ t: 'announce', text });
      break;
    }
    case 'shutdown': {
      shutdown = true;
      for (const c of clients.values()) kickClient(c, '관리자가 서버를 닫았어요.', false);
      for (const tok of sessions.keys()) sessions.delete(tok);
      break;
    }
    case 'reopen': shutdown = false; break;
    case 'setMap': {
      const room = rooms.get(msg.room);
      if (!room || !hasVote(room)) break;
      room.adminPick = MAP_LIST.some(m => m.id === msg.map) ? msg.map : null; // null = 투표대로
      if (room.adminPick) {
        const m = MAP_LIST.find(x => x.id === msg.map);
        roomBroadcast(room, { t: 'notice', text: `👑 관리자가 다음 맵을 ${m.icon} ${m.name}으로 정했어요!` });
      }
      roomBroadcast(room, voteInfo(room));
      if (msg.now) room.mode === 'fps' ? resetFps(room) : resetZombie(room);
      break;
    }
    case 'mute': {
      const a = acct(String(msg.name || ''));
      if (a) {
        a.muted = !!msg.on; saveAccounts();
        for (const c of clients.values()) if (c.name === msg.name) sendTo(c, { t: 'notice', text: a.muted ? '관리자가 채팅을 막았어요.' : '다시 채팅할 수 있어요.' });
      }
      break;
    }
    case 'giveCoins': {
      if (isAdminName(msg.name)) break;
      const a = acct(String(msg.name || ''));
      const n = Math.round(Number(msg.n));
      if (a && Number.isFinite(n) && Math.abs(n) <= 100000) {
        a.coins = Math.max(0, a.coins + n); saveAccounts();
        for (const c of clients.values()) if (c.name === msg.name) { sendTo(c, meInfo(c.name)); sendTo(c, { t: 'coins', delta: n, coins: a.coins }); }
      }
      break;
    }
    case 'deleteAccount': {
      const name = String(msg.name || '');
      if (isAdminName(name)) break;
      if (accounts[name]) {
        for (const c of clients.values()) if (c.name === name) kickClient(c, '계정이 삭제됐어요.', false);
        for (const [tok, se] of sessions) if (se.username === name) sessions.delete(tok);
        delete accounts[name]; saveAccounts();
      }
      break;
    }
    case 'ban': {
      const name = String(msg.name || '');
      const a = acct(name);
      if (!a || isAdminName(name)) break;
      a.banned = !!msg.on; saveAccounts();
      if (a.banned) {
        for (const c of clients.values()) if (c.name === name) kickClient(c, '관리자가 이 계정의 이용을 정지했어요.', false);
        for (const [tok, se] of sessions) if (se.username === name) sessions.delete(tok);
      }
      break;
    }
    case 'setTrophies': {
      const a = acct(String(msg.name || ''));
      const n = Math.round(Number(msg.n));
      if (a && Number.isFinite(n) && n >= 0 && n <= 1000000) {
        a.trophies = n; saveAccounts();
        for (const c of clients.values()) if (c.name === msg.name) sendTo(c, meInfo(c.name));
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
  if (accounts[name].banned) return fail('이 계정은 관리자가 이용을 정지했어요.');
  const block = kickBlocks.get(name);
  if (block && block > now()) return fail('퇴장당해서 잠시 후에 다시 들어올 수 있어요.');
  // 같은 계정이 이미 접속 중이면 이전 접속을 끊기
  for (const c of clients.values()) if (c.name === name) kickClient(c, '다른 곳에서 같은 계정으로 접속했어요.', false);
  if (clients.size >= MAX_PLAYERS * rooms.size) return fail('서버가 꽉 찼어요.');

  const c = { id: nextId++, name, ip, ws, room: null };
  clients.set(c.id, c);
  ws.send({ t: 'hello', name, shop: SHOP, winCoins: WIN_COINS, adminName: ADMIN_NAME });
  ws.send(meInfo(name));
  ws.send(lobbyInfo());

  ws.onmessage = raw => {
    let msg; try { msg = JSON.parse(raw); } catch { return; }
    const room = c.room;
    if (msg.t === 'join') joinRoom(c, String(msg.room));
    else if (msg.t === 'buy' || msg.t === 'equip' || msg.t === 'gender') handleShop(c, msg);
    else if (msg.t === 'chat') handleChat(c, msg);
    else if (msg.t === 'vote') handleVote(c, String(msg.map));
    else if (msg.t === 'give') { // 코인 보내기 버튼
      const to = String(msg.to || '').trim().replace(/\s+/g, ''), n = Math.floor(Number(msg.n));
      chatCommand(c, `/코인 ${to} ${n}`);
    }
    else if (!room) return;
    else if (msg.t === 'move') handleMove(room, c, msg);
    else if (msg.t === 'shoot') handleShoot(room, c, msg);
    else if (msg.t === 'attack') handleAttack(room, c);
    else if (msg.t === 'reload') {
      if (!c.reloadUntil && c.ammo < MAG_SIZE) c.reloadUntil = now() + RELOAD_MS;
    }
  };
  ws.onclose = () => {
    leaveRoom(c);
    if (clients.get(c.id) === c) clients.delete(c.id);
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
  // 관리자 창에서 '관리자 계정으로 게임하기'
  if (pathname === '/api/admin/play') {
    const exp = adminSessions.get(String(body.token || ''));
    if (!exp || exp < now()) return json(res, 401, { error: '관리자 로그인이 필요해요.' });
    const tok = newToken();
    sessions.set(tok, { username: ADMIN_NAME, expires: now() + 12 * 3600 * 1000 });
    return json(res, 200, { ok: true, token: tok, username: ADMIN_NAME });
  }

  if (shutdown) return json(res, 503, { error: '서버가 닫혀 있어요.' });
  if (!safeEqual(body.code || '', ENTRY_PASSWORD)) { failAttempt(ip); return json(res, 401, { error: '입장 비밀번호가 틀렸어요.' }); }

  if (pathname === '/api/entry') return json(res, 200, { ok: true });

  let username = String(body.username || '').trim();
  const password = String(body.password || '');
  if (pathname === '/api/signup') {
    if (!NAME_RE.test(username)) return json(res, 400, { error: '아이디는 한글/영어/숫자/_ 로 2~12글자여야 해요.' });
    if (password.length < 4 || password.length > 50) return json(res, 400, { error: '비밀번호는 4글자 이상이어야 해요.' });
    const lower = username.toLowerCase();
    if (isAdminName(username) || Object.keys(accounts).some(n => n.toLowerCase() === lower)) return json(res, 409, { error: '이미 있는 아이디예요.' });
    const salt = crypto.randomBytes(16).toString('hex');
    accounts[username] = {
      salt, hash: hashPassword(password, salt), created: new Date().toISOString(),
      coins: 0, owned: [], equip: { hat: null, visor: null, skin: null },
      gender: ['m', 'f', 'n'].includes(body.gender) ? body.gender : 'n',
    };
    saveAccounts();
  } else if (pathname === '/api/login' && isAdminName(username)) {
    // 관리자 계정은 관리자 비밀번호로 로그인해요
    if (!ADMIN_PASSWORD || !safeEqual(password, ADMIN_PASSWORD)) { failAttempt(ip); return json(res, 401, { error: '아이디나 비밀번호가 틀렸어요.' }); }
    username = ADMIN_NAME;
  } else if (pathname === '/api/login') {
    const acc = accounts[username];
    if (!acc || !acc.hash || !safeEqual(hashPassword(password, acc.salt), acc.hash)) {
      failAttempt(ip); return json(res, 401, { error: '아이디나 비밀번호가 틀렸어요.' });
    }
    if (acc.banned) return json(res, 403, { error: '이 계정은 관리자가 이용을 정지했어요.' });
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

// 서버가 꺼질 때 저장 안 된 내용을 바로 저장하기
process.on('SIGTERM', async () => {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; await flushAccounts(); }
  process.exit(0);
});

loadAccounts().then(() => {
  ensureAdminAccount();
  server.listen(PORT, () => {
    console.log(`게임 서버 실행 중: http://localhost:${PORT}`);
    if (!ADMIN_PASSWORD) console.log('⚠️  ADMIN_PASSWORD 환경변수가 없어서 관리자 로그인이 꺼져 있어요.');
  });
});
