// =====================================================
//  동글이 캐릭터 만들기 (게임 화면과 로비 미리보기가 같이 써요)
// =====================================================
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
export { THREE };

export const HEAD_Y = 1.42, HEAD_R = 0.4;
const HY = HEAD_Y, R = HEAD_R;
const FRONT = Math.PI * 1.5; // 구 모양에서 얼굴(앞, -z) 방향 각도

export const BODY_COLOR = {
  b_red: 0xe84848, b_orange: 0xff9f1c, b_yellow: 0xffd43b, b_green: 0x3ccf6e, b_pink: 0xff8fc8,
  b_purple: 0x9b6bff, b_white: 0xf4f4f6, b_black: 0x2d2f36, b_mint: 0x6ee7c8, b_gold: 0xe0b23a,
};
export const EYE_COLOR = {
  e_brown: 0x6b3e1f, e_blue: 0x2f6fd6, e_green: 0x2f9e44, e_purple: 0x8a4fd8,
  e_red: 0xd12b2b, e_sky: 0x4dc3ff, e_gold: 0xe0a800,
};
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
  } else if (id === 'halo') { // 천사 링: 머리 위에 둥둥 떠 있어요
    const halo = add(new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.035, 10, 36), new THREE.MeshBasicMaterial({ color: 0xffe066 })));
    halo.rotation.x = Math.PI / 2 - 0.15; halo.position.y = HY + R + 0.28;
    const glow = add(new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.07, 8, 36), new THREE.MeshBasicMaterial({ color: 0xfff2b0, transparent: true, opacity: 0.35 })));
    glow.rotation.copy(halo.rotation); glow.position.copy(halo.position);
  } else if (id === 'horns') { // 악마 뿔: 머리 양쪽 위에서 바깥으로 휘어져요
    for (const phi of [0, Math.PI]) {
      const hg = new THREE.Group();
      const base = new THREE.Mesh(new THREE.ConeGeometry(0.075, 0.16, 10), lam(0xc0392b)); base.position.y = 0.06; hg.add(base);
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.14, 10), lam(0x8e1b1b));
      tip.position.set(phi === 0 ? -0.025 : 0.025, 0.18, 0); tip.rotation.z = phi === 0 ? 0.35 : -0.35; hg.add(tip);
      standOnHead(hg, R + 0.04, 0.6, phi); add(hg);
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

// ---------- 얼굴 ----------
// 얼굴 부품은 머리 구의 앞쪽 표면에 딱 붙여요
const faceZ = (x, y) => -Math.sqrt(Math.max(0, R * R - x * x - (y - HY) ** 2)) - 0.004;
const basic = c => new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide });
// rz는 원래 회전에 '더해요' (덮어쓰면 ∪ 웃는 입이 ∩ 우는 입이 돼요)
function onFace(g, mesh, x, y, rz = 0) { mesh.position.set(x, y, faceZ(x, y)); mesh.rotation.z += rz; g.add(mesh); return mesh; }
function heartShape(s) {
  const h = new THREE.Shape();
  h.moveTo(0, -s);
  h.bezierCurveTo(-s * 1.4, -s * 0.2, -s * 0.9, s * 1.1, 0, s * 0.45);
  h.bezierCurveTo(s * 0.9, s * 1.1, s * 1.4, -s * 0.2, 0, -s);
  return h;
}
function starShape(s) {
  const st = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const a = Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? s * 0.45 : s;
    i ? st.lineTo(Math.cos(a) * r, Math.sin(a) * r) : st.moveTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  return st;
}
export function makeFace(g, face, gender, eyeColor) {
  const EY = HY + 0.03, MY = HY - 0.11, DARK = 0x1b1b1b;
  const arc = (r, t, c, up) => { const m = new THREE.Mesh(new THREE.TorusGeometry(r, t, 6, 14, Math.PI), basic(c)); if (!up) m.rotation.z = Math.PI; return m; };
  // 동그란 눈 (눈동자 색 + 반짝이)
  const dotEye = (x, sy = 1.25) => {
    const e = ball(g, 0.065, eyeColor, x, EY, faceZ(x, EY) + 0.025, 1, sy, 0.6, true);
    if (sy > 0.8) ball(g, 0.022, 0xffffff, x + 0.025, EY + 0.04, faceZ(x + 0.025, EY + 0.04) + 0.006, 1, 1, 1, true);
    return e;
  };
  const closedEye = (x, up = true) => onFace(g, arc(0.05, 0.014, DARK, up), x, EY - (up ? 0.02 : -0.02));
  const smile = () => onFace(g, arc(0.05, 0.012, 0x5a2a2a, false), 0, MY + 0.02);
  const bigSmile = (tongue = true) => {
    const sh = new THREE.Shape(); sh.moveTo(-0.07, 0); sh.quadraticCurveTo(0, -0.13, 0.07, 0); sh.lineTo(-0.07, 0);
    const m = onFace(g, new THREE.Mesh(new THREE.ShapeGeometry(sh, 12), basic(0x7a2030)), 0, MY + 0.03);
    if (tongue) ball(g, 0.03, 0xff7a8a, 0, MY - 0.02, faceZ(0, MY - 0.02) - 0.002, 1.1, 0.6, 0.3, true);
    return m;
  };
  const brow = (s, ang, thick, col, y = HY + 0.15) => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.11, thick, 0.01), basic(col));
    return onFace(g, b, s * 0.14, y, s * ang);
  };
  const blush = () => {
    for (const sx of [-0.24, 0.24]) {
      const b = ball(g, 0.06, gender === 'f' ? 0xff8aa8 : 0xff9bb3, sx, HY - 0.08, faceZ(sx, HY - 0.08) + 0.02, 1.2, 0.7, 0.3, true);
      b.material.transparent = true; b.material.opacity = 0.75;
    }
  };

  if (face === 'zombie') {
    for (const sx of [-0.14, 0.14]) ball(g, 0.065, 0xff2a2a, sx, EY, faceZ(sx, EY) + 0.025, 1, 1.25, 0.6, true);
    onFace(g, new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.03, 0.02), basic(0x2a3a1a)), 0, MY - 0.02, 0.15);
    return;
  }
  // 성별에 따른 눈썹/속눈썹 (화난 얼굴은 화난 눈썹)
  if (face === 'f_angry') {
    for (const s of [-1, 1]) brow(s, 0.45, 0.032, 0x2b2b2b, HY + 0.13);
  } else {
    for (const s of [-1, 1]) {
      if (gender === 'f') {
        for (const k of [0, 1]) {
          const lash = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.014, 0.01), basic(DARK));
          onFace(g, lash, s * (0.2 + k * 0.012), HY + 0.09 - k * 0.025, s * (0.5 + k * 0.3));
        }
      } else brow(s, -0.12, gender === 'm' ? 0.03 : 0.018, gender === 'm' ? 0x2b2b2b : 0x7a5a48);
    }
  }
  if (face !== 'f_angry' && face !== 'f_cool') blush();

  switch (face) {
    case 'f_happy': closedEye(-0.14); closedEye(0.14); bigSmile(true); break;
    case 'f_wink': dotEye(-0.14); onFace(g, arc(0.05, 0.014, DARK, true), 0.14, EY - 0.02); bigSmile(true); break;
    case 'f_sleepy':
      for (const x of [-0.14, 0.14]) onFace(g, new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.016, 0.01), basic(DARK)), x, EY - 0.01);
      onFace(g, new THREE.Mesh(new THREE.TorusGeometry(0.025, 0.01, 6, 14), basic(0x5a2a2a)), 0, MY);
      break;
    case 'f_angry':
      dotEye(-0.14, 1); dotEye(0.14, 1);
      onFace(g, arc(0.045, 0.012, 0x5a2a2a, true), 0, MY - 0.02);
      break;
    case 'f_cool':
      for (const x of [-0.14, 0.14]) {
        dotEye(x, 0.7);
        onFace(g, new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.02, 0.01), basic(DARK)), x, EY + 0.045); // 반쯤 감은 눈꺼풀
      }
      onFace(g, arc(0.045, 0.012, 0x5a2a2a, false), 0.04, MY + 0.02, -0.35); // 비스듬한 미소
      break;
    case 'f_cat':
      dotEye(-0.14); dotEye(0.14);
      for (const sx of [-0.035, 0.035]) onFace(g, arc(0.035, 0.011, 0x5a2a2a, false), sx, MY + 0.02); // ω 입
      for (const s of [-1, 1]) for (const k of [-1, 0, 1]) {
        onFace(g, new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.008, 0.005), basic(0x5a3a2a)), s * 0.27, MY + 0.03 + k * 0.03, s * k * 0.15);
      }
      break;
    case 'f_star':
      for (const x of [-0.14, 0.14]) onFace(g, new THREE.Mesh(new THREE.ShapeGeometry(starShape(0.08)), basic(0xffd34d)), x, EY);
      bigSmile(false);
      break;
    case 'f_heart':
      for (const x of [-0.14, 0.14]) onFace(g, new THREE.Mesh(new THREE.ShapeGeometry(heartShape(0.065)), basic(0xff4d88)), x, EY);
      smile();
      break;
    default: // 기본 얼굴
      dotEye(-0.14); dotEye(0.14); smile();
  }
}

// ---------- 날개 ----------
// 등(뒤쪽 +z)에 붙어요. 왼쪽 날개를 만들고 오른쪽은 거울처럼 뒤집어요.
// 날개 좌표: x = 바깥쪽, y = 위쪽 (뿌리가 0,0)
const shapeMesh = (shape, mat, z = 0) => { const m = new THREE.Mesh(new THREE.ShapeGeometry(shape, 24), mat); m.position.z = z; return m; };
const lineOf = (pts, color, z = 0.004, opacity = 1) => {
  const geo = new THREE.BufferGeometry().setFromPoints(pts.map(([x, y]) => new THREE.Vector3(x, y, z)));
  return new THREE.Line(geo, new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity }));
};

// 요정 날개: 길고 뾰족한 윗날개 + 작고 꼬리가 긴 아랫날개, 진주빛 반투명
function fairyWing(wg) {
  const up = new THREE.Shape();
  up.moveTo(0, 0);
  up.bezierCurveTo(0.05, 0.25, 0.3, 0.62, 0.56, 0.86);   // 위쪽 가장자리 → 뾰족한 끝
  up.bezierCurveTo(0.62, 0.62, 0.5, 0.28, 0.06, -0.02);  // 바깥 가장자리 → 뿌리
  const low = new THREE.Shape();
  low.moveTo(0, -0.03);
  low.bezierCurveTo(0.26, -0.05, 0.42, -0.22, 0.34, -0.4);
  low.bezierCurveTo(0.33, -0.5, 0.36, -0.62, 0.42, -0.74); // 길게 빠진 꼬리
  low.bezierCurveTo(0.28, -0.6, 0.12, -0.36, 0, -0.06);
  const mk = (col, op) => lam(col, { side: THREE.DoubleSide, transparent: true, opacity: op, depthWrite: false });
  for (const sh of [up, low]) {
    wg.add(shapeMesh(sh, mk(0xe9f3ff, 0.5), 0));
    const inner = shapeMesh(sh, mk(0xffd9f4, 0.35), 0.003); inner.scale.set(0.82, 0.82, 1); wg.add(inner); // 안쪽은 분홍빛
    const core = shapeMesh(sh, mk(0xd9ccff, 0.3), 0.006); core.scale.set(0.55, 0.55, 1); wg.add(core);    // 뿌리 쪽은 보랏빛
  }
  // 테두리와 날개맥
  wg.add(lineOf(up.getPoints(30).map(p => [p.x, p.y]), 0xc9b8ff));
  wg.add(lineOf(low.getPoints(30).map(p => [p.x, p.y]), 0xc9b8ff));
  for (const [x, y] of [[0.5, 0.74], [0.42, 0.5], [0.3, 0.3], [0.18, 0.14]]) wg.add(lineOf([[0.02, 0], [x * 0.55, y * 0.55], [x, y]], 0xe0d4ff, 0.008, 0.8));
  for (const [x, y] of [[0.36, -0.62], [0.3, -0.36], [0.18, -0.2]]) wg.add(lineOf([[0.02, -0.04], [x, y]], 0xe0d4ff, 0.008, 0.8));
  wg.position.z = 0.02;
}

// 천사 날개: 위로 솟은 날개뼈 + 비늘처럼 겹친 짧은 깃털 + 아래로 펼쳐진 긴 깃털
function angelWing(wg) {
  // 날개뼈(앞 가장자리) 곡선: 뿌리 → 위/바깥 끝
  const arm = t => [0.05 + 0.75 * t, 0.06 + 0.62 * Math.sin(t * Math.PI * 0.62)];
  const feather = (cx, cy, len, wid, ang, col, z) => {
    const f = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), lam(col));
    f.scale.set(len / 2, wid, 0.018); f.rotation.z = ang;
    f.position.set(cx, cy, z); wg.add(f); return f;
  };
  // 긴 깃털(아래로 부채꼴)
  const N = 9;
  for (let i = 0; i < N; i++) {
    const t = 0.18 + (i / (N - 1)) * 0.82;
    const [ax, ay] = arm(t);
    const L = 0.32 + 0.3 * t;
    const ang = -Math.PI / 2 + 0.25 + t * 0.85; // 안쪽은 아래로, 바깥쪽은 바깥으로
    feather(ax + Math.cos(ang) * L / 2, ay + Math.sin(ang) * L / 2, L, 0.055, ang, i % 2 ? 0xffffff : 0xf1f1f4, 0);
  }
  // 짧은 깃털 두 줄 (뒤에서 보면 위에 겹쳐 보여요)
  for (const [row, L, off] of [[0, 0.2, 0.08], [1, 0.12, 0.03]]) {
    for (let i = 0; i < 7; i++) {
      const t = 0.08 + i * 0.13;
      const [ax, ay] = arm(t);
      const ang = -Math.PI / 2 + 0.35 + t * 0.6;
      feather(ax + Math.cos(ang) * (L / 2 + off), ay + Math.sin(ang) * (L / 2 + off), L, 0.06, ang, row ? 0xffffff : 0xf6f6f8, 0.02 + row * 0.015);
    }
  }
  // 날개뼈를 따라 둥근 깃털 줄
  for (let i = 0; i <= 8; i++) {
    const [ax, ay] = arm(i / 8);
    ball(wg, 0.055 - i * 0.003, 0xffffff, ax, ay, 0.03, 1.4, 1, 0.5);
  }
}

// 악마(박쥐) 날개: 위쪽 뼈 + 갈고리 발톱 + 손가락뼈 사이 물결치는 막
function devilWing(wg) {
  const wrist = [0.3, 0.5], fingers = [[0.7, -0.38], [0.44, -0.6], [0.2, -0.46]];
  const sh = new THREE.Shape();
  sh.moveTo(0, 0.02);
  sh.quadraticCurveTo(0.08, 0.34, wrist[0], wrist[1]);
  sh.quadraticCurveTo(0.66, 0.32, fingers[0][0], fingers[0][1]);   // 바깥 가장자리
  sh.quadraticCurveTo(0.5, -0.28, fingers[1][0], fingers[1][1]);   // 물결 1
  sh.quadraticCurveTo(0.34, -0.3, fingers[2][0], fingers[2][1]);   // 물결 2
  sh.quadraticCurveTo(0.1, -0.18, 0, -0.06);                       // 물결 3 → 뿌리
  wg.add(shapeMesh(sh, lam(0x2c2a33, { side: THREE.DoubleSide })));
  const inner = shapeMesh(sh, lam(0x3d3a47, { side: THREE.DoubleSide }), 0.004); inner.scale.set(0.7, 0.7, 1); inner.position.x = 0.06; wg.add(inner);
  // 뼈 (원기둥으로 두 점 잇기)
  const bone = (a, b, r) => {
    const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.8, len, 8), lam(0x151419));
    m.position.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 0.012); m.rotation.z = Math.atan2(dy, dx) - Math.PI / 2; wg.add(m);
  };
  bone([0, 0.02], [0.12, 0.3], 0.03); bone([0.12, 0.3], wrist, 0.028);
  for (const f of fingers) bone(wrist, f, 0.016);
  ball(wg, 0.04, 0x151419, wrist[0], wrist[1], 0.012);
  // 위쪽 갈고리 발톱
  const claw = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.14, 8), lam(0x0d0c10));
  claw.position.set(wrist[0] - 0.05, wrist[1] + 0.08, 0.012); claw.rotation.z = 0.9; wg.add(claw);
}

function makeWings(id) {
  const root = new THREE.Group(); root.position.set(0, 0.88, 0.3);
  const pivots = [];
  for (const s of [-1, 1]) {
    const p = new THREE.Group(); p.position.x = s * 0.06; root.add(p); pivots.push(p);
    const wg = new THREE.Group(); wg.scale.x = s; p.add(wg);
    if (id === 'w_angel') angelWing(wg);
    else if (id === 'w_devil') devilWing(wg);
    else fairyWing(wg); // w_fairy (예전 나비 날개도 요정 날개로)
  }
  shadow(root);
  return { root, pivots };
}

// ---------- 꼬리 ----------
function makeTail(id, hairColor) {
  const root = new THREE.Group(); root.position.set(0, 0.42, 0.3); // 엉덩이 쪽
  const seg = (r, len, c, x, y, z, rx) => {
    const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 4, 10), lam(c)); m.position.set(x, y, z); m.rotation.x = rx; root.add(m); return m;
  };
  if (id === 't_devil') { // 가늘고 끝이 화살촉 모양
    seg(0.025, 0.2, 0xc0392b, 0, -0.02, 0.1, 1.3);
    seg(0.025, 0.2, 0xc0392b, 0, 0.06, 0.27, 0.6);
    seg(0.025, 0.16, 0xc0392b, 0, 0.2, 0.36, 0.1);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.14, 3), lam(0xc0392b)); tip.position.set(0, 0.34, 0.37); tip.scale.z = 0.3; root.add(tip);
  } else if (id === 't_cat') { // 위로 동그랗게 말린 고양이 꼬리 (머리색)
    seg(0.05, 0.18, hairColor, 0, 0, 0.1, 1.2);
    seg(0.05, 0.18, hairColor, 0, 0.12, 0.24, 0.5);
    seg(0.05, 0.14, hairColor, 0, 0.3, 0.27, -0.2);
    ball(root, 0.055, 0xffffff, 0, 0.42, 0.24);
  } else if (id === 't_dino') { // 통통한 공룡 꼬리 + 등 가시
    const t = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.6, 14), lam(0x3ccf6e));
    t.rotation.x = Math.PI / 2 + 0.35; t.position.set(0, -0.08, 0.27); root.add(t);
    for (const [y, z, h] of [[0.06, 0.16, 0.12], [0.0, 0.32, 0.1], [-0.07, 0.46, 0.07]]) {
      const sp = new THREE.Mesh(new THREE.ConeGeometry(0.04, h, 4), lam(0xffd34d)); sp.position.set(0, y + 0.06, z); root.add(sp);
    }
  }
  shadow(root);
  return root;
}

// ---------- 캐릭터 전체 ----------
// look = [모자, 얼굴, 피부, 머리스타일, 머리색, 성별, 눈 색, 날개, 꼬리, 옷 색]
export function buildCharacter(look = [], opts = {}) {
  const [hatId, faceId, skinId, hairId, hcolorId, gender = 'n', ecolorId = '', wingId = '', tailId = '', bcolorId = ''] = look;
  const zombie = !!opts.zombie;
  const skin = zombie ? 0x8fd16a : SKIN_COLOR[skinId] ?? DEFAULT_SKIN;
  // 옷 색: 팀전에서는 팀 색, 나머지는 고른 색
  const bodyColor = zombie ? 0x4a7a35 : (opts.teamColor ?? BODY_COLOR[bcolorId] ?? opts.bodyColor ?? 0x3d8bff);
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
  // 얼굴 (눈썹, 볼터치, 눈, 입)
  makeFace(inner, zombie ? 'zombie' : faceId, gender, EYE_COLOR[ecolorId] ?? 0x1b1b1b);
  // 머리카락
  inner.add(makeHair(hairStyle, hairColor, hatId));
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
  let wings = null, tail = null;
  if (wingId) { const w = makeWings(wingId); inner.add(w.root); wings = w.pivots; }
  if (tailId) { tail = makeTail(tailId, hairColor); inner.add(tail); }
  shadow(inner);
  return { inner, arm, body, wings, tail };
}

// 날개 파닥, 꼬리 살랑 (t = 밀리초)
export function animateExtras(c, t, phase = 0) {
  if (c.wings) c.wings.forEach((p, i) => (p.rotation.y = (i ? -1 : 1) * (0.35 + Math.sin(t * 0.006 + phase) * 0.3)));
  if (c.tail) c.tail.rotation.y = Math.sin(t * 0.004 + phase) * 0.45;
}
