// =====================================================
//  1인칭 팀전 게임 화면 (three.js)
// =====================================================
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
import { buildCharacter, animateExtras, tintWeapon } from './avatar.js';

const $ = id => document.getElementById(id);
const TEAM_COLOR = { red: 0xe84848, blue: 0x3d8bff, human: 0x3d8bff, zombie: 0x4f9a3a, runner: 0xff9f1c };
const TEAM_NAME = { red: '빨강 팀', blue: '파랑 팀', human: '인간', zombie: '좀비', runner: '러너' };
const TEAM_CSS = { red: '#ff7a7a', blue: '#6fb5ff', human: '#6fb5ff', zombie: '#7fe05a', runner: '#ffb14d' };
const IS_TOUCH = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
const R = 0.35, STAND_H = 1.8, CROUCH_H = 1.2, EYE = 1.7, CROUCH_EYE = 1.1;
let H = STAND_H, eyeNow = EYE; // 웅크리면 키가 작아지고 눈도 낮아져요
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
const flash = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 8), new THREE.MeshBasicMaterial({ color: 0xffd060 }));
flash.visible = false; flash.userData.noTint = true;
gun.position.set(0.22, -0.2, -0.35);
camera.add(gun);
let gunModel = null, minigunBarrels = null;
// 무기마다 다른 모양 (상자, 원기둥으로 만들어요)
function buildGunModel(id) {
  if (gunModel) { gun.remove(gunModel); gunModel.traverse(o => { o.geometry?.dispose(); o.material?.dispose?.(); }); }
  gunModel = new THREE.Group(); minigunBarrels = null;
  const M = c => new THREE.MeshLambertMaterial({ color: c });
  const B = (w, h, d, c, x, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), M(c)); m.position.set(x, y, z); gunModel.add(m); return m; };
  const C = (r, len, c, x, y, z) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 10), M(c)); m.rotation.x = Math.PI / 2; m.position.set(x, y, z); gunModel.add(m); return m; };
  let tip = -0.7;
  switch (id) {
    case 'wp_smg':
      B(0.08, 0.1, 0.34, 0x30343e, 0, 0, -0.15); B(0.06, 0.18, 0.06, 0x22252c, 0, -0.12, -0.12); B(0.06, 0.13, 0.07, 0x30343e, 0, -0.09, 0.0);
      C(0.022, 0.16, 0x15171c, 0, 0.02, -0.39); tip = -0.48; break;
    case 'wp_shotgun':
      C(0.04, 0.6, 0x2b2b2b, 0, 0.02, -0.33); C(0.045, 0.2, 0x8a5a2b, 0, -0.03, -0.38); // 총열 + 펌프
      B(0.08, 0.12, 0.26, 0x8a5a2b, 0, -0.03, 0.02); tip = -0.65; break;
    case 'wp_sniper':
      B(0.07, 0.09, 0.5, 0x3a4a2e, 0, 0, -0.15); C(0.02, 0.5, 0x15171c, 0, 0.02, -0.62);
      C(0.035, 0.24, 0x111111, 0, 0.1, -0.15); B(0.07, 0.12, 0.2, 0x3a4a2e, 0, -0.04, 0.15); tip = -0.88; break;
    case 'wp_minigun': {
      B(0.16, 0.16, 0.3, 0x3d3f45, 0, -0.02, -0.05);
      minigunBarrels = new THREE.Group(); minigunBarrels.position.set(0, -0.02, -0.38);
      for (let i = 0; i < 6; i++) {
        const a = i / 6 * Math.PI * 2, m = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.5, 6), M(0x1b1c20));
        m.rotation.x = Math.PI / 2; m.position.set(Math.cos(a) * 0.05, Math.sin(a) * 0.05, 0); minigunBarrels.add(m);
      }
      gunModel.add(minigunBarrels); tip = -0.65; break;
    }
    case 'wp_burst':
      B(0.08, 0.11, 0.48, 0x4a3b2a, 0, 0, -0.2); B(0.07, 0.16, 0.08, 0x2b2f38, 0, -0.1, -0.02); B(0.05, 0.14, 0.07, 0x2b2f38, 0, -0.1, -0.22);
      B(0.04, 0.04, 0.22, 0x15171c, 0, 0.02, -0.54); B(0.03, 0.05, 0.12, 0x15171c, 0, 0.08, -0.15); tip = -0.68; break;
    case 'wp_rpg':
      C(0.07, 0.95, 0x4f5d3a, 0.02, 0.02, -0.25); C(0.09, 0.14, 0x3a4429, 0.02, 0.02, -0.72);
      B(0.05, 0.14, 0.06, 0x2b2f38, 0.02, -0.1, -0.1); tip = -0.8; break;
    case 'wp_bow': {
      const bow = new THREE.Group();
      for (const s of [-1, 1]) {
        const limb = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.32, 0.03), M(0x8a5a2b));
        limb.position.set(0, s * 0.15, -0.02); limb.rotation.x = s * 0.35; bow.add(limb);
      }
      const grip = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.08, 0.04), M(0x4a2e18)); bow.add(grip);
      const str = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.6, 0.006), M(0xeeeeee)); str.position.z = 0.09; bow.add(str);
      bow.userData.string = str;
      const arrow = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.012, 0.6), M(0xd9c79a)); arrow.position.set(0, 0, -0.18); bow.add(arrow);
      bow.userData.arrow = arrow;
      bow.position.set(-0.1, 0.05, -0.15); bow.rotation.z = 0.25;
      gunModel.add(bow); gunModel.userData.bow = bow; tip = null; break;
    }
    case 'wp_shield':
      B(0.6, 0.75, 0.05, 0x3d4a5c, -0.25, 0.05, -0.25); B(0.4, 0.12, 0.052, 0x9fd0ff, -0.25, 0.25, -0.25); // 방패 + 창
      B(0.62, 0.05, 0.06, 0x2a3240, -0.25, -0.31, -0.25); tip = null; break;
    case 'wp_gunblade':
      B(0.06, 0.12, 0.22, 0x2b2f38, 0, -0.03, 0.02); B(0.04, 0.12, 0.05, 0x2b2f38, 0, -0.12, 0.05);
      B(0.03, 0.09, 0.75, 0xc9d3e0, 0, 0.0, -0.45); C(0.018, 0.4, 0x15171c, 0, 0.06, -0.3); tip = -0.5; break;
    case 'wp_scythe':
      B(0.04, 0.04, 1.1, 0x4a2e18, 0, -0.05, -0.3); // 긴 자루
      { const bl = B(0.02, 0.07, 0.55, 0xd5dbe3, 0, 0.18, -0.8); bl.rotation.x = 1.25; }
      tip = null; break;
    case 'wp_dagger':
      B(0.05, 0.05, 0.14, 0x5a3a22, 0, -0.03, 0.02); B(0.12, 0.03, 0.03, 0xb0b4bc, 0, -0.03, -0.06);
      B(0.02, 0.06, 0.3, 0xdde3ea, 0, -0.03, -0.22); tip = null; break;
    case 'wp_katana':
      B(0.05, 0.05, 0.26, 0x2b1d4a, 0, -0.03, 0.06); B(0.14, 0.03, 0.06, 0xd4a64a, 0, -0.03, -0.08);
      B(0.018, 0.06, 0.9, 0xe9eef5, 0, -0.03, -0.53); tip = null; break;
    default: // 돌격소총
      B(0.08, 0.1, 0.5, 0x2b2f38, 0, 0, -0.2); B(0.07, 0.16, 0.08, 0x2b2f38, 0, -0.1, -0.02); B(0.04, 0.04, 0.25, 0x15171c, 0, 0.02, -0.55);
  }
  const wc = myUp.color && myUp.color[id];
  if (wc) tintWeapon(gunModel, wc, 0); // 🎨 내가 산 무기 색
  if (tip !== null) { flash.position.set(0, 0.02, tip); gunModel.add(flash); }
  if (id === 'wp_katana' || id === 'wp_dagger' || id === 'wp_gunblade') gunModel.rotation.set(0.35, 0, 0.25); // 칼은 비스듬히 들기
  if (id === 'wp_scythe') gunModel.rotation.set(0.5, 0.3, 0.4);
  gun.add(gunModel);
}
// ---------- 무기 상태 ----------
let curW = 'wp_rifle', myWList = ['wp_rifle'], myGList = [], items = {};
let myUp = { lv: {}, color: {} }; // 🔧 재장전 업그레이드, 🎨 무기 색
const reloadMs = () => Math.round(WP().reload * (1 - 0.15 * (mode === 'range' ? 0 : (myUp.lv[curW] || 0))));
let zoomed = false, dashUntil = 0, lastDash = 0, melee = 0, bowCharge = 0, burstLeft = 0, lastAlt = 0, buffUntil = 0;
const knock = { x: 0, z: 0 }; // 로켓 점프로 날아가는 힘
// 아이템 키 (로비의 ⌨️ 키 설정에서 바꿀 수 있어요)
// 기본 조작 키 (마우스 대신 키보드로도): 쏘기 F, 특수 E, 무기 고르기 I
const DEFAULT_CTRL = { fire: 'KeyF', alt: 'KeyE', pick: 'KeyI', crouch: 'KeyC' };
let ctrlKeys = { ...DEFAULT_CTRL };
try { Object.assign(ctrlKeys, JSON.parse(localStorage.getItem('ctrlKeys') || '{}')); } catch { }
const DEFAULT_KEYS = { gr_grenade: 'KeyG', gr_smoke: 'KeyN', gr_flash: 'KeyX', gr_molotov: 'KeyZ', gr_jumppad: 'KeyB', gr_horn: 'KeyH' };
let gadgetKeys = { ...DEFAULT_KEYS }, gadgetSlots = {};
try { Object.assign(gadgetKeys, JSON.parse(localStorage.getItem('gadgetKeys') || '{}')); gadgetSlots = JSON.parse(localStorage.getItem('gadgetSlots') || '{}'); } catch { }
const WP = () => (cfg && cfg.weapons && cfg.weapons[curW]) || { fire: 110, mag: 25, reload: 1600 };
function setWeapon(id, newAmmo) {
  curW = id; reloadUntil = 0; ammo = newAmmo ?? WP().mag;
  setZoom(false); buildGunModel(id);
  updateWeaponButtons();
}
function cycleWeapon(dir = 1) {
  if (myWList.length < 2 || isZombie() || unarmed()) return;
  const i = myWList.indexOf(curW);
  send({ t: 'weapon', w: myWList[(i + dir + myWList.length) % myWList.length] });
}
// ---------- 무기 고르기 창 ----------
let pickerOpen = false, pickTimer = null, pickerTimed = false;
function openPicker(withTimer) {
  if (unarmed() || isZombie() || myWList.length < 1) return;
  pickerOpen = true; pickerTimed = !!withTimer; mouseDown = false;
  if (locked()) document.exitPointerLock(); // 마우스 화살표가 보이게 (화면이 안 돌아가요)
  const el = $('wpick');
  let left = 10;
  const draw = () => {
    el.innerHTML = `<div class="wp-title">🔫 무기 고르기 ${withTimer ? `<span class="wp-time">${left}초</span>` : ''}</div>
      <div class="wp-grid">${myWList.map((id, i) => {
        const w = cfg.weapons[id];
        return `<button type="button" class="wp-card ${id === curW ? 'on' : ''}" data-w="${id}"><span class="wp-n">${i + 1}</span><span class="wp-i">${w.icon}</span>${w.name}</button>`;
      }).join('')}</div>
      ${voteState && startVoting() && mode === 'fps' ? `<div class="wp-title" style="font-size:18px">🗳️ 맵 투표 <span class="wp-time">${Math.max(0, Math.ceil((voteEndsAt - performance.now()) / 1000))}초</span></div>
        <div class="wp-grid" style="max-height:none">${voteState.maps.map(mp => `<button type="button" class="wp-card wp-map ${myVote === mp.id ? 'on' : ''}" data-m="${mp.id}"><span class="wp-i">${mp.icon}</span>${mp.name}<small style="color:#9aa3b8">${mp.count}표${voteState.next === mp.id ? ' ⭐' : ''}</small></button>`).join('')}</div>
        ${voteState.adminPick ? '<div class="wp-help">👑 관리자가 맵을 정했어요</div>' : ''}` : ''}
      <div class="wp-help">${IS_TOUCH ? '누르면 바로 바뀌어요' : '마우스로 클릭하거나 숫자 키로 고르기' + (withTimer ? ' · Enter = 시작' : '')} · 게임 중에도 ${IS_TOUCH ? '🔁 버튼' : keyLabel(ctrlKeys.pick) + ' 키'}로 바꿀 수 있어요</div>
      <button type="button" class="wp-go" id="wp-go">✅ ${withTimer ? '이걸로 시작!' : '닫기'}</button>`;
    el.querySelectorAll('.wp-card[data-w]').forEach(b => b.onclick = e => { e.stopPropagation(); pickWeapon(b.dataset.w, !withTimer); });
    el.querySelectorAll('.wp-map').forEach(b => b.onclick = e => { e.stopPropagation(); vote(b.dataset.m); draw(); });
    $('wp-go').onclick = e => { e.stopPropagation(); closePicker(true); };
  };
  draw();
  el.style.display = 'flex';
  clearInterval(pickTimer);
  if (withTimer) pickTimer = setInterval(() => { left--; if (left <= 0) closePicker(); else draw(); }, 1000);
  el._redraw = draw;
}
function pickWeapon(id, closeAfter) {
  if (id !== curW) send({ t: 'weapon', w: id });
  curW = id; // 화면에 바로 표시 (서버가 확인해서 다시 알려 줘요)
  if (closeAfter) closePicker(true); else $('wpick')._redraw?.();
}
// resume = 클릭/키로 닫았으면 바로 게임으로 돌아가기 (시간이 다 돼서 닫히면 '클릭해서 시작' 화면)
function closePicker(resume) {
  if (!pickerOpen) return;
  pickerOpen = false; clearInterval(pickTimer);
  $('wpick').style.display = 'none';
  send({ t: 'ready' });
  if (resume && !ended) startPlaying();
}
const keyLabel = c => !c ? '?' : c.startsWith('Key') ? c.slice(3) : c.startsWith('Digit') ? c.slice(5) : c;
function setZoom(on) {
  zoomed = !!on && WP().zoom && me.alive;
  camera.fov = zoomed ? 22 : 75; camera.updateProjectionMatrix();
  const sc = document.getElementById('scope'); if (sc) sc.style.display = zoomed ? 'block' : 'none';
}
function altAction(down) { // 오른쪽 클릭: 저격총 = 조준경, 카타나/낫 = 돌진, 건블레이드 = 총 한 발
  const w = WP();
  if (w.zoom) setZoom(down);
  else if (w.dash && down) dash();
  else if (w.altShot && down) altShot();
}
function altShot() {
  const t = performance.now(), w = WP();
  if (!me.alive || t - lastAlt < w.altShot.cd) return;
  lastAlt = t;
  const dir = aimDir();
  send({ t: 'shoot', alt: 1, dx: dir.x, dy: dir.y, dz: dir.z });
  flash.visible = true; setTimeout(() => (flash.visible = false), 40);
  recoil = 0.1; me.pitch = Math.min(1.5, me.pitch + 0.03);
}
function aimDir() {
  const dir = new THREE.Vector3(); camera.getWorldDirection(dir);
  if (thirdPerson) { // 3인칭: 화면 가운데 조준점이 가리키는 곳으로
    const target = camera.position.clone().addScaledVector(dir, 40);
    dir.copy(target).sub(new THREE.Vector3(me.x, me.y + eyeNow, me.z)).normalize();
  }
  return dir;
}
function dash() {
  const t = performance.now();
  if (!me.alive || t - lastDash < 3000) return;
  lastDash = t; dashUntil = t + 280;
  send({ t: 'dash' });
}
function useGadget(id) {
  if (!(items[id] > 0) || !me.alive || isZombie() || unarmed()) return;
  const dir = aimDir();
  send({ t: 'gadget', g: id, dx: dir.x, dy: dir.y, dz: dir.z });
}
// 폰: 아이템 버튼 (위치는 로비의 ⌨️ 키 설정에서 골라요)
const SLOT_POS = [
  'right:286px;bottom:34px', 'right:210px;bottom:110px', 'right:362px;bottom:34px',
  'right:286px;bottom:110px', 'left:24px;bottom:190px', 'left:96px;bottom:190px',
];
function buildGadgetButtons() {
  document.querySelectorAll('.gadbtn').forEach(b => b.remove());
  const used = new Set();
  myGList.forEach((id, i) => {
    let slot = Number.isInteger(gadgetSlots[id]) ? gadgetSlots[id] : i;
    while (used.has(slot) && slot < 12) slot++;
    used.add(slot);
    const b = document.createElement('div');
    b.className = 'tbtn touchui gadbtn'; b.id = 'gad-' + id;
    b.style.cssText = (SLOT_POS[slot % SLOT_POS.length]) + ';width:58px;height:58px;font-size:17px;position:fixed';
    document.getElementById('game').appendChild(b);
    holdButton(b.id, () => useGadget(id));
  });
}
function updateWeaponButtons() {
  const w = WP();
  const alt = $('btn-alt'), sw = $('btn-weapon');
  if (alt) { alt.style.display = (w.zoom || w.dash || w.altShot) && !isZombie() && !unarmed() ? '' : 'none'; alt.textContent = w.zoom ? '🔭' : w.altShot ? '🔫' : '💨'; }
  if (sw) sw.style.display = !isZombie() && !unarmed() ? '' : 'none';
  for (const id of myGList) {
    const b = document.getElementById('gad-' + id); if (!b) continue;
    b.style.display = !isZombie() && !unarmed() ? '' : 'none';
    b.textContent = (cfg.gadgets[id]?.icon || '?') + (items[id] || 0);
    b.style.opacity = items[id] > 0 ? 1 : 0.4;
  }
}
// 날아가는 수류탄 (서버랑 같은 방법으로 움직여요)
const flyingGren = new Map();
function grenadeStep(g, dt) {
  const inside = (x, y, z) => (!map.noFloor && y < 0.1) || boxes.some(b => x > b.min[0] - 0.1 && x < b.max[0] + 0.1 && y > b.min[1] - 0.1 && y < b.max[1] + 0.1 && z > b.min[2] - 0.1 && z < b.max[2] + 0.1);
  g.vy -= 18 * dt;
  const lim = map.size - 0.5;
  let nx = g.x + g.vx * dt; if (inside(nx, g.y, g.z) || Math.abs(nx) > lim) { g.vx *= -0.4; nx = g.x; } g.x = nx;
  let nz = g.z + g.vz * dt; if (inside(g.x, g.y, nz) || Math.abs(nz) > lim) { g.vz *= -0.4; nz = g.z; } g.z = nz;
  let ny = g.y + g.vy * dt; if (inside(g.x, ny, g.z)) { g.vy *= -0.35; g.vx *= 0.7; g.vz *= 0.7; ny = g.y; } g.y = ny;
}
const booms = [];
function explode(x, y, z, r = 4, isFlash = false) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), new THREE.MeshBasicMaterial({ color: isFlash ? 0xffffff : 0xffa030, transparent: true, opacity: 0.85 }));
  m.position.set(x, y, z); scene.add(m); booms.push({ m, life: 0, r });
  const d = Math.hypot(me.x - x, me.y + 1 - y, me.z - z);
  if (d < 12) shake = Math.max(shake, (12 - d) / 12 * 0.25);
}
let shake = 0;
// 바닥 효과 (연기, 불), 점프패드, 화살/로켓
const zones = new Map(), pads = new Map(), projs = new Map();
function addZone(m) {
  const g = new THREE.Group(); g.position.set(m.x, m.y, m.z);
  if (m.k === 'smoke') {
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * 6.28, rr = Math.random() * m.r * 0.8;
      const puff = new THREE.Mesh(new THREE.SphereGeometry(1.4 + Math.random() * 1.2, 10, 8),
        new THREE.MeshLambertMaterial({ color: 0xc9ced6, transparent: true, opacity: 0.55, depthWrite: false }));
      puff.position.set(Math.cos(a) * rr, 0.8 + Math.random() * 2.6, Math.sin(a) * rr); g.add(puff);
    }
  } else {
    const disc = new THREE.Mesh(new THREE.CircleGeometry(m.r, 24), new THREE.MeshBasicMaterial({ color: 0xff5a1a, transparent: true, opacity: 0.55 }));
    disc.rotation.x = -Math.PI / 2; disc.position.y = 0.04; g.add(disc);
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * 6.28, rr = Math.random() * m.r * 0.85;
      const f = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.8, 6), new THREE.MeshBasicMaterial({ color: i % 2 ? 0xffb020 : 0xff4a10, transparent: true, opacity: 0.85 }));
      f.position.set(Math.cos(a) * rr, 0.4, Math.sin(a) * rr); f.userData.ph = Math.random() * 6; g.add(f);
    }
  }
  scene.add(g); zones.set(m.id, { g, until: performance.now() + m.ms, k: m.k });
}
function removeObj(map2, id) {
  const o = map2.get(id); if (!o) return;
  scene.remove(o.g || o.mesh);
  (o.g || o.mesh).traverse(x => { x.geometry?.dispose(); x.material?.dispose?.(); });
  map2.delete(id);
}
function addPad(m) {
  const g = new THREE.Group(); g.position.set(m.x, m.y, m.z);
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.9, 0.12, 20), new THREE.MeshLambertMaterial({ color: 0x2f2f3a })); base.position.y = 0.06;
  const top = new THREE.Mesh(new THREE.CylinderGeometry(0.65, 0.65, 0.05, 20), new THREE.MeshBasicMaterial({ color: 0x3cf0ff })); top.position.y = 0.14;
  const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.25, 0.4, 4), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7 })); arrow.position.y = 0.6;
  g.add(base, top, arrow); g.userData.arrow = arrow;
  scene.add(g); pads.set(m.id, { g, x: m.x, y: m.y, z: m.z, until: performance.now() + m.ms });
}
function addProj(m) {
  const [x, y, z, vx, vy, vz] = m.p;
  const mesh = m.k === 'rocket'
    ? new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.5, 8), new THREE.MeshLambertMaterial({ color: 0x5a6a3a }))
    : new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.7), new THREE.MeshLambertMaterial({ color: 0xd9c79a }));
  mesh.position.set(x, y, z); scene.add(mesh);
  projs.set(m.id, { mesh, x, y, z, vx, vy, vz, g: m.g || 0, k: m.k });
}

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
const unarmed = () => mode === 'obby' || mode === 'lava'; // 점프 타워, 용암 타워는 무기 없음

// ---------- 맵 만들기 ----------
const OBBY_COLORS = [0xff6b6b, 0xffa94d, 0xffd43b, 0x69db7c, 0x4dabf7, 0x9775fa, 0xf783ac];
let lavaMesh = null;
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
  if (map.lava) { // 🌋 올라오는 용암
    const lc = document.createElement('canvas'); lc.width = lc.height = 64;
    const lx = lc.getContext('2d');
    for (let i = 0; i < 64; i++) for (let j = 0; j < 64; j++) {
      const v = Math.sin(i * 0.4) * Math.cos(j * 0.35) + Math.sin((i + j) * 0.2);
      lx.fillStyle = `rgb(255,${Math.round(90 + v * 45)},${Math.round(20 + v * 15)})`; lx.fillRect(i, j, 1, 1);
    }
    const tex = new THREE.CanvasTexture(lc); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(20, 20);
    lavaMesh = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshBasicMaterial({ map: tex }));
    lavaMesh.rotation.x = -Math.PI / 2; lavaMesh.position.y = -3; scene.add(lavaMesh);
    voidPlane.visible = false;
  }
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
    const zombieSky = mode === 'zombie' || mode === 'wave' || mode === 'range';
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

// 🏙️ 도시 맵 (좀비 웨이브)
function buildCityMap() {
  const S = map.size;
  const c = document.createElement('canvas'); c.width = c.height = 512;
  const x = c.getContext('2d');
  x.fillStyle = '#4a4d55'; x.fillRect(0, 0, 512, 512); // 아스팔트
  for (let i = 0; i < 1800; i++) { x.fillStyle = `rgba(255,255,255,${Math.random() * 0.05})`; x.fillRect(Math.random() * 512, Math.random() * 512, 2, 2); }
  // 큰길 (가운데 십자) + 노란 중앙선 + 횡단보도
  x.fillStyle = '#3a3c42'; x.fillRect(0, 230, 512, 52); x.fillRect(230, 0, 52, 512);
  x.fillStyle = '#e8c547';
  for (let i = 0; i < 512; i += 24) { if (i < 220 || i > 292) { x.fillRect(i, 254, 14, 4); x.fillRect(254, i, 4, 14); } }
  x.fillStyle = '#e9e9e9';
  for (let i = 0; i < 6; i++) { x.fillRect(234 + i * 8, 218, 5, 10); x.fillRect(234 + i * 8, 284, 5, 10); x.fillRect(218, 234 + i * 8, 10, 5); x.fillRect(284, 234 + i * 8, 10, 5); }
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(S * 2, S * 2), new THREE.MeshLambertMaterial({ map: tex }));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; mapGroup.add(floor);
  applyTheme(false);
  scene.background.set(0x7c8aa3); scene.fog.color.set(0x7c8aa3); scene.fog.near = 30; scene.fog.far = 100;
  // 창문 무늬 (건물마다 색이 달라요)
  const winTex = color => {
    const k = document.createElement('canvas'); k.width = 64; k.height = 64;
    const g = k.getContext('2d');
    g.fillStyle = '#' + color.toString(16).padStart(6, '0'); g.fillRect(0, 0, 64, 64);
    for (const [wx, wy] of [[8, 10], [36, 10], [8, 40], [36, 40]]) {
      g.fillStyle = Math.random() < 0.3 ? '#ffe9a8' : '#2c3e57'; g.fillRect(wx, wy, 20, 16);
      g.fillStyle = 'rgba(255,255,255,.25)'; g.fillRect(wx, wy, 20, 3);
    }
    const t = new THREE.CanvasTexture(k); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  const roofMat = new THREE.MeshLambertMaterial({ color: 0x5b5f68 });
  const stairMat = new THREE.MeshLambertMaterial({ color: 0xa3a3a3 });
  const metal = new THREE.MeshLambertMaterial({ color: 0x55585f });
  boxes = map.boxes;
  for (const b of boxes) {
    const w = b.max[0] - b.min[0], h = b.max[1] - b.min[1], d = b.max[2] - b.min[2];
    const pos = [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];
    let m;
    if (b.kind === 'bldg') {
      const sideX = winTex(b.color); sideX.repeat.set(d / 3, h / 3);
      const sideZ = winTex(b.color); sideZ.repeat.set(w / 3, h / 3);
      const mX = new THREE.MeshLambertMaterial({ map: sideX }), mZ = new THREE.MeshLambertMaterial({ map: sideZ });
      m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), [mX, mX, roofMat, roofMat, mZ, mZ]);
      // 옥상 테두리 (보기만 해요)
      const rim = new THREE.Mesh(new THREE.BoxGeometry(w + 0.2, 0.25, d + 0.2), new THREE.MeshLambertMaterial({ color: 0x3f434b }));
      rim.position.set(pos[0], b.max[1] + 0.02, pos[2]); rim.scale.set(1, 1, 1); mapGroup.add(rim);
      const inner = new THREE.Mesh(new THREE.BoxGeometry(w - 0.4, 0.27, d - 0.4), roofMat);
      inner.position.set(pos[0], b.max[1] + 0.03, pos[2]); mapGroup.add(inner);
      // 옥상 물탱크
      const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 1.0, 12), new THREE.MeshLambertMaterial({ color: 0x8a6a4a }));
      tank.position.set(pos[0] + w / 4, b.max[1] + 0.5, pos[2] - d / 4); mapGroup.add(tank);
    } else if (b.kind === 'stair') {
      m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), stairMat);
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry), new THREE.LineBasicMaterial({ color: 0x6d6d6d }));
      edges.position.set(...pos); mapGroup.add(edges);
    } else if (b.kind === 'car') {
      m = new THREE.Mesh(new THREE.BoxGeometry(w, h * 0.55, d), new THREE.MeshLambertMaterial({ color: b.color }));
      pos[1] = b.min[1] + h * 0.275 + 0.25;
      const cab = new THREE.Mesh(new THREE.BoxGeometry(w > d ? w * 0.55 : w * 0.9, h * 0.4, w > d ? d * 0.9 : d * 0.55), new THREE.MeshLambertMaterial({ color: 0x9fc4e8 }));
      cab.position.set(pos[0], b.min[1] + h * 0.8 + 0.1, pos[2]); mapGroup.add(cab);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        const wh = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.25, 12), new THREE.MeshLambertMaterial({ color: 0x1b1b1b }));
        wh.rotation.z = Math.PI / 2; if (w > d) wh.rotation.set(Math.PI / 2, 0, 0);
        wh.position.set(pos[0] + sx * (w / 2 - 0.45) * (w > d ? 1 : 1.02), 0.32, pos[2] + sz * (d / 2 - 0.45)); mapGroup.add(wh);
      }
    } else if (b.kind === 'pole') {
      m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), metal);
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 8), new THREE.MeshBasicMaterial({ color: 0xfff0b0 }));
      lamp.position.set(pos[0], b.max[1] + 0.2, pos[2]); mapGroup.add(lamp);
    } else m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), roofMat);
    m.position.set(...pos);
    m.castShadow = m.receiveShadow = true;
    mapGroup.add(m);
  }
}
function buildMap() {
  if (map.noFloor) return buildObbyMap();
  if (map.theme === 'city') return buildCityMap();
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
function makeAvatar(name, team, look = [], weapon, weaponColor) {
  const teamColor = team === 'red' || team === 'blue' ? TEAM_COLOR[team] : undefined; // 팀전만 팀 색 옷
  const { inner, arm, body, wings, tail, legs, muzzle, weaponParts } = buildCharacter(look, { zombie: team === 'zombie', teamColor, weapon: unarmed() ? 'none' : weapon, weaponColor });
  const label = nameSprite(name, TEAM_CSS[team] || '#fff');
  label.position.y = 2.55;
  const grp = new THREE.Group(); grp.add(inner, label);
  return { group: grp, inner, arm, label, body, wings, tail, legs, muzzle, weaponParts, team, look: look.join(','), swing: 0, walk: 0, phase: Math.random() * 6 };
}
function syncOthers(list) {
  const seen = new Set();
  for (const p of list) {
    if (p.id === myId) continue;
    seen.add(p.id);
    let o = others.get(p.id);
    const lk = (p.lk || []).join(',') + '|' + (p.w || '') + '|' + (p.wc || '');
    if (!o || o.team !== p.tm || o.look !== lk) {
      const old = o;
      if (old) scene.remove(old.group);
      o = makeAvatar(p.n, p.tm, p.lk || undefined, p.w, p.wc); o.look = lk;
      if (p.id >= 1000000) o.label.visible = false; // 봇 좀비는 이름표 없음
      if (old) { o.group.position.copy(old.group.position); o.group.rotation.y = old.group.rotation.y; }
      else o.group.position.set(p.x, p.y, p.z);
      scene.add(o.group); others.set(p.id, o);
    }
    o.tx = p.x; o.ty = p.y; o.tz = p.z; o.tyaw = p.yw; o.tpitch = p.pt; o.alive = p.a; o.crouch = p.a === 2;
  }
  for (const [id, o] of others) if (!seen.has(id)) { scene.remove(o.group); others.delete(id); }
}
// 웅크린 모습: 몸을 낮추고 무릎을 앞으로
function crouchPose(av, on, dt) {
  av.cr = (av.cr || 0) + ((on ? 1 : 0) - (av.cr || 0)) * Math.min(1, dt * 12);
  if (av.cr < 0.01) return;
  av.inner.position.y -= av.cr * 0.42;
  if (av.legs) av.legs.forEach(l => (l.rotation.x = l.rotation.x * (1 - av.cr) - av.cr * 1.1));
  av.label.position.y = 2.55 - av.cr * 0.5;
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
const controlsOn = () => (locked() || touchActive) && !chatOpen && !pickerOpen; // 무기 고르는 동안은 화면/몸이 안 움직여요

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
let lookId = null, lookX = 0, lookY = 0, touchJump = false, touchCrouch = false;
let jumpQueued = false, airJumps = 0; // 2단 점프용
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
      const sens = zoomed ? 0.0018 : 0.006;
      me.yaw -= (t.clientX - lookX) * sens;
      me.pitch -= (t.clientY - lookY) * sens;
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
holdButton('btn-jump', () => { touchJump = true; jumpQueued = true; }, () => (touchJump = false));
holdButton('btn-reload', () => reload());
holdButton('btn-crouch', () => { touchCrouch = !touchCrouch; $('btn-crouch').classList.toggle('on', touchCrouch); });
holdButton('btn-weapon', () => (pickerOpen ? closePicker(true) : openPicker(false)));
holdButton('btn-alt', () => { if (WP().zoom) setZoom(!zoomed); else altAction(true); }); // 폰: 조준경은 누를 때마다 켜고 끄기
holdButton('btn-chat', () => openChat(false));
holdButton('btn-view', () => toggleView());
holdButton('btn-board', () => { $('board').style.display = 'block'; renderBoard(); }, () => ($('board').style.display = 'none'));

// ---------- 채팅 ----------
let chatTeam = false;
function openChat(team) {
  if (ended) return;
  chatOpen = true; chatTeam = team && !unarmed();
  for (const k in keys) keys[k] = false;
  mouseDown = false;
  $('chatform').style.display = 'flex';
  $('chatmode').textContent = chatTeam ? '팀' : '전체';
  $('chatmode').className = chatTeam ? 'team' : '';
  $('chatlog').classList.add('open');
  $('chatinput').value = '';
  $('chatinput').focus();
}
document.getElementById('ov-chat')?.addEventListener('click', e => { e.stopPropagation(); openChat(false); });
document.getElementById('btn-chatpc')?.addEventListener('click', e => { e.stopPropagation(); openChat(false); });
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
let voteEndsAt = 0; // 처음 시작 투표가 끝나는 시간
const startVoting = () => voteEndsAt > performance.now();
setInterval(() => { if (voteEndsAt) { renderVote(); if (pickerOpen && voteEndsAt > performance.now()) $('wpick')._redraw?.(); if (voteEndsAt < performance.now()) voteEndsAt = 0; } }, 1000);
function renderVote() {
  const box = $('votebox');
  if (!voteState || unarmed()) { box.style.display = 'none'; return; }
  box.style.display = 'block';
  const next = voteState.maps.find(m => m.id === voteState.next);
  const isAdmin = crown(myName) !== '';
  const left = Math.ceil((voteEndsAt - performance.now()) / 1000);
  box.innerHTML = (startVoting() ? `<div class="vt" style="color:#ffd43b">🗳️ 맵 투표 중! ${left}초 뒤 시작</div>` : '') + `<div class="vt">🗳️ ${startVoting() ? '시작할 맵' : '다음 맵'}: <b>${next.icon} ${next.name}</b>${voteState.adminPick ? ' <span class="ad">👑 관리자 결정</span>' : ''}</div>` +
    voteState.maps.map((m, i) => `<div class="vo ${myVote === m.id ? 'mine' : ''}" data-id="${m.id}">${IS_TOUCH ? '' : `<kbd>${i + 1}</kbd> `}${m.icon} ${m.name} · ${m.count}표${m.id === voteState.current ? ' (지금)' : ''}</div>`).join('') +
    `<div class="vh">${isAdmin ? '👑 관리자가 고르면 그 맵으로 정해져요' : startVoting() ? '다수결로 정해져요 (관리자가 고르면 그 맵으로)' : '다음 라운드에 다수결로 바뀌어요'}</div>`;
  box.querySelectorAll('.vo').forEach(el => el.onclick = () => vote(el.dataset.id));
}
function vote(id) {
  if (unarmed() || !voteState) return;
  myVote = id; send({ t: 'vote', map: id }); renderVote();
}

function addChat(html, cls = '') {
  const d = document.createElement('div');
  d.className = 'line ' + cls; d.innerHTML = html;
  $('chatlog').append(d);
  while ($('chatlog').children.length > 250) $('chatlog').firstChild.remove();
  $('chatlog').scrollTop = 1e6;
  setTimeout(() => d.classList.add('old'), 9000);
}
document.addEventListener('mousemove', e => {
  if (!locked() || pickerOpen) return;
  const sens = zoomed ? 0.0022 * 0.3 : 0.0022;
  me.yaw -= e.movementX * sens;
  me.pitch -= e.movementY * sens;
  me.pitch = Math.max(-1.5, Math.min(1.5, me.pitch));
});
document.addEventListener('contextmenu', e => { if (locked()) e.preventDefault(); });
document.addEventListener('wheel', e => { if (locked() && !chatOpen) cycleWeapon(e.deltaY > 0 ? 1 : -1); });
document.addEventListener('mousedown', e => {
  if (locked() && !chatOpen && e.button === 2 && !isZombie() && !unarmed()) { altAction(true); return; }
  if (!locked() || chatOpen || e.button !== 0) return;
  if (isZombie()) attack(); else if (!unarmed()) mouseDown = true;
});
document.addEventListener('mouseup', e => { if (e.button === 0) mouseDown = false; if (e.button === 2) altAction(false); });
document.addEventListener('keydown', e => {
  if (chatOpen || ended) return;
  if ((e.code === 'Enter' || e.code === 'KeyT') && (locked() || touchActive)) { e.preventDefault(); openChat(e.code === 'KeyT'); return; }
  keys[e.code] = true;
  if (e.code === 'Tab') { e.preventDefault(); $('board').style.display = 'block'; renderBoard(); }
  if (e.code === 'KeyR') reload();
  if (e.code === 'KeyV') toggleView();
  if (gameOverOpen() && e.code === 'Enter') { e.preventDefault(); retryWave(); return; }
  if (e.code === 'Space' && !e.repeat) jumpQueued = true;
  if (e.code === 'KeyQ') cycleWeapon(1);
  if (e.code === ctrlKeys.pick) { pickerOpen ? closePicker(true) : openPicker(false); }
  if (pickerOpen && /^Digit[1-9]$/.test(e.code)) { const id = myWList[+e.code.slice(5) - 1]; if (id) pickWeapon(id, !pickerTimed); return; } // 처음 창에서는 고르기만 (맵 투표도 해야 하니까)
  if (pickerOpen && e.code === 'Enter') { e.preventDefault(); closePicker(true); return; }
  if (e.code.startsWith('Arrow')) e.preventDefault(); // 화살표로 화면 돌리기 (아래 매 프레임에서)
  if (!e.repeat && e.code === ctrlKeys.fire && controlsOn()) { if (isZombie()) attack(); else if (!unarmed()) mouseDown = true; }
  if (!e.repeat && e.code === ctrlKeys.alt && controlsOn() && !isZombie() && !unarmed()) altAction(true);
  for (const id of myGList) if (gadgetKeys[id] === e.code) useGadget(id);
  if (!pickerOpen && /^Digit[1-9]$/.test(e.code) && voteState) { const m = voteState.maps[+e.code.slice(5) - 1]; if (m) vote(m.id); }
});
document.addEventListener('keyup', e => {
  keys[e.code] = false;
  if (e.code === ctrlKeys.fire) mouseDown = false;
  if (e.code === ctrlKeys.alt) altAction(false);
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
  const w = WP();
  if (w.melee || reloadUntil || ammo >= w.mag || !me.alive) return;
  reloadUntil = performance.now() + reloadMs();
  send({ t: 'reload' });
}

// ---------- 사격 ----------
const ray = new THREE.Raycaster();
function fire() {
  const t = performance.now();
  const w = WP();
  if (pickerOpen || !me.alive || isZombie() || unarmed() || reloadUntil || t - lastFire < w.fire) return;
  if (w.melee) { // 칼, 방패, 낫: 휘두르기
    lastFire = t; melee = 1; swing = 1;
    const dir = new THREE.Vector3(); camera.getWorldDirection(dir);
    send({ t: 'shoot', dx: dir.x, dy: dir.y, dz: dir.z });
    return;
  }
  if (w.charge) return; // 활은 누르고 있다가 뗄 때 쏴요 (아래 releaseArrow)
  if (w.burst && burstLeft === 0) burstLeft = w.burst; // 점사: 한 번 누르면 3발
  if (ammo <= 0) { reload(); return; }
  lastFire = t; ammo--;
  const dir = aimDir();
  if (w.spread && w.pellets === 1 && !zoomed) { // 기관단총, 미니건은 조금 퍼져요
    dir.x += (Math.random() - 0.5) * 2 * w.spread; dir.y += (Math.random() - 0.5) * 2 * w.spread; dir.z += (Math.random() - 0.5) * 2 * w.spread;
    dir.normalize();
  }
  send({ t: 'shoot', dx: dir.x, dy: dir.y, dz: dir.z });
  flash.visible = true; setTimeout(() => (flash.visible = false), 40);
  const kick = { wp_sniper: [0.18, 0.05], wp_shotgun: [0.14, 0.04], wp_minigun: [0.03, 0.004], wp_smg: [0.04, 0.008], wp_rpg: [0.25, 0.06], wp_burst: [0.05, 0.01] }[curW] || [0.06, 0.012];
  recoil = kick[0];
  me.pitch = Math.min(1.5, me.pitch + kick[1]);
  if (w.zoom) setZoom(false); // 저격총은 쏘면 조준경이 풀려요
  if (w.burst) { burstLeft--; if (burstLeft === 0) lastFire = t + w.burstGap - w.fire; } // 3발 다 쏘면 잠깐 쉬기
  if (ammo === 0) { burstLeft = 0; reload(); }
}

function releaseArrow() {
  const t = performance.now(), w = WP();
  const c = Math.min(1, bowCharge / 0.9); bowCharge = 0;
  if (!me.alive || t - lastFire < w.fire) return;
  lastFire = t;
  const dir = aimDir();
  send({ t: 'shoot', dx: dir.x, dy: dir.y, dz: dir.z, charge: c });
  recoil = 0.04;
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
// ---------- 💀 게임 오버 창 (좀비 웨이브) ----------
let reviveTimer = null;
function showGameOver(html) {
  const el = $('gameover');
  el.innerHTML = `<div class="go-box">${html}
    <div class="go-btns"><button type="button" id="go-retry">🔄 다시 하기 <small>(Enter)</small></button><button type="button" id="go-lobby" class="go-sub">🏠 로비로</button></div></div>`;
  el.style.display = 'flex';
  mouseDown = false;
  if (locked()) document.exitPointerLock(); // 마우스로 버튼 누를 수 있게
  $('go-retry').onclick = e => { e.stopPropagation(); retryWave(); };
  $('go-lobby').onclick = e => { e.stopPropagation(); location.reload(); };
}
function hideGameOver() { $('gameover').style.display = 'none'; }
function retryWave() { hideGameOver(); send({ t: 'waveRetry' }); startPlaying(); }
const gameOverOpen = () => $('gameover') && $('gameover').style.display === 'flex';
function center(text, ms, html) {
  if (html) $('center').innerHTML = text; else $('center').textContent = text;
  clearTimeout(centerTimer);
  if (ms) centerTimer = setTimeout(() => ($('center').textContent = ''), ms);
}
function setTeamUI() {
  if (isZombie() && pickerOpen) closePicker();
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
  if (isZombie() || unarmed()) setZoom(false);
  updateWeaponButtons();
}
const fmtTime = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
const PHASE_TEXT = { waiting: '2명 이상 모이면 시작해요', countdown: '곧 시작!', playing: '', ended: '라운드 끝' };
let cpInfo = { i: 0, total: 4 };

function onMessage(m) {
  switch (m.t) {
    case 'welcome':
      myId = m.id; myTeam = m.team; myName = m.name; cfg = m.cfg; map = m.map; mode = m.mode; adminName = m.adminName || '';
      myWList = m.myWeapons || ['wp_rifle']; myGList = m.myGadgets || []; myUp = m.myUp || myUp;
      buildGadgetButtons();
      setTimeout(() => openPicker(true), 50); // 처음 10초: 무기 고르기
      setWeapon(m.weapon || 'wp_rifle');
      buildMap(); setTeamUI();
      document.title = m.roomTitle;
      cpInfo = { i: 0, total: (map.checkpoints?.length || 5) - 1 };
      if (IS_TOUCH) {
        $('ov-text').innerHTML = `왼쪽 조이스틱: 이동 &nbsp; 오른쪽 화면 드래그: 둘러보기<br>⬆️ 점프 &nbsp; 🔫 사격 &nbsp; 🔄 재장전 &nbsp; 💬 채팅 &nbsp; 📋 점수판 &nbsp; 👁 1인칭/3인칭<br>폰은 가로로 돌려서 하면 좋아요`;
      } else {
        $('ov-text').innerHTML += `<br><kbd>Enter</kbd> 전체 채팅 &nbsp; <kbd>T</kbd> 팀 채팅`
          + `<br><kbd>${keyLabel(ctrlKeys.fire)}</kbd> 쏘기 &nbsp; <kbd>${keyLabel(ctrlKeys.alt)}</kbd> 특수 &nbsp; <kbd>${keyLabel(ctrlKeys.pick)}</kbd> 무기 고르기 &nbsp; <kbd>${keyLabel(ctrlKeys.crouch)}</kbd> 웅크리기 &nbsp; <kbd>⬅️⬆️⬇️➡️</kbd> 화면 돌리기`;
      }
      const tapWord = IS_TOUCH ? '화면을 눌러서 시작' : '클릭해서 시작';
      if (mode === 'zombie') {
        $('ov-title').textContent = '🧟 좀비 모드 · ' + tapWord;
        $('ov-text').innerHTML = `인간: 총으로 좀비를 막고 3분 동안 살아남기<br>좀비: ${IS_TOUCH ? '🧟 버튼' : '<kbd>왼쪽 클릭</kbd>'}으로 인간을 잡아서 좀비로 만들기<br><br>` + $('ov-text').innerHTML;
      } else if (mode === 'range') {
        $('ov-title').textContent = '🎯 무기 시험장 · ' + tapWord;
        $('ov-text').innerHTML = `나만 들어온 연습장이에요. 좀비 3마리가 계속 쫓아와요.<br>모든 무기·아이템을 써 볼 수 있어요 (I 키로 바꾸기). 코인·트로피는 없어요.<br><br>` + $('ov-text').innerHTML;
      } else if (mode === 'wave') {
        $('ov-title').textContent = '🧟‍♂️ 좀비 웨이브 · ' + tapWord;
        $('ov-text').innerHTML = `몰려오는 좀비 떼를 총으로 막아요! 웨이브를 깰 때마다 🪙 5코인, 5웨이브마다 🏆 트로피<br>쓰러지면 20초 뒤 부활 · 모두 쓰러지면 게임 오버<br><br>` + $('ov-text').innerHTML;
      } else if (mode === 'lava') {
        $('ov-title').textContent = '🌋 용암 타워 · ' + tapWord;
        $('ov-text').innerHTML = `용암이 아래에서 점점 빨리 올라와요! 닿으면 바로 아웃<br>꼭대기 🏁까지 올라가면 🪙 20코인 (2명 이상이면 1등은 🏆 트로피도)<br><br>` + $('ov-text').innerHTML;
      } else if (mode === 'obby') {
        $('ov-title').textContent = '🗼 점프 타워 · ' + tapWord;
        $('ov-text').innerHTML = `빙글빙글 타워를 올라 꼭대기 🏁에 먼저 닿으면 승리!<br>🔥 빨간 블록은 밟으면 아웃 · 많이 떨어지면 🚩 체크포인트에서 다시 시작<br><br>` + $('ov-text').innerHTML;
      } else {
        $('ov-title').textContent = tapWord;
        center(`${TEAM_NAME[myTeam]}이에요!`, 2500);
      }
      break;
    case 'dm': // 관리자 갠톡 (게임 중이면 알림으로)
      if (m.msg.who === 'a') { feed(`📩 👑 관리자: ${esc(m.msg.text)}`); center(`📩 관리자 갠톡: ${esc(m.msg.text)}<br><small>답장: 채팅에 /관리자 내용</small>`, 5000, true); }
      break;
    case 'dmThread': break;
    case 'chatHist': { // 이 게임에서 예전에 했던 채팅 (채팅 창을 열면 보여요)
      const log = $('chatlog');
      const frag = document.createDocumentFragment();
      if (m.list.length) { const h = document.createElement('div'); h.className = 'line sys old'; h.textContent = '— 예전 채팅 —'; frag.append(h); }
      for (const e of m.list) {
        const d = document.createElement('div'); d.className = 'line old';
        const t = new Date(e.at);
        d.innerHTML = `<span style="color:#8a93a8;font-size:11px">${t.getMonth() + 1}/${t.getDate()} ${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}</span> <b>${crown(e.from)}${esc(e.from)}</b>: ${esc(e.text)}`;
        frag.append(d);
      }
      log.prepend(frag);
      break;
    }
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
      voteState = m; if (m.vt) voteEndsAt = performance.now() + m.vt * 1000; else voteEndsAt = 0;
      renderVote();
      if (pickerOpen) $('wpick')._redraw?.();
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
        if (m.phase === 'break' && gameOverOpen()) { hideGameOver(); startPlaying(); } // 다른 사람이 다시 시작했어요
        if (m.phase === 'break' && !roomInfo.wv) center('🧟‍♂️ 곧 좀비가 몰려와요! 준비하세요', 3000);
        break;
      }
      if (mode === 'lava') {
        if (m.phase === 'countdown') center('🌋 곧 용암이 올라와요! 출발선에서 기다려요', 3000);
        if (m.phase === 'rising') center('출발! 위로 도망쳐요! 🏃💨', 1500);
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
    case 'lavadie':
      feed(`🌋 ${esc(m.name)} 님이 용암에 빠졌어요 (${m.h}m)`);
      if (m.name === myName) center(`🌋 용암에 빠졌어요! ${m.h}m까지 올라갔어요<br>다음 판을 기다려요`, 0, true);
      break;
    case 'lavawait':
      center('🌋 이미 시작했어요! 다음 판부터 같이 해요', 4000);
      break;
    case 'lavaend': {
      const top = (m.results || []).slice(0, 5).map((r, i) => `${i + 1}. ${esc(r.n)} ${r.h}m`).join(' · ');
      const best = m.best ? `<br>🏆 최고 기록: ${m.best.time}초 (${esc(m.best.name)})` : '';
      center(`${esc(m.text)}${top ? '<br>' + top : ''}${best}<br>곧 다음 판!`, 7500, true);
      break;
    }
    case 'wave':
      center(`🌊 웨이브 ${m.n} 시작! 좀비 ${m.count}마리`, 2500);
      break;
    case 'waveClear':
      center(`✅ 웨이브 ${m.n} 클리어!${m.record ? ' 🏆 새 최고 기록!' : ''}`, 2400);
      break;
    case 'wavedead': { // 20초 뒤 부활 (카운트다운)
      let left = m.secs || 20;
      clearInterval(reviveTimer);
      center(`쓰러졌어요! ${left}초 뒤에 부활해요 💫`, 0);
      reviveTimer = setInterval(() => {
        left--;
        if (me.alive || left <= 0) { clearInterval(reviveTimer); return; }
        center(`쓰러졌어요! ${left}초 뒤에 부활해요 💫`, 0);
      }, 1000);
      break;
    }
    case 'gameover': { // 💀 게임 오버 → 다시 할지 물어보기
      clearInterval(reviveTimer); center('', 0);
      const best = m.best ? `🏆 최고 기록: 웨이브 ${m.best.wave} (${m.best.names.map(esc).join(', ')})` : '';
      const top = (m.top || []).slice(0, 5).map(x => `${esc(x.n)} ${x.k}킬`).join(' · ');
      showGameOver(`<div class="go-t">💀 게임 오버</div>
        <div class="go-s">웨이브 <b>${m.wave}</b>까지 버텼어요! (클리어 ${m.cleared})</div>
        ${top ? `<div class="go-k">${m.solo ? '' : '처치: '}${top}</div>` : ''}
        ${best ? `<div class="go-k">${best}</div>` : ''}
        <div class="go-q">다시 할까요?</div>`);
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
      ammo = m.ammo ?? WP().mag; reloadUntil = 0; items = m.items || {}; me.crouch = false; H = STAND_H; touchCrouch = false; dashUntil = 0; knock.x = knock.z = 0; buffUntil = 0; bowCharge = 0; burstLeft = 0; setZoom(false); updateWeaponButtons();
      clearInterval(reviveTimer); if (/부활|일어나요|기다려요/.test($('center').textContent)) center('', 0);
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
      for (const k of ['s', 'target', 'ph', 'w', 'tl', 'wv', 'zl', 'lv']) if (m[k] !== undefined) roomInfo[k] = m[k];
      m = { ...roomInfo, t: 'state', p: [...roomPlayers.values()] };
      if (mode === 'fps' && !m.s) break;
    }
      lastState = m;
      if (mode === 'fps') {
        $('sc-r').textContent = m.s.red; $('sc-b').textContent = m.s.blue; $('sc-t').textContent = `목표 ${m.target}`;
      } else if (mode === 'range') {
        $('sc-r').textContent = '🎯'; $('sc-b').textContent = `처치 ${(m.p.find(x => x.id === myId) || {}).k || 0}`; $('sc-b').style.color = '#7fe05a';
        $('sc-t').textContent = '무기 시험장 · 코인/트로피 없음 · I 키 = 무기 바꾸기';
      } else if (mode === 'wave') {
        $('sc-r').textContent = `🌊 ${m.wv || 0}`; $('sc-r').style.color = '#6fb5ff';
        $('sc-b').textContent = `🧟 ${m.zl || 0}`; $('sc-b').style.color = '#7fe05a';
        $('sc-t').textContent = m.ph === 'wave' ? `웨이브 ${m.wv} · 남은 좀비 ${m.zl}` : m.ph === 'break' ? `다음 웨이브까지 ${m.tl}초` : m.ph === 'over' ? '게임 오버' : '';
      } else if (mode === 'lava') {
        const lvY = (m.lv ?? -300) / 100;
        $('sc-r').textContent = `🌋 ${Math.max(0, lvY).toFixed(1)}m`; $('sc-r').style.color = '#ff7a2a';
        $('sc-b').textContent = `🧍 ${Math.max(0, me.y).toFixed(1)}m`; $('sc-b').style.color = '#69db7c';
        $('sc-t').textContent = m.ph === 'countdown' ? `출발까지 ${m.tl}초` : m.ph === 'rising' ? `🏁 ${(map.height || 35).toFixed(0)}m까지 도망쳐요!` : m.ph === 'ended' ? '다음 판 준비 중…' : '';
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
        const lk = (p.lk || []).join(',') + '|' + (p.w || '') + '|' + (p.wc || '');
        if (!meAv || meAv.team !== p.tm || meAv.look !== lk) {
          if (meAv) scene.remove(meAv.group);
          meAv = makeAvatar(p.n, p.tm, p.lk || undefined, p.w, p.wc); meAv.look = lk;
          meAv.label.visible = false;
          scene.add(meAv.group);
        }
        if (me.alive && !p.a) { me.alive = false; if (mode !== 'wave' && mode !== 'lava') center(mode === 'zombie' ? '쓰러졌어요! 3초 후 다시 일어나요' : '죽었어요! 3초 후 부활', 0); }
        me.hp = p.hp;
      }
      if ($('board').style.display === 'block') renderBoard();
      break;
    case 'shot':
      { // 총알은 총구에서 나와요 (내 1인칭 총 / 3인칭 캐릭터 / 다른 사람 캐릭터의 총)
        const v = new THREE.Vector3();
        let o = m.o;
        if (m.id === myId) {
          if (thirdPerson && meAv && meAv.muzzle) o = meAv.muzzle.getWorldPosition(v).toArray();
          else if (gunModel && flash.parent) o = flash.getWorldPosition(v).toArray();
          else o = [me.x, me.y + eyeNow - 0.15, me.z];
        } else {
          const av = others.get(m.id);
          if (av && av.muzzle) o = av.muzzle.getWorldPosition(v).toArray();
        }
        for (const e of m.es || [m.e]) tracer(o, e, m.id === myId);
      }
      break;
    case 'weapon': {
      setWeapon(m.w, m.ammo);
      if (pickerOpen) $('wpick')._redraw?.();
      const w = WP(); center(`${w.icon} ${w.name}`, 900);
      break;
    }
    case 'items':
      items = m.items || {}; updateWeaponButtons();
      break;
    case 'throw': {
      const [x, y, z, vx, vy, vz] = m.p;
      const col = { gr_smoke: 0xb0b6c0, gr_flash: 0xeeeeee, gr_molotov: 0x7a3b12 }[m.k] || 0x3d5a2a;
      const mesh = new THREE.Mesh(m.k === 'gr_molotov' ? new THREE.CylinderGeometry(0.07, 0.09, 0.28, 8) : new THREE.SphereGeometry(0.12, 10, 8), new THREE.MeshLambertMaterial({ color: col }));
      mesh.position.set(x, y, z); scene.add(mesh);
      flyingGren.set(m.id, { x, y, z, vx, vy, vz, mesh });
      break;
    }
    case 'pop': removeObj(flyingGren, m.id); break;
    case 'boom': explode(m.x, m.y, m.z, m.r || 4, !!m.flash); break;
    case 'zone': addZone(m); break;
    case 'zoneGone': removeObj(zones, m.id); break;
    case 'pad': addPad(m); break;
    case 'padGone': removeObj(pads, m.id); break;
    case 'proj': addProj(m); break;
    case 'projEnd': removeObj(projs, m.id); break;
    case 'knock': // 로켓 폭발에 날아가요
      me.vy = m.v[1]; knock.x = m.v[0]; knock.z = m.v[2]; me.onGround = false;
      break;
    case 'flashed': {
      const f = $('flashov'); f.style.transition = 'none'; f.style.opacity = 1;
      setTimeout(() => { f.style.transition = `opacity ${m.ms}ms ease-in`; f.style.opacity = 0; }, 60);
      break;
    }
    case 'horn':
      feed(`📯 ${esc(m.name)} 님이 전쟁 나팔을 불었어요!`);
      break;
    case 'buff':
      buffUntil = performance.now() + m.ms;
      center(`📯 ${m.from === myName ? '' : esc(m.from) + ' 님의 '}나팔! 8초 동안 빨라지고 세져요`, 1800);
      break;
    case 'dash':
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
      feed(`<span class="${cls(m.kteam)}">${esc(m.killer)}</span> ${esc(m.w || '🔫')}${m.head ? '🎯' : ''} <span class="${cls(m.vteam)}">${esc(m.victim)}</span>`);
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
  if (mode === 'lava') {
    const rows = [...lastState.p].sort((a, b) => b.y - a.y)
      .map(p => `<tr class="${p.id === myId ? 'me' : ''}"><td>${crown(p.n)}${esc(p.n)}</td><td>${p.a ? Math.max(0, p.y).toFixed(1) + 'm' : '🌋 아웃'}</td></tr>`).join('');
    $('board').innerHTML = `<div style="color:#ff7a2a;font-weight:800;margin:6px 0">🌋 용암 타워</div><table><tr><th>이름</th><th>높이</th></tr>${rows}</table>`;
    return;
  }
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

  if (reloadUntil && t >= reloadUntil) { ammo = WP().mag; reloadUntil = 0; }
  if (mouseDown) fire();

  // 화살표 키로 화면 돌리기 (마우스/터치패드 대신)
  if (controlsOn()) {
    const tr = (zoomed ? 0.6 : 2.4) * dt;
    if (keys.ArrowLeft) me.yaw += tr;
    if (keys.ArrowRight) me.yaw -= tr;
    if (keys.ArrowUp) me.pitch = Math.min(1.5, me.pitch + tr * 0.7);
    if (keys.ArrowDown) me.pitch = Math.max(-1.5, me.pitch - tr * 0.7);
  }
  // 웅크리기 (누르고 있는 동안 / 폰은 버튼으로 켜고 끄기)
  {
    const want = me.alive && !unarmed() && controlsOn() && (keys[ctrlKeys.crouch] || touchCrouch);
    if (want && !me.crouch) { me.crouch = true; H = CROUCH_H; }
    else if (!want && me.crouch) { // 일어나기: 머리 위가 막혀 있으면 못 일어나요
      H = STAND_H;
      if (hitBox(me.x, me.y, me.z)) H = CROUCH_H; else me.crouch = false;
    }
    eyeNow += ((me.crouch ? CROUCH_EYE : EYE) - eyeNow) * Math.min(1, dt * 14);
  }
  if (map && me.alive) {
    // 이동
    let speed = keys.ShiftLeft || keys.ShiftRight ? WALK : isZombie() ? 7.3 : RUN * (!isZombie() && WP().speed || 1);
    if (zoomed || me.crouch) speed = me.crouch ? 2.6 : WALK;
    if (performance.now() < buffUntil && !isZombie()) speed *= 1.3; // 📯
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
    if (Math.abs(knock.x) + Math.abs(knock.z) > 0.05) { // 로켓 점프로 날아가는 중
      const dx = knock.x * dt, dz = knock.z * dt;
      if (!hitBox(me.x + dx, me.y, me.z)) me.x += dx; else knock.x = 0;
      if (!hitBox(me.x, me.y, me.z + dz)) me.z += dz; else knock.z = 0;
      const fr = me.onGround ? Math.pow(0.02, dt) : Math.pow(0.6, dt);
      knock.x *= fr; knock.z *= fr;
    }
    // 점프패드 밟으면 슝!
    for (const pd of pads.values()) {
      if (me.vy <= 0.5 && Math.hypot(me.x - pd.x, me.z - pd.z) < 0.85 && Math.abs(me.y - pd.y) < 0.4) { me.vy = 15; me.onGround = false; center('🦘 슝!', 600); }
    }
    if (performance.now() < dashUntil) { // 카타나/낫 돌진: 보는 방향으로 쓩
      const dx = -Math.sin(me.yaw) * 17 * dt, dz = -Math.cos(me.yaw) * 17 * dt;
      if (!hitBox(me.x + dx, me.y, me.z)) me.x += dx;
      if (!hitBox(me.x, me.y, me.z + dz)) me.z += dz;
    }
    // 점프 / 중력
    // 점프 + 2단 점프 (총 게임에서만, 점프 타워/용암 타워는 1번만)
    if (me.onGround) airJumps = 0;
    if (controlsOn() && (keys.Space || touchJump) && me.onGround) { me.vy = JUMP; me.onGround = false; jumpQueued = false; }
    else if (controlsOn() && jumpQueued && !me.onGround && !unarmed() && airJumps < 1) {
      me.vy = JUMP * 0.9; airJumps++;
      const puff = new THREE.Mesh(new THREE.RingGeometry(0.2, 0.45, 16), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7, side: THREE.DoubleSide }));
      puff.rotation.x = -Math.PI / 2; puff.position.set(me.x, me.y, me.z); scene.add(puff); booms.push({ m: puff, life: 0, r: 0.6 });
    }
    jumpQueued = false;
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
      send({ t: 'move', x: +me.x.toFixed(3), y: +me.y.toFixed(3), z: +me.z.toFixed(3), yaw: me.yaw, pitch: me.pitch, c: me.crouch ? 1 : 0 });
    }
  }

  // 카메라
  const eye = new THREE.Vector3(me.x, me.y + (me.alive ? eyeNow : 0.4), me.z);
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
      crouchPose(meAv, me.crouch, dt);
      meAv.arm.rotation.x = me.pitch - Math.sin(swing * Math.PI) * 0.8;
      animateExtras(meAv, t, meAv.phase);
    }
  }
  recoil *= 0.8;
  gun.position.z = -0.35 + recoil;
  melee = Math.max(0, melee - dt * 4);
  const ms = Math.sin(melee * Math.PI);
  gun.rotation.set(-ms * 1.1, curW === 'wp_katana' ? ms * 1.2 : 0, 0);  // 칼 휘두르기
  gun.position.x = 0.22 - (curW === 'wp_katana' ? ms * 0.3 : 0);
  if (minigunBarrels && mouseDown) minigunBarrels.rotation.z += dt * 25;
  // 활 당기기: 누르고 있으면 차오르고, 떼면 발사
  if (WP().charge && me.alive && !isZombie() && !unarmed()) {
    if (mouseDown) bowCharge = Math.min(1.2, bowCharge + dt);
    else if (bowCharge > 0) releaseArrow();
  } else bowCharge = 0;
  const bow = gunModel && gunModel.userData.bow;
  if (bow) { const c = Math.min(1, bowCharge / 0.9); bow.userData.string.position.z = 0.09 + c * 0.18; bow.userData.arrow.position.z = -0.18 + c * 0.18; }
  if (burstLeft > 0) fire(); // 점사 나머지 발
  { // 🌈 무지개 무기는 색이 계속 바뀌어요
    const hue = (performance.now() / 3000) % 1;
    if (gunModel && gunModel.userData.rainbow) tintWeapon(gunModel, 'rainbow', hue);
    for (const o of others.values()) if (o.weaponParts && o.weaponParts.userData.rainbow) tintWeapon(o.weaponParts, 'rainbow', hue);
    if (meAv && meAv.weaponParts && meAv.weaponParts.userData.rainbow) tintWeapon(meAv.weaponParts, 'rainbow', hue);
  }
  if (lavaMesh && roomInfo.lv !== undefined) {
    const ty = roomInfo.lv / 100;
    lavaMesh.position.y += (ty - lavaMesh.position.y) * Math.min(1, dt * 5);
    lavaMesh.material.map.offset.x += dt * 0.02; lavaMesh.material.map.offset.y += dt * 0.013;
  }
  {
    const now2 = performance.now();
    for (const [id, z] of zones) {
      if (now2 > z.until) { removeObj(zones, id); continue; }
      if (z.k === 'fire') z.g.children.forEach(f => { if (f.userData.ph !== undefined) f.scale.y = 0.7 + Math.sin(now2 * 0.012 + f.userData.ph) * 0.35; });
      else z.g.rotation.y += dt * 0.05;
    }
    for (const [id, pd] of pads) {
      if (now2 > pd.until) { removeObj(pads, id); continue; }
      pd.g.userData.arrow.position.y = 0.6 + Math.sin(now2 * 0.006) * 0.15;
    }
    for (const pj of projs.values()) {
      pj.vy -= pj.g * dt;
      pj.x += pj.vx * dt; pj.y += pj.vy * dt; pj.z += pj.vz * dt;
      pj.mesh.position.set(pj.x, pj.y, pj.z);
      pj.mesh.lookAt(pj.x + pj.vx, pj.y + pj.vy, pj.z + pj.vz);
      if (pj.k === 'rocket') pj.mesh.rotateX(Math.PI / 2);
    }
  }
  gun.visible = gun.visible && !zoomed;
  for (const g of flyingGren.values()) {
    for (let k = 0; k < 2; k++) grenadeStep(g, dt / 2);
    g.mesh.position.set(g.x, g.y, g.z);
  }
  for (let i = booms.length - 1; i >= 0; i--) {
    const b = booms[i]; b.life += dt;
    b.m.scale.setScalar(0.5 + b.life * b.r * 2.2); b.m.material.opacity = Math.max(0, 0.85 - b.life * 2.2);
    if (b.life > 0.4) { scene.remove(b.m); b.m.geometry.dispose(); b.m.material.dispose(); booms.splice(i, 1); }
  }
  if (shake > 0.001) { camera.position.x += (Math.random() - 0.5) * shake; camera.position.y += (Math.random() - 0.5) * shake; shake *= 0.85; }
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
    o.bounce = moving ? Math.abs(Math.sin(o.walk)) * 0.03 : (o.bounce || 0) * 0.8;
    o.inner.position.y = o.bounce;
    if (o.legs) o.legs.forEach((l, i) => (l.rotation.x = moving ? Math.sin(o.walk) * (i ? -0.7 : 0.7) : l.rotation.x * 0.8));
    crouchPose(o, o.crouch, dt);
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
  if (cfg) {
    const w = WP();
    const g = myGList.map(id => ` <small style="opacity:${items[id] > 0 ? 1 : 0.4}">${cfg.gadgets[id].icon}${items[id] || 0}</small>`).join('');
    const buff = performance.now() < buffUntil ? ' <small>📯</small>' : '';
    const main = w.melee || w.charge ? `<small>${w.name}${w.charge && bowCharge > 0 ? ' ' + '▮'.repeat(Math.round(Math.min(1, bowCharge / 0.9) * 8)) : ''}</small>`
      : reloadUntil ? '재장전…' : `${ammo} <small>/ ${w.mag}</small>`;
    $('ammo').innerHTML = `<small>${w.icon || ''}</small> ` + main + g + buff;
  }

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
