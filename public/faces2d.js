// =====================================================
//  그림 얼굴 (캔버스에 직접 그려서 머리 앞에 붙여요)
//  사진의 스타일을 참고해서 새로 그린 얼굴들이에요.
//  좌표: 그림 512 x 480, 왼쪽 눈 (144,216), 오른쪽 눈 (368,216), 입 (256,329)
// =====================================================
export const FACE2D_W = 512, FACE2D_H = 480;
const LX = 144, RX = 368, EY = 216, MX = 256, MY = 329;

const css = hex => '#' + (hex >>> 0).toString(16).padStart(6, '0');
const shade = (hex, k) => { // k<1 어둡게, k>1 밝게
  const r = (hex >> 16) & 255, g = (hex >> 8) & 255, b = hex & 255;
  const f = v => Math.max(0, Math.min(255, Math.round(k < 1 ? v * k : v + (255 - v) * (k - 1))));
  return `rgb(${f(r)},${f(g)},${f(b)})`;
};

function line(c, pts, w, color = '#1b1b1b') {
  c.beginPath(); c.moveTo(pts[0][0], pts[0][1]);
  for (const [x, y] of pts.slice(1)) c.lineTo(x, y);
  c.lineWidth = w; c.lineCap = 'round'; c.lineJoin = 'round'; c.strokeStyle = color; c.stroke();
}
function blush(c, alpha = 0.55) {
  for (const x of [LX - 18, RX + 18]) {
    const g = c.createRadialGradient(x, EY + 62, 4, x, EY + 62, 46);
    g.addColorStop(0, `rgba(255,120,140,${alpha})`); g.addColorStop(1, 'rgba(255,120,140,0)');
    c.fillStyle = g; c.beginPath(); c.ellipse(x, EY + 62, 50, 30, 0, 0, 7); c.fill();
  }
}
function heartPath(c, x, y, s) {
  c.beginPath(); c.moveTo(x, y + s * 0.9);
  c.bezierCurveTo(x - s * 1.4, y, x - s * 0.7, y - s * 1.05, x, y - s * 0.35);
  c.bezierCurveTo(x + s * 0.7, y - s * 1.05, x + s * 1.4, y, x, y + s * 0.9);
  c.closePath();
}
function starPath(c, x, y, r) {
  c.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.45 : r;
    c[i ? 'lineTo' : 'moveTo'](x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  c.closePath();
}
// 반짝이는 애니 눈 (hl: 'dot' | 'heart' | 'star')
function animeEye(c, x0, y0, iris, hl, flip) {
  c.save(); c.translate(x0, y0); c.scale(1.3, 1.3); // 조금 크게
  const x = 0, y = 0, s = flip ? -1 : 1;
  // 흰자
  c.fillStyle = '#fbfbfd'; c.beginPath(); c.ellipse(x, y + 4, 40, 44, 0, 0, 7); c.fill();
  // 눈동자 (위는 어둡고 아래는 밝게)
  const g = c.createLinearGradient(0, y - 40, 0, y + 46);
  g.addColorStop(0, shade(iris, 0.35)); g.addColorStop(0.55, css(iris)); g.addColorStop(1, shade(iris, 1.45));
  c.fillStyle = g; c.beginPath(); c.ellipse(x, y + 6, 32, 40, 0, 0, 7); c.fill();
  c.fillStyle = shade(iris, 0.2); c.beginPath(); c.ellipse(x, y + 2, 15, 20, 0, 0, 7); c.fill();
  // 반짝이
  c.fillStyle = '#fff';
  if (hl === 'heart') { heartPath(c, x - 11 * s, y - 12, 13); c.fill(); }
  else if (hl === 'star') { starPath(c, x - 10 * s, y - 12, 15); c.fill(); }
  else { c.beginPath(); c.ellipse(x - 11 * s, y - 13, 11, 13, 0, 0, 7); c.fill(); }
  c.beginPath(); c.arc(x + 12 * s, y + 24, 5, 0, 7); c.fill();
  // 위 속눈썹 (두껍게 + 끝이 바깥으로 삐침)
  line(c, [[x - 44 * s, y - 14], [x - 20 * s, y - 40], [x + 14 * s, y - 42], [x + 40 * s, y - 26], [x + 54 * s, y - 34]], 9);
  line(c, [[x + 40 * s, y - 26], [x + 52 * s, y - 16]], 6);
  // 아래 속눈썹
  line(c, [[x - 18 * s, y + 50], [x + 16 * s, y + 49]], 3, 'rgba(27,27,27,.6)');
  c.restore();
}
function brows(c, lift = 0, color = 'rgba(40,40,40,.75)') {
  line(c, [[LX - 34, 146 + lift], [LX - 6, 138 + lift], [LX + 26, 142 + lift]], 4, color);
  line(c, [[RX + 34, 146 + lift], [RX + 6, 138 + lift], [RX - 26, 142 + lift]], 4, color);
}
const smallSmile = c => { c.beginPath(); c.arc(MX, MY - 12, 14, 0.2 * Math.PI, 0.8 * Math.PI); c.lineWidth = 4; c.strokeStyle = '#2a1a1a'; c.stroke(); };
const catMouth = (c, y = MY - 6, w = 4) => {
  c.lineWidth = w; c.strokeStyle = '#1b1b1b'; c.lineCap = 'round';
  c.beginPath(); c.arc(MX - 13, y, 13, 0, Math.PI); c.stroke();
  c.beginPath(); c.arc(MX + 13, y, 13, 0, Math.PI); c.stroke();
};
const squintEyes = (c, w = 13) => {
  line(c, [[LX - 40, EY - 30], [LX + 30, EY], [LX - 40, EY + 30]], w);
  line(c, [[RX + 40, EY - 30], [RX - 30, EY], [RX + 40, EY + 30]], w);
};

// 얼굴마다 그리기
export const FACES_2D = {
  // >_< + ω
  f_squint: (c) => { squintEyes(c); blush(c); catMouth(c, MY - 10, 7); },
  // >_< + 크게 웃는 입 + 송곳니
  f_xd: (c) => {
    squintEyes(c); blush(c);
    c.fillStyle = '#7a1424'; c.beginPath(); c.moveTo(MX - 60, MY - 26); c.lineTo(MX + 60, MY - 26); c.arc(MX, MY - 26, 60, 0, Math.PI); c.closePath(); c.fill();
    c.lineWidth = 5; c.strokeStyle = '#1b1b1b'; c.stroke();
    c.save(); c.clip(); c.fillStyle = '#ff7a8f'; c.beginPath(); c.ellipse(MX, MY + 30, 36, 20, 0, 0, 7); c.fill(); c.restore();
    c.fillStyle = '#fff'; c.beginPath(); c.moveTo(MX - 42, MY - 24); c.lineTo(MX - 26, MY - 24); c.lineTo(MX - 34, MY - 6); c.closePath(); c.fill();
  },
  // 하트 반짝 애니 눈
  f_kawaii: (c, e) => { brows(c, -14); blush(c); animeEye(c, LX, EY, e, 'heart'); animeEye(c, RX, EY, e, 'heart', true); smallSmile(c); },
  // 별 반짝 애니 눈
  f_starry: (c, e) => { brows(c, -14); blush(c); animeEye(c, LX, EY, e, 'star'); animeEye(c, RX, EY, e, 'star', true); catMouth(c, MY - 8, 3); },
  // 큰 반짝 까만 눈
  f_glossy: (c) => {
    blush(c, 0.4);
    for (const x of [LX, RX]) {
      c.fillStyle = '#0d0d10'; c.beginPath(); c.ellipse(x, EY + 6, 54, 58, 0, 0, 7); c.fill();
      c.fillStyle = '#fff'; c.beginPath(); c.ellipse(x - 18, EY - 16, 18, 15, -0.4, 0, 7); c.fill();
      c.beginPath(); c.arc(x + 20, EY + 26, 8, 0, 7); c.fill(); c.beginPath(); c.arc(x - 26, EY + 22, 5, 0, 7); c.fill();
    }
    line(c, [[MX - 12, MY - 6], [MX, MY - 18], [MX + 12, MY - 6]], 4);
  },
  // 웃으면서 눈 감은 얼굴 (속눈썹)
  f_closed: (c) => {
    brows(c, -4); blush(c, 0.65);
    for (const [x, s] of [[LX, 1], [RX, -1]]) {
      c.beginPath(); c.arc(x, EY + 12, 40, 1.15 * Math.PI, 1.85 * Math.PI); c.lineWidth = 8; c.strokeStyle = '#1b1b1b'; c.stroke();
      for (let k = 0; k < 4; k++) line(c, [[x - 30 + k * 16, EY - 12 - (k === 1 || k === 2 ? 14 : 8)], [x - 34 + k * 16 - 2 * s, EY - 28 - (k === 1 || k === 2 ? 10 : 2)]], 4);
    }
    catMouth(c, MY - 6, 3);
  },
  // 😭 우는 얼굴
  f_cry: (c) => {
    brows(c, 6, 'rgba(40,40,40,.9)');
    line(c, [[LX - 36, EY], [LX + 32, EY - 2]], 10); line(c, [[RX + 36, EY], [RX - 32, EY - 2]], 10);
    c.fillStyle = 'rgba(140,200,255,.9)';
    for (const x of [LX, RX]) { c.beginPath(); c.moveTo(x - 10, EY + 6); c.lineTo(x + 10, EY + 6); c.lineTo(x + 16, EY + 190); c.lineTo(x - 14, EY + 190); c.closePath(); c.fill(); }
    blush(c, 0.45);
    line(c, [[MX - 22, MY], [MX - 10, MY - 8], [MX, MY], [MX + 10, MY - 8], [MX + 22, MY]], 4);
  },
  // 😵 빙글빙글 눈
  f_dizzy: (c) => {
    blush(c, 0.5);
    for (const x of [LX, RX]) {
      c.beginPath();
      for (let t = 0; t < 18; t += 0.1) { const r = 3 + t * 2.4, px = x + Math.cos(t) * r, py = EY + 6 + Math.sin(t) * r; t ? c.lineTo(px, py) : c.moveTo(px, py); }
      c.lineWidth = 5; c.strokeStyle = '#1b1b1b'; c.stroke();
    }
    c.fillStyle = '#e88a9a'; c.beginPath(); c.roundRect ? c.roundRect(MX - 22, MY - 22, 44, 30, 8) : c.rect(MX - 22, MY - 22, 44, 30); c.fill();
    c.lineWidth = 3; c.strokeStyle = '#2a1a1a'; c.stroke();
  },
  // 😍 분홍 하트 눈
  f_hearteyes: (c) => {
    brows(c, -2); blush(c, 0.6);
    for (const x of [LX, RX]) {
      c.fillStyle = '#ff5c9a'; heartPath(c, x, EY + 4, 48); c.fill();
      c.fillStyle = '#ffd0e4'; heartPath(c, x, EY + 6, 24); c.fill();
      c.fillStyle = '#fff'; c.beginPath(); c.arc(x - 22, EY - 18, 7, 0, 7); c.fill();
    }
    c.fillStyle = '#e06a86'; c.beginPath(); c.ellipse(MX, MY - 10, 9, 11, 0, 0, 7); c.fill();
  },
  // 😏 시크한 반쯤 감은 눈
  f_smug: (c) => {
    line(c, [[LX - 40, EY - 30], [LX + 20, EY - 38]], 5); line(c, [[RX - 20, EY - 38], [RX + 40, EY - 30]], 5);
    for (const x of [LX, RX]) {
      c.fillStyle = '#121212'; c.beginPath(); c.ellipse(x, EY + 4, 40, 26, 0, 0, Math.PI); c.fill();
      line(c, [[x - 46, EY + 2], [x + 46, EY + 2]], 9);
    }
    blush(c, 0.3);
    line(c, [[MX - 24, MY - 8], [MX + 4, MY - 6], [MX + 26, MY - 18]], 5);
  },
  // 😛 점 눈 + 메롱
  f_derp: (c) => {
    c.fillStyle = '#121212'; c.beginPath(); c.arc(LX - 30, EY + 4, 16, 0, 7); c.fill(); c.beginPath(); c.arc(RX + 30, EY + 4, 16, 0, 7); c.fill();
    line(c, [[MX - 40, MY - 18], [MX + 40, MY - 18]], 6);
    c.fillStyle = '#ff7a95'; c.beginPath(); c.ellipse(MX + 10, MY, 16, 20, 0, 0, Math.PI); c.fill();
    c.fillStyle = '#ff7a95'; c.fillRect(MX - 6, MY - 18, 32, 18);
  },
  // ⚫ 큰 동그라미 눈
  f_round: (c) => {
    for (const x of [LX, RX]) {
      c.fillStyle = '#0d0d0d'; c.beginPath(); c.arc(x, EY + 4, 56, 0, 7); c.fill();
      c.beginPath(); c.arc(x, EY + 4, 44, 0, 7); c.lineWidth = 5; c.strokeStyle = '#ffffff'; c.stroke();
    }
    line(c, [[MX - 14, MY + 2], [MX, MY - 8], [MX + 14, MY + 2]], 4);
  },
  // 💢 화난 치비 얼굴
  f_mad: (c) => {
    blush(c, 0.7);
    line(c, [[LX - 40, EY - 30], [LX + 30, EY - 14]], 8); line(c, [[RX + 40, EY - 30], [RX - 30, EY - 14]], 8);
    line(c, [[LX - 34, EY + 10], [LX + 30, EY + 10]], 11); line(c, [[RX + 34, EY + 10], [RX - 30, EY + 10]], 11);
    line(c, [[MX - 16, MY - 6], [MX - 6, MY - 12], [MX + 6, MY - 6], [MX + 16, MY - 12]], 4);
    // 💢 표시
    const ax = RX + 70, ay = EY - 90; c.strokeStyle = '#e8343f'; c.lineWidth = 7; c.lineCap = 'round';
    for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      c.beginPath(); c.moveTo(ax + dx * 6, ay + dy * 22); c.quadraticCurveTo(ax + dx * 6, ay + dy * 6, ax + dx * 22, ay + dy * 6); c.stroke();
    }
  },
  // uwu
  f_uwu: (c) => {
    blush(c, 0.55);
    for (const x of [LX, RX]) { c.fillStyle = '#121212'; c.beginPath(); c.ellipse(x, EY + 2, 12, 18, 0, 0, 7); c.fill(); c.fillStyle = '#fff'; c.beginPath(); c.arc(x - 3, EY - 5, 4, 0, 7); c.fill(); }
    catMouth(c, MY - 10, 5);
  },
  // 😁 활짝 웃는 점 눈
  f_beam: (c) => {
    blush(c, 0.4);
    for (const x of [LX, RX]) { c.fillStyle = '#121212'; c.beginPath(); c.arc(x, EY + 4, 15, 0, 7); c.fill(); }
    c.fillStyle = '#e04a62'; c.beginPath(); c.moveTo(MX - 34, MY - 24); c.lineTo(MX + 34, MY - 24); c.quadraticCurveTo(MX + 30, MY + 30, MX, MY + 30); c.quadraticCurveTo(MX - 30, MY + 30, MX - 34, MY - 24); c.fill();
    c.lineWidth = 4; c.strokeStyle = '#1b1b1b'; c.stroke();
  },
};
