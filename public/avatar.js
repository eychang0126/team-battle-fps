// =====================================================
//  동글이 캐릭터 만들기 (게임 화면과 로비 미리보기가 같이 써요)
// =====================================================
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
export { THREE };

export const HEAD_Y = 1.42, HEAD_R = 0.4;
const HY = HEAD_Y, R = HEAD_R;
const FRONT = Math.PI * 1.5; // 구 모양에서 얼굴(앞, -z) 방향 각도

export const VISOR_COLOR = { v_red: 0xff3b3b, v_blue: 0x3bb0ff, v_pink: 0xff7ad9, v_gold: 0xffd34d };
export const SKIN_COLOR = { s_1: 0xffe3cf, s_2: 0xc68a5a, s_3: 0x8a5a3a, s_robot: 0xb8c2cc, s_alien: 0x7fd4ff, s_gold: 0xffc83d };
export const HAIR_COLOR = {
  hc_black: 0x2b2b2b, hc_brown: 0x6b4423, hc_blonde: 0xf2c94c, hc_red: 0xb5452f,
  hc_pink: 0xff8fc8, hc_blue: 0x4d9bff, hc_purple: 0x9b6bff, hc_mint: 0x6ee7c8, hc_silver: 0xd9dde3,
};
export const DEFAULT_HAIR = { m: 'h_short', f: 'h_long', n: 'h_bob' };
const DEFAULT_SKIN = 0xffdcc0;
const DEFAULT_HAIR_COLOR = 0x6b4423;
// 머리 윗부분을 덮는 모자 (이 모자를 쓰면 위로 솟은 머리카락은 모자 속에 들어가요)
const COVER_HATS = new Set(['cap', 'beanie', 'helmet', 'tophat']);

const lam = (c, extra = {}) => new THREE.MeshLambertMaterial({ color: c, ...extra });
const shadow = g => g.traverse(o => { if (o.isMesh) o.castShadow = true; });
// 구의 일부분 (머리카락, 모자를 머리 모양에 딱 맞게 감싸요)
function shell(r, color, t0, tl, p0 = 0, pl = Math.PI * 2) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, 32, 18, p0, pl, t0, tl), lam(color, { side: THREE.DoubleSide }));
  m.position.y = HY;
  return m;
}
function ball(g, r, color, x, y, z, sx = 1, sy = 1, sz = 1, basic = false) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 12), basic ? new THREE.MeshBasicMaterial({ color }) : lam(color));
  m.position.set(x, y, z); m.scale.set(sx, sy, sz); g.add(m);
  return m;
}
// 머리 표면에서 바깥을 향하게 세우기
function standOnHead(obj, r, theta, phi) {
  const n = new THREE.Vector3(-Math.cos(phi) * Math.sin(theta), Math.cos(theta), Math.sin(phi) * Math.sin(theta));
  obj.position.set(n.x * r, HY + n.y * r, n.z * r);
  obj.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), n);
}

// ---------- 머리카락 ----------
function makeHair(style, color, hatId) {
  const g = new THREE.Group();
  if (!style || style === 'h_bald') return g;
  const covered = COVER_HATS.has(hatId);
  const hr = R + 0.03;
  const add = m => { g.add(m); return m; };
  const sides = (r, t0, t1, face = 1.0) => add(shell(r, color, t0, t1 - t0, FRONT + face, Math.PI * 2 - 2 * face));
  const scalp = () => add(shell(hr, color, 0, 0.95));
  const bangs = (n = 3) => {
    const xs = n === 3 ? [-0.18, 0, 0.18] : [-0.22, -0.075, 0.075, 0.22];
    for (const x of xs) ball(g, 0.12, color, x, HY + 0.26 - Math.abs(x) * 0.15, -0.29 + Math.abs(x) * 0.12, 1.2, 0.6, 0.6);
  };
  switch (style) {
    case 'h_short':
      scalp(); sides(hr, 0.9, 1.45); bangs(3);
      break;
    case 'h_long': {
      scalp(); sides(hr + 0.01, 0.9, 2.35, 0.9);
      ball(g, 0.36, color, 0, HY - 0.38, 0.16, 1.05, 1.5, 0.6); // 등 뒤로 내려오는 긴 머리
      bangs(4);
      break;
    }
    case 'h_bob':
      scalp(); sides(hr + 0.04, 0.9, 1.95, 0.95); bangs(4);
      break;
    case 'h_pony': {
      scalp(); sides(hr, 0.9, 1.4); bangs(3);
      ball(g, 0.06, 0xff5c8a, 0, HY + 0.12, R + 0.05); // 머리끈
      const tail = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.42, 6, 12), lam(color));
      tail.position.set(0, HY - 0.17, R + 0.14); tail.rotation.x = 0.35; add(tail);
      break;
    }
    case 'h_twin': {
      scalp(); sides(hr, 0.9, 1.4); bangs(3);
      for (const s of [-1, 1]) {
        ball(g, 0.055, 0xff5c8a, s * (R + 0.02), HY + 0.06, 0.06);
        const tail = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.36, 6, 12), lam(color));
        tail.position.set(s * (R + 0.1), HY - 0.2, 0.06); tail.rotation.z = s * 0.3; add(tail);
      }
      break;
    }
    case 'h_spiky': {
      scalp(); sides(hr, 0.9, 1.3); bangs(3);
      if (!covered) {
        const spots = [[0.15, 0], [0.5, 0.6], [0.5, 2.2], [0.5, 3.8], [0.5, 5.4], [0.8, 1.6], [0.8, 4.6]];
        for (const [t, p] of spots) {
          const c = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.26, 8), lam(color));
          c.geometry.translate(0, 0.11, 0);
          standOnHead(c, hr - 0.02, t, p); add(c);
        }
      }
      break;
    }
    case 'h_curly': {
      sides(hr, 0.9, 1.5);
      for (let i = 0; i < 26; i++) {
        const t = 0.15 + (i % 6) * 0.2, p = i * 2.4;
        if (covered && t < 1.0) continue; // 모자 속에 들어가는 부분은 빼기
        if (t > 0.85 && Math.abs(((p % (Math.PI * 2)) - FRONT)) < 0.9) continue; // 얼굴 가리지 않기
        const m = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), lam(color));
        standOnHead(m, hr, t, p); add(m);
      }
      if (!covered) add(shell(hr - 0.01, color, 0, 0.95));
      break;
    }
  }
  shadow(g);
  return g;
}

// ---------- 모자 (머리 모양에 맞게) ----------
export function makeHat(id) {
  const g = new THREE.Group();
  const add = m => { g.add(m); return m; };
  if (id === 'cap') { // 야구모자: 머리를 감싸는 둥근 모자 + 앞 챙
    const cr = R + 0.1; // 머리카락(최대 R+0.07)보다 바깥
    add(shell(cr, 0xd03030, 0, 1.05));
    const brim = add(new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.03, 24, 1, false, Math.PI / 2, Math.PI), lam(0xd03030)));
    brim.position.set(0, HY + cr * Math.cos(1.05), -0.3); brim.rotation.x = -0.12;
    ball(g, 0.04, 0xd03030, 0, HY + cr, 0);
  } else if (id === 'beanie') { // 비니: 머리에 쏙 쓰는 털모자 + 접힌 부분 + 방울
    const br = R + 0.11;
    add(shell(br, 0x3b6bd6, 0, 1.2));
    const t = 1.2, rr = br * Math.sin(t);
    const band = add(new THREE.Mesh(new THREE.TorusGeometry(rr, 0.055, 10, 32), lam(0x2c55b8)));
    band.rotation.x = Math.PI / 2; band.position.y = HY + br * Math.cos(t);
    ball(g, 0.09, 0xffffff, 0, HY + br + 0.07, 0);
  } else if (id === 'helmet') { // 군인 헬멧: 머리를 깊게 덮는 둥근 헬멧 + 테두리 + 턱끈
    const hr = R + 0.13;
    add(shell(hr, 0x556b2f, 0, 1.42));
    const t = 1.42, rr = hr * Math.sin(t);
    const rim = add(new THREE.Mesh(new THREE.TorusGeometry(rr, 0.035, 8, 36), lam(0x46592a)));
    rim.rotation.x = Math.PI / 2; rim.position.y = HY + hr * Math.cos(t);
    // 턱끈: 양쪽 귀에서 턱 아래로
    const strap = add(new THREE.Mesh(new THREE.TorusGeometry(R + 0.01, 0.015, 6, 30, Math.PI), lam(0x3a3a2a)));
    strap.rotation.z = Math.PI; strap.position.set(0, HY + 0.02, 0.02);
  } else if (id === 'tophat') { // 신사 모자: 챙이 머리에 걸쳐서 앉아요
    const y = HY + Math.sqrt((R + 0.07) ** 2 - 0.3 * 0.3) + 0.02; // 머리카락 위에 걸쳐 앉기
    const b = add(new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, 0.03, 28), lam(0x1a1a1a))); b.position.y = y;
    const body = add(new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.42, 28), lam(0x1a1a1a))); body.position.y = y + 0.21;
    const band = add(new THREE.Mesh(new THREE.CylinderGeometry(0.245, 0.245, 0.07, 28), lam(0xb02020))); band.position.y = y + 0.06;
  } else if (id === 'party') { // 고깔모자: 정수리에 살짝 기울여서 + 고무줄
    const pg = new THREE.Group();
    const c = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.5, 18), lam(0xff5cc8)); c.position.y = 0.25; pg.add(c);
    for (const [y, col] of [[0.1, 0xffe14d], [0.27, 0x4dc3ff]]) {
      const stripe = new THREE.Mesh(new THREE.TorusGeometry(0.2 * (1 - y / 0.5), 0.018, 6, 20), lam(col));
      stripe.rotation.x = Math.PI / 2; stripe.position.y = y; pg.add(stripe);
    }
    const pom = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), lam(0xffe14d)); pom.position.y = 0.52; pg.add(pom);
    standOnHead(pg, R + 0.02, 0.32, 0.4); add(pg);
  } else if (id === 'bunny') { // 토끼 귀: 머리띠에 달린 귀
    const bandR = R + 0.09; // 머리카락 위로 보이게
    const band = add(new THREE.Mesh(new THREE.TorusGeometry(bandR, 0.028, 8, 28, Math.PI), lam(0xff9bc8)));
    band.position.y = HY; band.position.z = 0.05;
    for (const s of [-1, 1]) {
      const a = 0.42;
      const eg = new THREE.Group();
      eg.position.set(s * bandR * Math.sin(a), HY + bandR * Math.cos(a), 0.05);
      eg.rotation.z = -s * (a + 0.15);
      const ear = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.34, 6, 12), lam(0xffffff)); ear.position.y = 0.24; ear.scale.z = 0.55;
      const inner = new THREE.Mesh(new THREE.CapsuleGeometry(0.04, 0.26, 6, 12), lam(0xffb6d5)); inner.position.set(0, 0.24, -0.035); inner.scale.z = 0.4;
      eg.add(ear, inner);
      if (s === 1) { eg.rotation.x = -0.25; } // 한쪽 귀는 살짝 접혀요
      add(eg);
    }
  } else if (id === 'crown') { // 왕관: 머리에 꼭 맞게 앉아요
    const rr = 0.27, y = HY + Math.sqrt((R + 0.05) ** 2 - rr * rr) + 0.07;
    const ring = add(new THREE.Mesh(new THREE.CylinderGeometry(rr + 0.02, rr, 0.15, 24, 1, true), lam(0xffc83d, { side: THREE.DoubleSide })));
    ring.position.y = y;
    for (let i = 0; i < 6; i++) {
      const a = i / 6 * Math.PI * 2;
      const sp = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.13, 6), lam(0xffc83d));
      sp.position.set(Math.cos(a) * (rr + 0.02), y + 0.13, Math.sin(a) * (rr + 0.02)); g.add(sp);
      ball(g, 0.022, 0xffffff, Math.cos(a) * (rr + 0.02), y + 0.2, Math.sin(a) * (rr + 0.02));
    }
    ball(g, 0.045, 0xe0245e, 0, y, -rr - 0.02);
    ball(g, 0.035, 0x3bb0ff, -0.19, y, -0.2);
    ball(g, 0.035, 0x3bb0ff, 0.19, y, -0.2);
  }
  shadow(g);
  return g;
}

// ---------- 캐릭터 전체 ----------
// look = [모자, 고글, 피부, 머리스타일, 머리색, 성별]
export function buildCharacter(look = [], opts = {}) {
  const [hatId, visorId, skinId, hairId, hcolorId, gender = 'n'] = look;
  const zombie = !!opts.zombie;
  const skin = zombie ? 0x8fd16a : SKIN_COLOR[skinId] ?? DEFAULT_SKIN;
  const bodyColor = zombie ? 0x4a7a35 : (opts.bodyColor ?? 0x3d8bff);
  const hairColor = HAIR_COLOR[hcolorId] ?? DEFAULT_HAIR_COLOR;
  const hairStyle = hairId || DEFAULT_HAIR[gender] || 'h_bob';
  const inner = new THREE.Group();
  const sph = (r, c, x, y, z, basic) => ball(inner, r, c, x, y, z, 1, 1, 1, basic);

  // 몸통, 배, 발
  const body = sph(0.36, bodyColor, 0, 0.72, 0); body.scale.set(1, 1.08, 0.9);
  const belly = sph(0.24, 0xffffff, 0, 0.66, -0.2); belly.scale.set(1, 1.1, 0.45);
  belly.material = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: zombie ? 0 : 0.35 });
  for (const sx of [-0.16, 0.16]) { const f = sph(0.13, bodyColor, sx, 0.13, -0.04); f.scale.set(1, 0.7, 1.25); }
  // 머리
  sph(R, skin, 0, HY, 0);
  // 눈
  for (const sx of [-0.14, 0.14]) {
    const eye = sph(0.065, zombie ? 0xff2a2a : 0x1b1b1b, sx, HY + 0.03, -R + 0.03, true);
    eye.scale.set(1, 1.25, 0.6);
    if (!zombie) sph(0.022, 0xffffff, sx + 0.025, HY + 0.07, -R + 0.005, true);
  }
  if (!zombie) {
    // 성별에 따라: 여자는 속눈썹, 남자는 진한 눈썹, 중성은 연한 눈썹
    for (const s of [-1, 1]) {
      if (gender === 'f') {
        for (const k of [0, 1]) {
          const lash = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.014, 0.01), new THREE.MeshBasicMaterial({ color: 0x1b1b1b }));
          lash.position.set(s * (0.2 + k * 0.012), HY + 0.09 - k * 0.025, -R + 0.07); lash.rotation.z = s * (0.5 + k * 0.3); inner.add(lash);
        }
      } else {
        const brow = new THREE.Mesh(new THREE.BoxGeometry(0.11, gender === 'm' ? 0.03 : 0.018, 0.01),
          new THREE.MeshBasicMaterial({ color: gender === 'm' ? 0x2b2b2b : 0x7a5a48 }));
        brow.position.set(s * 0.14, HY + 0.15, -R + 0.07); brow.rotation.z = s * -0.12; inner.add(brow);
      }
    }
    // 볼터치, 웃는 입
    for (const sx of [-0.24, 0.24]) {
      const b = sph(0.06, gender === 'f' ? 0xff8aa8 : 0xff9bb3, sx, HY - 0.08, -R + 0.07, true);
      b.scale.set(1.2, 0.7, 0.3); b.material.transparent = true; b.material.opacity = 0.75;
    }
    const mouth = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.012, 6, 12, Math.PI), new THREE.MeshBasicMaterial({ color: 0x5a2a2a }));
    mouth.position.set(0, HY - 0.11, -R + 0.02); mouth.rotation.z = Math.PI; inner.add(mouth);
  } else {
    const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.03, 0.02), new THREE.MeshBasicMaterial({ color: 0x2a3a1a }));
    mouth.position.set(0, HY - 0.13, -R + 0.03); mouth.rotation.z = 0.15; inner.add(mouth);
  }
  // 머리카락
  inner.add(makeHair(hairStyle, hairColor, hatId));
  // 고글
  if (visorId && !zombie) {
    const gm = new THREE.MeshBasicMaterial({ color: VISOR_COLOR[visorId] ?? 0x222222 });
    for (const sx of [-0.14, 0.14]) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.025, 8, 18), gm);
      ring.position.set(sx, HY + 0.03, -R + 0.02); inner.add(ring);
    }
    const strap = new THREE.Mesh(new THREE.TorusGeometry(R + 0.04, 0.02, 6, 30), gm);
    strap.rotation.x = Math.PI / 2; strap.position.y = HY + 0.03; inner.add(strap);
  }
  // 팔 (총이나 좀비 팔)
  const arm = new THREE.Group(); arm.position.set(0, 0.85, 0);
  if (zombie) {
    for (const sx of [-0.26, 0.26]) {
      const a = new THREE.Mesh(new THREE.CapsuleGeometry(0.08, 0.45, 4, 10), lam(skin));
      a.rotation.x = Math.PI / 2; a.position.set(sx, 0, -0.38); arm.add(a);
    }
  } else {
    for (const sx of [-0.2, 0.24]) {
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.085, 12, 10), lam(skin));
      hand.position.set(sx, -0.02, -0.36); arm.add(hand);
    }
    if (opts.gun !== false) {
      const rifle = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.1, 0.6), lam(0x2b2f38));
      rifle.position.set(0.04, 0.03, -0.5); arm.add(rifle);
    }
  }
  inner.add(arm);
  if (hatId) inner.add(makeHat(hatId));
  shadow(inner);
  return { inner, arm, body };
}
