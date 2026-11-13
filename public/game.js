// =====================================================
//  1인칭 팀전 게임 화면 (three.js)
// =====================================================
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';

const $ = id => document.getElementById(id);
const TEAM_COLOR = { red: 0xe84848, blue: 0x3d8bff };
const TEAM_NAME = { red: '빨강 팀', blue: '파랑 팀' };
const R = 0.35, H = 1.8, EYE = 1.6;
const RUN = 6.5, WALK = 3.2, JUMP = 6.5, GRAV = 18;

let ws, myId, myTeam, myName, cfg, map;
let boxes = [];
const me = { x: 0, y: 0, z: 0, vy: 0, yaw: 0, pitch: 0, onGround: true, alive: false, hp: 100 };
let ammo = 25, reloadUntil = 0, lastFire = 0, mouseDown = false, recoil = 0;
const keys = {};
const others = new Map(); // id -> { group, target, ... }
let lastState = null;

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

// ---------- 맵 만들기 ----------
function buildMap() {
  const S = map.size;
  // 바닥 (격자 무늬)
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d');
  x.fillStyle = '#6d8f5a'; x.fillRect(0, 0, 128, 128);
  x.strokeStyle = 'rgba(0,0,0,.15)'; x.lineWidth = 2; x.strokeRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(S, S);
  tex.colorSpace = THREE.SRGBColorSpace;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(S * 2, S * 2), new THREE.MeshLambertMaterial({ map: tex }));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true;
  scene.add(floor);
  // 팀 진영 표시
  for (const [team, z] of [['red', S - 6], ['blue', -S + 6]]) {
    const pad = new THREE.Mesh(new THREE.PlaneGeometry(26, 10),
      new THREE.MeshBasicMaterial({ color: TEAM_COLOR[team], transparent: true, opacity: 0.25 }));
    pad.rotation.x = -Math.PI / 2; pad.position.set(0, 0.01, z);
    scene.add(pad);
  }
  const mats = {
    wall: new THREE.MeshLambertMaterial({ color: 0xc9c2b4 }),
    crate: new THREE.MeshLambertMaterial({ color: 0xa8743f }),
  };
  boxes = map.boxes;
  for (const b of boxes) {
    const w = b.max[0] - b.min[0], h = b.max[1] - b.min[1], d = b.max[2] - b.min[2];
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mats[b.kind] || mats.wall);
    m.position.set((b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2);
    m.castShadow = m.receiveShadow = true;
    scene.add(m);
    if (b.kind === 'crate') {
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry), new THREE.LineBasicMaterial({ color: 0x5a3a1a }));
      edges.position.copy(m.position); scene.add(edges);
    }
  }
}

// ---------- 다른 플레이어 모습 ----------
function nameSprite(text, color) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64;
  const x = c.getContext('2d');
  x.font = 'bold 34px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.lineWidth = 6; x.strokeStyle = 'rgba(0,0,0,.7)'; x.strokeText(text, 128, 32);
  x.fillStyle = color; x.fillText(text, 128, 32);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false }));
  s.scale.set(1.6, 0.4, 1); s.position.y = 2.25; s.renderOrder = 10;
  return s;
}
function makeAvatar(name, team) {
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.3, 0.45), new THREE.MeshLambertMaterial({ color: TEAM_COLOR[team] }));
  body.position.y = 0.65; body.castShadow = true;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.45, 0.45), new THREE.MeshLambertMaterial({ color: 0xf1c9a0 }));
  head.position.y = 1.6; head.castShadow = true;
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.1, 0.05), new THREE.MeshBasicMaterial({ color: 0x222222 }));
  visor.position.set(0, 1.65, -0.23);
  const arm = new THREE.Group(); arm.position.set(0.25, 1.25, 0);
  const rifle = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.1, 0.6), gunMat);
  rifle.position.set(0, 0, -0.35); rifle.castShadow = true;
  arm.add(rifle);
  const label = nameSprite(name, team === 'red' ? '#ff8a8a' : '#8cc4ff');
  const grp = new THREE.Group(); grp.add(body, head, visor, arm, label);
  return { group: grp, arm, label, body, team };
}
function syncOthers(list) {
  const seen = new Set();
  for (const p of list) {
    if (p.id === myId) continue;
    seen.add(p.id);
    let o = others.get(p.id);
    if (!o || o.team !== p.tm) {
      if (o) scene.remove(o.group);
      o = makeAvatar(p.n, p.tm); o.group.position.set(p.x, p.y, p.z);
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
const locked = () => document.pointerLockElement === canvas;
$('overlay').addEventListener('click', () => canvas.requestPointerLock());
canvas.addEventListener('click', () => { if (!locked()) canvas.requestPointerLock(); });
document.addEventListener('pointerlockchange', () => {
  if (ended) return;
  $('overlay').classList.toggle('hide', locked());
  if (!locked()) mouseDown = false;
});
document.addEventListener('mousemove', e => {
  if (!locked()) return;
  me.yaw -= e.movementX * 0.0022;
  me.pitch -= e.movementY * 0.0022;
  me.pitch = Math.max(-1.5, Math.min(1.5, me.pitch));
});
document.addEventListener('mousedown', e => { if (locked() && e.button === 0) mouseDown = true; });
document.addEventListener('mouseup', e => { if (e.button === 0) mouseDown = false; });
document.addEventListener('keydown', e => {
  keys[e.code] = true;
  if (e.code === 'Tab') { e.preventDefault(); $('board').style.display = 'block'; renderBoard(); }
  if (e.code === 'KeyR') reload();
});
document.addEventListener('keyup', e => {
  keys[e.code] = false;
  if (e.code === 'Tab') $('board').style.display = 'none';
});

function reload() {
  if (reloadUntil || ammo >= cfg.mag || !me.alive) return;
  reloadUntil = performance.now() + cfg.reloadMs;
  send({ t: 'reload' });
}

// ---------- 사격 ----------
const ray = new THREE.Raycaster();
function fire() {
  const t = performance.now();
  if (!me.alive || reloadUntil || t - lastFire < cfg.fireMs) return;
  if (ammo <= 0) { reload(); return; }
  lastFire = t; ammo--;
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
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
  ended = true;
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
let centerTimer;
function center(text, ms) {
  $('center').textContent = text;
  clearTimeout(centerTimer);
  if (ms) centerTimer = setTimeout(() => ($('center').textContent = ''), ms);
}
function setTeamUI() {
  $('teamtag').textContent = `${myName} · ${TEAM_NAME[myTeam]}`;
  $('teamtag').style.color = myTeam === 'red' ? '#ff7a7a' : '#6fb5ff';
}

function onMessage(m) {
  switch (m.t) {
    case 'welcome':
      myId = m.id; myTeam = m.team; myName = m.name; cfg = m.cfg; map = m.map;
      ammo = cfg.mag;
      buildMap(); setTeamUI();
      center(`${TEAM_NAME[myTeam]}이에요!`, 2500);
      break;
    case 'respawn':
      Object.assign(me, { x: m.x, y: m.y, z: m.z, yaw: m.yaw, pitch: 0, vy: 0, alive: true, hp: cfg.maxHp });
      ammo = cfg.mag; reloadUntil = 0;
      if ($('center').textContent.includes('부활')) center('', 0);
      break;
    case 'correct':
      me.x = m.x; me.y = m.y; me.z = m.z; me.vy = 0;
      break;
    case 'state':
      lastState = m;
      $('sc-r').textContent = m.s.red; $('sc-b').textContent = m.s.blue; $('sc-t').textContent = `목표 ${m.target}`;
      syncOthers(m.p);
      for (const p of m.p) if (p.id === myId) {
        if (me.alive && !p.a) { me.alive = false; center('죽었어요! 3초 후 부활', 0); }
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
      feed(`<span class="${m.kteam[0]}">${esc(m.killer)}</span> ${m.head ? '🎯' : '🔫'} <span class="${m.vteam[0]}">${esc(m.victim)}</span>`);
      if (m.killer === myName) center(m.head ? '헤드샷 킬!' : '킬!', 900);
      break;
    case 'win':
      center(`${TEAM_NAME[m.team]} 승리! 🎉 곧 다음 라운드`, 0);
      break;
    case 'round':
      center('새 라운드 시작!', 2000);
      break;
    case 'team':
      myTeam = m.team; setTeamUI(); center(`${TEAM_NAME[myTeam]}으로 옮겨졌어요`, 2500);
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
  const rows = team => lastState.p.filter(p => p.tm === team).sort((a, b) => b.k - a.k)
    .map(p => `<tr class="${p.id === myId ? 'me' : ''}"><td>${esc(p.n)}</td><td>${p.k}</td><td>${p.d}</td></tr>`).join('');
  $('board').innerHTML = ['red', 'blue'].map(t => `
    <div style="color:${t === 'red' ? '#ff7a7a' : '#6fb5ff'};font-weight:800;margin:6px 0">${TEAM_NAME[t]} — ${lastState.s[t]}점</div>
    <table><tr><th>이름</th><th>킬</th><th>데스</th></tr>${rows(t)}</table>`).join('');
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
    const speed = keys.ShiftLeft || keys.ShiftRight ? WALK : RUN;
    let fx = 0, fz = 0;
    if (locked()) {
      if (keys.KeyW) fz -= 1; if (keys.KeyS) fz += 1;
      if (keys.KeyA) fx -= 1; if (keys.KeyD) fx += 1;
    }
    const len = Math.hypot(fx, fz) || 1;
    const sin = Math.sin(me.yaw), cos = Math.cos(me.yaw);
    const mx = ((fx * cos + fz * sin) / len) * speed * dt;
    const mz = ((-fx * sin + fz * cos) / len) * speed * dt;
    if (!hitBox(me.x + mx, me.y, me.z)) me.x += mx;
    if (!hitBox(me.x, me.y, me.z + mz)) me.z += mz;
    // 점프 / 중력
    if (locked() && keys.Space && me.onGround) { me.vy = JUMP; me.onGround = false; }
    me.vy -= GRAV * dt;
    let ny = me.y + me.vy * dt;
    me.onGround = false;
    if (ny <= 0) { ny = 0; me.vy = 0; me.onGround = true; }
    const b = hitBox(me.x, ny, me.z);
    if (b) {
      if (me.vy <= 0) { ny = b.max[1]; me.onGround = true; } else { ny = b.min[1] - H; }
      me.vy = 0;
    }
    me.y = ny;

    sendAcc += dt;
    if (sendAcc >= 0.05) {
      sendAcc = 0;
      send({ t: 'move', x: +me.x.toFixed(3), y: +me.y.toFixed(3), z: +me.z.toFixed(3), yaw: me.yaw, pitch: me.pitch });
    }
  }

  // 카메라
  camera.position.set(me.x, me.y + (me.alive ? EYE : 0.4), me.z);
  camera.rotation.set(me.pitch, me.yaw, me.alive ? 0 : 0.5);
  gun.visible = me.alive;
  recoil *= 0.8;
  gun.position.z = -0.35 + recoil;

  // 다른 플레이어 부드럽게 움직이기
  const k = Math.min(1, dt * 15);
  for (const o of others.values()) {
    const p = o.group.position;
    p.x += (o.tx - p.x) * k; p.y += (o.ty - p.y) * k; p.z += (o.tz - p.z) * k;
    o.group.rotation.y = lerpAngle(o.group.rotation.y, o.tyaw, k);
    o.arm.rotation.x = o.tpitch;
    o.group.rotation.z = o.alive ? 0 : Math.PI / 2;
    o.label.visible = o.alive && o.team === myTeam || o.alive && p.distanceTo(camera.position) < 25;
  }

  // 총알 궤적 사라지기
  for (let i = tracers.length - 1; i >= 0; i--) {
    tracers[i].life -= dt;
    if (tracers[i].life <= 0) { scene.remove(tracers[i].line); tracers[i].line.geometry.dispose(); tracers.splice(i, 1); }
  }

  // HUD
  $('hptext').textContent = Math.max(0, me.hp);
  $('hpfill').style.width = Math.max(0, me.hp) + '%';
  $('hpfill').style.background = me.hp > 50 ? '#4cdc7a' : me.hp > 25 ? '#ffc23d' : '#ff4d4d';
  if (cfg) $('ammo').innerHTML = reloadUntil ? '재장전…' : `${ammo} <small>/ ${cfg.mag}</small>`;

  renderer.render(scene, camera);
}

// ---------- 시작 ----------
export function start(token) {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws?token=${encodeURIComponent(token)}`);
  ws.onmessage = e => { try { onMessage(JSON.parse(e.data)); } catch (err) { console.error(err); } };
  ws.onclose = () => { if (!ended) endGame('연결이 끊겼어요', '서버와 연결이 끊어졌어요.'); };
  frame();
}
