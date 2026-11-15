// =====================================================
//  1인칭 팀전 게임 화면 (three.js)
// =====================================================
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
import { buildCharacter, animateExtras } from './avatar.js';

const $ = id => document.getElementById(id);
const TEAM_COLOR = { red: 0xe84848, blue: 0x3d8bff, human: 0x3d8bff, zombie: 0x4f9a3a, runner: 0xff9f1c };
const TEAM_NAME = { red: '빨강 팀', blue: '파랑 팀', human: '인간', zombie: '좀비', runner: '러너' };
const TEAM_CSS = { red: '#ff7a7a', blue: '#6fb5ff', human: '#6fb5ff', zombie: '#7fe05a', runner: '#ffb14d' };
const IS_TOUCH = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
const R = 0.35, H = 1.8, EYE = 1.7;
const RUN = 6.5, WALK = 3.2, JUMP = 6.5, GRAV = 18;

let ws, myId, myTeam, myName, cfg, map, mode = 'fps', adminName = '';
const crown = n => adminName && String(n).toLowerCase() === adminName.toLowerCase() ? '👑 ' : '';
let lastAttack = 0, swing = 0;
let boxes = [];
const me = { x: 0, y: 0, z: 0, vy: 0, yaw: 0, pitch: 0, onGround: true, alive: false, hp: 100, maxHp: 100 };
let ammo = 25, reloadUntil = 0, lastFire = 0, mouseDown = false, recoil = 0;
const keys = {};
const others = new Map(); // id -> { group, target, ... }
let lastState = null;
const roomPlayers = new Map(); // id -> 플레이어 정보 (명단 + 위치)
const roomInfo = {};           // 점수, 시간 등

// ---------- three.js 기본 ----------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
$('game').prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9fc7ee);
scene.fog = new THREE.Fog(0x9fc7ee, 40, 110);
const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.05, 300);
camera.rotation.order = 'YXZ';
scene.add(camera);

scene.add(new THREE.HemisphereLight(0xffffff, 0x556070, 0.9));
const sun = new THREE.DirectionalLight(0xffffff, 1.1);
sun.position.set(30, 50, 20);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -50, right: 50, top: 50, bottom: -50, near: 1, far: 150 });
scene.add(sun);

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ---------- 내 총 (화면에 보이는 것) ----------
const gun = new THREE.Group();
const gunMat = new THREE.MeshLambertMaterial({ color: 0x2b2f38 });
const g1 = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.1, 0.5), gunMat); g1.position.set(0, 0, -0.2);
const g2 = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.16, 0.08), gunMat); g2.position.set(0, -0.1, -0.02);
const g3 = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.25), new THREE.MeshLambertMaterial({ color: 0x15171c }));
g3.position.set(0, 0.02, -0.55);
gun.add(g1, g2, g3);
const flash = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 8), new THREE.MeshBasicMaterial({ color: 0xffd060 }));
flash.position.set(0, 0.02, -0.7); flash.visible = false; gun.add(flash);
gun.position.set(0.22, -0.2, -0.35);
camera.add(gun);

// 좀비 손 (화면에 보이는 것)
const claws = new THREE.Group();
const clawMat = new THREE.MeshLambertMaterial({ color: 0x5c9e3e });
for (const sx of [-0.28, 0.28]) {
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.6), clawMat);
  arm.position.set(sx, -0.25, -0.45);
  claws.add(arm);
}
claws.visible = false;
camera.add(claws);
const isZombie = () => mode === 'zombie' && myTeam === 'zombie';
// ---------- 1인칭 / 3인칭 ----------
let thirdPerson = false;
try { thirdPerson = localStorage.getItem('view3') === '1'; } catch { }
let meAv = null; // 3인칭에서 보이는 내 캐릭터
function toggleView() {
  thirdPerson = !thirdPerson;
  try { localStorage.setItem('view3', thirdPerson ? '1' : '0'); } catch { }
  center(thirdPerson ? '👁 3인칭 시점' : '👁 1인칭 시점', 1000);
}
const unarmed = () => mode === 'obby';

// ---------- 맵 만들기 ----------
const OBBY_COLORS = [0xff6b6b, 0xffa94d, 0xffd43b, 0x69db7c, 0x4dabf7, 0x9775fa, 0xf783ac];
function buildObbyMap() {
  scene.background.set(0x8ec9ff); scene.fog.color.set(0x8ec9ff); scene.fog.near = 60; scene.fog.far = 160;
  const voidPlane = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), new THREE.MeshBasicMaterial({ color: 0x3b2f7a }));
  voidPlane.rotation.x = -Math.PI / 2; voidPlane.position.y = -30; scene.add(voidPlane);
  const special = { start: 0x8e9aaf, cp: 0x3ccf6e, goal: 0xffc83d, beam: 0xd9a066, pillar: 0x5b6075 };
  boxes = map.boxes;
  boxes.forEach((b, i) => {
    const w = b.max[0] - b.min[0], h = b.max[1] - b.min[1], d = b.max[2] - b.min[2];
    const color = special[b.kind] ?? OBBY_COLORS[i % OBBY_COLORS.length];
    const mat = b.kind === 'kill' ? new THREE.MeshBasicMaterial({ color: 0xff2a2a }) // 빨간 블록은 빛나게
      : new THREE.MeshLambertMaterial({ color });
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set((b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2);
    m.castShadow = m.receiveShadow = true;
    scene.add(m);
    if (b.kind === 'cp' || b.kind === 'goal') { // 깃발
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.2), new THREE.MeshLambertMaterial({ color: 0xffffff }));
      pole.position.set(m.position.x + w / 2 - 0.5, b.max[1] + 1.1, m.position.z);
      const flag = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.5, 0.8), new THREE.MeshLambertMaterial({ color: b.kind === 'goal' ? 0xff3b3b : 0x2f9e44 }));
      flag.position.set(pole.position.x, b.max[1] + 1.95, m.position.z - 0.4);
      scene.add(pole, flag);
    }
  });
  const top = map.height || 40;
  sun.position.set(35, top + 50, 25); sun.target.position.set(0, top / 2, 0); scene.add(sun.target);
  Object.assign(sun.shadow.camera, { left: -45, right: 45, top: 45, bottom: -45, far: top + 160 });
  sun.shadow.camera.updateProjectionMatrix();
}

// ---------- 맵 그룹 (맵이 바뀌면 통째로 지우고 다시 만들어요) ----------
let mapGroup = new THREE.Group();
scene.add(mapGroup);
let snow = null;
function clearMap() {
  scene.remove(mapGroup);
  mapGroup.traverse(o => { o.geometry?.dispose(); if (o.material) [].concat(o.material).forEach(mm => { mm.map?.dispose(); mm.dispose(); }); });
  mapGroup = new THREE.Group(); scene.add(mapGroup);
  snow = null;
}
const hemi = scene.children.find(o => o.isHemisphereLight);
function applyTheme(xmas) {
  if (xmas) {
    scene.background.set(0x24314f); scene.fog.color.set(0x24314f); scene.fog.near = 30; scene.fog.far = 95;
    if (hemi) { hemi.color.set(0xcfe0ff); hemi.intensity = 0.85; }
    sun.color.set(0xdfe9ff); sun.intensity = 0.8;
    // 내리는 눈
    const N = 2500, pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) { pos[i * 3] = (Math.random() - 0.5) * 90; pos[i * 3 + 1] = Math.random() * 30; pos[i * 3 + 2] = (Math.random() - 0.5) * 90; }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    snow = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.15, transparent: true, opacity: 0.9 }));
    mapGroup.add(snow);
  } else {
    const zombieSky = mode === 'zombie' || mode === 'wave';
    scene.background.set(zombieSky ? 0x6f7f94 : 0x9fc7ee); scene.fog.color.set(zombieSky ? 0x6f7f94 : 0x9fc7ee);
    scene.fog.near = 40; scene.fog.far = 110;
    if (hemi) { hemi.color.set(0xffffff); hemi.intensity = 0.9; }
    sun.color.set(0xffffff); sun.intensity = 1.1;
  }
}
function decorateXmas(b, m, w, h, d) {
  if (b.kind === 'tree') return;
  // 위에 쌓인 눈
  const cap = new THREE.Mesh(new THREE.BoxGeometry(w + 0.08, 0.12, d + 0.08), new THREE.MeshLambertMaterial({ color: 0xffffff }));
  cap.position.set(m.position.x, b.max[1] + 0.06, m.position.z); mapGroup.add(cap);
  if (b.kind === 'crate') { // 선물 상자 리본
    const rib = new THREE.MeshLambertMaterial({ color: 0xffffff });
    const r1 = new THREE.Mesh(new THREE.BoxGeometry(w + 0.02, h + 0.02, 0.18), rib);
    const r2 = new THREE.Mesh(new THREE.BoxGeometry(0.18, h + 0.02, d + 0.02), rib);
    r1.position.copy(m.position); r2.position.copy(m.position); mapGroup.add(r1, r2);
  } else if (h >= 2.5) { // 벽에 꼬마전구
    const colors = [0xff4040, 0xffd84d, 0x4dff88, 0x4dc3ff];
    const long = w > d, len = long ? w : d, n = Math.floor(len / 1.2);
    for (let i = 0; i < n; i++) {
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.09, 6, 5), new THREE.MeshBasicMaterial({ color: colors[i % 4] }));
      const off = -len / 2 + 0.6 + i * 1.2;
      bulb.position.set(m.position.x + (long ? off : 0), b.max[1] - 0.25, m.position.z + (long ? 0 : off));
      if (long) bulb.position.z += (d / 2 + 0.05) * (i % 2 ? 1 : -1); else bulb.position.x += (w / 2 + 0.05) * (i % 2 ? 1 : -1);
      mapGroup.add(bulb);
    }
  }
}
function makeTree(x, z) {
  const g = new THREE.Group();
  const leaf = new THREE.MeshLambertMaterial({ color: 0x1d6b35 });
  [[1.6, 1.6, 1.7], [1.25, 1.4, 2.6], [0.9, 1.2, 3.4]].forEach(([r, h, y]) => {
    const c = new THREE.Mesh(new THREE.ConeGeometry(r, h, 10), leaf); c.position.y = y; c.castShadow = true; g.add(c);
  });
  const trunk = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.6, 0.7), new THREE.MeshLambertMaterial({ color: 0x6b4423 }));
  trunk.position.y = 0.8; g.add(trunk);
  const star = new THREE.Mesh(new THREE.OctahedronGeometry(0.28), new THREE.MeshBasicMaterial({ color: 0xffe14d }));
  star.position.y = 4.15; g.add(star);
  const colors = [0xff3b3b, 0xffd84d, 0x3bb0ff, 0xff7ad9, 0xffffff];
  for (let i = 0; i < 14; i++) {
    const a = i * 2.4, y = 1.3 + (i % 7) * 0.32, r = 1.45 - (y - 1.2) * 0.42;
    const o = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 6), new THREE.MeshBasicMaterial({ color: colors[i % colors.length] }));
    o.position.set(Math.cos(a) * r, y, Math.sin(a) * r); g.add(o);
  }
  g.position.set(x, 0, z);
  return g;
}

function buildMap() {
  if (map.noFloor) return buildObbyMap();
  const S = map.size;
  // 바닥 (격자 무늬)
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d');
  const xmas = map.theme === 'xmas';
  x.fillStyle = xmas ? '#eef4fb' : '#6d8f5a'; x.fillRect(0, 0, 128, 128);
  x.strokeStyle = 'rgba(0,0,0,.15)'; x.lineWidth = 2; x.strokeRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(S, S);
  tex.colorSpace = THREE.SRGBColorSpace;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(S * 2, S * 2), new THREE.MeshLambertMaterial({ map: tex }));
  if (xmas) floor.material.color.set(0xffffff);
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true;
  mapGroup.add(floor);
  // 팀 진영 표시
  for (const [team, z] of [['red', S - 6], ['blue', -S + 6]]) {
    const pad = new THREE.Mesh(new THREE.PlaneGeometry(26, 10),
      new THREE.MeshBasicMaterial({ color: TEAM_COLOR[team], transparent: true, opacity: 0.25 }));
    pad.rotation.x = -Math.PI / 2; pad.position.set(0, 0.01, z);
    mapGroup.add(pad);
  }
  const mats = xmas ? {
    wall: new THREE.MeshLambertMaterial({ color: 0xb8312f }),
    wall2: new THREE.MeshLambertMaterial({ color: 0x1f7a3f }),
    crate: new THREE.MeshLambertMaterial({ color: 0x2f6fd6 }),
    crate2: new THREE.MeshLambertMaterial({ color: 0xe0a92a }),
    tree: new THREE.MeshLambertMaterial({ color: 0x6b4423 }),
  } : {
    wall: new THREE.MeshLambertMaterial({ color: 0xc9c2b4 }),
    crate: new THREE.MeshLambertMaterial({ color: 0xa8743f }),
  };
  applyTheme(xmas);
  boxes = map.boxes;
  for (const b of boxes) {
    const w = b.max[0] - b.min[0], h = b.max[1] - b.min[1], d = b.max[2] - b.min[2];
    const alt = xmas && (Math.round(b.min[0] * 7 + b.min[2] * 3) % 2 === 0) ? '2' : '';
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mats[b.kind + alt] || mats[b.kind] || mats.wall);
    m.position.set((b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2);
    m.castShadow = m.receiveShadow = true;
    mapGroup.add(m);
    if (xmas) decorateXmas(b, m, w, h, d);
    if (b.kind === 'crate' && !xmas) {
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry), new THREE.LineBasicMaterial({ color: 0x5a3a1a }));
      edges.position.copy(m.position); mapGroup.add(edges);
    }
  }
  if (xmas) for (const t of map.trees) mapGroup.add(makeTree(t.x, t.z));
}

// ---------- 다른 플레이어 모습 ----------
function nameSprite(text, color) {
  text = crown(text) + text;
  const c = document.createElement('canvas'); c.width = 256; c.height = 64;
  const x = c.getContext('2d');
  x.font = 'bold 34px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.lineWidth = 6; x.strokeStyle = 'rgba(0,0,0,.7)'; x.strokeText(text, 128, 32);
  x.fillStyle = color; x.fillText(text, 128, 32);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false }));
  s.scale.set(1.6, 0.4, 1); s.position.y = 2.6; s.renderOrder = 10;
  return s;
}
// ---------- 블록 캐릭터 (avatar.js) ----------
function makeAvatar(name, team, look = []) {
  const teamColor = team === 'red' || team === 'blue' ? TEAM_COLOR[team] : undefined; // 팀전만 팀 색 옷
  const { inner, arm, body, wings, tail, legs } = buildCharacter(look, { zombie: team === 'zombie', teamColor });
  const label = nameSprite(name, TEAM_CSS[team] || '#fff');
  label.position.y = 2.55;
  const grp = new THREE.Group(); grp.add(inner, label);
  return { group: grp, inner, arm, label, body, wings, tail, legs, team, look: look.join(','), swing: 0, walk: 0, phase: Math.random() * 6 };
}
function syncOthers(list) {
  const seen = new Set();
  for (const p of list) {
    if (p.id === myId) continue;
    seen.add(p.id);
    let o = others.get(p.id);
    const lk = (p.lk || []).join(',');
    if (!o || o.team !== p.tm || o.look !== lk) {
      const old = o;
      if (old) scene.remove(old.group);
      o = makeAvatar(p.n, p.tm, p.lk || undefined);
      if (p.id >= 1000000) o.label.visible = false; // 봇 좀비는 이름표 없음
      if (old) { o.group.position.copy(old.group.position); o.group.rotation.y = old.group.rotation.y; }
      else o.group.position.set(p.x, p.y, p.z);
      scene.add(o.group); others.set(p.id, o);
    }
    o.tx = p.x; o.ty = p.y; o.tz = p.z; o.tyaw = p.yw; o.tpitch = p.pt; o.alive = p.a;
  }
  for (const [id, o] of others) if (!seen.has(id)) { scene.remove(o.group); others.delete(id); }
}
function lerpAngle(a, b, t) {
  let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
  return a + d * t;
}

// ---------- 총알 궤적 ----------
const tracers = [];
function tracer(o, e, mine) {
  const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...o), new THREE.Vector3(...e)]);
  const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: mine ? 0xfff3a0 : 0xffc060, transparent: true, opacity: 0.9 }));
  scene.add(line); tracers.push({ line, life: 0.08 });
  const spark = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 6), new THREE.MeshBasicMaterial({ color: 0xffe080 }));
  spark.position.set(...e); scene.add(spark); tracers.push({ line: spark, life: 0.12 });
}

// ---------- 충돌 ----------
function hitBox(px, py, pz) {
  for (const b of boxes) {
    if (px + R > b.min[0] && px - R < b.max[0] && py + H > b.min[1] && py < b.max[1] && pz + R > b.min[2] && pz - R < b.max[2]) return b;
  }
  return null;
}

// ---------- 입력 ----------
const canvas = renderer.domElement;
let touchActive = false;  // 폰/태블릿에서 게임 중인지
let chatOpen = false;
const locked = () => document.pointerLockElement === canvas;
const controlsOn = () => (locked() || touchActive) && !chatOpen;

async function goLandscape() {
  try { await document.documentElement.requestFullscreen?.({ navigationUI: 'hide' }); } catch { }
  try { await screen.orientation?.lock?.('landscape'); } catch { }
}
function startPlaying() {
  if (ended) return;
  if (IS_TOUCH) {
    touchActive = true;
    $('overlay').classList.add('hide');
    document.body.classList.add('touching');
    goLandscape();
  } else canvas.requestPointerLock();
}
$('overlay').addEventListener('click', startPlaying);
canvas.addEventListener('click', () => { if (!IS_TOUCH && !locked()) canvas.requestPointerLock(); });
document.addEventListener('pointerlockchange', () => {
  if (ended || IS_TOUCH) return;
  if (!locked() && chatOpen) return; // 채팅 입력 중에는 메뉴를 띄우지 않기
  $('overlay').classList.toggle('hide', locked());
  if (!locked()) mouseDown = false;
});
$('btn-menu').addEventListener('click', () => {
  touchActive = false; mouseDown = false;
  document.body.classList.remove('touching');
  $('overlay').classList.remove('hide');
});

// ---------- 터치 조작 (폰/태블릿) ----------
const joy = { id: null, x: 0, y: 0, cx: 0, cy: 0 };
let lookId = null, lookX = 0, lookY = 0, touchJump = false;
const JOY_R = 55;
function setKnob() { $('joy-knob').style.transform = `translate(${joy.x * JOY_R}px, ${joy.y * JOY_R}px)`; }
$('joy').addEventListener('touchstart', e => {
  e.preventDefault();
  const t = e.changedTouches[0], r = $('joy').getBoundingClientRect();
  joy.id = t.identifier; joy.cx = r.left + r.width / 2; joy.cy = r.top + r.height / 2;
  moveJoy(t);
}, { passive: false });
function moveJoy(t) {
  let dx = (t.clientX - joy.cx) / JOY_R, dy = (t.clientY - joy.cy) / JOY_R;
  const l = Math.hypot(dx, dy); if (l > 1) { dx /= l; dy /= l; }
  joy.x = dx; joy.y = dy; setKnob();
}
document.addEventListener('touchmove', e => {
  if (!touchActive) return;
  for (const t of e.changedTouches) {
    if (t.identifier === joy.id) moveJoy(t);
    else if (t.identifier === lookId) {
      me.yaw -= (t.clientX - lookX) * 0.006;
      me.pitch -= (t.clientY - lookY) * 0.006;
      me.pitch = Math.max(-1.5, Math.min(1.5, me.pitch));
      lookX = t.clientX; lookY = t.clientY;
    }
  }
  e.preventDefault();
}, { passive: false });
function endTouch(e) {
  for (const t of e.changedTouches) {
    if (t.identifier === joy.id) { joy.id = null; joy.x = joy.y = 0; setKnob(); }
    if (t.identifier === lookId) lookId = null;
  }
}
document.addEventListener('touchend', endTouch);
document.addEventListener('touchcancel', endTouch);
// 화면 오른쪽을 드래그하면 둘러보기
canvas.addEventListener('touchstart', e => {
  if (!touchActive) return;
  for (const t of e.changedTouches) {
    if (lookId === null && t.clientX > innerWidth * 0.35) { lookId = t.identifier; lookX = t.clientX; lookY = t.clientY; }
  }
  e.preventDefault();
}, { passive: false });
function holdButton(id, down, up) {
  const el = $(id);
  el.addEventListener('touchstart', e => { e.preventDefault(); e.stopPropagation(); el.classList.add('down'); down(); }, { passive: false });
  el.addEventListener('touchend', e => { e.preventDefault(); el.classList.remove('down'); up && up(); }, { passive: false });
  el.addEventListener('touchcancel', () => { el.classList.remove('down'); up && up(); });
}
holdButton('btn-fire', () => { if (isZombie()) attack(); else if (!unarmed()) mouseDown = true; }, () => (mouseDown = false));
holdButton('btn-jump', () => (touchJump = true), () => (touchJump = false));
holdButton('btn-reload', () => reload());
holdButton('btn-chat', () => openChat(false));
holdButton('btn-view', () => toggleView());
holdButton('btn-board', () => { $('board').style.display = 'block'; renderBoard(); }, () => ($('board').style.display = 'none'));

// ---------- 채팅 ----------
let chatTeam = false;
function openChat(team) {
  if (ended) return;
  chatOpen = true; chatTeam = team && mode !== 'obby';
  for (const k in keys) keys[k] = false;
  mouseDown = false;
  $('chatform').style.display = 'flex';
  $('chatmode').textContent = chatTeam ? '팀' : '전체';
  $('chatmode').className = chatTeam ? 'team' : '';
  $('chatlog').classList.add('open');
  $('chatinput').value = '';
  $('chatinput').focus();
}
function closeChat() {
  chatOpen = false;
  $('chatform').style.display = 'none';
  $('chatlog').classList.remove('open');
  $('chatinput').blur();
  if (!IS_TOUCH && !locked() && !ended) canvas.requestPointerLock();
}
$('chatform').addEventListener('submit', e => {
  e.preventDefault();
  const text = $('chatinput').value.trim();
  if (text) send({ t: 'chat', text, team: chatTeam });
  closeChat();
});
$('chatinput').addEventListener('keydown', e => {
  if (e.key === 'Escape') { e.preventDefault(); closeChat(); }
  e.stopPropagation();
});
$('chatmode').addEventListener('click', () => {
  if (mode === 'obby') return;
  chatTeam = !chatTeam;
  $('chatmode').textContent = chatTeam ? '팀' : '전체';
  $('chatmode').className = chatTeam ? 'team' : '';
  $('chatinput').focus();
});
// ---------- 맵 투표 ----------
let voteState = null, myVote = null;
function renderVote() {
  const box = $('votebox');
  if (!voteState || mode === 'obby') { box.style.display = 'none'; return; }
  box.style.display = 'block';
  const next = voteState.maps.find(m => m.id === voteState.next);
  const isAdmin = crown(myName) !== '';
  box.innerHTML = `<div class="vt">🗳️ 다음 맵: <b>${next.icon} ${next.name}</b>${voteState.adminPick ? ' <span class="ad">👑 관리자 결정</span>' : ''}</div>` +
    voteState.maps.map((m, i) => `<div class="vo ${myVote === m.id ? 'mine' : ''}" data-id="${m.id}">${IS_TOUCH ? '' : `<kbd>${i + 1}</kbd> `}${m.icon} ${m.name} · ${m.count}표${m.id === voteState.current ? ' (지금)' : ''}</div>`).join('') +
    `<div class="vh">${isAdmin ? '👑 관리자가 고르면 그 맵으로 정해져요' : '다음 라운드에 다수결로 바뀌어요'}</div>`;
  box.querySelectorAll('.vo').forEach(el => el.onclick = () => vote(el.dataset.id));
}
function vote(id) {
  if (mode === 'obby' || !voteState) return;
  myVote = id; send({ t: 'vote', map: id }); renderVote();
}

function addChat(html, cls = '') {
  const d = document.createElement('div');
  d.className = 'line ' + cls; d.innerHTML = html;
  $('chatlog').append(d);
  while ($('chatlog').children.length > 30) $('chatlog').firstChild.remove();
  $('chatlog').scrollTop = 1e6;
  setTimeout(() => d.classList.add('old'), 9000);
}
document.addEventListener('mousemove', e => {
  if (!locked()) return;
  me.yaw -= e.movementX * 0.0022;
  me.pitch -= e.movementY * 0.0022;
  me.pitch = Math.max(-1.5, Math.min(1.5, me.pitch));
});
document.addEventListener('mousedown', e => {
  if (!locked() || chatOpen || e.button !== 0) return;
  if (isZombie()) attack(); else if (!unarmed()) mouseDown = true;
});
document.addEventListener('mouseup', e => { if (e.button === 0) mouseDown = false; });
document.addEventListener('keydown', e => {
  if (chatOpen || ended) return;
  if ((e.code === 'Enter' || e.code === 'KeyT') && (locked() || touchActive)) { e.preventDefault(); openChat(e.code === 'KeyT'); return; }
  keys[e.code] = true;
  if (e.code === 'Tab') { e.preventDefault(); $('board').style.display = 'block'; renderBoard(); }
  if (e.code === 'KeyR') reload();
  if (e.code === 'KeyV') toggleView();
  if (/^Digit[1-9]$/.test(e.code) && voteState) { const m = voteState.maps[+e.code.slice(5) - 1]; if (m) vote(m.id); }
});
document.addEventListener('keyup', e => {
  keys[e.code] = false;
  if (e.code === 'Tab') $('board').style.display = 'none';
});

function attack() {
  const t = performance.now();
  if (!me.alive || t - lastAttack < cfg.attackMs) return;
  lastAttack = t; swing = 1;
  send({ t: 'attack' });
}

function reload() {
  if (isZombie() || unarmed()) return;
  if (reloadUntil || ammo >= cfg.mag || !me.alive) return;
  reloadUntil = performance.now() + cfg.reloadMs;
  send({ t: 'reload' });
}

// ---------- 사격 ----------
const ray = new THREE.Raycaster();
function fire() {
  const t = performance.now();
  if (!me.alive || isZombie() || unarmed() || reloadUntil || t - lastFire < cfg.fireMs) return;
  if (ammo <= 0) { reload(); return; }
  lastFire = t; ammo--;
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  if (thirdPerson) { // 3인칭: 화면 가운데 조준점이 가리키는 곳으로 쏘기
    const target = camera.position.clone().addScaledVector(dir, 40);
    dir.copy(target).sub(new THREE.Vector3(me.x, me.y + EYE, me.z)).normalize();
  }
  send({ t: 'shoot', dx: dir.x, dy: dir.y, dz: dir.z });
  flash.visible = true; setTimeout(() => (flash.visible = false), 40);
  recoil = 0.06;
  me.pitch = Math.min(1.5, me.pitch + 0.012);
  if (ammo === 0) reload();
}

// ---------- 네트워크 ----------
function send(m) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(m)); }
let ended = false;
function endGame(title, text) {
  ended = true; touchActive = false;
  document.body.classList.remove('touching');
  document.exitPointerLock?.();
  $('overlay').classList.remove('hide');
  $('ov-title').textContent = title;
  $('ov-text').innerHTML = text + '<br><br><a href="/" style="color:#6fb5ff">처음 화면으로</a>';
}

function feed(html) {
  const d = document.createElement('div'); d.innerHTML = html;
  $('feed').prepend(d);
  while ($('feed').children.length > 6) $('feed').lastChild.remove();
  setTimeout(() => d.remove(), 6000);
}
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cls = t => ({ red: 'r', blue: 'b', human: 'b', zombie: 'z' }[t] || '');
let centerTimer;
function center(text, ms, html) {
  if (html) $('center').innerHTML = text; else $('center').textContent = text;
  clearTimeout(centerTimer);
  if (ms) centerTimer = setTimeout(() => ($('center').textContent = ''), ms);
}
function setTeamUI() {
  $('teamtag').textContent = `${crown(myName)}${myName} · ${TEAM_NAME[myTeam]}${myTeam === 'zombie' ? ' 🧟' : ''}`;
  $('teamtag').style.color = TEAM_CSS[myTeam];
  me.maxHp = myTeam === 'zombie' ? cfg.zombieHp : cfg.maxHp;
  gun.visible = !isZombie() && !unarmed(); claws.visible = isZombie();
  $('ammo').style.display = isZombie() || unarmed() ? 'none' : 'block';
  $('hpbar').style.display = $('hptext').style.display = unarmed() ? 'none' : '';
  $('btn-fire').textContent = isZombie() ? '🧟' : '🔫';
  $('btn-fire').style.display = $('btn-reload').style.display = unarmed() ? 'none' : '';
  if (isZombie()) $('btn-reload').style.display = 'none';
  if (isZombie() || unarmed()) mouseDown = false;
}
const fmtTime = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
const PHASE_TEXT = { waiting: '2명 이상 모이면 시작해요', countdown: '곧 시작!', playing: '', ended: '라운드 끝' };
let cpInfo = { i: 0, total: 4 };

function onMessage(m) {
  switch (m.t) {
    case 'welcome':
      myId = m.id; myTeam = m.team; myName = m.name; cfg = m.cfg; map = m.map; mode = m.mode; adminName = m.adminName || '';
      ammo = cfg.mag;
      buildMap(); setTeamUI();
      document.title = m.roomTitle;
      cpInfo = { i: 0, total: (map.checkpoints?.length || 5) - 1 };
      if (IS_TOUCH) {
        $('ov-text').innerHTML = `왼쪽 조이스틱: 이동 &nbsp; 오른쪽 화면 드래그: 둘러보기<br>⬆️ 점프 &nbsp; 🔫 사격 &nbsp; 🔄 재장전 &nbsp; 💬 채팅 &nbsp; 📋 점수판 &nbsp; 👁 1인칭/3인칭<br>폰은 가로로 돌려서 하면 좋아요`;
      } else {
        $('ov-text').innerHTML += `<br><kbd>Enter</kbd> 전체 채팅 &nbsp; <kbd>T</kbd> 팀 채팅`;
      }
      const tapWord = IS_TOUCH ? '화면을 눌러서 시작' : '클릭해서 시작';
      if (mode === 'zombie') {
        $('ov-title').textContent = '🧟 좀비 모드 · ' + tapWord;
        $('ov-text').innerHTML = `인간: 총으로 좀비를 막고 3분 동안 살아남기<br>좀비: ${IS_TOUCH ? '🧟 버튼' : '<kbd>왼쪽 클릭</kbd>'}으로 인간을 잡아서 좀비로 만들기<br><br>` + $('ov-text').innerHTML;
      } else if (mode === 'wave') {
        $('ov-title').textContent = '🧟‍♂️ 좀비 웨이브 · ' + tapWord;
        $('ov-text').innerHTML = `몰려오는 좀비 떼를 총으로 막아요! 웨이브를 깰 때마다 🪙 5코인, 5웨이브마다 🏆 트로피<br>쓰러지면 다음 웨이브에 부활 · 모두 쓰러지면 게임 오버<br><br>` + $('ov-text').innerHTML;
      } else if (mode === 'obby') {
        $('ov-title').textContent = '🗼 점프 타워 · ' + tapWord;
        $('ov-text').innerHTML = `빙글빙글 타워를 올라 꼭대기 🏁에 먼저 닿으면 승리!<br>🔥 빨간 블록은 밟으면 아웃 · 많이 떨어지면 🚩 체크포인트에서 다시 시작<br><br>` + $('ov-text').innerHTML;
      } else {
        $('ov-title').textContent = tapWord;
        center(`${TEAM_NAME[myTeam]}이에요!`, 2500);
      }
      break;
    case 'chat': {
      const tag = m.scope === 'team' ? '<span class="tag">[팀]</span> ' : '';
      addChat(`${tag}<b style="color:${TEAM_CSS[m.team] || '#fff'}">${crown(m.from)}${esc(m.from)}</b>: ${esc(m.text)}`, m.scope === 'team' ? 'team' : '');
      break;
    }
    case 'notice':
      addChat(`⚠️ ${esc(m.text)}`, 'sys');
      break;
    case 'map':
      map = m.map; clearMap(); buildMap();
      center(`🗺️ 맵이 바뀌었어요: ${m.name}`, 3000);
      break;
    case 'vote':
      voteState = m; renderVote();
      break;
    case 'checkpoint':
      cpInfo = { i: m.i, total: m.total };
      center(`🚩 체크포인트 ${m.i}/${m.total}!`, 1500);
      break;
    case 'obbywin':
      center(m.name ? `🏆 ${m.name} 1등! (${m.time}초)${m.name === myName ? ' 축하해요!' : ''}` : '⏰ 시간 끝! 아무도 골인하지 못했어요', 7000);
      break;
    case 'fell':
      center('떨어졌어요! 체크포인트에서 다시 시작 🚩', 1500);
      break;
    case 'zap':
      center('🔥 앗 뜨거! 빨간 블록은 밟으면 안 돼요', 1500);
      break;
    case 'practice':
      center('🏁 타워 클리어! 🪙 +20 코인 (2명 이상이면 1등에게 🏆 트로피도!)', 4000);
      cpInfo.i = 0;
      break;
    case 'coins':
      $('coinbox').textContent = '🪙 ' + (m.inf ? '∞' : m.coins);
      if (m.trophy) setTimeout(() => center(`🏆 +${m.trophy} 트로피${m.delta > 0 ? ` · 🪙 +${m.delta} 코인` : ''}!`, 3000), 2500);
      else if (m.delta > 0) setTimeout(() => center(`🪙 +${m.delta} 코인!`, 2500), 2500);
      break;
    case 'me':
      $('coinbox').textContent = '🪙 ' + (m.inf ? '∞' : m.coins);
      break;
    case 'role':
      myTeam = m.role; setTeamUI();
      if (mode === 'zombie' && myTeam === 'zombie') center('🧟 좀비가 됐어요! 인간을 잡으세요!', 3000);
      else if (mode === 'fps') center(`${TEAM_NAME[myTeam]}으로 옮겨졌어요`, 2500);
      break;
    case 'phase':
      if (mode === 'wave') {
        if (m.phase === 'break' && !roomInfo.wv) center('🧟‍♂️ 곧 좀비가 몰려와요! 준비하세요', 3000);
        break;
      }
      if (mode === 'obby') {
        if (m.phase === 'countdown') { cpInfo.i = 0; center('🏁 출발선에서 기다려요! 10초 뒤 출발', 3000); }
        if (m.phase === 'playing') center('출발! 🏃💨', 1500);
        if (m.phase === 'waiting') center('2명 이상 모이면 경주가 시작돼요 (지금은 연습)', 3000);
        break;
      }
      if (m.phase === 'countdown') center('곧 시작해요!', 2000);
      if (m.phase === 'waiting') center('2명 이상 모이면 시작해요', 2500);
      break;
    case 'wave':
      center(`🌊 웨이브 ${m.n} 시작! 좀비 ${m.count}마리`, 2500);
      break;
    case 'waveClear':
      center(`✅ 웨이브 ${m.n} 클리어!${m.record ? ' 🏆 새 최고 기록!' : ''}`, 2400);
      break;
    case 'wavedead':
      center('쓰러졌어요! 다음 웨이브에 부활해요 💫', 0);
      break;
    case 'gameover': {
      const best = m.best ? `<br>🏆 최고 기록: 웨이브 ${m.best.wave} (${m.best.names.map(esc).join(', ')})` : '';
      const top = (m.top || []).slice(0, 5).map(x => `${esc(x.n)} ${x.k}킬`).join(' · ');
      center(`💀 게임 오버! 웨이브 ${m.wave}까지 버텼어요${top ? '<br>' + top : ''}${best}<br>곧 웨이브 1부터 다시 시작해요`, 7500, true);
      break;
    }
    case 'zstart':
      center(myTeam === 'zombie' ? '🧟 당신이 첫 좀비예요! 인간을 잡으세요!' : `🧟 좀비 등장: ${m.zombies.join(', ')} · 도망쳐요!`, 3500);
      break;
    case 'infect':
      feed(`<span class="z">${esc(m.zombie)}</span> 🧟 <span class="b">${esc(m.human)}</span> 감염`);
      if (m.zombie === myName) center('잡았다! 🧟', 900);
      break;
    case 'swing': {
      const o = others.get(m.id); if (o) o.swing = 1;
      break;
    }
    case 'respawn':
      Object.assign(me, { x: m.x, y: m.y, z: m.z, yaw: m.yaw, pitch: 0, vy: 0, alive: true, hp: m.hp ?? cfg.maxHp });
      ammo = cfg.mag; reloadUntil = 0;
      if (/부활|일어나요/.test($('center').textContent)) center('', 0);
      break;
    case 'correct':
      me.x = m.x; me.y = m.y; me.z = m.z; me.vy = 0;
      break;
    case 'roster': { // 명단 (이름, 팀, 꾸미기, 킬/데스) - 바뀔 때만 와요
      const ids = new Set();
      for (const r of m.p) {
        ids.add(r.id);
        const p = roomPlayers.get(r.id) || { x: 0, y: 0, z: 0, yw: 0, pt: 0, hp: 100, a: 1 };
        Object.assign(p, r);
        roomPlayers.set(r.id, p);
      }
      for (const id of [...roomPlayers.keys()]) if (!ids.has(id)) roomPlayers.delete(id);
      return onMessage({ t: 'state', p: [] }); // 화면 바로 갱신
    }
    case 'state': {
      // 짧은 숫자 배열을 풀어서 합치기
      for (const [id, x, y, z, yw, pt, hp, a] of m.p) {
        const p = roomPlayers.get(id);
        if (!p) continue;
        Object.assign(p, { x: x / 100, y: y / 100, z: z / 100, yw: yw / 1000, pt: pt / 1000, hp, a });
      }
      for (const k of ['s', 'target', 'ph', 'w', 'tl', 'wv', 'zl']) if (m[k] !== undefined) roomInfo[k] = m[k];
      m = { ...roomInfo, t: 'state', p: [...roomPlayers.values()] };
      if (mode === 'fps' && !m.s) break;
    }
      lastState = m;
      if (mode === 'fps') {
        $('sc-r').textContent = m.s.red; $('sc-b').textContent = m.s.blue; $('sc-t').textContent = `목표 ${m.target}`;
      } else if (mode === 'wave') {
        $('sc-r').textContent = `🌊 ${m.wv || 0}`; $('sc-r').style.color = '#6fb5ff';
        $('sc-b').textContent = `🧟 ${m.zl || 0}`; $('sc-b').style.color = '#7fe05a';
        $('sc-t').textContent = m.ph === 'wave' ? `웨이브 ${m.wv} · 남은 좀비 ${m.zl}` : m.ph === 'break' ? `다음 웨이브까지 ${m.tl}초` : m.ph === 'over' ? '게임 오버' : '';
      } else if (mode === 'obby') {
        $('sc-r').textContent = `🏃 ${m.p.length}`; $('sc-r').style.color = '#ffb14d';
        $('sc-b').textContent = `🚩 ${cpInfo.i}/${cpInfo.total}`; $('sc-b').style.color = '#69db7c';
        $('sc-t').textContent = m.ph === 'playing' ? `⏱ ${fmtTime(m.tl)}` : m.ph === 'countdown' ? `출발까지 ${m.tl}초` : m.ph === 'waiting' ? '연습 중 · 2명 모이면 시작' : PHASE_TEXT[m.ph];
      } else {
        const humans = m.p.filter(p => p.tm === 'human').length, zombies = m.p.length - humans;
        $('sc-r').textContent = `🧑 ${humans}`; $('sc-r').style.color = '#6fb5ff';
        $('sc-b').textContent = `🧟 ${zombies}`; $('sc-b').style.color = '#7fe05a';
        $('sc-t').textContent = m.ph === 'playing' ? `⏱ ${fmtTime(m.tl)}` : m.ph === 'countdown' ? `시작까지 ${m.tl}초` : PHASE_TEXT[m.ph] || '';
      }
      syncOthers(m.p);
      for (const p of m.p) if (p.id === myId) {
        const lk = (p.lk || []).join(',');
        if (!meAv || meAv.team !== p.tm || meAv.look !== lk) {
          if (meAv) scene.remove(meAv.group);
          meAv = makeAvatar(p.n, p.tm, p.lk || undefined);
          meAv.label.visible = false;
          scene.add(meAv.group);
        }
        if (me.alive && !p.a) { me.alive = false; if (mode !== 'wave') center(mode === 'zombie' ? '쓰러졌어요! 3초 후 다시 일어나요' : '죽었어요! 3초 후 부활', 0); }
        me.hp = p.hp;
      }
      if ($('board').style.display === 'block') renderBoard();
      break;
    case 'shot':
      tracer(m.id === myId ? [me.x, me.y + EYE - 0.15, me.z] : m.o, m.e, m.id === myId);
      break;
    case 'hurt': {
      const d = $('dmg'); d.style.opacity = 1; setTimeout(() => (d.style.opacity = 0), 150);
      break;
    }
    case 'hitmark': {
      const h = $('hitmark'); h.className = m.kill ? 'kill' : m.head ? 'head' : '';
      h.style.opacity = 1; setTimeout(() => (h.style.opacity = 0), 120);
      break;
    }
    case 'kill':
      feed(`<span class="${cls(m.kteam)}">${esc(m.killer)}</span> ${m.head ? '🎯' : '🔫'} <span class="${cls(m.vteam)}">${esc(m.victim)}</span>`);
      if (m.killer === myName) center(m.head ? '헤드샷 킬!' : '킬!', 900);
      break;
    case 'win':
      if (mode === 'zombie') {
        center(m.team === 'human' ? '🧑 인간 승리! 끝까지 살아남았어요 🎉' : m.team === 'zombie' ? '🧟 좀비 승리! 모두 감염됐어요' : '인원이 부족해서 라운드가 끝났어요', 6000);
      } else center(`${TEAM_NAME[m.team]} 승리! 🎉 곧 다음 라운드`, 0);
      break;
    case 'round':
      center('새 라운드 시작!', 2000);
      break;
    case 'joined': feed(`${esc(m.name)} 님이 들어왔어요`); break;
    case 'left': feed(`${esc(m.name)} 님이 나갔어요`); break;
    case 'announce': {
      const a = $('announce'); a.textContent = '📢 ' + m.text; a.style.display = 'block';
      clearTimeout(a._t); a._t = setTimeout(() => (a.style.display = 'none'), 7000);
      break;
    }
    case 'kicked':
      sessionStorage.removeItem('token');
      endGame('게임에서 나가졌어요', esc(m.reason));
      break;
  }
}

function renderBoard() {
  if (!lastState) return;
  if (mode === 'obby') {
    const rows = [...lastState.p].sort((a, b) => b.c - a.c)
      .map(p => `<tr class="${p.id === myId ? 'me' : ''}"><td>${crown(p.n)}${esc(p.n)}</td><td>🚩 ${p.c}/${cpInfo.total}</td></tr>`).join('');
    $('board').innerHTML = `<div style="color:#ffb14d;font-weight:800;margin:6px 0">🗼 점프 타워 순위</div><table><tr><th>이름</th><th>체크포인트</th></tr>${rows}</table>`;
    return;
  }
  if (mode === 'wave') {
    const rows = lastState.p.filter(p => p.tm === 'human').sort((a, b) => b.k - a.k)
      .map(p => `<tr class="${p.id === myId ? 'me' : ''}"><td>${crown(p.n)}${esc(p.n)}</td><td>${p.k}</td><td>${p.d}</td></tr>`).join('');
    $('board').innerHTML = `<div style="color:#7fe05a;font-weight:800;margin:6px 0">🧟‍♂️ 좀비 웨이브 — 웨이브 ${lastState.wv || 0}</div><table><tr><th>이름</th><th>처치</th><th>쓰러짐</th></tr>${rows}</table>`;
    return;
  }
  const teams = mode === 'fps' ? ['red', 'blue'] : ['human', 'zombie'];
  const rows = team => lastState.p.filter(p => p.tm === team).sort((a, b) => b.k - a.k)
    .map(p => `<tr class="${p.id === myId ? 'me' : ''}"><td>${crown(p.n)}${esc(p.n)}</td><td>${p.k}</td><td>${p.d}</td></tr>`).join('');
  const head = t => mode === 'fps' ? `${TEAM_NAME[t]} — ${lastState.s[t]}점` : `${TEAM_NAME[t]} — 승리 ${lastState.w[t]}번`;
  $('board').innerHTML = teams.map(t => `
    <div style="color:${TEAM_CSS[t]};font-weight:800;margin:6px 0">${head(t)}</div>
    <table><tr><th>이름</th><th>${mode === 'fps' ? '킬' : t === 'zombie' ? '감염' : '처치'}</th><th>데스</th></tr>${rows(t)}</table>`).join('');
}

// ---------- 매 프레임 ----------
const clock = new THREE.Clock();
let sendAcc = 0;
function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, clock.getDelta());
  const t = performance.now();

  if (reloadUntil && t >= reloadUntil) { ammo = cfg.mag; reloadUntil = 0; }
  if (mouseDown) fire();

  if (map && me.alive) {
    // 이동
    let speed = keys.ShiftLeft || keys.ShiftRight ? WALK : isZombie() ? 7.3 : RUN;
    let fx = 0, fz = 0;
    if (controlsOn()) {
      if (keys.KeyW) fz -= 1; if (keys.KeyS) fz += 1;
      if (keys.KeyA) fx -= 1; if (keys.KeyD) fx += 1;
      if (joy.id !== null && Math.hypot(joy.x, joy.y) > 0.15) {
        fx = joy.x; fz = joy.y;
        speed *= Math.min(1, Math.hypot(joy.x, joy.y) * 1.2); // 조금만 밀면 천천히
      }
    }
    const len = Math.hypot(fx, fz) || 1;
    const sin = Math.sin(me.yaw), cos = Math.cos(me.yaw);
    const mx = ((fx * cos + fz * sin) / len) * speed * dt;
    const mz = ((-fx * sin + fz * cos) / len) * speed * dt;
    if (!hitBox(me.x + mx, me.y, me.z)) me.x += mx;
    if (!hitBox(me.x, me.y, me.z + mz)) me.z += mz;
    // 점프 / 중력
    if (controlsOn() && (keys.Space || touchJump) && me.onGround) { me.vy = JUMP; me.onGround = false; }
    me.vy -= GRAV * dt;
    let ny = me.y + me.vy * dt;
    me.onGround = false;
    if (!map.noFloor && ny <= 0) { ny = 0; me.vy = 0; me.onGround = true; }
    if (ny < -40) { ny = -40; me.vy = 0; } // 아주 깊이 떨어지면 멈추고 서버가 되살려 줄 때까지 기다리기
    const b = hitBox(me.x, ny, me.z);
    if (b) {
      if (me.vy <= 0) { ny = b.max[1]; me.onGround = true; } else { ny = b.min[1] - H; }
      me.vy = 0;
    }
    me.y = ny;

    sendAcc += dt;
    if (sendAcc >= 0.066) { // 1초에 15번
      sendAcc = 0;
      send({ t: 'move', x: +me.x.toFixed(3), y: +me.y.toFixed(3), z: +me.z.toFixed(3), yaw: me.yaw, pitch: me.pitch });
    }
  }

  // 카메라
  const eye = new THREE.Vector3(me.x, me.y + (me.alive ? EYE : 0.4), me.z);
  camera.rotation.set(me.pitch, me.yaw, me.alive || thirdPerson ? 0 : 0.5);
  const tp = thirdPerson && map;
  if (tp) {
    // 어깨 뒤에서 보기 (오른쪽 0.6, 위 0.35, 뒤 3.2). 벽에 막히면 가까이 당겨요
    const back = new THREE.Vector3(0.6, 0.35, 3.2).applyEuler(camera.rotation);
    let f = 1;
    for (let s = 1; s <= 16; s++) {
      const k = s / 16, px = eye.x + back.x * k, py = eye.y + back.y * k, pz = eye.z + back.z * k;
      if ((!map.noFloor && py < 0.15) || boxes.some(b => px > b.min[0] - 0.15 && px < b.max[0] + 0.15 && py > b.min[1] - 0.15 && py < b.max[1] + 0.15 && pz > b.min[2] - 0.15 && pz < b.max[2] + 0.15)) {
        f = Math.max(0.1, (s - 1) / 16); break;
      }
    }
    camera.position.copy(eye).addScaledVector(back, f);
  } else camera.position.copy(eye);
  gun.visible = !tp && me.alive && !isZombie() && !unarmed();
  claws.visible = !tp && me.alive && isZombie();
  if (meAv) {
    meAv.group.visible = !!tp;
    if (tp) {
      const mp = meAv.group.position;
      const moving = Math.hypot(me.x - mp.x, me.z - mp.z) > 0.005;
      mp.set(me.x, me.y, me.z);
      meAv.group.rotation.y = me.yaw;
      meAv.group.rotation.z = me.alive ? 0 : Math.PI / 2;
      meAv.walk = moving ? meAv.walk + dt * 12 : 0;
      meAv.inner.position.y = moving ? Math.abs(Math.sin(meAv.walk)) * 0.03 : 0;
      if (meAv.legs) meAv.legs.forEach((l, i) => (l.rotation.x = moving ? Math.sin(meAv.walk) * (i ? -0.7 : 0.7) : 0)); // 다리 앞뒤로
      meAv.arm.rotation.x = me.pitch - Math.sin(swing * Math.PI) * 0.8;
      animateExtras(meAv, t, meAv.phase);
    }
  }
  recoil *= 0.8;
  gun.position.z = -0.35 + recoil;
  swing = Math.max(0, swing - dt * 5);
  claws.position.z = -Math.sin(swing * Math.PI) * 0.35;
  claws.rotation.x = -Math.sin(swing * Math.PI) * 0.5;

  // 다른 플레이어 부드럽게 움직이기
  const k = Math.min(1, dt * 15);
  for (const o of others.values()) {
    const p = o.group.position;
    p.x += (o.tx - p.x) * k; p.y += (o.ty - p.y) * k; p.z += (o.tz - p.z) * k;
    o.group.rotation.y = lerpAngle(o.group.rotation.y, o.tyaw, k);
    o.swing = Math.max(0, o.swing - dt * 5);
    o.arm.rotation.x = o.tpitch - Math.sin(o.swing * Math.PI) * 0.8;
    animateExtras(o, t, o.phase);
    o.group.rotation.z = o.alive ? 0 : Math.PI / 2;
    // 움직이면 통통 튀기
    const moving = Math.hypot(o.tx - p.x, o.tz - p.z) > 0.03;
    o.walk = moving ? o.walk + dt * 12 : 0;
    o.inner.position.y = moving ? Math.abs(Math.sin(o.walk)) * 0.03 : o.inner.position.y * 0.8;
    if (o.legs) o.legs.forEach((l, i) => (l.rotation.x = moving ? Math.sin(o.walk) * (i ? -0.7 : 0.7) : l.rotation.x * 0.8));
    o.inner.rotation.z = moving ? Math.sin(o.walk) * 0.06 : 0;
    o.label.visible = o.alive && o.team === myTeam || o.alive && p.distanceTo(camera.position) < 25;
  }

  // 눈 내리기
  if (snow) {
    const a = snow.geometry.attributes.position;
    for (let i = 0; i < a.count; i++) {
      let y = a.getY(i) - dt * 2.2;
      if (y < 0) y += 30;
      a.setY(i, y);
      a.setX(i, a.getX(i) + Math.sin(t * 0.001 + i) * dt * 0.3);
    }
    a.needsUpdate = true;
    snow.position.set(Math.round(me.x / 10) * 10, 0, Math.round(me.z / 10) * 10);
  }

  // 총알 궤적 사라지기
  for (let i = tracers.length - 1; i >= 0; i--) {
    tracers[i].life -= dt;
    if (tracers[i].life <= 0) { scene.remove(tracers[i].line); tracers[i].line.geometry.dispose(); tracers.splice(i, 1); }
  }

  // HUD
  $('hptext').textContent = Math.max(0, me.hp);
  const hpPct = Math.max(0, me.hp) / me.maxHp * 100;
  $('hpfill').style.width = hpPct + '%';
  $('hpfill').style.background = hpPct > 50 ? '#4cdc7a' : hpPct > 25 ? '#ffc23d' : '#ff4d4d';
  if (cfg) $('ammo').innerHTML = reloadUntil ? '재장전…' : `${ammo} <small>/ ${cfg.mag}</small>`;

  renderer.render(scene, camera);
}

// ---------- 시작 ----------
export function start(socket, welcome, queued) {
  ws = socket;
  const handle = m => { try { onMessage(m); } catch (err) { console.error(err); } };
  handle(welcome);
  for (const m of queued.splice(0)) handle(m);
  ws.onmessage = e => handle(JSON.parse(e.data));
  ws.onclose = () => { if (!ended) endGame('연결이 끊겼어요', '서버와 연결이 끊어졌어요.'); };
  frame();
}
