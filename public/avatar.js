// =====================================================
//  블록 캐릭터 만들기 (로블록스 아바타 같은 모양) (게임 화면과 로비 미리보기가 같이 써요)
// =====================================================
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
export { THREE };

// 로블록스 아바타 같은 블록 캐릭터: 다리 0~0.72, 몸통 0.72~1.44, 머리 가운데 1.70
export const HEAD_Y = 1.70, HEAD_R = 0.27;
const HY = HEAD_Y, R = HEAD_R, HH = 0.23; // HH = 머리 높이의 절반

export const BODY_COLOR = {
  b_red: 0xe84848, b_orange: 0xff9f1c, b_yellow: 0xffd43b, b_green: 0x3ccf6e, b_pink: 0xff8fc8,
  b_purple: 0x9b6bff, b_white: 0xf4f4f6, b_black: 0x2d2f36, b_mint: 0x6ee7c8, b_gold: 0xe0b23a,
};
export const PANTS_COLOR = {
  p_navy: 0x2b3a67, p_black: 0x25262b, p_gray: 0x7a7f8a, p_jean: 0x4f74a8, p_brown: 0x6b4a32, p_white: 0xeeeeee,
  p_red: 0xc23b3b, p_green: 0x2f8a4a, p_pink: 0xff8fc8, p_purple: 0x8a5cd6, p_mint: 0x6ee7c8, p_gold: 0xe0b23a,
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
function ball(g, r, color, x, y, z, sx = 1, sy = 1, sz = 1, basic = false) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 12), basic ? new THREE.MeshBasicMaterial({ color }) : lam(color));
  m.position.set(x, y, z); m.scale.set(sx, sy, sz); g.add(m);
  return m;
}

// ---------- 블록 머리 모양 ----------
// 머리 = 모서리가 둥근 원기둥 (로블록스 아바타 느낌). 머리카락/모자도 같은 모양으로 감싸요.
// 둥근 원기둥 옆모습 점들 (위 가운데 → 바깥 → 아래로, y는 머리 가운데 기준), yCut 아래는 잘라요
function rcProfile(r, hh, c, yCut = -99) {
  const pts = [new THREE.Vector2(0.0001, hh)];
  for (let i = 0; i <= 8; i++) {
    const a = (i / 8) * Math.PI / 2;
    pts.push(new THREE.Vector2(r - c + Math.sin(a) * c, hh - c + Math.cos(a) * c));
  }
  pts.push(new THREE.Vector2(r, -hh + c));
  for (let i = 1; i <= 8; i++) {
    const a = Math.PI / 2 + (i / 8) * Math.PI / 2;
    pts.push(new THREE.Vector2(r - c + Math.sin(a) * c, -hh + c + Math.cos(a) * c));
  }
  pts.push(new THREE.Vector2(0.0001, -hh));
  const out = pts.filter(p => p.y >= yCut);
  if (out.length < pts.length) out.push(new THREE.Vector2(r, Math.max(yCut, -hh + c))); // 잘린 끝
  return out;
}
// 감싸는 껍데기. open = 얼굴(앞쪽) 쪽으로 비워 둘 각도
function wrap(r, hh, c, yCut, color, open = 0, y0 = HY) {
  const prof = rcProfile(r, hh, c, yCut);
  const m = new THREE.Mesh(new THREE.LatheGeometry(prof, 32, Math.PI + open / 2, Math.PI * 2 - open), lam(color, { side: THREE.DoubleSide }));
  m.position.y = y0;
  return m;
}
// 옆/뒤 머리 (위쪽 y1부터 아래 y2까지, 앞은 비움)
function band(r, y1, y2, color, open) {
  const prof = [new THREE.Vector2(r, y1), new THREE.Vector2(r, y2)];
  const m = new THREE.Mesh(new THREE.LatheGeometry(prof, 32, Math.PI + open / 2, Math.PI * 2 - open), lam(color, { side: THREE.DoubleSide }));
  m.position.y = HY;
  return m;
}
function box(g, w, h, d, color, x, y, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), lam(color));
  m.position.set(x, y, z); g.add(m);
  return m;
}

// ---------- 머리카락 ----------
function makeHair(style, color, hatId) {
  const g = new THREE.Group();
  if (!style || style === 'h_bald') return g;
  const covered = COVER_HATS.has(hatId);
  const add = m => { g.add(m); return m; };
  const hr = R + 0.025;
  const top = () => add(wrap(hr, HH + 0.025, 0.11, 0.11, color));      // 정수리~이마 위
  const sides = (y2, open = 2.5, r = hr) => add(band(r, 0.13, y2, color, open)); // 옆, 뒤
  const fringe = (n = 3) => { // 앞머리
    const w = 0.42 / n;
    for (let i = 0; i < n; i++) {
      const x = -0.21 + w / 2 + i * w;
      const b = box(g, w - 0.01, 0.08, 0.05, color, x, HY + 0.145 - (i % 2) * 0.012, -Math.sqrt(hr * hr - x * x) + 0.005);
      b.rotation.set(-0.15, Math.asin(x / hr), 0); // 둥근 이마를 따라 붙어요
    }
  };
  switch (style) {
    case 'h_short': top(); sides(-0.03); fringe(3); break;
    case 'h_long':
      top(); sides(-HH, 2.1); fringe(4);
      box(g, 0.5, 0.42, 0.09, color, 0, HY - HH - 0.17, hr - 0.03);        // 등 뒤로 내려오는 긴 머리
      for (const s of [-1, 1]) box(g, 0.08, 0.36, 0.12, color, s * (hr - 0.02), HY - 0.2, -0.08); // 앞으로 내려온 머리
      break;
    case 'h_bob': top(); sides(-0.16, 2.3, hr + 0.035); fringe(4); break;
    case 'h_pony': {
      top(); sides(-0.03); fringe(3);
      ball(g, 0.045, 0xff5c8a, 0, HY + 0.05, hr + 0.03);
      const t = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.34, 6, 12), lam(color));
      t.position.set(0, HY - 0.15, hr + 0.1); t.rotation.x = 0.35; add(t);
      break;
    }
    case 'h_twin':
      top(); sides(-0.03); fringe(3);
      for (const s of [-1, 1]) {
        ball(g, 0.045, 0xff5c8a, s * (hr + 0.02), HY + 0.06, 0.04);
        const t = new THREE.Mesh(new THREE.CapsuleGeometry(0.07, 0.32, 6, 12), lam(color));
        t.position.set(s * (hr + 0.08), HY - 0.13, 0.04); t.rotation.z = s * 0.3; add(t);
      }
      break;
    case 'h_spiky':
      top(); sides(-0.01); fringe(3);
      if (!covered) for (const [x, z, h] of [[0, 0, 0.2], [-0.15, -0.08, 0.15], [0.15, -0.08, 0.15], [-0.12, 0.13, 0.16], [0.12, 0.13, 0.16], [0, -0.17, 0.13]]) {
        const c = new THREE.Mesh(new THREE.ConeGeometry(0.07, h, 4), lam(color));
        c.position.set(x, HY + HH + 0.02 + h / 2, z); c.rotation.set(z * 1.5, 0.78, -x * 1.5); add(c);
      }
      break;
    case 'h_curly':
      sides(-0.08, 2.4);
      if (!covered) add(wrap(hr - 0.005, HH + 0.02, 0.11, 0.11, color));
      for (let i = 0; i < 22; i++) {
        const a = i * 2.4, rr = 0.06 + (i % 4) * 0.06, y = HH + 0.03;
        let x = Math.sin(a) * rr, z = Math.cos(a) * rr;
        if (covered) continue;
        ball(g, 0.07, color, x, HY + y, z, 1, 0.8, 1);
      }
      for (let i = 0; i < 12; i++) { // 옆/뒤 곱슬
        const a = Math.PI + 1.3 + i * ((Math.PI * 2 - 2.6) / 11);
        ball(g, 0.07, color, Math.sin(a) * (hr + 0.02), HY + 0.06 - (i % 2) * 0.1, Math.cos(a) * (hr + 0.02));
      }
      break;
  }
  shadow(g);
  return g;
}

// ---------- 모자 (블록 머리 모양에 맞게) ----------
const HTOP = HY + HH; // 머리 꼭대기
export function makeHat(id) {
  const g = new THREE.Group();
  const add = m => { g.add(m); return m; };
  if (id === 'cap') { // 야구모자: 머리 윗부분을 감싸고 앞 챙
    add(wrap(R + 0.06, HH + 0.06, 0.13, 0.06, 0xd03030));
    const brim = add(new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.03, 24, 1, false, Math.PI / 2, Math.PI), lam(0xd03030)));
    brim.position.set(0, HY + 0.07, -(R + 0.04)); brim.rotation.x = -0.1;
    ball(g, 0.035, 0xd03030, 0, HTOP + 0.065, 0);
  } else if (id === 'beanie') { // 비니 + 접힌 부분 + 방울
    add(wrap(R + 0.065, HH + 0.07, 0.16, 0.0, 0x3b6bd6));
    const b = add(new THREE.Mesh(new THREE.TorusGeometry(R + 0.07, 0.045, 10, 32), lam(0x2c55b8)));
    b.rotation.x = Math.PI / 2; b.position.y = HY + 0.01;
    ball(g, 0.08, 0xffffff, 0, HTOP + 0.13, 0);
  } else if (id === 'helmet') { // 군인 헬멧 + 테두리 + 턱끈
    add(wrap(R + 0.085, HH + 0.085, 0.18, -0.05, 0x556b2f));
    const rim = add(new THREE.Mesh(new THREE.TorusGeometry(R + 0.085, 0.03, 8, 36), lam(0x46592a)));
    rim.rotation.x = Math.PI / 2; rim.position.y = HY - 0.05;
    const strap = add(new THREE.Mesh(new THREE.TorusGeometry(R + 0.012, 0.014, 6, 30, Math.PI), lam(0x3a3a2a)));
    strap.rotation.z = Math.PI; strap.scale.y = (HH + 0.03) / (R + 0.012); strap.position.set(0, HY - 0.02, 0);
  } else if (id === 'tophat') { // 신사 모자
    const y = HTOP + 0.035;
    add(new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.03, 28), lam(0x1a1a1a))).position.y = y;
    add(new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.42, 28), lam(0x1a1a1a))).position.y = y + 0.21;
    add(new THREE.Mesh(new THREE.CylinderGeometry(0.245, 0.245, 0.07, 28), lam(0xb02020))).position.y = y + 0.06;
  } else if (id === 'party') { // 고깔모자 (살짝 기울여서)
    const pg = new THREE.Group();
    const c = new THREE.Mesh(new THREE.ConeGeometry(0.19, 0.48, 18), lam(0xff5cc8)); c.position.y = 0.24; pg.add(c);
    for (const [y, col] of [[0.1, 0xffe14d], [0.26, 0x4dc3ff]]) {
      const st = new THREE.Mesh(new THREE.TorusGeometry(0.19 * (1 - y / 0.48), 0.017, 6, 20), lam(col));
      st.rotation.x = Math.PI / 2; st.position.y = y; pg.add(st);
    }
    const pom = new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 8), lam(0xffe14d)); pom.position.y = 0.5; pg.add(pom);
    pg.position.set(0.07, HTOP + 0.01, 0); pg.rotation.z = -0.25; add(pg);
  } else if (id === 'bunny') { // 토끼 귀 머리띠
    const bw = R + 0.045, bh = HH + 0.045;
    const bd = add(new THREE.Mesh(new THREE.TorusGeometry(bw, 0.026, 8, 28, Math.PI), lam(0xff9bc8)));
    bd.scale.y = bh / bw; bd.position.set(0, HY, 0.04);
    for (const s of [-1, 1]) {
      const a = 0.5, eg = new THREE.Group();
      eg.position.set(s * bw * Math.sin(a), HY + bh * Math.cos(a), 0.04);
      eg.rotation.z = -s * 0.25;
      const ear = new THREE.Mesh(new THREE.CapsuleGeometry(0.07, 0.32, 6, 12), lam(0xffffff)); ear.position.y = 0.22; ear.scale.z = 0.55;
      const inner = new THREE.Mesh(new THREE.CapsuleGeometry(0.038, 0.24, 6, 12), lam(0xffb6d5)); inner.position.set(0, 0.22, -0.032); inner.scale.z = 0.4;
      eg.add(ear, inner);
      if (s === 1) eg.rotation.x = -0.3;
      add(eg);
    }
  } else if (id === 'halo') { // 천사 링
    const halo = add(new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.035, 10, 36), new THREE.MeshBasicMaterial({ color: 0xffe066 })));
    halo.rotation.x = Math.PI / 2 - 0.15; halo.position.y = HTOP + 0.28;
    const glow = add(new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.07, 8, 36), new THREE.MeshBasicMaterial({ color: 0xfff2b0, transparent: true, opacity: 0.35 })));
    glow.rotation.copy(halo.rotation); glow.position.copy(halo.position);
  } else if (id === 'horns') { // 악마 뿔
    for (const s of [-1, 1]) {
      const hg = new THREE.Group();
      const base = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.15, 10), lam(0xc0392b)); base.position.y = 0.06; hg.add(base);
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.042, 0.13, 10), lam(0x8e1b1b));
      tip.position.set(s * 0.025, 0.17, 0); tip.rotation.z = -s * 0.35; hg.add(tip);
      hg.position.set(s * 0.17, HTOP - 0.01, -0.03); hg.rotation.z = -s * 0.35; add(hg);
    }
  } else if (id === 'crown') { // 왕관: 머리 위에 딱 앉아요
    const rr = 0.25, y = HTOP + 0.1;
    add(new THREE.Mesh(new THREE.CylinderGeometry(rr + 0.02, rr, 0.15, 24, 1, true), lam(0xffc83d, { side: THREE.DoubleSide }))).position.y = y;
    for (let i = 0; i < 6; i++) {
      const a = i / 6 * Math.PI * 2;
      const sp = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.13, 6), lam(0xffc83d));
      sp.position.set(Math.cos(a) * (rr + 0.02), y + 0.13, Math.sin(a) * (rr + 0.02)); g.add(sp);
      ball(g, 0.022, 0xffffff, Math.cos(a) * (rr + 0.02), y + 0.2, Math.sin(a) * (rr + 0.02));
    }
    ball(g, 0.045, 0xe0245e, 0, y, -rr - 0.02);
    ball(g, 0.035, 0x3bb0ff, -0.19, y, -0.19);
    ball(g, 0.035, 0x3bb0ff, 0.19, y, -0.19);
  }
  shadow(g);
  return g;
}

// ---------- 얼굴 ----------
// 얼굴은 반지름 0.4짜리 가상 원기둥 앞면에 그린 다음, 진짜 머리 크기로 줄여서 붙여요
const FR = 0.4, FK = R / FR;
const faceZ = (x, y) => -Math.sqrt(Math.max(0, FR * FR - x * x)) - 0.014;
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
export function makeFace(parent, face, gender, eyeColor) {
  const g = new THREE.Group(); g.position.y = HEAD_Y; g.scale.set(FK, FK, FK); parent.add(g);
  const HY = 0, R = FR; // 이 안에서는 가상 좌표
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
  const root = new THREE.Group(); root.position.set(0, 1.25, 0.2); // 등
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
  const root = new THREE.Group(); root.position.set(0, 0.78, 0.2); // 엉덩이 쪽
  const seg = (r, len, c, x, y, z, rx) => {
    const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 4, 10), lam(c)); m.position.set(x, y, z); m.rotation.x = rx; root.add(m); return m;
  };
  if (id === 't_devil') { // 매끄럽게 동그랗게 말린 꼬리 + 끝은 둥근 하트 모양 화살촉
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0, 0.02), new THREE.Vector3(0, -0.16, 0.2), new THREE.Vector3(0, -0.12, 0.42),
      new THREE.Vector3(0, 0.08, 0.55), new THREE.Vector3(0, 0.3, 0.5), new THREE.Vector3(0, 0.38, 0.32),
      new THREE.Vector3(0, 0.3, 0.2),
    ]);
    root.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 40, 0.028, 8, false), lam(0xc0392b)));
    const end = curve.getPoint(1), dir = curve.getTangent(1);
    const tip = new THREE.Mesh(new THREE.ShapeGeometry(heartShape(0.09), 16), lam(0xc0392b, { side: THREE.DoubleSide }));
    tip.rotation.y = Math.PI / 2;                                   // 옆에서 보이게
    const tg = new THREE.Group(); tg.add(tip);
    tg.position.copy(end);
    tg.rotation.x = Math.atan2(-dir.z, -dir.y);                     // 뾰족한 끝이 꼬리가 가는 방향으로
    root.add(tg);
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
// look = [모자, 얼굴, 피부, 머리스타일, 머리색, 성별, 눈 색, 날개, 꼬리, 윗옷 색, 바지 색]
export function buildCharacter(look = [], opts = {}) {
  const [hatId, faceId, skinId, hairId, hcolorId, gender = 'n', ecolorId = '', wingId = '', tailId = '', bcolorId = '', pcolorId = ''] = look;
  const zombie = !!opts.zombie;
  const skin = zombie ? 0x8fd16a : SKIN_COLOR[skinId] ?? DEFAULT_SKIN;
  // 옷 색(윗옷): 팀전에서는 팀 색, 나머지는 고른 색. 바지는 조금 어두운 색
  const bodyColor = zombie ? 0x4a7a35 : (opts.teamColor ?? BODY_COLOR[bcolorId] ?? opts.bodyColor ?? 0x3d8bff);
  const pantsColor = zombie ? 0x3b4a7a : PANTS_COLOR[pcolorId] ?? new THREE.Color(bodyColor).multiplyScalar(0.55).getHex();
  const hairColor = HAIR_COLOR[hcolorId] ?? DEFAULT_HAIR_COLOR;
  const hairStyle = hairId || DEFAULT_HAIR[gender] || 'h_bob';
  const inner = new THREE.Group();

  // 다리 (엉덩이를 기준으로 앞뒤로 흔들 수 있게)
  const legs = [];
  for (const s of [-1, 1]) {
    const leg = new THREE.Group(); leg.position.set(s * 0.18, 0.72, 0);
    const m = box(leg, 0.35, 0.72, 0.36, pantsColor, 0, -0.36, 0);
    box(leg, 0.36, 0.1, 0.38, 0x2d2f36, 0, -0.67, -0.005); // 신발
    m.castShadow = true; inner.add(leg); legs.push(leg);
  }
  // 몸통
  const body = box(inner, 0.72, 0.72, 0.36, bodyColor, 0, 1.08, 0);
  // 머리 (모서리가 둥근 원기둥)
  inner.add(wrap(R, HH, 0.09, -99, skin));
  // 얼굴 (눈썹, 볼터치, 눈, 입)
  makeFace(inner, zombie ? 'zombie' : faceId, gender, EYE_COLOR[ecolorId] ?? 0x1b1b1b);
  // 머리카락
  inner.add(makeHair(hairStyle, hairColor, hatId));
  // 팔: 어깨를 기준으로 돌아요. 총 들 때(게임)는 앞으로, 미리보기에서는 아래로
  const arm = new THREE.Group(); arm.position.set(0, 1.38, 0);
  const wp = opts.weapon || 'wp_rifle';
  let muzzle = null;
  const forward = zombie || (opts.gun !== false && wp !== 'none');
  const oneArm = (s, yaw) => {
    const pivot = new THREE.Group(); pivot.position.x = s * 0.54; pivot.rotation.y = yaw;
    const a = new THREE.Group(); if (forward) a.rotation.x = Math.PI / 2; pivot.add(a);
    box(a, 0.34, 0.3, 0.36, zombie ? 0x4a7a35 : bodyColor, 0, -0.09, 0); // 소매
    box(a, 0.33, 0.44, 0.35, skin, 0, -0.45, 0);                          // 팔 + 손
    arm.add(pivot);
  };
  if (zombie) { oneArm(-1, 0); oneArm(1, 0); }
  else if (forward && ['wp_dagger', 'wp_katana', 'wp_gunblade', 'wp_scythe', 'wp_shield', 'wp_bow'].includes(wp)) {
    // 칼: 오른손으로 들고 왼팔은 내리기
    oneArm(1, 0.1);
    const lp = new THREE.Group(); lp.position.x = -0.54; arm.add(lp);
    const la = new THREE.Group(); la.rotation.x = 0.15; lp.add(la); // 왼팔은 거의 내리기
    box(la, 0.34, 0.3, 0.36, bodyColor, 0, -0.09, 0); box(la, 0.33, 0.44, 0.35, skin, 0, -0.45, 0);
    const blade = new THREE.Group(); blade.position.set(0.48, 0, -0.68); blade.rotation.x = -0.6; arm.add(blade); // 칼끝이 위쪽 앞으로
    if (wp === 'wp_shield') { // 방패는 몸 앞에 세워서
      blade.rotation.x = 0; blade.position.set(0.2, -0.25, -0.75);
      box(blade, 0.75, 0.95, 0.06, 0x3d4a5c, 0, 0, 0); box(blade, 0.5, 0.14, 0.065, 0x9fd0ff, 0, 0.25, 0);
    } else if (wp === 'wp_bow') {
      blade.rotation.x = 0; blade.position.set(0.48, 0.05, -0.75);
      for (const k of [-1, 1]) { const l = box(blade, 0.04, 0.5, 0.05, 0x8a5a2b, 0, k * 0.24, 0.04); l.rotation.x = k * 0.35; }
      box(blade, 0.01, 0.9, 0.01, 0xeeeeee, 0, 0, 0.14);
    } else if (wp === 'wp_scythe') {
      box(blade, 0.05, 1.5, 0.05, 0x4a2e18, 0, 0.45, 0);
      const bl = box(blade, 0.03, 0.12, 0.7, 0xd5dbe3, 0, 1.15, -0.3); bl.rotation.x = -0.25;
    } else if (wp === 'wp_gunblade') {
      box(blade, 0.07, 0.24, 0.12, 0x2b2f38, 0, -0.02, 0); box(blade, 0.04, 0.9, 0.1, 0xc9d3e0, 0, 0.55, 0);
    } else if (wp === 'wp_katana') {
      box(blade, 0.06, 0.24, 0.06, 0x2b1d4a, 0, -0.02, 0); box(blade, 0.16, 0.03, 0.1, 0xd4a64a, 0, 0.11, 0);
      box(blade, 0.03, 0.95, 0.08, 0xe9eef5, 0, 0.6, 0);
    } else {
      box(blade, 0.05, 0.14, 0.05, 0x5a3a22, 0, -0.02, 0); box(blade, 0.12, 0.03, 0.05, 0xb0b4bc, 0, 0.06, 0);
      box(blade, 0.025, 0.3, 0.06, 0xdde3ea, 0, 0.22, 0);
    }
  } else if (forward) {
    oneArm(1, 0.15); oneArm(-1, -0.6); // 오른팔은 총 잡고, 왼팔은 총 앞쪽 받치기
    const G = { // 총 모양: [길이, 두께, 색]
      wp_rifle: [0.75, 0.13, 0x2b2f38], wp_smg: [0.5, 0.12, 0x30343e], wp_shotgun: [0.8, 0.12, 0x6b4a2b],
      wp_sniper: [1.05, 0.11, 0x3a4a2e], wp_minigun: [0.8, 0.22, 0x3d3f45], wp_burst: [0.72, 0.13, 0x4a3b2a], wp_rpg: [1.1, 0.18, 0x4f5d3a],
    }[wp] || [0.75, 0.13, 0x2b2f38];
    const rifle = box(arm, G[1] * 0.8, G[1], G[0], G[2], 0.3, 0.02, -0.35 - G[0] / 2);
    box(arm, 0.06, 0.16, 0.08, G[2], 0.3, -0.1, -0.6); // 손잡이
    if (wp === 'wp_sniper') box(arm, 0.06, 0.06, 0.26, 0x111111, 0.3, 0.12, -0.7); // 조준경
    muzzle = new THREE.Group(); muzzle.position.set(0.3, 0.02, -0.38 - G[0]); arm.add(muzzle); // 총구 (총알이 나오는 곳)
    rifle.castShadow = true;
  } else { oneArm(1, 0); oneArm(-1, 0); }
  inner.add(arm);
  if (hatId) inner.add(makeHat(hatId));
  let wings = null, tail = null;
  if (wingId) { const w = makeWings(wingId); inner.add(w.root); wings = w.pivots; }
  if (tailId) { tail = makeTail(tailId, hairColor); inner.add(tail); }
  shadow(inner);
  return { inner, arm, body, wings, tail, legs, muzzle };
}

// 날개 파닥, 꼬리 살랑 (t = 밀리초)
export function animateExtras(c, t, phase = 0) {
  if (c.wings) c.wings.forEach((p, i) => (p.rotation.y = (i ? -1 : 1) * (0.35 + Math.sin(t * 0.006 + phase) * 0.3)));
  if (c.tail) c.tail.rotation.y = Math.sin(t * 0.004 + phase) * 0.45;
}
