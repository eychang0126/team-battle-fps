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

const TICK_MS = 66;              // 초당 15번 상태 전송 (데이터 아끼기)
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
  { id: 'halo', type: 'hat', name: '천사 링', icon: '😇', price: 80 },
  { id: 'horns', type: 'hat', name: '악마 뿔', icon: '😈', price: 80 },
  { id: 'crown', type: 'hat', name: '왕관', icon: '👑', price: 99999999999999999999999999, priceText: '99999999999999999999999999' },
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
  // 얼굴
  { id: 'f_happy', type: 'face', name: '웃는 눈', icon: '😊', price: 0 },
  { id: 'f_wink', type: 'face', name: '윙크', icon: '😉', price: 20 },
  { id: 'f_sleepy', type: 'face', name: '졸린 눈', icon: '😪', price: 20 },
  { id: 'f_angry', type: 'face', name: '화난 얼굴', icon: '😠', price: 20 },
  { id: 'f_cool', type: 'face', name: '쿨', icon: '😎', price: 30 },
  { id: 'f_cat', type: 'face', name: '고양이 입', icon: '😺', price: 30 },
  { id: 'f_star', type: 'face', name: '반짝 눈', icon: '🤩', price: 40 },
  { id: 'f_heart', type: 'face', name: '하트 눈', icon: '😍', price: 40 },
  // 눈 색
  { id: 'e_brown', type: 'ecolor', name: '갈색', color: '#6b3e1f', price: 0 },
  { id: 'e_blue', type: 'ecolor', name: '파랑', color: '#2f6fd6', price: 0 },
  { id: 'e_green', type: 'ecolor', name: '초록', color: '#2f9e44', price: 0 },
  { id: 'e_purple', type: 'ecolor', name: '보라', color: '#8a4fd8', price: 20 },
  { id: 'e_red', type: 'ecolor', name: '빨강', color: '#d12b2b', price: 20 },
  { id: 'e_sky', type: 'ecolor', name: '하늘색', color: '#4dc3ff', price: 20 },
  { id: 'e_gold', type: 'ecolor', name: '금색', color: '#e0a800', price: 50 },
  // 옷 색 (팀 배틀 FPS에서는 팀 색)
  { id: 'b_red', type: 'bcolor', name: '빨강', color: '#e84848', price: 0 },
  { id: 'b_orange', type: 'bcolor', name: '주황', color: '#ff9f1c', price: 0 },
  { id: 'b_yellow', type: 'bcolor', name: '노랑', color: '#ffd43b', price: 0 },
  { id: 'b_green', type: 'bcolor', name: '초록', color: '#3ccf6e', price: 0 },
  { id: 'b_pink', type: 'bcolor', name: '분홍', color: '#ff8fc8', price: 0 },
  { id: 'b_purple', type: 'bcolor', name: '보라', color: '#9b6bff', price: 0 },
  { id: 'b_white', type: 'bcolor', name: '흰색', color: '#f4f4f6', price: 0 },
  { id: 'b_black', type: 'bcolor', name: '검정', color: '#2d2f36', price: 0 },
  { id: 'b_mint', type: 'bcolor', name: '민트', color: '#6ee7c8', price: 20 },
  { id: 'b_gold', type: 'bcolor', name: '금색', color: '#e0b23a', price: 100 },
  // 바지 색 (안 고르면 윗옷 색보다 조금 어두운 색)
  { id: 'p_navy', type: 'pcolor', name: '남색', color: '#2b3a67', price: 0 },
  { id: 'p_black', type: 'pcolor', name: '검정', color: '#25262b', price: 0 },
  { id: 'p_gray', type: 'pcolor', name: '회색', color: '#7a7f8a', price: 0 },
  { id: 'p_jean', type: 'pcolor', name: '청바지', color: '#4f74a8', price: 0 },
  { id: 'p_brown', type: 'pcolor', name: '갈색', color: '#6b4a32', price: 0 },
  { id: 'p_white', type: 'pcolor', name: '흰색', color: '#eeeeee', price: 0 },
  { id: 'p_red', type: 'pcolor', name: '빨강', color: '#c23b3b', price: 0 },
  { id: 'p_green', type: 'pcolor', name: '초록', color: '#2f8a4a', price: 0 },
  { id: 'p_pink', type: 'pcolor', name: '분홍', color: '#ff8fc8', price: 20 },
  { id: 'p_purple', type: 'pcolor', name: '보라', color: '#8a5cd6', price: 20 },
  { id: 'p_mint', type: 'pcolor', name: '민트', color: '#6ee7c8', price: 20 },
  { id: 'p_gold', type: 'pcolor', name: '금색', color: '#e0b23a', price: 100 },
  // 날개
  { id: 'w_angel', type: 'wing', name: '천사 날개', icon: '🕊️', price: 150 },
  { id: 'w_devil', type: 'wing', name: '악마 날개', icon: '🦇', price: 150 },
  { id: 'w_fairy', type: 'wing', name: '요정 날개', icon: '🧚', price: 120 },
  // 꼬리
  { id: 't_devil', type: 'tail', name: '악마 꼬리', icon: '😈', price: 60 },
  { id: 't_cat', type: 'tail', name: '고양이 꼬리', icon: '🐱', price: 50 },
  { id: 't_dino', type: 'tail', name: '공룡 꼬리', icon: '🦖', price: 70 },
  // 무기 (산 무기는 게임 안에서 Q 키 / 🔁 버튼으로 바꿔 들어요)
  { id: 'wp_rifle', type: 'weapon', name: '돌격소총', icon: '🔫', price: 0, desc: '기본 총. 무난해요' },
  { id: 'wp_smg', type: 'weapon', name: '기관단총', icon: '💨', price: 80, desc: '아주 빠르게 연사, 한 발은 약해요' },
  { id: 'wp_shotgun', type: 'weapon', name: '샷건', icon: '💥', price: 120, desc: '가까이서 엄청 세요. 멀면 약해요' },
  { id: 'wp_sniper', type: 'weapon', name: '저격총', icon: '🎯', price: 200, desc: '헤드샷 한 방! 오른쪽 클릭으로 조준경' },
  { id: 'wp_minigun', type: 'weapon', name: '미니건', icon: '🌀', price: 400, desc: '총알 120발, 쉬지 않고 쏴요' },
  { id: 'wp_dagger', type: 'weapon', name: '단검', icon: '🗡️', price: 60, desc: '빠르게 찌르기. 뒤에서 찌르면 한 방! 들면 더 빨라요' },
  { id: 'wp_katana', type: 'weapon', name: '카타나', icon: '⚔️', price: 250, desc: '넓게 베기 + 오른쪽 클릭으로 돌진' },
  { id: 'wp_bow', type: 'weapon', name: '활', icon: '🏹', price: 150, desc: '누르고 있으면 당겨져요. 꽉 당기면 세요' },
  { id: 'wp_burst', type: 'weapon', name: '점사 소총', icon: '🔂', price: 180, desc: '한 번 누르면 3발 연속 탕탕탕' },
  { id: 'wp_shield', type: 'weapon', name: '폭동 방패', icon: '🛡️', price: 220, desc: '앞에서 오는 총알을 막아요. 방패로 때리기도!' },
  { id: 'wp_scythe', type: 'weapon', name: '낫', icon: '🌙', price: 300, desc: '한 바퀴 휘둘러 주변을 다 베기 + 오른쪽 클릭 대쉬' },
  { id: 'wp_gunblade', type: 'weapon', name: '건블레이드', icon: '🗡️🔫', price: 350, desc: '칼로 베고, 오른쪽 클릭으로 총처럼 한 발' },
  { id: 'wp_rpg', type: 'weapon', name: 'RPG', icon: '🚀', price: 450, desc: '로켓 펑! 내 발밑에 쏘면 로켓 점프 (나는 안 다쳐요)' },
  { id: 'gr_grenade', type: 'gadget', name: '수류탄', icon: '💣', price: 150, desc: '던지면 2초 뒤 펑! 살아날 때마다 2개' },
  { id: 'gr_smoke', type: 'gadget', name: '연막탄', icon: '🌫️', price: 100, desc: '연기 20초. 한 판에 3개' },
  { id: 'gr_flash', type: 'gadget', name: '섬광탄', icon: '⚡', price: 140, desc: '보고 있던 사람 화면이 하얘져요. 살아날 때마다 2개' },
  { id: 'gr_molotov', type: 'gadget', name: '화염병', icon: '🔥', price: 180, desc: '불바닥 20초, 상대 팀만 다쳐요. 살아날 때마다 1개' },
  { id: 'gr_jumppad', type: 'gadget', name: '점프패드', icon: '🦘', price: 120, desc: '발밑에 설치, 밟으면 높이 슝! 살아날 때마다 1개' },
  { id: 'gr_horn', type: 'gadget', name: '전쟁 나팔', icon: '📯', price: 200, desc: '주변 우리 팀 8초 동안 빨라지고 세져요. 살아날 때마다 1번' },
];
const SHOP_BY_ID = new Map(SHOP.map(i => [i.id, i]));
// 관리자 계정이 없으면 만들어 두기 (원래 있던 같은 이름 계정이면 그대로 관리자 계정으로 써요)
function ensureAdminAccount() {
  const existing = Object.keys(accounts).find(isAdminName);
  if (existing && existing !== ADMIN_NAME) { accounts[ADMIN_NAME] = accounts[existing]; delete accounts[existing]; }
  if (!accounts[ADMIN_NAME]) accounts[ADMIN_NAME] = { created: new Date().toISOString(), coins: 0, owned: [], equip: { hat: 'crown', face: null, skin: null } };
  accounts[ADMIN_NAME].admin = true;
}
function acct(name) {
  const a = accounts[name];
  if (!a) return null;
  if (typeof a.coins !== 'number') a.coins = 0;
  if (!Array.isArray(a.owned)) a.owned = [];
  if (!a.equip) a.equip = { hat: null, face: null, skin: null };
  if (!['m', 'f', 'n'].includes(a.gender)) a.gender = 'n';
  // 없어진 고글/옷은 산 값을 돌려주기
  const REFUND = { v_red: 30, v_blue: 30, v_pink: 30, v_gold: 80, o_hoodie: 40, o_sweater: 40, o_overalls: 50, o_dress: 60, o_suit: 80, o_cape: 120, o_astro: 200 };
  for (const id of a.owned.filter(x => REFUND[x] !== undefined)) a.coins += REFUND[id];
  a.owned = a.owned.filter(x => REFUND[x] === undefined);
  delete a.equip.visor; delete a.equip.outfit;
  // 예전 나비 날개는 요정 날개로 바꿔 주기
  if (a.owned.includes('w_butterfly')) a.owned = a.owned.map(x => x === 'w_butterfly' ? 'w_fairy' : x);
  if (a.equip.wing === 'w_butterfly') a.equip.wing = 'w_fairy';
  return a;
}
// 관리자는 상점 물건을 전부 가진 걸로 쳐요
const owns = (a, item) => item.price === 0 || !!a.admin || a.owned.includes(item.id);
const ADMIN_COINS = Number.MAX_SAFE_INTEGER; // 관리자는 코인 무한
const coinsOf = name => isAdminName(name) ? ADMIN_COINS : (acct(name)?.coins ?? 0);
function meInfo(name) {
  const a = acct(name);
  return { t: 'me', coins: coinsOf(name), inf: isAdminName(name), owned: a.admin ? SHOP.map(i => i.id) : a.owned, equip: a.equip, gender: a.gender, trophies: a.trophies || 0, rank: rankOf(name), bestWave: a.bestWave || 0, mgBest: a.mgBest || {} };
}
function lookOf(name) {
  const a = acct(name);
  return a ? [a.equip.hat || '', a.equip.face || '', a.equip.skin || '', a.equip.hair || '', a.equip.hcolor || '', a.gender, a.equip.ecolor || '', a.equip.wing || '', a.equip.tail || '', a.equip.bcolor || '', a.equip.pcolor || '']
    : ['', '', '', '', '', 'n', '', '', '', '', ''];
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
    if (!['hat', 'face', 'ecolor', 'skin', 'hair', 'hcolor', 'wing', 'tail', 'bcolor', 'pcolor', 'weapon'].includes(type)) return;
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

// ---------- ✊ 관리자와 가위바위보 (하루에 한 번, 이기면 50코인) ----------
const RPS_COINS = 50;
const rpsGames = new Map(); // 신청한 사람 이름 → { name, state: 'pending'|'playing', userPick, adminPick, round, at }
const todayKST = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
const RPS_NAMES = { r: '✊ 바위', p: '✋ 보', s: '✌️ 가위' };
function rpsInfo(c) {
  const a = acct(c.name), g = rpsGames.get(c.name);
  return { t: 'rps', state: g ? g.state : 'none', round: g ? g.round : 0, picked: !!(g && g.userPick),
    usedToday: !!a && a.rpsDay === todayKST(), coins: RPS_COINS, isAdmin: isAdminName(c.name) };
}
function clientByName(name) { for (const x of clients.values()) if (x.name === name) return x; return null; }
function rpsNotify(name, extra) {
  const c = clientByName(name);
  if (c) sendTo(c, { ...rpsInfo(c), ...(extra || {}) });
}
function handleRpsUser(c, msg) {
  const a = acct(c.name);
  if (!a) return;
  if (msg.t === 'rpsReq') {
    if (isAdminName(c.name)) return sendTo(c, { t: 'notice', text: '관리자는 신청할 수 없어요 😄' });
    if (a.rpsDay === todayKST()) return sendTo(c, { t: 'notice', text: '오늘은 이미 했어요! 내일 다시 신청해 주세요.' });
    if (rpsGames.has(c.name)) return;
    if (rpsGames.size >= 30) return sendTo(c, { t: 'notice', text: '신청이 너무 많아요. 잠시 뒤에 다시 해 주세요.' });
    rpsGames.set(c.name, { name: c.name, state: 'pending', userPick: null, adminPick: null, round: 1, at: Date.now() });
    rpsNotify(c.name);
  } else if (msg.t === 'rpsCancel') {
    const g = rpsGames.get(c.name);
    if (g) { rpsGames.delete(c.name); rpsNotify(c.name, { msg: '신청을 취소했어요.' }); }
  } else if (msg.t === 'rpsPick') {
    const g = rpsGames.get(c.name);
    if (!g || g.state !== 'playing' || g.userPick || !RPS_NAMES[msg.pick]) return;
    g.userPick = msg.pick;
    rpsNotify(c.name);
    rpsResolve(g);
  }
}
function rpsResolve(g) {
  if (!g.userPick || !g.adminPick) return;
  const u = g.userPick, ad = g.adminPick;
  const beats = { r: 's', s: 'p', p: 'r' };
  const picks = { you: u, admin: ad };
  if (u === ad) { // 비기면 다시
    g.round++; g.userPick = g.adminPick = null;
    rpsNotify(g.name, { msg: `비겼어요! (둘 다 ${RPS_NAMES[u]}) 다시 골라요`, last: picks });
    return;
  }
  const userWins = beats[u] === ad;
  const a = acct(g.name);
  if (a) {
    a.rpsDay = todayKST();
    if (userWins) a.coins += RPS_COINS;
    a.rpsLog = (a.rpsLog || []).slice(-9).concat({ day: a.rpsDay, win: userWins });
    saveAccounts();
  }
  rpsGames.delete(g.name);
  const c = clientByName(g.name);
  rpsNotify(g.name, { done: true, win: userWins, last: picks,
    msg: userWins ? `🎉 이겼어요! 🪙 +${RPS_COINS}코인 (나 ${RPS_NAMES[u]} vs 관리자 ${RPS_NAMES[ad]})` : `😢 졌어요… (나 ${RPS_NAMES[u]} vs 관리자 ${RPS_NAMES[ad]}) 내일 또 도전해요!` });
  if (c) sendTo(c, meInfo(g.name));
  chatLog.push({ time: new Date().toISOString(), from: g.name, where: '가위바위보', text: `${RPS_NAMES[u]} vs 관리자 ${RPS_NAMES[ad]} → ${userWins ? '신청자 승리 (+' + RPS_COINS + '코인)' : '관리자 승리'}` });
}
// 관리자 쪽 (관리자 페이지)
function handleRpsAdmin(msg) {
  const g = rpsGames.get(String(msg.name));
  if (!g) return;
  if (msg.t === 'rpsAccept' && g.state === 'pending') {
    if (!clientByName(g.name)) { rpsGames.delete(g.name); return; } // 이미 나갔어요
    g.state = 'playing';
    rpsNotify(g.name, { msg: '관리자가 수락했어요! ✊✋✌️ 하나를 골라요' });
  } else if (msg.t === 'rpsDecline') {
    rpsGames.delete(g.name);
    rpsNotify(g.name, { msg: '관리자가 지금은 안 된대요. 다음에 다시 신청해 주세요.' });
  } else if (msg.t === 'rpsPick' && g.state === 'playing' && !g.adminPick && RPS_NAMES[msg.pick]) {
    g.adminPick = msg.pick;
    rpsNotify(g.name, { adminPicked: true });
    rpsResolve(g);
  }
}

// ---------- 🎮 미니게임 (플래피 버드, 공룡 달리기) ----------
// 화면에서 게임을 하고 점수를 보내요. 서버는 걸린 시간을 보고 진짜인지 확인해요.
const MINIGAMES = {
  flappy: { name: '플래피 버드', goal: 20, coins: 20, secPerPoint: 1.2 },  // 토관 하나에 최소 1.2초
  dino: { name: '공룡 달리기', goal: 1000, coins: 20, secPerPoint: 1 / 26 }, // 1초에 최대 26점쯤
};
function handleMinigame(c, msg) {
  const G = MINIGAMES[msg.g], a = acct(c.name);
  if (!G || !a) return;
  if (msg.t === 'mgStart') { c.mg = { g: msg.g, start: now() }; return; }
  const score = Math.max(0, Math.floor(Number(msg.score) || 0));
  if (!c.mg || c.mg.g !== msg.g) return;
  const secs = (now() - c.mg.start) / 1000;
  c.mg = null;
  const real = secs >= score * G.secPerPoint * 0.9; // 너무 빨리 끝난 점수는 무시
  a.mgBest = a.mgBest || {};
  let coins = 0;
  if (real) {
    if (score > (a.mgBest[msg.g] || 0)) a.mgBest[msg.g] = score;
    if (score >= G.goal) { coins = G.coins; if (!isAdminName(c.name)) a.coins += coins; } // 트로피는 없어요
    saveAccounts();
  }
  sendTo(c, { t: 'mgResult', g: msg.g, score, best: a.mgBest[msg.g] || 0, coins, goal: G.goal, ok: real });
  if (coins) sendTo(c, meInfo(c.name));
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
// 🏙️ 좀비 웨이브용 도시 맵: 건물 + 바깥 계단으로 옥상까지 올라갈 수 있어요
function buildCity() {
  const boxes = [], S = 40;
  const box = (x0, y0, z0, x1, y1, z1, kind, extra = {}) => boxes.push({ min: [x0, y0, z0], max: [x1, y1, z1], kind, ...extra });
  const COLORS = [0xb5654a, 0x8f9aa8, 0xd8c7a3, 0x6f7f96, 0xc98d5a, 0x9a8bb0, 0x7d9a7a, 0xb7b0a2];
  // 건물: 가운데 (cx,cz), 크기 w×d, 높이 h, 계단이 붙는 쪽 side ('e' 동, 'w' 서, 'n' 북(-z), 's' 남(+z))
  const B = [
    [12, 12, 9, 10, 6, 's'], [26, 22, 8, 12, 9, 'w'],
    [-13, 14, 10, 8, 4.5, 'e'], [-27, 24, 8, 9, 7.5, 'e'],
    [14, -24, 10, 10, 7.5, 'w'], [27, -10, 7, 9, 4.5, 'n'],
    [-12, -13, 9, 12, 9, 'e'], [-26, -25, 9, 8, 6, 'n'],
  ];
  B.forEach(([cx, cz, w, d, h, side], i) => {
    const x0 = cx - w / 2, x1 = cx + w / 2, z0 = cz - d / 2, z1 = cz + d / 2;
    box(x0, 0, z0, x1, h, z1, 'bldg', { color: COLORS[i % COLORS.length] });
    // 바깥 계단: 벽을 따라 한 칸씩 올라가요 (한 칸 높이 0.8m 이하 = 점프로 쉽게 올라가요)
    const n = Math.ceil(h / 0.8) - 1, rise = h / (n + 1), along = side === 'e' || side === 'w' ? d : w;
    const run = Math.min(1.15, (along - 0.4) / n);
    for (let k = 0; k < n; k++) {
      const top = rise * (k + 1), a0 = -along / 2 + 0.2 + k * run, a1 = a0 + run;
      if (side === 'e') box(x1, 0, cz + a0, x1 + 1.6, top, cz + a1, 'stair');
      if (side === 'w') box(x0 - 1.6, 0, cz - a1, x0, top, cz - a0, 'stair');
      if (side === 's') box(cx - a1, 0, z1, cx - a0, top, z1 + 1.6, 'stair');
      if (side === 'n') box(cx + a0, 0, z0 - 1.6, cx + a1, top, z0, 'stair');
    }
  });
  // 길가의 자동차, 가로등
  const cars = [[3, -18, 0], [-4, 20, 0], [20, 3, 1], [-20, -3, 1], [33, 30, 0], [-33, -8, 0]];
  cars.forEach(([x, z, rot], i) => {
    const [hw, hd] = rot ? [2.1, 1] : [1, 2.1];
    box(x - hw, 0, z - hd, x + hw, 1.4, z + hd, 'car', { color: [0xe84848, 0x3d8bff, 0xffd43b, 0xf4f4f6, 0x2d2f36, 0x3ccf6e][i] });
  });
  for (const [x, z] of [[4.5, 4.5], [-4.5, -4.5], [4.5, -30], [-4.5, 30], [30, 4.5], [-30, -4.5]]) box(x - 0.12, 0, z - 0.12, x + 0.12, 4.2, z + 0.12, 'pole');
  const spawnsH = [[0, 0], [3, 0], [-3, 0], [0, 3], [0, -3], [0, 9], [9, 0], [-9, 0], [0, -9]].map(([x, z]) => ({ x, z, yaw: Math.random() * 6.28 }));
  return { id: 'city', theme: 'city', size: S, boxes, spawnsH, spawns: MAP.spawns };
}
const CITY = buildCity();
BATTLE_MAPS.city = CITY;
const MAP_LIST = [
  { id: 'basic', name: '기본 맵', icon: '🌳' },
  { id: 'xmas', name: '크리스마스 맵', icon: '🎄' },
  { id: 'city', name: '도시 맵', icon: '🏙️' },
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
  // 🗼 타워: 가운데 기둥을 네모나게 빙글빙글 돌면서 위로 올라가요 (점점 어려워짐)
  const boxes = [], checkpoints = [], L = 9;
  const plat = (x, y, z, w, d, kind, h = 1) => boxes.push({ min: [x - w / 2, y - h, z - d / 2], max: [x + w / 2, y, z + d / 2], kind });
  let y = 0, fx = 5, fz = L, dx = 1, dz = 0; // 마지막 발판 앞쪽 끝 (fx,fz), 가는 방향 (dx,dz)
  plat(0, 0, L, 10, 6, 'start');
  checkpoints.push({ x: 0, y: 0, z: L, w: 10, d: 6 });
  const along = (x, z) => x * dx + z * dz;
  // 한 칸 놓기: l=가는 방향 길이, w=옆 길이, off=옆으로 비켜서기
  const next = (l, w, gap, dy, kind = 'plat', off = 0) => {
    const fa = along(fx, fz);
    if (fa + gap + l > L + 1.5) { // 모서리에 닿으면 모서리 발판 놓고 90도 돌기
      const ca = Math.max(L, fa + 1.6 + 1.25), cs = dx ? fz : fx;
      const cx = dx ? ca * dx : cs, cz = dx ? cs : ca * dz;
      y += Math.min(dy, 0.5);
      plat(cx, y, cz, 2.5, 2.5, 'plat');
      [dx, dz] = [-dz, dx];
      fx = cx + dx * 1.25; fz = cz + dz * 1.25;
    }
    y += dy;
    const px = -dz, pz = dx; // 옆 방향
    const cx = fx + dx * (gap + l / 2) + px * off, cz = fz + dz * (gap + l / 2) + pz * off;
    const bw = dx ? l : w, bd = dx ? w : l;
    plat(cx, y, cz, bw, bd, kind);
    fx = cx + dx * l / 2 - px * off; fz = cz + dz * l / 2 - pz * off;
    return { x: cx, y, z: cz, w: bw, d: bd };
  };
  // 용암 줄이 있는 발판 (빨간 줄을 밟으면 체크포인트로)
  const lavaPad = (gap, dy) => {
    const p = next(3.4, 3, gap, dy);
    plat(p.x, p.y + 0.15, p.z, dx ? 0.35 : 1.4, dx ? 1.4 : 0.35, 'kill', 0.15); // 작은 빨간 블록 (옆으로 피해 가도 돼요)
  };
  const cp = () => checkpoints.push(next(4, 4, 2.2, 0.3, 'cp'));
  // 1구간: 계단
  for (let i = 0; i < 8; i++) next(2, 2, 2.0, 0.7);
  cp();
  // 2구간: 작은 블록 지그재그
  for (let i = 0; i < 10; i++) next(1, 1, 2.3, 0.4, 'plat', i % 2 ? 1.2 : -1.2);
  cp();
  // 3구간: 좁은 빔 + 용암 발판
  for (let i = 0; i < 4; i++) next(5, 0.5, 1.8, 0.3, 'beam');
  for (let i = 0; i < 4; i++) lavaPad(2.0, 0.4);
  cp();
  // 4구간: 높은 점프 (거의 끝까지 뛰어야 해요)
  for (let i = 0; i < 8; i++) next(1.4, 1.4, 1.5, 0.95, 'plat', i % 2 ? 0.8 : -0.8);
  for (let i = 0; i < 3; i++) lavaPad(2.0, 0.5);
  cp();
  // 5구간: 아주 작은 발판 멀리뛰기 + 실 같은 빔
  for (let i = 0; i < 8; i++) next(0.8, 0.8, 2.6, 0.3, 'plat', i % 2 ? 0.6 : -0.6);
  for (let i = 0; i < 3; i++) next(4, 0.4, 1.6, 0.5, 'beam');
  for (let i = 0; i < 4; i++) next(0.7, 0.7, 2.4, 0.6);
  const goal = next(6, 6, 2.2, 0.4, 'goal');
  // 가운데 기둥 (꼭대기까지)
  plat(0, y + 3, 0, 6, 6, 'pillar', y + 4);
  return { size: L + 30, boxes, noFloor: true, checkpoints, goal, tower: true, height: y };
}
const OBBY = buildObby();
// 용암 타워: 같은 탑에서 빨간 블록만 빼요 (용암이 대신 올라와요)
const LAVA_MAP = { ...OBBY, id: 'lava', boxes: OBBY.boxes.filter(b => b.kind !== 'kill'), lava: true };
const LAVA_START = -3, LAVA_COUNTDOWN_MS = 8000, LAVA_END_MS = 8000;
const lavaSpeed = secs => 0.11 + secs * 0.0015; // 점점 빨라져요 (m/초)
const OBBY_ROUND_MS = 6 * 60 * 1000;
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
  { id: 'wave', mode: 'wave', icon: '🧟‍♂️', title: '좀비 웨이브', desc: '몰려오는 봇 좀비 떼를 막아라! 혼자서도, 친구랑 같이도 할 수 있어요.' },
  { id: 'lava', mode: 'lava', icon: '🌋', title: '용암 타워', desc: '용암이 올라와요! 닿으면 바로 아웃. 꼭대기까지 도망쳐요. 혼자서도 OK' },
  { id: 'obby', mode: 'obby', icon: '🗼', title: '점프 타워', desc: '빙글빙글 타워를 먼저 꼭대기까지 오르면 승리! 빨간 블록은 밟으면 안 돼요. 꽤 어려워요!' },
];
const rooms = new Map();
for (const d of ROOM_DEFS) {
  rooms.set(d.id, {
    ...d, players: new Map(), map: d.mode === 'obby' ? OBBY : d.mode === 'lava' ? LAVA_MAP : d.mode === 'wave' || d.mode === 'zombie' ? CITY : MAP,
    mapId: d.mode === 'wave' || d.mode === 'zombie' ? 'city' : 'basic', mapVoteUntil: 0, votes: new Map(), adminPick: null,                  // 맵 투표 (팀전/좀비)
    scores: { red: 0, blue: 0 }, killTarget: 5,  roundOver: false,      // 팀전
    phase: 'waiting', phaseEnd: 0, wins: { human: 0, zombie: 0 },       // 좀비
    roundNo: 1, grenades: [], projs: [], zones: [], pads: [],
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
  if (room.mode === 'obby' || room.mode === 'lava') return 'runner';
  if (room.mode === 'wave') return 'human';
  const r = countTeam(room, 'red'), b = countTeam(room, 'blue');
  if (r !== b) return r < b ? 'red' : 'blue';
  return Math.random() < 0.5 ? 'red' : 'blue';
}

function spawn(room, p) {
  if (room.mode === 'obby' || room.mode === 'lava') {
    const c = OBBY.checkpoints[room.mode === 'lava' ? 0 : p.cp || 0];
    p.x = c.x + (Math.random() - 0.5) * (c.w - 2); p.y = c.y; p.z = c.z + (Math.random() - 0.5) * (c.d - 2);
    p.yaw = 0; p.pitch = 0;
  } else {
    const list = room.mode === 'fps' ? MAP.spawns[p.team] : room.map.spawnsH && p.team === 'human' ? room.map.spawnsH : ZSPAWNS[p.team];
    const s = list[Math.floor(Math.random() * list.length)];
    p.x = s.x + (Math.random() - 0.5); p.y = 0; p.z = s.z; p.yaw = s.yaw; p.pitch = 0;
  }
  p.hp = p.team === 'zombie' ? ZOMBIE_HP : MAX_HP;
  p.alive = true; p.protectUntil = now() + SPAWN_PROTECT_MS;
  p.ammoW = {}; p.ammo = weaponOf(p).mag; p.reloadUntil = 0; p.lastMoveAt = now();
  refillGadgets(room, p);
  p.burstTimes = []; p.buffUntil = 0; p.crouch = false;
  sendTo(p, { t: 'respawn', x: p.x, y: p.y, z: p.z, yaw: p.yaw, hp: p.hp, ammo: p.ammo, items: p.items });
}

// 아이템 다시 채우기 (살아날 때마다 / 새 판이 시작될 때만)
function refillGadgets(room, p) {
  const can = room.mode !== 'obby' && room.mode !== 'lava' && p.team !== 'zombie';
  const old = p.items || {};
  const newMatch = p.matchNo !== room.roundNo;
  p.matchNo = room.roundNo;
  p.items = {};
  for (const id of myGadgets(p.name)) {
    const G = GADGETS[id];
    p.items[id] = !can ? 0 : G.per === 'match' && !newMatch ? (old[id] ?? 0) : G.n;
  }
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
  const firstOne = room.players.size === 0;
  c.room = room;
  Object.assign(c, {
    team: pickTeam(room), x: 0, y: 0, z: 0, yaw: 0, pitch: 0, hp: MAX_HP, alive: false,
    kills: 0, deaths: 0, lastShot: 0, lastAttack: 0, ammo: MAG_SIZE, reloadUntil: 0, weapon: startWeapon(c.name), ammoW: {}, matchNo: -1, items: {},
    respawnAt: 0, protectUntil: 0, lastMoveAt: now(), cp: 0,
  });
  room.players.set(c.id, c);
  room.forceFull = true; // 새로 온 사람에게 전부 보내기
  sendTo(c, {
    t: 'welcome', id: c.id, name: c.name, team: c.team, map: room.map, adminName: ADMIN_NAME,
    mode: room.mode, roomTitle: room.title,
    cfg: { maxHp: MAX_HP, zombieHp: ZOMBIE_HP, mag: MAG_SIZE, reloadMs: RELOAD_MS, fireMs: FIRE_INTERVAL, attackMs: ATTACK_MS, weapons: WEAPONS, gadgets: GADGETS },
    weapon: c.weapon, myWeapons: myWeapons(c.name), myGadgets: myGadgets(c.name),
  });
  spawn(room, c);
  sendChatHist(c, room.id);
  if (room.mode === 'lava' && room.phase === 'rising' && room.lavaY > OBBY.checkpoints[0].y - 0.5) {
    c.alive = false; c.respawnAt = Infinity; // 용암이 이미 출발점보다 높으면 다음 판부터
    sendTo(c, { t: 'lavawait' });
  }
  sendObjects(room, c);
  if (firstOne && room.mode === 'fps') startMapVote(room); // 처음 시작할 때 10초 맵 투표
  else if (hasVote(room)) sendTo(c, voteInfo(room));
  roomBroadcast(room, { t: 'joined', name: c.name });
}
function leaveRoom(c) {
  const room = c.room;
  if (!room) return;
  room.players.delete(c.id);
  room.forceFull = true;
  if (room.lastSent) room.lastSent.delete(c.id);
  if (room.votes.delete(c.name)) roomBroadcast(room, voteInfo(room));
  c.room = null;
  roomBroadcast(room, { t: 'left', name: c.name });
}

// =====================================================
//  팀전 규칙
// =====================================================
// ---------- 맵 투표 ----------
// 관리자가 고르면 관리자 맵, 아니면 투표 다수결 (같으면 지금 맵 유지)
const hasVote = room => room.mode === 'fps'; // 맵 투표는 팀 배틀만 (좀비 모드, 좀비 웨이브는 항상 도시)
function decideNextMap(room) {
  if (room.adminPick) return room.adminPick;
  const count = {};
  for (const v of room.votes.values()) count[v] = (count[v] || 0) + 1;
  let best = room.mapId, bestN = count[room.mapId] || 0;
  for (const m of MAP_LIST) if ((count[m.id] || 0) > bestN) { best = m.id; bestN = count[m.id]; }
  return best;
}
// 게임을 처음 시작할 때: 10초 동안 맵 투표 (그동안은 싸울 수 없어요)
const START_VOTE_MS = 10000;
function startMapVote(room) {
  room.votes.clear(); room.adminPick = room.adminPick || null;
  room.mapVoteUntil = now() + START_VOTE_MS;
  room.roundOver = true;
  roomBroadcast(room, voteInfo(room));
}
function voteInfo(room) {
  const count = {};
  for (const v of room.votes.values()) count[v] = (count[v] || 0) + 1;
  const vt = room.mapVoteUntil ? Math.max(0, Math.ceil((room.mapVoteUntil - now()) / 1000)) : 0;
  return {
    t: 'vote', current: room.mapId, next: decideNextMap(room), adminPick: room.adminPick, vt,
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
  room.roundNo = (room.roundNo || 0) + 1; clearObjects(room);
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
  roomBroadcast(room, { t: 'kill', killer: killer.name, kteam: killer.team, victim: victim.name, vteam: victim.team, head, w: killer.killIcon || weaponOf(killer).icon });
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
  room.roundNo = (room.roundNo || 0) + 1; clearObjects(room);
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
  const myCp = OBBY.checkpoints[p.cp || 0];
  if (p.y < -12 || p.y < myCp.y - 8) { sendTo(p, { t: 'fell' }); spawn(room, p); return; } // 많이 떨어지면 체크포인트로
  if (OBBY.boxes.some(b => b.kind === 'kill' && onPad(p, { x: (b.min[0] + b.max[0]) / 2, z: (b.min[2] + b.max[2]) / 2, y: b.max[1], w: b.max[0] - b.min[0], d: b.max[2] - b.min[2] }, 0.1))) {
    sendTo(p, { t: 'zap' }); spawn(room, p); return; // 빨간 블록 = 아웃
  }
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
      // 혼자 연습할 때 꼭대기까지 가도 🪙 20코인 (트로피는 경주에서 1등 해야 받아요)
      const acc = acct(p.name);
      if (acc && !isAdminName(p.name)) { acc.coins += WIN_COINS; saveAccounts(); }
      sendTo(p, { t: 'practice', coins: WIN_COINS });
      sendTo(p, { t: 'coins', delta: isAdminName(p.name) ? 0 : WIN_COINS, coins: coinsOf(p.name), inf: isAdminName(p.name) });
      p.cp = 0; spawn(room, p);
    }
  }
}

// =====================================================
//  용암 타워 (혼자서도 OK)
// =====================================================
function lavaRecord() { const g = acct(ADMIN_NAME); return g && g.lavaBest ? g.lavaBest : null; }
function lavaNewRound(room) {
  room.lavaY = LAVA_START; room.winner = null; room.roundStarters = 0;
  for (const p of room.players.values()) { p.maxY = 0; spawn(room, p); }
  setPhase(room, 'countdown', LAVA_COUNTDOWN_MS);
  room.forceFull = true;
}
function lavaDie(room, p) {
  if (!p.alive) return;
  p.alive = false; p.hp = 0; p.deaths++; p.respawnAt = Infinity; // 다음 판까지 기다려요
  roomBroadcast(room, { t: 'lavadie', name: p.name, h: Math.round(p.maxY * 10) / 10 });
}
function lavaEnd(room, text) {
  const results = [...room.players.values()].sort((a, b) => (b.maxY || 0) - (a.maxY || 0)).map(p => ({ n: p.name, h: Math.round((p.maxY || 0) * 10) / 10 }));
  roomBroadcast(room, { t: 'lavaend', text, winner: room.winner, results, best: lavaRecord() });
  setPhase(room, 'ended', LAVA_END_MS);
}
function lavaCheck(room, p) {
  const start = OBBY.checkpoints[0];
  if (room.phase === 'countdown' && !(Math.abs(p.x - start.x) < 6 && Math.abs(p.z - start.z) < 6)) {
    sendTo(p, { t: 'correct', x: start.x, y: start.y, z: start.z }); // 출발 전에는 출발선에서 기다리기
    p.x = start.x; p.y = start.y; p.z = start.z;
    return;
  }
  if (room.phase !== 'rising' || !p.alive) return;
  p.maxY = Math.max(p.maxY || 0, p.y);
  if (p.y <= room.lavaY) return lavaDie(room, p); // 용암에 닿으면 바로 아웃!
  if (onPad(p, OBBY.goal) && !room.winner) {
    room.winner = p.name;
    const secs = Math.round((now() - room.raceStart) / 100) / 10;
    // 코인 20개 (2명 이상이 같이 시작했으면 트로피도)
    const a = acct(p.name);
    if (room.roundStarters >= 2) giveCoins([p]);
    else if (a) {
      if (!isAdminName(p.name)) a.coins += WIN_COINS;
      sendTo(p, { t: 'coins', delta: isAdminName(p.name) ? 0 : WIN_COINS, coins: coinsOf(p.name), inf: isAdminName(p.name) });
      sendTo(p, meInfo(p.name));
    }
    const g = acct(ADMIN_NAME);
    let record = false;
    if (g && (!g.lavaBest || secs < g.lavaBest.time)) { g.lavaBest = { time: secs, name: p.name }; record = true; }
    saveAccounts();
    lavaEnd(room, `🏆 ${p.name} 탈출 성공! (${secs}초)${record ? ' 🎉 새 최고 기록!' : ''}`);
  }
}
function lavaTick(room, t) {
  if (!room.players.size) { room.phase = 'waiting'; return; }
  switch (room.phase) {
    case 'waiting': lavaNewRound(room); break;
    case 'countdown':
      if (t >= room.phaseEnd) {
        room.raceStart = t; room.lastLava = t;
        room.roundStarters = [...room.players.values()].filter(p => p.alive).length;
        setPhase(room, 'rising');
      }
      break;
    case 'rising': {
      const dt = (t - room.lastLava) / 1000; room.lastLava = t;
      room.lavaY += lavaSpeed((t - room.raceStart) / 1000) * dt;
      for (const p of room.players.values()) if (p.alive && p.y <= room.lavaY) lavaDie(room, p);
      if (![...room.players.values()].some(p => p.alive)) lavaEnd(room, '🌋 모두 용암에 빠졌어요!');
      break;
    }
    case 'ended': if (t >= room.phaseEnd) lavaNewRound(room); break;
  }
}

// =====================================================
//  무기
// =====================================================
// body/head = 한 발 데미지, fire = 쏘는 간격(ms), pellets = 한 번에 나가는 총알, spread = 퍼짐, far = 이 거리보다 멀면 데미지 반
const WEAPONS = {
  wp_rifle: { name: '돌격소총', icon: '🔫', body: 25, head: 60, fire: 110, mag: 25, reload: 1600, pellets: 1, spread: 0 },
  wp_smg: { name: '기관단총', icon: '💨', body: 16, head: 38, fire: 70, mag: 35, reload: 1400, pellets: 1, spread: 0.035 },
  wp_shotgun: { name: '샷건', icon: '💥', body: 13, head: 20, fire: 850, mag: 6, reload: 2200, pellets: 8, spread: 0.075, far: 14 },
  wp_sniper: { name: '저격총', icon: '🎯', body: 90, head: 200, fire: 1300, mag: 5, reload: 2500, pellets: 1, spread: 0, zoom: true },
  wp_minigun: { name: '미니건', icon: '🌀', body: 12, head: 26, fire: 55, mag: 120, reload: 3200, pellets: 1, spread: 0.05 },
  // 근접 무기: range = 닿는 거리, cone = 앞쪽 몇 도까지 (cos 값), multi = 여러 명 한 번에
  wp_dagger: { name: '단검', icon: '🗡️', melee: true, body: 50, head: 50, fire: 380, range: 2.2, cone: 0.7, backstab: true, speed: 1.15, mag: 0 },
  wp_katana: { name: '카타나', icon: '⚔️', melee: true, body: 70, head: 70, fire: 650, range: 3.2, cone: 0.45, multi: true, dash: true, mag: 0 },
  wp_scythe: { name: '낫', icon: '🌙', melee: true, body: 60, head: 60, fire: 800, range: 3.0, cone: -1.1, multi: true, dash: true, mag: 0 },
  wp_shield: { name: '폭동 방패', icon: '🛡️', melee: true, body: 30, head: 30, fire: 600, range: 2.0, cone: 0.6, shield: true, speed: 0.85, mag: 0 },
  wp_gunblade: { name: '건블레이드', icon: '🗡️🔫', melee: true, body: 55, head: 55, fire: 500, range: 2.6, cone: 0.55, mag: 0,
    altShot: { body: 45, head: 90, cd: 900, pellets: 1, spread: 0 } },
  wp_burst: { name: '점사 소총', icon: '🔂', body: 28, head: 65, fire: 65, mag: 24, reload: 1700, pellets: 1, spread: 0, burst: 3, burstGap: 430 },
  wp_bow: { name: '활', icon: '🏹', proj: 'arrow', body: 100, head: 160, fire: 350, mag: 0, charge: true },
  wp_rpg: { name: 'RPG', icon: '🚀', proj: 'rocket', body: 110, fire: 500, mag: 1, reload: 2600 },
};
// 아이템: per = 몇 개 (life = 살아날 때마다, match = 한 판에)
const GADGETS = {
  gr_grenade: { name: '수류탄', icon: '💣', n: 2, per: 'life', throw: true, fuse: 2000 },
  gr_smoke: { name: '연막탄', icon: '🌫️', n: 3, per: 'match', throw: true, fuse: 1200 },
  gr_flash: { name: '섬광탄', icon: '⚡', n: 2, per: 'life', throw: true, fuse: 1500 },
  gr_molotov: { name: '화염병', icon: '🔥', n: 1, per: 'life', throw: true, fuse: 3000, impact: true },
  gr_jumppad: { name: '점프패드', icon: '🦘', n: 1, per: 'life' },
  gr_horn: { name: '전쟁 나팔', icon: '📯', n: 1, per: 'life' },
};
const ZONE_MS = 20000, BUFF_MS = 8000, PAD_MS = 30000;
const myGadgets = name => { const a = acct(name); return Object.keys(GADGETS).filter(id => a && owns(a, SHOP_BY_ID.get(id))); };
const GRENADE_RADIUS = 4, GRENADE_DMG = 90, DASH_COOLDOWN = 3000;
const weaponOf = p => WEAPONS[p.weapon] || WEAPONS.wp_rifle;
function myWeapons(name) {
  const a = acct(name);
  return Object.keys(WEAPONS).filter(id => a && owns(a, SHOP_BY_ID.get(id)));
}
function startWeapon(name) {
  const a = acct(name), list = myWeapons(name);
  const w = a && a.equip && a.equip.weapon;
  return list.includes(w) ? w : 'wp_rifle';
}
function handleWeapon(c, w) {
  w = String(w);
  if (!c.room || !WEAPONS[w] || w === c.weapon || !myWeapons(c.name).includes(w)) return;
  c.ammoW = c.ammoW || {};
  c.ammoW[c.weapon] = c.ammo;
  c.weapon = w; c.reloadUntil = 0;
  c.ammo = c.ammoW[w] ?? WEAPONS[w].mag;
  c.lastShot = now() - 200; // 바꾸는 데 살짝 시간이 걸려요
  sendTo(c, { t: 'weapon', w, ammo: c.ammo });
}

// =====================================================
//  좀비 웨이브 (봇 좀비, 혼자서도 OK)
// =====================================================
const WAVE_BREAK_MS = 6000, WAVE_OVER_MS = 8000, MAX_BOTS_ALIVE = 24, WAVE_COINS = 5;
const WAVE_SPAWNS = [[-36, -36], [36, -36], [-36, 36], [36, 36], [0, -37], [0, 37], [-37, 0], [37, 0],
  [-20, -37], [20, -37], [-20, 37], [20, 37], [-37, -20], [37, -20], [-37, 20], [37, 20]];
const BOT_HAIRS = ['h_short', 'h_spiky', 'h_curly', 'h_bald', 'h_long', 'h_bob'];
const BOT_HAIR_COLORS = ['hc_black', 'hc_black', 'hc_red', 'hc_blonde'];
let nextBotId = 1000000;
// 웨이브가 올라갈수록 많이, 빠르게, 튼튼하게
function waveCfg(n) {
  return { count: 3 + n * 2, speed: Math.min(6.0, 2.6 + n * 0.25), hp: 50 + n * 15, dmg: Math.min(35, 12 + n * 2) };
}
const botsAlive = room => [...room.bots.values()].filter(b => b.alive);
// 봇이 서 있을 수 있는 높이 (발밑에 있는 제일 높은 상자 위, 없으면 땅)
function groundUnder(map, x, z, y) {
  let g = 0;
  for (const b of map.boxes) if (x + 0.3 > b.min[0] && x - 0.3 < b.max[0] && z + 0.3 > b.min[2] && z - 0.3 < b.max[2] && b.max[1] <= y + 0.6 && b.max[1] > g) g = b.max[1];
  return g;
}
// 봇 몸에 부딪히는 상자 (발밑 0.6m 위 ~ 머리 높이)
function botWall(map, x, z, y) {
  const lim = map.size - 1.5;
  if (Math.abs(x) > lim || Math.abs(z) > lim) return { edge: true };
  for (const b of map.boxes) if (x + 0.35 > b.min[0] && x - 0.35 < b.max[0] && z + 0.35 > b.min[2] && z - 0.35 < b.max[2] && b.max[1] > y + 0.6 && b.min[1] < y + 1.8) return b;
  return null;
}
const waveBlocked = (map, x, z, y = 0) => !!botWall(map, x, z, y);
function waveReset(room) {
  room.roundNo = (room.roundNo || 0) + 1; clearObjects(room);
  applyNextMap(room);
  room.bots = new Map(); room.waveNum = 0; room.toSpawn = 0;
  for (const p of room.players.values()) { p.kills = 0; p.deaths = 0; spawn(room, p); }
  setPhase(room, 'break', WAVE_BREAK_MS);
  room.forceFull = true;
}
function waveStart(room) {
  room.waveNum++;
  const cfg = waveCfg(room.waveNum);
  room.toSpawn = cfg.count; room.nextSpawn = 0;
  for (const p of room.players.values()) { if (!p.alive) spawn(room, p); else p.hp = MAX_HP; } // 부활 + 체력 회복
  setPhase(room, 'wave');
  roomBroadcast(room, { t: 'wave', n: room.waveNum, count: cfg.count });
}
function spawnBot(room) {
  const alive = [...room.players.values()].filter(p => p.alive);
  // 무작위로 3곳을 골라서 사람들한테서 제일 먼 곳에 나타나요
  let best = null, bestD = -1;
  for (let i = 0; i < 3; i++) {
    const [x, z] = WAVE_SPAWNS[Math.floor(Math.random() * WAVE_SPAWNS.length)];
    const d = alive.length ? Math.min(...alive.map(p => Math.hypot(p.x - x, p.z - z))) : 99;
    if (d > bestD) { bestD = d; best = [x, z]; }
  }
  const cfg = waveCfg(room.waveNum);
  const b = {
    id: nextBotId++, name: '좀비', team: 'zombie', isBot: true,
    x: best[0] + (Math.random() - 0.5), y: 0, z: best[1] + (Math.random() - 0.5), yaw: 0, pitch: 0, climbing: false,
    hp: cfg.hp, alive: true, speed: cfg.speed * (0.85 + Math.random() * 0.3), dmg: cfg.dmg,
    lastAttack: 0, kills: 0, deaths: 0, detour: null, removeAt: 0, protectUntil: 0,
    lk: ['', '', '', BOT_HAIRS[Math.floor(Math.random() * BOT_HAIRS.length)], BOT_HAIR_COLORS[Math.floor(Math.random() * 4)], 'n', '', '', ''],
  };
  room.bots.set(b.id, b);
}
function wavePlayerDie(room, q) {
  q.alive = false; q.hp = 0; q.deaths++; q.respawnAt = Infinity; // 다음 웨이브에 부활
  roomBroadcast(room, { t: 'kill', killer: '좀비', kteam: 'zombie', victim: q.name, vteam: 'human', head: false });
  sendTo(q, { t: 'wavedead' });
}
function moveBots(room, t) {
  const dt = TICK_MS / 1000;
  const targets = [...room.players.values()].filter(p => p.alive);
  if (!targets.length) return;
  const list = botsAlive(room);
  for (const b of list) {
    let q = null, qd = Infinity;
    for (const p of targets) { const d = Math.hypot(p.x - b.x, p.z - b.z); if (d < qd) { qd = d; q = p; } }
    const dx = q.x - b.x, dz = q.z - b.z, d = qd || 0.001;
    b.yaw = Math.atan2(-dx, -dz);
    // 가까우면 물기
    if (d < 1.25 && Math.abs(q.y - b.y) < 2.2) {
      if (t - b.lastAttack >= 900 && q.protectUntil <= t) {
        b.lastAttack = t;
        roomBroadcast(room, { t: 'swing', id: b.id });
        q.hp -= b.dmg;
        sendTo(q, { t: 'hurt', from: '좀비' });
        if (q.hp <= 0) wavePlayerDie(room, q);
      }
      continue;
    }
    // 쫓아가기: 낮은 턱은 올라가고, 사람이 위에 있으면 벽을 기어올라요 🧗, 아니면 옆으로 돌아가요
    const step = b.speed * dt;
    let mx = dx / d * step, mz = dz / d * step;
    if (b.detour && t < b.detour.until) { mx = b.detour.x * step; mz = b.detour.z * step; }
    const wall = botWall(room.map, b.x + mx, b.z + mz, b.y);
    b.climbing = false;
    if (!wall) { b.x += mx; b.z += mz; }
    else if (!wall.edge && (q.y > b.y + 1 || wall.max[1] - b.y < 1.3)) { // 기어오르기
      b.y = Math.min(wall.max[1], b.y + 3.2 * dt); b.climbing = true;
    }
    else if (Math.abs(mx) > 0.01 && !botWall(room.map, b.x + Math.sign(mx) * step, b.z, b.y)) b.x += Math.sign(mx) * step;
    else if (Math.abs(mz) > 0.01 && !botWall(room.map, b.x, b.z + Math.sign(mz) * step, b.y)) b.z += Math.sign(mz) * step;
    else {
      const sgn = Math.random() < 0.5 ? 1 : -1;
      b.detour = { x: -dz / d * sgn, z: dx / d * sgn, until: t + 600 + Math.random() * 600 };
    }
    // 떨어지기 (발밑에 아무것도 없으면)
    if (!b.climbing) { const g = groundUnder(room.map, b.x, b.z, b.y); if (b.y > g) b.y = Math.max(g, b.y - 9 * dt); else b.y = g; }
  }
  // 좀비끼리 너무 겹치지 않게 밀어내기
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    const a = list[i], c = list[j], dx = c.x - a.x, dz = c.z - a.z, d = Math.hypot(dx, dz);
    if (d > 0.001 && d < 0.65) {
      const push = (0.65 - d) / 2, ux = dx / d * push, uz = dz / d * push;
      if (!waveBlocked(room.map, a.x - ux, a.z - uz, a.y)) { a.x -= ux; a.z -= uz; }
      if (!waveBlocked(room.map, c.x + ux, c.z + uz, c.y)) { c.x += ux; c.z += uz; }
    }
  }
}
function waveRecord(room) {
  const g = acct(ADMIN_NAME);
  return g && g.waveBest ? g.waveBest : null;
}
function waveClear(room) {
  const n = room.waveNum;
  const trophy = n % 5 === 0 ? 1 : 0;
  for (const p of room.players.values()) {
    const a = acct(p.name);
    if (!a) continue;
    if (!isAdminName(p.name)) a.coins += WAVE_COINS;
    if (trophy) a.trophies = (a.trophies || 0) + 1;
    a.bestWave = Math.max(a.bestWave || 0, n);
    sendTo(p, { t: 'coins', delta: isAdminName(p.name) ? 0 : WAVE_COINS, coins: coinsOf(p.name), inf: isAdminName(p.name), trophy, trophies: a.trophies || 0 });
    sendTo(p, meInfo(p.name));
  }
  // 전체 최고 기록
  const g = acct(ADMIN_NAME), names = [...room.players.values()].map(p => p.name);
  let record = false;
  if (!g.waveBest || n > g.waveBest.wave) { g.waveBest = { wave: n, names, time: new Date().toISOString() }; record = true; }
  saveAccounts();
  roomBroadcast(room, { t: 'waveClear', n, coins: WAVE_COINS, trophy, record });
  setPhase(room, 'break', WAVE_BREAK_MS);
}
function waveGameOver(room) {
  const cleared = room.waveNum - 1;
  const top = [...room.players.values()].sort((a, b) => b.kills - a.kills).map(p => ({ n: p.name, k: p.kills }));
  roomBroadcast(room, { t: 'gameover', wave: room.waveNum, cleared, top, best: waveRecord(room) });
  setPhase(room, 'over', WAVE_OVER_MS);
}
function waveTick(room, t) {
  if (!room.bots) room.bots = new Map();
  if (!room.players.size) {
    if (room.phase !== 'waiting') { room.bots.clear(); room.waveNum = 0; room.phase = 'waiting'; }
    return;
  }
  switch (room.phase) {
    case 'waiting': waveReset(room); break; // 누가 들어오면 바로 준비
    case 'break': if (t >= room.phaseEnd) waveStart(room); break;
    case 'wave': {
      if (room.toSpawn > 0 && botsAlive(room).length < MAX_BOTS_ALIVE && t >= room.nextSpawn) {
        spawnBot(room); room.toSpawn--;
        room.nextSpawn = t + Math.max(250, 900 - room.waveNum * 50);
      }
      moveBots(room, t);
      for (const [id, b] of room.bots) if (!b.alive && t > b.removeAt) room.bots.delete(id);
      if (![...room.players.values()].some(p => p.alive)) waveGameOver(room);
      else if (room.toSpawn === 0 && !botsAlive(room).length) waveClear(room);
      break;
    }
    case 'over': if (t >= room.phaseEnd) waveReset(room); break;
  }
}

// =====================================================
//  공통: 사격 / 이동
// =====================================================
function handleShoot(room, p, msg) {
  const t = now();
  if (!p.alive || room.mode === 'obby' || room.mode === 'lava') return;
  if (room.mode === 'fps' && room.roundOver) return;
  if (room.mode === 'zombie' && p.team === 'zombie') return;
  const W = weaponOf(p);
  let d = [Number(msg.dx), Number(msg.dy), Number(msg.dz)];
  if (!d.every(Number.isFinite)) return;
  const len = Math.hypot(d[0], d[1], d[2]);
  if (len < 0.5) return;
  d = d.map(v => v / len);
  // 건블레이드 오른쪽 클릭: 총 한 발
  if (msg.alt && W.altShot) {
    if (t - (p.lastAlt || 0) < W.altShot.cd - 15) return;
    p.lastAlt = t; p.protectUntil = 0;
    return fireBullets(room, p, d, W.altShot, t);
  }
  if (W.burst) { // 점사: 3발까지는 빨리, 그다음은 쉬어야 해요
    p.burstTimes = (p.burstTimes || []).filter(x => t - x < W.burstGap);
    if (p.burstTimes.length >= W.burst) return;
  }
  if (t - p.lastShot < W.fire - 15) return;
  if (W.melee) return handleMelee(room, p, msg, W, t);
  if (W.proj === 'arrow') { // 활: 당긴 만큼 세게
    p.lastShot = t; p.protectUntil = 0;
    const c = Math.max(0.15, Math.min(1, Number(msg.charge) || 0));
    return launchProj(room, p, 'arrow', d, 18 + c * 32, { dmg: Math.round(W.body * (0.25 + 0.75 * c)), head: Math.round(W.head * (0.25 + 0.75 * c)), grav: 5 });
  }
  if (p.reloadUntil && t >= p.reloadUntil) { p.ammo = W.mag; p.reloadUntil = 0; }
  if (p.reloadUntil || p.ammo <= 0) return;
  p.lastShot = t; p.ammo--; p.protectUntil = 0;
  if (W.burst) p.burstTimes.push(t);
  if (W.proj === 'rocket') return launchProj(room, p, 'rocket', d, 28, { grav: 0 });
  fireBullets(room, p, d, W, t);
}
// 방패를 앞으로 들고 있는 사람은 앞에서 오는 공격을 막아요
function shieldBlocks(q, fromX, fromZ) {
  if (q.isBot || q.weapon !== 'wp_shield') return false;
  const dx = fromX - q.x, dz = fromZ - q.z, l = Math.hypot(dx, dz) || 1;
  return (-Math.sin(q.yaw) * dx - Math.cos(q.yaw) * dz) / l > 0.35;
}
function fireBullets(room, p, d, W, t) {
  const o = [p.x, p.y + (p.crouch ? 1.1 : 1.7), p.z];
  const r2 = v => Math.round(v * 100) / 100;
  const castRay = dir => {
    let best = 100, hitPlayer = null;
    for (const b of room.map.boxes) { const tt = rayBox(o, dir, b.min, b.max); if (tt < best) best = tt; }
    for (const q of targetsOf(room)) {
      if (!canHurt(room, p, q)) continue;
      const tt = rayBox(o, dir, [q.x - 0.4, q.y, q.z - 0.4], [q.x + 0.4, q.y + bodyTop(q), q.z + 0.4]);
      if (tt < best) { best = tt; hitPlayer = q; }
    }
    return { best, hitPlayer, end: [o[0] + dir[0] * best, o[1] + dir[1] * best, o[2] + dir[2] * best] };
  };
  // 샷건은 서버가 총알 여러 개를 퍼뜨려요 (다른 총의 퍼짐은 쏘는 사람 화면에서 이미 들어가 있어요)
  const dirs = [];
  for (let k = 0; k < (W.pellets || 1); k++) {
    if ((W.pellets || 1) === 1) { dirs.push(d); continue; }
    const v = d.map(x => x + (Math.random() - 0.5) * 2 * W.spread);
    const l = Math.hypot(...v); dirs.push(v.map(x => x / l));
  }
  const dmg = new Map();
  const ends = [];
  for (const dir of dirs) {
    const { best, hitPlayer, end } = castRay(dir);
    ends.push(end.map(r2));
    if (!hitPlayer) continue;
    if (shieldBlocks(hitPlayer, p.x, p.z)) { sendTo(p, { t: 'hitmark', block: true }); continue; } // 🛡️ 막힘
    const head = end[1] - hitPlayer.y > headFrom(hitPlayer); // 머리에 맞았나요?
    let amount = head ? W.head : W.body;
    if (W.far && best > W.far) amount = Math.round(amount / 2);
    const cur = dmg.get(hitPlayer) || { amount: 0, head: false };
    cur.amount += amount; cur.head = cur.head || head;
    dmg.set(hitPlayer, cur);
  }
  roomBroadcast(room, ends.length === 1 ? { t: 'shot', id: p.id, o: o.map(r2), e: ends[0] } : { t: 'shot', id: p.id, o: o.map(r2), es: ends });
  for (const [q, { amount, head }] of dmg) applyDamage(room, p, q, amount, head, t);
}

// 몸 크기 (웅크리면 작아져요)
const bodyTop = q => q.crouch ? 1.35 : 1.95;
const headFrom = q => q.crouch ? 0.95 : 1.45;
// 이 사람이 q를 공격할 수 있나요?
function canHurt(room, p, q) {
  if (q === p || !q.alive) return false;
  if (room.mode === 'fps') return q.team !== p.team;
  if (room.mode === 'wave') return room.phase === 'wave' && !!q.isBot;
  if (room.mode === 'zombie') return room.phase === 'playing' && q.team === 'zombie';
  return false;
}
function targetsOf(room) { return room.mode === 'wave' && room.bots ? [...room.bots.values()] : [...room.players.values()]; }
// 데미지 주기 (총, 칼, 수류탄 공통)
function applyDamage(room, p, q, amount, head, t) {
  if (q.protectUntil > t || !q.alive) return;
  if (p.buffUntil > t) amount = Math.round(amount * 1.3); // 📯 나팔 효과
  q.hp -= amount;
  if (!q.isBot) sendTo(q, { t: 'hurt', from: p.name });
  const dead = q.hp <= 0;
  sendTo(p, { t: 'hitmark', head, kill: dead });
  if (!dead) return;
  if (room.mode === 'fps') fpsKill(room, q, p, head);
  else if (q.isBot) { q.alive = false; q.hp = 0; q.removeAt = t + 1500; p.kills++; }
  else {
    q.alive = false; q.hp = 0; q.deaths++; q.respawnAt = t + RESPAWN_MS; p.kills++;
    roomBroadcast(room, { t: 'kill', killer: p.name, kteam: 'human', victim: q.name, vteam: 'zombie', head, w: p.killIcon || weaponOf(p).icon });
  }
}
// 단검 / 카타나
function handleMelee(room, p, msg, W, t) {
  p.lastShot = t; p.protectUntil = 0;
  let fx = Number(msg.dx), fz = Number(msg.dz);
  if (![fx, fz].every(Number.isFinite)) return;
  const fl = Math.hypot(fx, fz) || 1; fx /= fl; fz /= fl;
  roomBroadcast(room, { t: 'swing', id: p.id, m: 1 });
  const hits = [];
  for (const q of targetsOf(room)) {
    if (!canHurt(room, p, q)) continue;
    const dx = q.x - p.x, dz = q.z - p.z, d = Math.hypot(dx, dz);
    if (d > W.range || Math.abs(q.y - p.y) > 1.8) continue;
    if (d > 0.5 && (dx * fx + dz * fz) / d < W.cone) continue; // 앞쪽에 있어야 해요
    hits.push({ q, d, dx, dz });
  }
  hits.sort((a, b) => a.d - b.d);
  for (const { q, d, dx, dz } of W.multi ? hits : hits.slice(0, 1)) {
    let amount = W.body, back = false;
    if (W.backstab && d > 0.01) {
      // q가 바라보는 방향과 (나→q) 방향이 같으면 = q 뒤에서 찌른 것
      const qf = [-Math.sin(q.yaw), -Math.cos(q.yaw)];
      if ((qf[0] * dx + qf[1] * dz) / d > 0.5) { amount = 9999; back = true; }
    }
    p.killIcon = back ? '🗡️💀' : W.icon;
    applyDamage(room, p, q, amount, back, t);
    p.killIcon = null;
  }
}
// 카타나 돌진 (이동은 내 화면이 하고, 서버는 그동안 빨리 움직여도 봐줘요)
function handleDash(p) {
  const W = weaponOf(p), t = now();
  if (!W.dash || !p.alive || t - (p.lastDash || 0) < DASH_COOLDOWN) return;
  p.lastDash = t; p.dashUntil = t + 450;
  sendTo(p, { t: 'dash' });
}
// =====================================================
//  던지는 아이템 / 화살 / 로켓 / 바닥 효과 / 점프패드
// =====================================================
let nextObjId = 1;
const r2 = v => Math.round(v * 100) / 100;
function useGadget(room, p, msg) {
  const id = String(msg.g), G = GADGETS[id], t = now();
  if (!G || !p.alive || room.mode === 'obby' || room.mode === 'lava' || p.team === 'zombie') return;
  if (!p.items || !(p.items[id] > 0)) return;
  if (t - (p.lastGadget || 0) < 600) return;
  let d = [Number(msg.dx), Number(msg.dy), Number(msg.dz)];
  if (G.throw) {
    if (!d.every(Number.isFinite)) return;
    const l = Math.hypot(...d); if (l < 0.5) return; d = d.map(v => v / l);
  }
  p.lastGadget = t; p.items[id]--; p.protectUntil = 0;
  sendTo(p, { t: 'items', items: p.items });
  if (G.throw) {
    const g = { id: nextObjId++, kind: id, owner: p, x: p.x + d[0] * 0.5, y: p.y + 1.6 + d[1] * 0.5, z: p.z + d[2] * 0.5,
      vx: d[0] * 14, vy: d[1] * 14 + 3, vz: d[2] * 14, boomAt: t + G.fuse };
    (room.grenades = room.grenades || []).push(g);
    roomBroadcast(room, { t: 'throw', id: g.id, k: id, p: [g.x, g.y, g.z, g.vx, g.vy, g.vz].map(r2) });
  } else if (id === 'gr_jumppad') {
    room.pads = (room.pads || []).filter(x => { if (x.owner === p) { roomBroadcast(room, { t: 'padGone', id: x.id }); return false; } return true; });
    const pad = { id: nextObjId++, owner: p, x: p.x, y: p.y, z: p.z, until: t + PAD_MS };
    room.pads.push(pad);
    roomBroadcast(room, { t: 'pad', id: pad.id, x: r2(pad.x), y: r2(pad.y), z: r2(pad.z), ms: PAD_MS });
  } else if (id === 'gr_horn') {
    roomBroadcast(room, { t: 'horn', id: p.id, name: p.name });
    for (const q of room.players.values()) {
      if (!q.alive || q.team !== p.team || Math.hypot(q.x - p.x, q.z - p.z) > 12) continue;
      q.buffUntil = t + BUFF_MS;
      sendTo(q, { t: 'buff', ms: BUFF_MS, from: p.name });
    }
  }
}
// 화살 / 로켓 쏘기
function launchProj(room, p, kind, d, speed, extra) {
  const o = { id: nextObjId++, kind, owner: p, x: p.x + d[0] * 0.6, y: p.y + 1.6 + d[1] * 0.6, z: p.z + d[2] * 0.6,
    vx: d[0] * speed, vy: d[1] * speed, vz: d[2] * speed, born: now(), ...extra };
  (room.projs = room.projs || []).push(o);
  roomBroadcast(room, { t: 'proj', id: o.id, k: kind, g: o.grav, p: [o.x, o.y, o.z, o.vx, o.vy, o.vz].map(r2), from: p.id });
}
// 폭발 (수류탄, 로켓): 상대는 다치고, 로켓은 가까이 있는 모두를 밀어내요 (쏜 사람은 안 다쳐요)
function explodeAt(room, p, x, y, z, radius, maxDmg, icon, knock) {
  const t = now();
  roomBroadcast(room, { t: 'boom', x: r2(x), y: r2(y), z: r2(z), r: radius });
  if (!room.players.has(p.id)) return;
  const all = new Set([...room.players.values(), ...targetsOf(room)]); // 나도 밀려나야 해서 사람 + 봇 전부
  for (const q of all) {
    const d = Math.hypot(q.x - x, q.y + 0.9 - y, q.z - z);
    if (d > radius || !q.alive) continue;
    if (knock && !q.isBot && (q === p || canHurt(room, p, q))) { // 밀어내기 (로켓 점프!)
      const dx = q.x - x, dy = q.y + 0.9 - y, dz = q.z - z, l = Math.hypot(dx, dy, dz) || 1;
      const f = knock * (1 - d / radius * 0.6);
      q.dashUntil = t + 1500;
      sendTo(q, { t: 'knock', v: [dx / l * f, Math.max(4, dy / l * f + 3), dz / l * f].map(r2) });
    }
    if (!canHurt(room, p, q)) continue;
    p.killIcon = icon;
    applyDamage(room, p, q, Math.round(maxDmg * (1 - d / radius * 0.7)), false, t);
    p.killIcon = null;
  }
}
// 던진 것 날아가기 (벽, 바닥에 튕겨요) - 화면에서도 똑같이 계산해요. 부딪히면 true
function grenadeStep(g, map, dt) {
  const inside = (x, y, z) => (!map.noFloor && y < 0.1) || map.boxes.some(b => x > b.min[0] - 0.1 && x < b.max[0] + 0.1 && y > b.min[1] - 0.1 && y < b.max[1] + 0.1 && z > b.min[2] - 0.1 && z < b.max[2] + 0.1);
  g.vy -= 18 * dt;
  const lim = map.size - 0.5;
  let hit = false;
  let nx = g.x + g.vx * dt; if (inside(nx, g.y, g.z) || Math.abs(nx) > lim) { g.vx *= -0.4; nx = g.x; hit = true; } g.x = nx;
  let nz = g.z + g.vz * dt; if (inside(g.x, g.y, nz) || Math.abs(nz) > lim) { g.vz *= -0.4; nz = g.z; hit = true; } g.z = nz;
  let ny = g.y + g.vy * dt; if (inside(g.x, ny, g.z)) { g.vy *= -0.35; g.vx *= 0.7; g.vz *= 0.7; ny = g.y; hit = true; } g.y = ny;
  return hit;
}
function popGrenade(room, g, t) {
  const p = g.owner;
  roomBroadcast(room, { t: 'pop', id: g.id });
  if (g.kind === 'gr_grenade') explodeAt(room, p, g.x, g.y, g.z, GRENADE_RADIUS, GRENADE_DMG, '💣', 0);
  else if (g.kind === 'gr_smoke' || g.kind === 'gr_molotov') {
    const z = { id: nextObjId++, kind: g.kind === 'gr_smoke' ? 'smoke' : 'fire', owner: p, team: p.team, x: g.x, y: Math.max(g.y - 0.1, -50), z: g.z,
      r: g.kind === 'gr_smoke' ? 5 : 3, until: t + ZONE_MS, nextHurt: t };
    (room.zones = room.zones || []).push(z);
    roomBroadcast(room, { t: 'zone', id: z.id, k: z.kind, x: r2(z.x), y: r2(z.y), z: r2(z.z), r: z.r, ms: ZONE_MS });
  } else if (g.kind === 'gr_flash') {
    roomBroadcast(room, { t: 'boom', x: r2(g.x), y: r2(g.y), z: r2(g.z), r: 1.5, flash: true });
    if (!room.players.has(p.id)) return;
    for (const q of room.players.values()) {
      if (!q.alive || q === p || (room.mode !== 'fps' ? true : q.team === p.team)) continue;
      const dx = g.x - q.x, dy = g.y - (q.y + 1.7), dz = g.z - q.z, d = Math.hypot(dx, dy, dz);
      if (d > 22) continue;
      // 벽 뒤에 있으면 안 보여요
      const dir = [dx / d, dy / d, dz / d], o = [q.x, q.y + 1.7, q.z];
      if (room.map.boxes.some(b => rayBox(o, dir, b.min, b.max) < d - 0.3)) continue;
      // 보고 있는 쪽이면 더 오래
      const look = [-Math.sin(q.yaw) * Math.cos(q.pitch), Math.sin(q.pitch), -Math.cos(q.yaw) * Math.cos(q.pitch)];
      const facing = look[0] * dir[0] + look[1] * dir[1] + look[2] * dir[2];
      const ms = Math.round((facing > 0.3 ? 2500 : 700) * (1 - d / 30));
      sendTo(q, { t: 'flashed', ms });
    }
  }
}
function objectsTick(room, t) {
  const dt4 = TICK_MS / 4000;
  // 던진 것
  if (room.grenades && room.grenades.length) {
    const left = [];
    for (const g of room.grenades) {
      let hit = false;
      for (let k = 0; k < 4; k++) hit = grenadeStep(g, room.map, dt4) || hit;
      if (t >= g.boomAt || (hit && GADGETS[g.kind].impact) || g.y < -40) popGrenade(room, g, t);
      else left.push(g);
    }
    room.grenades = left;
  }
  // 화살 / 로켓
  if (room.projs && room.projs.length) {
    const left = [];
    for (const o of room.projs) {
      let done = null; // { x,y,z, q }
      for (let k = 0; k < 4 && !done; k++) {
        o.vy -= (o.grav || 0) * dt4;
        const nx = o.x + o.vx * dt4, ny = o.y + o.vy * dt4, nz = o.z + o.vz * dt4;
        const dir = [nx - o.x, ny - o.y, nz - o.z], seg = Math.hypot(...dir) || 0.0001, u = dir.map(v => v / seg);
        let best = seg, hitQ = null;
        for (const b of room.map.boxes) { const tt = rayBox([o.x, o.y, o.z], u, b.min, b.max); if (tt < best) { best = tt; hitQ = null; } }
        if (!room.map.noFloor && ny < 0) { const tt = o.y / Math.max(0.0001, o.y - ny) * seg; if (tt < best) { best = tt; hitQ = null; } }
        for (const q of targetsOf(room)) {
          if (q === o.owner || !q.alive) continue;
          if (o.kind === 'arrow' && !canHurt(room, o.owner, q)) continue;
          const tt = rayBox([o.x, o.y, o.z], u, [q.x - 0.4, q.y, q.z - 0.4], [q.x + 0.4, q.y + bodyTop(q), q.z + 0.4]);
          if (tt < best) { best = tt; hitQ = q; }
        }
        if (best < seg || hitQ) done = { x: o.x + u[0] * best, y: o.y + u[1] * best, z: o.z + u[2] * best, q: hitQ };
        else { o.x = nx; o.y = ny; o.z = nz; }
      }
      if (!done && (t - o.born > 4000 || o.y < -40)) done = { x: o.x, y: o.y, z: o.z, q: null };
      if (!done) { left.push(o); continue; }
      roomBroadcast(room, { t: 'projEnd', id: o.id, x: r2(done.x), y: r2(done.y), z: r2(done.z) });
      if (o.kind === 'rocket') explodeAt(room, o.owner, done.x, done.y, done.z, 4.5, WEAPONS.wp_rpg.body, '🚀', 14);
      else if (done.q && room.players.has(o.owner.id)) {
        if (shieldBlocks(done.q, o.owner.x, o.owner.z)) sendTo(o.owner, { t: 'hitmark', block: true });
        else {
          const head = done.y - done.q.y > headFrom(done.q);
          o.owner.killIcon = '🏹';
          applyDamage(room, o.owner, done.q, head ? o.head : o.dmg, head, t);
          o.owner.killIcon = null;
        }
      }
    }
    room.projs = left;
  }
  // 불바닥 (상대 팀만), 연기, 점프패드 시간 끝
  if (room.zones && room.zones.length) {
    room.zones = room.zones.filter(z => t < z.until);
    for (const z of room.zones) {
      if (z.kind !== 'fire' || t < z.nextHurt) continue;
      z.nextHurt = t + 500;
      if (!room.players.has(z.owner.id)) continue;
      for (const q of targetsOf(room)) {
        if (!canHurt(room, z.owner, q) || Math.hypot(q.x - z.x, q.z - z.z) > z.r || Math.abs(q.y - z.y) > 2) continue;
        z.owner.killIcon = '🔥';
        applyDamage(room, z.owner, q, 8, false, t);
        z.owner.killIcon = null;
      }
    }
  }
  if (room.pads && room.pads.length) room.pads = room.pads.filter(x => t < x.until || (roomBroadcast(room, { t: 'padGone', id: x.id }), false));
}
// 새로 들어온 사람에게 지금 깔려 있는 것들 알려 주기
function sendObjects(room, c) {
  const t = now();
  for (const z of room.zones || []) sendTo(c, { t: 'zone', id: z.id, k: z.kind, x: r2(z.x), y: r2(z.y), z: r2(z.z), r: z.r, ms: z.until - t });
  for (const x of room.pads || []) sendTo(c, { t: 'pad', id: x.id, x: r2(x.x), y: r2(x.y), z: r2(x.z), ms: x.until - t });
}
function clearObjects(room) {
  for (const x of room.pads || []) roomBroadcast(room, { t: 'padGone', id: x.id });
  for (const z of room.zones || []) roomBroadcast(room, { t: 'zoneGone', id: z.id });
  room.grenades = []; room.projs = []; room.zones = []; room.pads = [];
}

function handleMove(room, p, msg) {
  if (!p.alive) return;
  const x = Number(msg.x), y = Number(msg.y), z = Number(msg.z);
  const yaw = Number(msg.yaw), pitch = Number(msg.pitch);
  if (![x, y, z, yaw, pitch].every(Number.isFinite)) return;
  const t = now();
  const dt = Math.min(1, (t - p.lastMoveAt) / 1000);
  p.lastMoveAt = t;
  const maxStep = (p.dashUntil > t ? 22 : 8) * dt * 1.6 + 0.6; // 카타나 돌진 중에는 더 빨라도 OK
  const dist = Math.hypot(x - p.x, z - p.z);
  const lim = room.map.size - 1;
  const [ymin, ymax] = room.map.noFloor ? [-40, 250] : [-0.5, 30]; // 점프패드, 로켓 점프로 높이 올라갈 수 있어요
  if (dist > maxStep || Math.abs(x) > lim || Math.abs(z) > lim || y < ymin || y > ymax) {
    sendTo(p, { t: 'correct', x: p.x, y: p.y, z: p.z });
  } else {
    p.x = x; p.y = y; p.z = z;
  }
  p.yaw = yaw; p.pitch = Math.max(-1.6, Math.min(1.6, pitch));
  p.crouch = !!msg.c; // 웅크리기
  if (room.mode === 'obby') obbyCheck(room, p);
  if (room.mode === 'lava') lavaCheck(room, p);
}

// =====================================================
//  채팅
// =====================================================
const chatLog = [];
// 예전 채팅 기록 (로비 + 방마다, 서버가 다시 켜져도 남아요)
const CHAT_KEEP = 200;
function chatHistStore() { const g = acct(ADMIN_NAME); if (!g) return []; g.chatHist = g.chatHist || []; return g.chatHist; }
function rememberChat(where, from, text) {
  const h = chatHistStore();
  h.push({ w: where, f: from, x: text, at: Date.now() });
  if (h.length > CHAT_KEEP * 3) h.splice(0, h.length - CHAT_KEEP * 3);
  saveAccounts();
}
function sendChatHist(c, where) {
  const list = chatHistStore().filter(e => e.w === where).slice(-CHAT_KEEP).map(e => ({ from: e.f, text: e.x, at: e.at }));
  sendTo(c, { t: 'chatHist', where, list });
}
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
  const team = !!msg.team && !!room && room.mode !== 'obby' && room.mode !== 'lava';
  const out = { t: 'chat', from: c.name, text, scope: !room ? 'lobby' : team ? 'team' : 'all', team: room ? c.team : null };
  if (!room) { for (const x of clients.values()) if (!x.room) sendTo(x, out); }
  else if (team) { for (const p of room.players.values()) if (p.team === c.team) sendTo(p, out); }
  else roomBroadcast(room, out);
  if (!team) rememberChat(room ? room.id : 'lobby', c.name, text); // 팀 채팅은 기록 안 해요
  chatLog.push({ time: new Date().toISOString(), from: c.name, where: !room ? '로비' : room.title + (team ? ' (팀)' : ''), text });
  if (chatLog.length > 100) chatLog.shift();
}

// 채팅 명령어: /코인 아이디 개수  (내 코인을 친구에게 보내기)
// ---------- 초대 링크 ----------
// 링크에 들어 있는 초대 코드는 입장 비밀번호 대신 쓸 수 있어요. 관리자가 새로 만들면 예전 링크는 막혀요.
function inviteCode() {
  const a = acct(ADMIN_NAME);
  if (!a.invite) { a.invite = 'inv-' + crypto.randomBytes(6).toString('hex'); saveAccounts(); }
  return a.invite;
}
function entryOk(code) {
  code = String(code || '');
  if (safeEqual(code, ENTRY_PASSWORD)) return true;
  return code.startsWith('inv-') && safeEqual(code, inviteCode());
}

// ---------- 관리자에게 문자 ----------
function adminInbox() {
  const a = acct(ADMIN_NAME);
  if (!Array.isArray(a.inbox)) a.inbox = [];
  return a.inbox;
}
function handleToAdmin(c, raw) {
  const note = text => sendTo(c, { t: 'notice', text });
  const text = String(raw || '').replace(/\s+/g, ' ').trim().slice(0, 200);
  if (!text) return note('보낼 내용을 써 주세요.');
  if (isAdminName(c.name)) return note('관리자는 자기한테 문자를 보낼 수 없어요 😄');
  const t = now();
  if (c.lastToAdmin && t - c.lastToAdmin < 10000) return note('관리자 문자는 10초에 한 번만 보낼 수 있어요.');
  c.lastToAdmin = t;
  const inbox = adminInbox();
  inbox.push({ id: crypto.randomBytes(5).toString('hex'), time: new Date().toISOString(), from: c.name, text, read: false });
  while (inbox.length > 200) inbox.shift();
  saveAccounts();
  note('📨 관리자에게 문자를 보냈어요!');
  for (const x of clients.values()) if (isAdminName(x.name)) sendTo(x, { t: 'notice', text: `📨 ${c.name} 님의 문자: ${text}` });
}
// 관리자 답장: 접속 중이면 바로, 아니면 다음 접속 때
function deliverMail(name) {
  const a = acct(name);
  if (!a || !Array.isArray(a.mail) || !a.mail.length) return;
  const online = [...clients.values()].filter(x => x.name === name);
  if (!online.length) return;
  for (const m of a.mail) for (const x of online) sendTo(x, { t: 'notice', text: `📩 관리자 답장: ${m.text}` });
  a.mail = [];
  saveAccounts();
}

// 여러 명에게 한 번에 코인 보내기 (scope: 'online' = 지금 접속한 사람, 'all' = 가입한 계정 전부)
function giveAll(c, n, scope) {
  const note = text => sendTo(c, { t: 'notice', text });
  if (!Number.isFinite(n) || n < 1) return note('1 이상의 숫자를 써 주세요.');
  if (n > 1e12) return note('한 명에게 1조 코인까지만 보낼 수 있어요.');
  const names = scope === 'all'
    ? Object.keys(accounts).filter(k => !accounts[k].banned)
    : [...new Set([...clients.values()].map(x => x.name))];
  const targets = names.filter(k => k !== c.name && !isAdminName(k)); // 나와 관리자는 빼기
  if (!targets.length) return note(scope === 'all' ? '보낼 계정이 없어요.' : '지금 접속한 다른 사람이 없어요.');
  const total = n * targets.length;
  const admin = isAdminName(c.name);
  if (!admin && coinsOf(c.name) < total) {
    return note(`코인이 부족해요. ${targets.length}명 × ${n} = 🪙 ${total}코인이 필요해요. (가진 코인: ${coinsOf(c.name)})`);
  }
  if (!admin) acct(c.name).coins -= total;
  for (const k of targets) acct(k).coins += n;
  saveAccounts();
  note(`${scope === 'all' ? '가입한 계정' : '접속한 사람'} ${targets.length}명에게 🪙 ${n}코인씩 보냈어요! (총 ${total})`);
  sendTo(c, meInfo(c.name));
  sendTo(c, { t: 'coins', delta: 0, coins: coinsOf(c.name), inf: admin });
  const set = new Set(targets);
  for (const x of clients.values()) if (set.has(x.name)) {
    sendTo(x, { t: 'notice', text: `${c.name} 님이 모두에게 🪙 ${n}코인을 선물했어요! 🎁` });
    sendTo(x, meInfo(x.name));
    sendTo(x, { t: 'coins', delta: n, coins: coinsOf(x.name) });
  }
  chatLog.push({ time: new Date().toISOString(), from: c.name, where: '코인 보내기', text: `${scope === 'all' ? '가입한 계정' : '접속한 사람'} ${targets.length}명에게 ${n}코인씩` });
  if (chatLog.length > 100) chatLog.shift();
}

function chatCommand(c, text) {
  const [cmd, who, num] = text.split(' ');
  if (cmd === '/관리자' || cmd === '/admin') return handleToAdmin(c, text.slice(cmd.length));
  if ((cmd === '/코인' || cmd === '/give') && (who === '모두' || who === 'all')) return giveAll(c, Math.floor(Number(num)), 'online');
  if ((cmd === '/코인' || cmd === '/give') && who === '전체') return giveAll(c, Math.floor(Number(num)), 'all');
  if (cmd === '/코인' || cmd === '/give') {
    const n = Math.floor(Number(num));
    const target = who && Object.keys(accounts).find(k => k.toLowerCase() === who.toLowerCase());
    if (!who || !Number.isFinite(n)) return sendTo(c, { t: 'notice', text: '사용법: /코인 아이디 개수  (예: /코인 철수 20)' });
    if (!target) return sendTo(c, { t: 'notice', text: `'${who}' 계정이 없어요.` });
    if (target === c.name) return sendTo(c, { t: 'notice', text: '나에게는 보낼 수 없어요.' });
    if (n < 1) return sendTo(c, { t: 'notice', text: '1 이상의 숫자를 써 주세요.' });
    if (n > 1e12) return sendTo(c, { t: 'notice', text: '한 번에 1조 코인까지만 보낼 수 있어요.' });
    if (!isAdminName(c.name) && coinsOf(c.name) < n) return sendTo(c, { t: 'notice', text: `코인이 부족해요. (가진 코인: ${coinsOf(c.name)})` });
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
  sendTo(c, { t: 'notice', text: '명령어: /코인 아이디 개수 · /코인 모두 개수 (접속한 사람 모두) · /코인 전체 개수 (가입한 계정 모두) · /관리자 내용' });
}

function kickClient(c, reason, block) {
  if (block) kickBlocks.set(c.name, now() + KICK_BLOCK_MS);
  sendTo(c, { t: 'kicked', reason });
  setTimeout(() => c.ws.close(), 100);
}

function lobbyInfo() {
  return {
    t: 'lobby', top: ranking().slice(0, 10),
    rooms: [...rooms.values()].map(r => {
      const o = { id: r.id, icon: r.icon, title: r.title, desc: r.desc, count: r.players.size, max: MAX_PLAYERS };
      if (r.mode === 'wave') { const wb = waveRecord(r); if (wb) o.note = `🏆 최고 기록: 웨이브 ${wb.wave} (${wb.names.join(', ')})`; }
      if (r.mode === 'lava') { const lb = lavaRecord(); if (lb) o.note = `🏆 최고 기록: ${lb.time}초 (${lb.name})`; }
      return o;
    }),
  };
}

// 주기적 업데이트 (데이터 아끼기)
//  - roster(이름, 팀, 꾸미기, 킬/데스): 바뀔 때만 보내요
//  - state(위치): 짧은 숫자 배열로, 움직인 사람만 보내요. 1초마다 한 번은 전부 보내요
let tickCount = 0;
setInterval(() => {
  const t = now();
  tickCount++;
  const keyframe = tickCount % 15 === 0;
  for (const room of rooms.values()) {
    if (room.mode === 'zombie') zombieTick(room, t);
    if (room.mode === 'fps' && room.mapVoteUntil && t >= room.mapVoteUntil) { room.mapVoteUntil = 0; resetFps(room); } // 투표 끝 → 그 맵으로 시작
    if (room.mode === 'fps' && !room.players.size) room.mapVoteUntil = 0;
    if (room.mode === 'obby') obbyTick(room, t);
    if (room.mode === 'lava') lavaTick(room, t);
    if (room.mode === 'wave') waveTick(room, t);
    objectsTick(room, t);
    for (const p of room.players.values()) {
      if (!p.alive && t >= p.respawnAt && !(room.mode === 'fps' && room.roundOver)) spawn(room, p);
    }
    if (!room.players.size) continue;
    // 1) 명단: 바뀌었을 때만
    const everyone = room.bots && room.mode === 'wave' ? [...room.players.values(), ...room.bots.values()] : [...room.players.values()];
    const roster = everyone.map(p => p.isBot ? { id: p.id, n: p.name, tm: 'zombie', lk: p.lk, k: 0, d: 0, c: 0 }
      : { id: p.id, n: p.name, tm: p.team, lk: lookOf(p.name), k: p.kills, d: p.deaths, c: p.cp || 0, w: p.weapon });
    const rosterKey = JSON.stringify(roster);
    if (rosterKey !== room.lastRoster || room.forceFull) {
      room.lastRoster = rosterKey;
      roomBroadcast(room, { t: 'roster', p: roster });
    }
    // 2) 위치: [id, x*100, y*100, z*100, yaw*1000, pitch*1000, hp, 살아있음]
    if (!room.lastSent) room.lastSent = new Map();
    const full = keyframe || room.forceFull;
    const rows = [];
    for (const p of everyone) {
      const row = [p.id, Math.round(p.x * 100), Math.round(p.y * 100), Math.round(p.z * 100),
        Math.round(p.yaw * 1000), Math.round(p.pitch * 1000), Math.max(0, Math.round(p.hp)), p.alive ? (p.crouch ? 2 : 1) : 0]; // 2 = 웅크림
      const key = row.join(',');
      if (full || room.lastSent.get(p.id) !== key) { rows.push(row); room.lastSent.set(p.id, key); }
    }
    // 3) 점수/시간: 바뀌었을 때만
    const info = room.mode === 'fps' ? { s: room.scores, target: room.killTarget }
      : room.mode === 'lava' ? { ph: room.phase, tl: Math.max(0, Math.ceil((room.phaseEnd - t) / 1000)), lv: Math.round((room.lavaY ?? LAVA_START) * 100) }
      : room.mode === 'wave' ? { ph: room.phase, tl: Math.max(0, Math.ceil((room.phaseEnd - t) / 1000)), wv: room.waveNum,
        zl: (room.toSpawn || 0) + (room.bots ? botsAlive(room).length : 0) }
      : { ph: room.phase, w: room.wins, tl: Math.max(0, Math.ceil((room.phaseEnd - t) / 1000)) };
    const infoKey = JSON.stringify(info);
    const state = { t: 'state', p: rows };
    if (full || infoKey !== room.lastInfo) { Object.assign(state, info); room.lastInfo = infoKey; }
    room.forceFull = false;
    if (rows.length || state.s || state.ph) roomBroadcast(room, state);
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
      scores: r.scores, killTarget: r.killTarget, phase: r.phase, wins: r.wins, wv: r.waveNum || 0, best: r.mode === 'wave' ? waveRecord(r) : null,
      ...(hasVote(r) ? { vote: voteInfo(r) } : {}),
    })),
    maps: MAP_LIST,
    players: [...clients.values()].map(c => ({
      id: c.id, name: c.name, room: c.room ? c.room.id : null, roomTitle: c.room ? c.room.title : '로비',
      team: c.room ? c.team : null, kills: c.kills || 0, deaths: c.deaths || 0, hp: c.hp, alive: !!c.alive,
      coins: isAdminName(c.name) ? '∞' : coinsOf(c.name), muted: !!(acct(c.name) && acct(c.name).muted),
    })),
    chat: chatLog.slice(-40),
    rps: [...rpsGames.values()].map(g => ({ name: g.name, state: g.state, round: g.round, userPicked: !!g.userPick, adminPicked: !!g.adminPick, online: !!clientByName(g.name) })),
    invite: inviteCode(),
    inbox: adminInbox().slice(-60).reverse(),
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
  if (msg.t === 'rpsAccept' || msg.t === 'rpsDecline' || msg.t === 'rpsPick') return handleRpsAdmin(msg);
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
      if (room) room.mode === 'fps' ? resetFps(room) : room.mode === 'zombie' ? resetZombie(room) : room.mode === 'wave' ? waveReset(room) : room.mode === 'lava' ? lavaNewRound(room) : obbyStartCountdown(room);
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
    case 'newInvite': { // 새 초대 링크 (예전 링크는 막혀요)
      acct(ADMIN_NAME).invite = 'inv-' + crypto.randomBytes(6).toString('hex');
      saveAccounts();
      const inv = inviteCode();
      for (const x of clients.values()) sendTo(x, { t: 'invite', invite: inv });
      break;
    }
    case 'setMap': {
      const room = rooms.get(msg.room);
      if (!room || !hasVote(room)) break;
      room.adminPick = MAP_LIST.some(m => m.id === msg.map) ? msg.map : null; // null = 투표대로
      if (room.adminPick) {
        const m = MAP_LIST.find(x => x.id === msg.map);
        roomBroadcast(room, { t: 'notice', text: `👑 관리자가 다음 맵을 ${m.icon} ${m.name}으로 정했어요!` });
      }
      roomBroadcast(room, voteInfo(room));
      if (msg.now) room.mode === 'fps' ? resetFps(room) : room.mode === 'wave' ? waveReset(room) : resetZombie(room);
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
    case 'giveAll': { // 관리자 화면에서 모두에게 주기
      const n = Math.round(Number(msg.n));
      if (!(n >= 1 && n <= 1e12)) break;
      const scope = msg.scope === 'all' ? 'all' : 'online';
      const names = scope === 'all' ? Object.keys(accounts).filter(k => !accounts[k].banned) : [...new Set([...clients.values()].map(x => x.name))];
      const targets = names.filter(k => !isAdminName(k));
      for (const k of targets) acct(k).coins += n;
      saveAccounts();
      const set = new Set(targets);
      for (const x of clients.values()) if (set.has(x.name)) {
        sendTo(x, { t: 'notice', text: `👑 관리자가 모두에게 🪙 ${n}코인을 선물했어요! 🎁` });
        sendTo(x, meInfo(x.name));
        sendTo(x, { t: 'coins', delta: n, coins: coinsOf(x.name) });
      }
      break;
    }
    case 'giveCoins': {
      if (isAdminName(msg.name)) break;
      const a = acct(String(msg.name || ''));
      const n = Math.round(Number(msg.n));
      if (a && Number.isFinite(n) && Math.abs(n) <= 1e12) {
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
    case 'inboxRead': {
      for (const m of adminInbox()) if (!msg.id || m.id === msg.id) m.read = true;
      saveAccounts();
      break;
    }
    case 'inboxDelete': {
      const a = acct(ADMIN_NAME);
      a.inbox = adminInbox().filter(m => m.id !== msg.id);
      saveAccounts();
      break;
    }
    case 'reply': {
      const to = String(msg.to || ''), text = String(msg.text || '').trim().slice(0, 200);
      const a = acct(to);
      if (!a || !text) break;
      if (!Array.isArray(a.mail)) a.mail = [];
      a.mail.push({ time: new Date().toISOString(), text });
      for (const m of adminInbox()) if (m.id === msg.id) { m.read = true; m.replied = text; }
      saveAccounts();
      deliverMail(to);
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
  ws.send({ t: 'hello', name, shop: SHOP, winCoins: WIN_COINS, adminName: ADMIN_NAME, invite: inviteCode() });
  ws.send(meInfo(name));
  setTimeout(() => deliverMail(name), 500); // 못 받은 관리자 답장 보여 주기
  ws.send(lobbyInfo());
  sendChatHist(c, 'lobby');
  sendTo(c, rpsInfo(c));

  ws.onmessage = raw => {
    let msg; try { msg = JSON.parse(raw); } catch { return; }
    const room = c.room;
    if (msg.t === 'join') joinRoom(c, String(msg.room));
    else if (msg.t === 'buy' || msg.t === 'equip' || msg.t === 'gender') handleShop(c, msg);
    else if (msg.t === 'chat') handleChat(c, msg);
    else if (msg.t === 'toAdmin') handleToAdmin(c, msg.text);
    else if (msg.t === 'mgStart' || msg.t === 'mgEnd') handleMinigame(c, msg);
    else if (msg.t === 'rpsReq' || msg.t === 'rpsCancel' || msg.t === 'rpsPick') handleRpsUser(c, msg);
    else if (msg.t === 'vote') handleVote(c, String(msg.map));
    else if (msg.t === 'give') { // 코인 보내기 버튼
      const to = String(msg.to || '').trim().replace(/\s+/g, ''), n = Math.floor(Number(msg.n));
      if (msg.scope === 'online' || msg.scope === 'all') giveAll(c, n, msg.scope);
      else chatCommand(c, `/코인 ${to} ${n}`);
    }
    else if (!room) return;
    else if (msg.t === 'move') handleMove(room, c, msg);
    else if (msg.t === 'shoot') handleShoot(room, c, msg);
    else if (msg.t === 'attack') handleAttack(room, c);
    else if (msg.t === 'weapon') handleWeapon(c, msg.w);
    else if (msg.t === 'gadget') useGadget(room, c, msg);
    else if (msg.t === 'dash') handleDash(c);
    else if (msg.t === 'reload') {
      const W = weaponOf(c);
      if (!c.reloadUntil && c.ammo < W.mag) c.reloadUntil = now() + W.reload;
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
  if (!entryOk(body.code)) {
    failAttempt(ip);
    const inv = String(body.code || '').startsWith('inv-');
    return json(res, 401, { error: inv ? '초대 링크가 바뀌었어요. 새 링크를 받거나 입장 비밀번호를 써 주세요.' : '입장 비밀번호가 틀렸어요.' });
  }

  if (pathname === '/api/entry') return json(res, 200, { ok: true });

  let username = String(body.username || '').trim();
  const password = String(body.password || '');
  if (pathname === '/api/signup') {
    if (!NAME_RE.test(username)) return json(res, 400, { error: '아이디는 한글/영어/숫자/_ 로 2~12글자여야 해요.' });
    if (['모두', '전체', 'all', '관리자', 'admin'].includes(username.toLowerCase())) return json(res, 400, { error: '그 아이디는 쓸 수 없어요.' });
    if (password.length < 4 || password.length > 50) return json(res, 400, { error: '비밀번호는 4글자 이상이어야 해요.' });
    const lower = username.toLowerCase();
    if (isAdminName(username) || Object.keys(accounts).some(n => n.toLowerCase() === lower)) return json(res, 409, { error: '이미 있는 아이디예요.' });
    const salt = crypto.randomBytes(16).toString('hex');
    accounts[username] = {
      salt, hash: hashPassword(password, salt), created: new Date().toISOString(),
      coins: 0, owned: [], equip: { hat: null, face: null, skin: null },
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
  for (const name of Object.keys(accounts)) acct(name); // 없어진 아이템 환불 등 정리
  saveAccounts();
  server.listen(PORT, () => {
    console.log(`게임 서버 실행 중: http://localhost:${PORT}`);
    if (!ADMIN_PASSWORD) console.log('⚠️  ADMIN_PASSWORD 환경변수가 없어서 관리자 로그인이 꺼져 있어요.');
  });
});
