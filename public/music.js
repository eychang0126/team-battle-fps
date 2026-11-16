// =====================================================
//  🎵 배경음악: 브라우저가 직접 연주하는 8비트 오리지널 곡 (음악 파일 없음)
//  Music.play('lobby' | 'fps' | 'zombie' | 'wave' | 'tower' | 'lava' | 'range')
// =====================================================
const SCALES = { major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10], harm: [0, 2, 3, 5, 7, 8, 11] };

// 곡마다: 빠르기, 으뜸음, 음계, 코드 진행(음계 몇 번째 음), 드럼 무늬, 소리 크기
const TRACKS = {
  lobby: { name: '로비 - 느긋한 오후', bpm: 96, root: 60, scale: 'major', prog: [0, 5, 3, 4], kick: 'x.......x.......', snare: '....x.......x...', hat: '..x...x...x...x.', lead: 0.5, seed: 3, arp: 'up' },
  fps: { name: '팀 배틀 - 돌격!', bpm: 142, root: 57, scale: 'minor', prog: [0, 5, 2, 6], kick: 'x...x...x...x.x.', snare: '....x.......x...', hat: 'x.x.x.x.x.x.x.xx', lead: 0.8, seed: 11, arp: 'updown' },
  zombie: { name: '좀비 - 어둠 속에서', bpm: 108, root: 52, scale: 'harm', prog: [0, 3, 4, 0], kick: 'x.....x...x.....', snare: '........x.......', hat: '..x...x...x...x.', lead: 0.55, seed: 7, arp: 'down' },
  wave: { name: '좀비 웨이브 - 버텨라', bpm: 126, root: 50, scale: 'harm', prog: [0, 5, 3, 4], kick: 'x...x...x...x...', snare: '....x.......x..x', hat: 'xxx.xxx.xxx.xxx.', lead: 0.7, seed: 19, arp: 'updown' },
  tower: { name: '점프 타워 - 깡총깡총', bpm: 132, root: 62, scale: 'major', prog: [0, 3, 4, 3], kick: 'x.....x.x.......', snare: '....x.......x...', hat: 'x.xxx.xxx.xxx.xx', lead: 0.75, seed: 5, arp: 'up' },
  lava: { name: '용암 타워 - 서둘러!', bpm: 158, root: 55, scale: 'minor', prog: [0, 6, 5, 4], kick: 'x.x.x.x.x.x.x.x.', snare: '....x.......x.x.', hat: 'x.x.x.x.x.x.x.x.', lead: 0.8, seed: 23, arp: 'updown' },
  range: { name: '시험장 - 연습 시간', bpm: 112, root: 59, scale: 'minor', prog: [0, 3, 6, 4], kick: 'x.......x.......', snare: '....x.......x...', hat: '..x...x...x...x.', lead: 0.5, seed: 13, arp: 'up' },
};
export const TRACK_FOR_MODE = { fps: 'fps', zombie: 'zombie', wave: 'wave', obby: 'tower', lava: 'lava', range: 'range' };

let ctx = null, master = null, noiseBuf = null;
let current = null, timer = null, step = 0, nextTime = 0, melody = [];
let enabled = true, volume = 0.5;
try { enabled = localStorage.getItem('musicOn') !== '0'; volume = Math.min(1, Math.max(0, +(localStorage.getItem('musicVol') ?? 0.5))); } catch { }

const freq = m => 440 * Math.pow(2, (m - 69) / 12);
function rng(seed) { let s = seed * 9301 + 49297; return () => ((s = (s * 9301 + 49297) % 233280) / 233280); }

function ensureCtx() {
  if (ctx) return true;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return false;
  ctx = new AC();
  master = ctx.createGain(); master.gain.value = volume * 0.35;
  const comp = ctx.createDynamicsCompressor();
  master.connect(comp); comp.connect(ctx.destination);
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return true;
}
function tone(type, f, t, dur, vol, glideTo) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(f, t);
  if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, t + dur);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.02);
}
function noise(t, dur, vol, hp) {
  const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
  s.buffer = noiseBuf; f.type = 'highpass'; f.frequency.value = hp;
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f); f.connect(g); g.connect(master); s.start(t); s.stop(t + dur + 0.02);
}
// 곡마다 멜로디를 정해진 무늬로 만들어요 (매번 똑같이 나오게 seed 사용)
function makeMelody(tr) {
  const r = rng(tr.seed), notes = [];
  let deg = 4;
  for (let i = 0; i < 64; i++) { // 4마디 × 16칸
    if (r() < tr.lead * (i % 2 ? 0.45 : 0.9)) {
      deg = Math.max(0, Math.min(11, deg + Math.round((r() - 0.5) * 4)));
      notes.push({ deg, len: r() < 0.3 ? 2 : 1 });
    } else notes.push(null);
  }
  return notes;
}
function scaleNote(tr, deg, oct = 0) {
  const sc = SCALES[tr.scale], n = sc.length;
  return tr.root + Math.floor(deg / n) * 12 + sc[((deg % n) + n) % n] + oct * 12;
}
function playStep(tr, s, t) {
  const sixteenth = 60 / tr.bpm / 4;
  const bar = Math.floor(s / 16) % tr.prog.length, i = s % 16, chordDeg = tr.prog[bar];
  // 드럼
  if (tr.kick[i] === 'x') tone('sine', 140, t, 0.18, 0.9, 40);
  if (tr.snare[i] === 'x') noise(t, 0.12, 0.35, 1500);
  if (tr.hat[i] === 'x') noise(t, 0.03, 0.12, 7000);
  // 베이스 (8분음표)
  if (i % 2 === 0) tone('triangle', freq(scaleNote(tr, chordDeg, -1)), t, sixteenth * 1.8, 0.35);
  // 아르페지오 (코드 음을 차례로)
  const chord = [0, 2, 4, 7].map(k => scaleNote(tr, chordDeg + k));
  const order = tr.arp === 'down' ? [3, 2, 1, 0] : tr.arp === 'updown' ? [0, 1, 2, 3, 2, 1] : [0, 1, 2, 3];
  tone('square', freq(chord[order[i % order.length]]), t, sixteenth * 0.9, 0.05);
  // 멜로디 (두 번째 반복부터)
  const m = melody[s % 64];
  if (m && Math.floor(s / 64) % 2 === 1) tone('square', freq(scaleNote(tr, chordDeg + m.deg - 2, 1)), t, sixteenth * m.len * 0.95, 0.07);
}
function schedule() {
  if (!current) return;
  const tr = TRACKS[current], sixteenth = 60 / tr.bpm / 4;
  while (nextTime < ctx.currentTime + 0.15) { playStep(tr, step, nextTime); nextTime += sixteenth; step++; }
}
function start() {
  if (!current || !enabled || !ensureCtx()) return;
  if (ctx.state === 'suspended') ctx.resume();
  clearInterval(timer);
  melody = makeMelody(TRACKS[current]); step = 0; nextTime = ctx.currentTime + 0.08;
  timer = setInterval(schedule, 25);
}
function stop() { clearInterval(timer); timer = null; }

export const Music = {
  tracks: TRACKS,
  get on() { return enabled; },
  get volume() { return volume; },
  get trackName() { return current ? TRACKS[current].name : ''; },
  play(name) { if (!TRACKS[name]) return; if (current === name && timer) return; current = name; if (enabled) start(); },
  // 브라우저는 사용자가 한 번 누른 다음에만 소리를 낼 수 있어요
  unlock() { if (enabled && current && !timer) start(); else if (ctx && ctx.state === 'suspended') ctx.resume(); },
  toggle() {
    enabled = !enabled; try { localStorage.setItem('musicOn', enabled ? '1' : '0'); } catch { }
    if (enabled) start(); else stop();
    return enabled;
  },
  setVolume(v) { volume = Math.min(1, Math.max(0, v)); try { localStorage.setItem('musicVol', volume); } catch { } if (master) master.gain.value = volume * 0.35; },
};
// 미리 듣기용: 곡을 소리 파일 데이터로 만들기
export async function renderTrack(name, secs = 16, rate = 22050) {
  const saved = [ctx, master, noiseBuf];
  ctx = new OfflineAudioContext(1, Math.floor(rate * secs), rate);
  master = ctx.createGain(); master.gain.value = 0.5 * 0.35;
  const comp = ctx.createDynamicsCompressor(); master.connect(comp); comp.connect(ctx.destination);
  noiseBuf = ctx.createBuffer(1, rate * 0.5, rate); const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const tr = TRACKS[name], sixteenth = 60 / tr.bpm / 4; melody = makeMelody(tr);
  for (let s = 0, t = 0.05; t < secs; s++, t += sixteenth) playStep(tr, s, t);
  const buf = await ctx.startRendering();
  [ctx, master, noiseBuf] = saved;
  return buf.getChannelData(0);
}
window.Music = Music; // 로비와 게임 화면이 같이 써요
