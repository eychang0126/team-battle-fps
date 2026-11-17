// =====================================================
//  미니게임: 🐤 플래피 버드, 🦖 공룡 달리기 (로비에서 해요)
//  점수는 서버로 보내서 코인을 받아요 (서버가 시간을 확인해요)
// =====================================================
const W = 480, H = 640;

export function playMinigame(kind, { canvas, onStart, onEnd, hud }) {
  const ctx = canvas.getContext('2d');
  let stop = false, raf = 0;
  const game = kind === 'dino' ? dinoGame(ctx) : flappyGame(ctx);
  canvas.width = game.w; canvas.height = game.h;
  let state = 'ready', score = 0, last = performance.now();

  const press = () => {
    if (state === 'ready') { state = 'play'; game.reset(); score = 0; onStart(); game.press(); }
    else if (state === 'play') game.press();
    else if (state === 'over' && performance.now() - game.overAt > 500) { state = 'ready'; game.reset(); }
  };
  const release = () => game.release && game.release();
  const key = e => {
    if (['Space', 'ArrowUp', 'KeyW'].includes(e.code)) { e.preventDefault(); if (!e.repeat) press(); }
    if (e.code === 'ArrowDown' || e.code === 'KeyS') { e.preventDefault(); game.duck && game.duck(true); }
  };
  const keyUp = e => {
    if (e.code === 'ArrowDown' || e.code === 'KeyS') game.duck && game.duck(false);
    if (['Space', 'ArrowUp', 'KeyW'].includes(e.code)) release();
  };
  const down = e => { e.preventDefault(); press(); };
  addEventListener('keydown', key); addEventListener('keyup', keyUp);
  canvas.addEventListener('pointerdown', down); canvas.addEventListener('pointerup', release);

  function loop(t) {
    if (stop) return;
    raf = requestAnimationFrame(loop);
    const dt = Math.min(0.05, (t - last) / 1000); last = t;
    if (state === 'play') {
      const r = game.step(dt);
      score = r.score;
      if (r.dead) { state = 'over'; game.overAt = performance.now(); onEnd(score); }
    }
    game.draw(state, score);
    hud(state, score);
  }
  game.reset();
  raf = requestAnimationFrame(loop);
  return () => {
    stop = true; cancelAnimationFrame(raf);
    removeEventListener('keydown', key); removeEventListener('keyup', keyUp);
    canvas.removeEventListener('pointerdown', down); canvas.removeEventListener('pointerup', release);
  };
}

function text(ctx, s, x, y, size, color = '#fff', align = 'center') {
  ctx.font = `bold ${size}px sans-serif`; ctx.textAlign = align; ctx.textBaseline = 'middle';
  ctx.lineWidth = Math.max(3, size / 7); ctx.strokeStyle = 'rgba(0,0,0,.55)'; ctx.strokeText(s, x, y);
  ctx.fillStyle = color; ctx.fillText(s, x, y);
}

// ---------- 🐤 플래피 버드 ----------
function flappyGame(ctx) {
  const GAP = 200, SPACING = 230, SPEED = 165, GRAV = 1500, FLAP = -430, GROUND = 70;
  let bird, pipes, passed, scroll, flapT;
  const g = {
    w: W, h: H,
    reset() { bird = { x: 130, y: H / 2 - 40, vy: 0 }; pipes = []; passed = 0; scroll = 0; flapT = 0; },
    press() { bird.vy = FLAP; flapT = 0.15; },
    step(dt) {
      bird.vy += GRAV * dt; bird.y += bird.vy * dt; scroll += SPEED * dt; flapT -= dt;
      if (!pipes.length || pipes[pipes.length - 1].x < W - SPACING) {
        const gy = 110 + Math.random() * (H - GROUND - 220 - GAP / 2);
        pipes.push({ x: W + 40, gy, done: false });
      }
      for (const p of pipes) {
        p.x -= SPEED * dt;
        if (!p.done && p.x + 35 < bird.x) { p.done = true; passed++; }
      }
      pipes = pipes.filter(p => p.x > -80);
      // 부딪혔나요?
      let dead = bird.y > H - GROUND - 14 || bird.y < -40;
      for (const p of pipes) {
        if (bird.x + 14 > p.x - 35 && bird.x - 14 < p.x + 35 && (bird.y - 13 < p.gy - GAP / 2 || bird.y + 13 > p.gy + GAP / 2)) dead = true;
      }
      return { score: passed, dead };
    },
    draw(state, score) {
      // 하늘 + 구름
      const sky = ctx.createLinearGradient(0, 0, 0, H); sky.addColorStop(0, '#5ec6f5'); sky.addColorStop(1, '#bfe9ff');
      ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = 'rgba(255,255,255,.85)';
      for (let i = 0; i < 4; i++) {
        const cx = ((i * 170 - scroll * 0.3) % (W + 160) + W + 160) % (W + 160) - 80, cy = 90 + (i % 2) * 70;
        ctx.beginPath(); ctx.arc(cx, cy, 26, 0, 7); ctx.arc(cx + 28, cy - 10, 32, 0, 7); ctx.arc(cx + 58, cy, 24, 0, 7); ctx.fill();
      }
      // 토관
      for (const p of pipes) {
        for (const [y0, y1] of [[0, p.gy - GAP / 2], [p.gy + GAP / 2, H - GROUND]]) {
          ctx.fillStyle = '#3fbf4a'; ctx.fillRect(p.x - 32, y0, 64, y1 - y0);
          ctx.fillStyle = '#7ee07f'; ctx.fillRect(p.x - 24, y0, 10, y1 - y0);
          const capY = y0 === 0 ? y1 - 26 : y0;
          ctx.fillStyle = '#2e9e38'; ctx.fillRect(p.x - 38, capY, 76, 26);
          ctx.fillStyle = '#7ee07f'; ctx.fillRect(p.x - 30, capY + 4, 10, 18);
          ctx.strokeStyle = '#1d6b25'; ctx.lineWidth = 3; ctx.strokeRect(p.x - 38, capY, 76, 26); ctx.strokeRect(p.x - 32, y0, 64, y1 - y0);
        }
      }
      // 땅
      ctx.fillStyle = '#ded28a'; ctx.fillRect(0, H - GROUND, W, GROUND);
      ctx.fillStyle = '#7cc94a'; ctx.fillRect(0, H - GROUND, W, 14);
      ctx.fillStyle = '#68b23c';
      for (let x = -(scroll % 28); x < W; x += 28) ctx.fillRect(x, H - GROUND, 14, 14);
      // 새 (동글동글 노란 새)
      ctx.save(); ctx.translate(bird.x, bird.y);
      ctx.rotate(Math.max(-0.5, Math.min(1.2, bird.vy / 600)));
      ctx.fillStyle = '#ffd43b'; ctx.beginPath(); ctx.ellipse(0, 0, 18, 15, 0, 0, 7); ctx.fill();
      ctx.strokeStyle = '#a07a10'; ctx.lineWidth = 2.5; ctx.stroke();
      ctx.fillStyle = '#fff7d0'; ctx.beginPath(); ctx.ellipse(-6, 4, 9, 6, 0, 0, 7); ctx.fill();
      ctx.fillStyle = '#ffe98a'; ctx.beginPath(); ctx.ellipse(-8, flapT > 0 ? -6 : 2, 9, 5, flapT > 0 ? -0.6 : 0.3, 0, 7); ctx.fill(); ctx.stroke(); // 날개
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(7, -5, 6, 0, 7); ctx.fill();
      ctx.fillStyle = '#222'; ctx.beginPath(); ctx.arc(9, -5, 3, 0, 7); ctx.fill();
      ctx.fillStyle = '#ff8a3d'; ctx.beginPath(); ctx.moveTo(14, 0); ctx.lineTo(26, 3); ctx.lineTo(14, 8); ctx.closePath(); ctx.fill();
      ctx.restore();
      // 글자
      if (state !== 'ready') text(ctx, String(score), W / 2, 70, 56);
      if (state === 'ready') {
        text(ctx, '🐤 플래피 버드', W / 2, 190, 40, '#fff');
        text(ctx, '누르거나 Space로 날갯짓!', W / 2, 250, 22);
        text(ctx, '토관 10개 넘으면 🪙 20 + 🏆 1', W / 2, 290, 22, '#ffe066');
      }
      if (state === 'over') {
        text(ctx, '게임 오버', W / 2, 220, 46, '#ff6b6b');
        text(ctx, `토관 ${score}개`, W / 2, 280, 30);
        text(ctx, '눌러서 다시 하기', W / 2, 330, 22);
      }
    },
  };
  return g;
}

// ---------- 🦖 공룡 달리기 ----------
function dinoGame(ctx) {
  const GW = 720, GH = 260, GROUND = 210, GRAV = 2600, JUMP = -820;
  let dino, obs, speed, dist, nextIn, ducking, holdJump, t, stars;
  const g = {
    w: GW, h: GH,
    reset() {
      dino = { y: 0, vy: 0, onGround: true }; obs = []; speed = 380; dist = 0; nextIn = 0.9; ducking = false; holdJump = false; t = 0;
      stars = Array.from({ length: 6 }, (_, i) => ({ x: i * 130 + Math.random() * 60, y: 30 + Math.random() * 70 }));
    },
    press() { if (dino.onGround) { dino.vy = JUMP; dino.onGround = false; } holdJump = true; },
    release() { holdJump = false; },
    duck(on) { ducking = on; if (on && !dino.onGround) dino.vy = Math.max(dino.vy, 600); },
    step(dt) {
      t += dt;
      speed = Math.min(950, 380 + t * 9);
      dist += speed * dt;
      // 점프 (꾹 누르면 조금 더 높이)
      dino.vy += (holdJump && dino.vy < 0 ? GRAV * 0.55 : GRAV) * dt;
      dino.y += dino.vy * dt;
      if (dino.y >= 0) { dino.y = 0; dino.vy = 0; dino.onGround = true; }
      // 장애물: 선인장, 나중에는 새도
      nextIn -= dt;
      if (nextIn <= 0) {
        const score = Math.floor(dist / 40);
        if (score > 250 && Math.random() < 0.3) obs.push({ x: GW + 20, w: 42, h: 26, y: Math.random() < 0.5 ? 58 : 22, bird: true });
        else { const n = 1 + Math.floor(Math.random() * (score > 150 ? 3 : 2)); obs.push({ x: GW + 20, w: 18 * n + 6, h: 34 + Math.random() * 20, y: 0, n }); }
        nextIn = (0.75 + Math.random() * 0.9) * (380 / speed) * 1.25;
      }
      for (const o of obs) o.x -= speed * dt;
      obs = obs.filter(o => o.x > -80);
      for (const s of stars) { s.x -= speed * dt * 0.08; if (s.x < -20) s.x = GW + 20; }
      // 부딪혔나요? (공룡 몸통 상자)
      const dh = ducking && dino.onGround ? 30 : 50, dw = ducking && dino.onGround ? 56 : 40;
      const dx0 = 60, dy1 = GROUND + dino.y, dy0 = dy1 - dh;
      let dead = false;
      for (const o of obs) {
        const oy1 = GROUND - o.y, oy0 = oy1 - o.h;
        if (dx0 + dw - 8 > o.x + 4 && dx0 + 6 < o.x + o.w - 4 && dy1 - 4 > oy0 + 4 && dy0 + 6 < oy1) dead = true;
      }
      return { score: Math.floor(dist / 40), dead };
    },
    draw(state, score) {
      const night = Math.floor(score / 700) % 2 === 1; // 700점마다 낮 ↔ 밤
      ctx.fillStyle = night ? '#1d2236' : '#f4f1e8'; ctx.fillRect(0, 0, GW, GH);
      ctx.fillStyle = night ? '#fff8c0' : '#d9d3bf';
      for (const s of stars) { if (night) ctx.fillRect(s.x, s.y, 3, 3); else { ctx.beginPath(); ctx.arc(s.x, s.y + 20, 14, 0, 7); ctx.arc(s.x + 18, s.y + 14, 18, 0, 7); ctx.arc(s.x + 36, s.y + 20, 12, 0, 7); ctx.fill(); } }
      const fg = night ? '#d8dbe8' : '#4a4a4a';
      // 땅
      ctx.fillStyle = fg; ctx.fillRect(0, GROUND, GW, 2);
      for (let x = -(dist % 60); x < GW; x += 60) { ctx.fillRect(x + 10, GROUND + 8, 8, 2); ctx.fillRect(x + 38, GROUND + 14, 4, 2); }
      // 장애물
      for (const o of obs) {
        const y1 = GROUND - o.y;
        if (o.bird) { // 날아다니는 익룡
          ctx.fillStyle = night ? '#ff9b9b' : '#8a4b4b';
          ctx.fillRect(o.x + 10, y1 - 16, 26, 10); ctx.fillRect(o.x + 32, y1 - 20, 10, 8);
          const flap = Math.floor(dist / 60) % 2;
          ctx.fillRect(o.x + 14, flap ? y1 - 30 : y1 - 6, 14, flap ? 14 : 12);
        } else { // 선인장
          ctx.fillStyle = night ? '#7fe08a' : '#2f8a3b';
          for (let k = 0; k < o.n; k++) {
            const cx = o.x + 3 + k * 18, h = o.h - (k % 2) * 8;
            ctx.fillRect(cx + 4, y1 - h, 10, h);
            ctx.fillRect(cx, y1 - h * 0.6, 4, 10); ctx.fillRect(cx, y1 - h * 0.6 - 8, 4, 8);
            ctx.fillRect(cx + 14, y1 - h * 0.75, 4, 10); ctx.fillRect(cx + 14, y1 - h * 0.75 - 10, 4, 10);
          }
        }
      }
      // 공룡 (초록색 아기 공룡)
      const duck = ducking && dino.onGround;
      const x = 60, y = GROUND + dino.y;
      const step = state === 'play' && dino.onGround ? Math.floor(dist / 30) % 2 : 0;
      ctx.fillStyle = state === 'over' ? '#e05a5a' : '#45b649';
      if (duck) {
        ctx.fillRect(x, y - 30, 46, 20); ctx.fillRect(x + 36, y - 34, 22, 16);   // 몸, 머리
        ctx.fillRect(x - 10, y - 26, 12, 8);                                    // 꼬리
      } else {
        ctx.fillRect(x + 6, y - 40, 28, 26);                                    // 몸
        ctx.fillRect(x + 22, y - 58, 24, 20);                                   // 머리
        ctx.fillRect(x - 6, y - 34, 14, 10);                                    // 꼬리
        ctx.fillRect(x + 30, y - 30, 8, 5);                                     // 팔
        ctx.fillStyle = '#7fd67f'; ctx.fillRect(x + 12, y - 32, 14, 14);         // 배
        ctx.fillStyle = '#ffd43b'; for (let k = 0; k < 3; k++) ctx.fillRect(x + 8 + k * 9, y - 46, 6, 6); // 등 가시
        ctx.fillStyle = state === 'over' ? '#e05a5a' : '#45b649';
      }
      // 다리
      ctx.fillRect(x + 10, y - 14, 8, step ? 14 : 10); ctx.fillRect(x + 24, y - 14, 8, step ? 10 : 14);
      // 눈
      ctx.fillStyle = '#fff'; ctx.fillRect(duck ? x + 48 : x + 36, duck ? y - 31 : y - 54, 7, 7);
      ctx.fillStyle = '#222'; ctx.fillRect(duck ? x + 51 : x + 39, duck ? y - 29 : y - 52, 3, 4);
      if (state === 'over') { ctx.fillStyle = '#222'; ctx.fillRect(x + 35, y - 54, 9, 2); }
      // 점수
      text(ctx, String(score).padStart(5, '0'), GW - 20, 26, 22, night ? '#fff' : '#555', 'right');
      if (state === 'ready') {
        text(ctx, '🦖 공룡 달리기', GW / 2, 70, 34, '#45b649');
        text(ctx, '누르거나 Space/↑ 점프 · ↓ 숙이기', GW / 2, 110, 18, night ? '#fff' : '#333');
        text(ctx, '200점 넘으면 🪙 20 + 🏆 1', GW / 2, 140, 18, '#e0a800');
      }
      if (state === 'over') {
        text(ctx, '게임 오버', GW / 2, 80, 36, '#e05a5a');
        text(ctx, '눌러서 다시 하기', GW / 2, 120, 18, night ? '#fff' : '#333');
      }
    },
  };
  return g;
}
