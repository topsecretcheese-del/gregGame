// Greg Game — a side-scrolling platformer.
// Everything is drawn with canvas shapes, so there are no image assets to load.

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const VIEW_W = canvas.width;
const VIEW_H = canvas.height;
const TILE = 32;

// Physics, in pixels and seconds.
const GRAVITY = 2200;
const JUMP_VELOCITY = 720;
const LOW_JUMP_GRAVITY = 2.2; // extra gravity multiplier when jump is released early
const FAST_FALL_GRAVITY = 1.8; // extra gravity multiplier while holding S in the air
const MAX_FALL = 900;
const WALK_SPEED = 220;
const SPRINT_SPEED = 320;
const GROUND_ACCEL = 1800;
const AIR_ACCEL = 1200;
const FRICTION = 2000;
const COYOTE_TIME = 0.1; // seconds you can still jump after walking off a ledge
const JUMP_BUFFER = 0.12; // seconds a jump press is remembered before landing
const STOMP_BOUNCE = 480;
const ENEMY_SPEED = 60;
const START_LIVES = 3;

// Level legend:
//   #  ground        =  brick        ?  question block (gives a coin)
//   o  coin          e  enemy        P  Greg's start   F  goal flag
//   .  empty
const LEVEL_MAP = [
  '......................................................................................................................................................',
  '......................................................................................................................................................',
  '......................................................................................................................................................',
  '......................................................................................................................................................',
  '......................................................................................................................................................',
  '.................?...................................................................oooooo.........................................#.................',
  '.....................................ooooo.........................................................................................##.................',
  '.......................................................................oo.........................................................###.................',
  '........................ooooo.............................................====..........................ooooo....................####.................',
  '............?..=?=?=....=====....#..................................................===??===....................................#####.................',
  '................................##..........................##....===...............................====......===..............######.................',
  '...............................###................##........##................................................................#######.................',
  '...P..................e.......####...........e....##....e...##..................e.........e......e....................e......########........F........',
  '######################################...#############################....###############################...##########################################',
  '######################################...#############################....###############################...##########################################',
];

const SOLID = new Set(['#', '=', '?', 'U']);

// ---------------------------------------------------------------------------
// Input

const keys = {};
let jumpPressed = false;
let startPressed = false;

window.addEventListener('keydown', (e) => {
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
    e.preventDefault();
  }
  if (!e.repeat) {
    if (e.code === 'Space' || e.code === 'KeyW' || e.code === 'ArrowUp') jumpPressed = true;
    if (e.code === 'Enter' || e.code === 'Space') startPressed = true;
  }
  keys[e.code] = true;
});
window.addEventListener('keyup', (e) => {
  keys[e.code] = false;
});
// Clicking the game focuses it (needed when embedded) and starts or restarts play.
canvas.addEventListener('pointerdown', () => {
  window.focus();
  startPressed = true;
});
window.addEventListener('blur', () => {
  for (const k in keys) keys[k] = false;
});

const input = {
  left: () => keys.KeyA || keys.ArrowLeft,
  right: () => keys.KeyD || keys.ArrowRight,
  down: () => keys.KeyS || keys.ArrowDown,
  jumpHeld: () => keys.Space || keys.KeyW || keys.ArrowUp,
  sprint: () => keys.ShiftLeft || keys.ShiftRight,
};

// ---------------------------------------------------------------------------
// Game state

let state = 'title'; // title | playing | dying | won | gameover
let level; // { tiles, cols, rows, start, flag }
let player;
let enemies;
let particles;
let bumps; // tile key -> seconds of bump animation left
let camX = 0;
let score = 0;
let coins = 0;
let lives = START_LIVES;
let stateTimer = 0;
let time = 0;

function loadLevel() {
  const cols = Math.max(...LEVEL_MAP.map((row) => row.length));
  const rows = LEVEL_MAP.length;
  const tiles = [];
  let start = { x: TILE * 2, y: TILE * 10 };
  let flag = null;
  enemies = [];

  for (let r = 0; r < rows; r++) {
    tiles.push([]);
    for (let c = 0; c < cols; c++) {
      let ch = LEVEL_MAP[r][c] || '.';
      if (ch === 'P') {
        start = { x: c * TILE + 5, y: (r + 1) * TILE - 40 };
        ch = '.';
      } else if (ch === 'e') {
        enemies.push(makeEnemy(c * TILE + 2, (r + 1) * TILE - 28));
        ch = '.';
      } else if (ch === 'F') {
        flag = { x: c * TILE + TILE / 2, baseY: (r + 1) * TILE, topY: (r - 8) * TILE };
        ch = '.';
      }
      tiles[r].push(ch);
    }
  }

  level = { tiles, cols, rows, start, flag };
  particles = [];
  bumps = new Map();
  player = makePlayer(start.x, start.y);
  camX = 0;
}

function makePlayer(x, y) {
  return {
    x, y, w: 22, h: 40,
    vx: 0, vy: 0,
    onGround: false,
    facing: 1,
    coyote: 0,
    jumpBuffer: 0,
    walkCycle: 0,
  };
}

function makeEnemy(x, y) {
  return { x, y, w: 28, h: 28, vx: -ENEMY_SPEED, vy: 0, onGround: false, alive: true, squash: 0, active: false };
}

function newGame() {
  score = 0;
  coins = 0;
  lives = START_LIVES;
  loadLevel();
  state = 'playing';
}

// ---------------------------------------------------------------------------
// Tiles and collision

function tileAt(c, r) {
  if (c < 0 || c >= level.cols) return '#'; // the level's sides act as walls
  if (r < 0 || r >= level.rows) return '.';
  return level.tiles[r][c];
}

function isSolid(c, r) {
  return SOLID.has(tileAt(c, r));
}

// Moves a body by its velocity, one axis at a time, stopping it at solid tiles.
// Returns the tiles bumped from below so the caller can react to them.
function moveAndCollide(body, dt) {
  const result = { hitWall: false, headTiles: [] };

  body.x += body.vx * dt;
  let top = Math.floor(body.y / TILE);
  let bottom = Math.floor((body.y + body.h - 0.01) / TILE);
  if (body.vx > 0) {
    const c = Math.floor((body.x + body.w) / TILE);
    for (let r = top; r <= bottom; r++) {
      if (isSolid(c, r)) {
        body.x = c * TILE - body.w;
        body.vx = 0;
        result.hitWall = true;
        break;
      }
    }
  } else if (body.vx < 0) {
    const c = Math.floor(body.x / TILE);
    for (let r = top; r <= bottom; r++) {
      if (isSolid(c, r)) {
        body.x = (c + 1) * TILE;
        body.vx = 0;
        result.hitWall = true;
        break;
      }
    }
  }

  body.y += body.vy * dt;
  body.onGround = false;
  const left = Math.floor(body.x / TILE);
  const right = Math.floor((body.x + body.w - 0.01) / TILE);
  if (body.vy > 0) {
    const r = Math.floor((body.y + body.h) / TILE);
    for (let c = left; c <= right; c++) {
      if (isSolid(c, r)) {
        body.y = r * TILE - body.h;
        body.vy = 0;
        body.onGround = true;
        break;
      }
    }
  } else if (body.vy < 0) {
    const r = Math.floor(body.y / TILE);
    for (let c = left; c <= right; c++) {
      if (isSolid(c, r)) result.headTiles.push({ c, r });
    }
    if (result.headTiles.length) {
      body.y = (r + 1) * TILE;
      body.vy = 0;
    }
  }

  return result;
}

function overlaps(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

// ---------------------------------------------------------------------------
// Update

function update(dt) {
  time += dt;

  if (state === 'title' || state === 'gameover') {
    if (startPressed) newGame();
  } else if (state === 'playing') {
    updatePlayer(dt);
    updateEnemies(dt);
  } else if (state === 'dying') {
    player.vy = Math.min(player.vy + GRAVITY * dt, MAX_FALL);
    player.y += player.vy * dt;
    stateTimer -= dt;
    if (stateTimer <= 0) {
      lives--;
      if (lives <= 0) {
        state = 'gameover';
      } else {
        loadLevel();
        state = 'playing';
      }
    }
  } else if (state === 'won') {
    const groundY = level.flag.baseY - player.h;
    player.y = Math.min(player.y + 240 * dt, groundY);
    stateTimer -= dt;
    if (stateTimer <= 0 && startPressed) newGame();
  }

  updateParticles(dt);
  for (const [key, t] of bumps) {
    if (t - dt <= 0) bumps.delete(key);
    else bumps.set(key, t - dt);
  }

  jumpPressed = false;
  startPressed = false;
}

function updatePlayer(dt) {
  const p = player;

  // Horizontal movement.
  const dir = (input.right() ? 1 : 0) - (input.left() ? 1 : 0);
  const maxSpeed = input.sprint() ? SPRINT_SPEED : WALK_SPEED;
  const accel = p.onGround ? GROUND_ACCEL : AIR_ACCEL;
  if (dir !== 0) {
    p.vx += dir * accel * dt;
    if (Math.abs(p.vx) > maxSpeed) p.vx = Math.sign(p.vx) * Math.max(maxSpeed, Math.abs(p.vx) - FRICTION * dt);
    p.facing = dir;
  } else if (p.onGround) {
    const slow = FRICTION * dt;
    p.vx = Math.abs(p.vx) <= slow ? 0 : p.vx - Math.sign(p.vx) * slow;
  }

  // Jumping, with coyote time and a jump buffer so it feels forgiving.
  p.coyote = p.onGround ? COYOTE_TIME : p.coyote - dt;
  p.jumpBuffer = jumpPressed ? JUMP_BUFFER : p.jumpBuffer - dt;
  if (p.jumpBuffer > 0 && p.coyote > 0) {
    p.vy = -JUMP_VELOCITY;
    p.jumpBuffer = 0;
    p.coyote = 0;
    p.onGround = false;
  }

  // Gravity: fall faster when jump is released early (short hop) or S is held.
  let g = GRAVITY;
  if (p.vy < 0 && !input.jumpHeld()) g *= LOW_JUMP_GRAVITY;
  if (!p.onGround && input.down()) g *= FAST_FALL_GRAVITY;
  p.vy = Math.min(p.vy + g * dt, input.down() ? MAX_FALL * 1.3 : MAX_FALL);

  const hit = moveAndCollide(p, dt);

  // Head bumps: only the block most directly above Greg reacts.
  if (hit.headTiles.length) {
    const center = p.x + p.w / 2;
    hit.headTiles.sort((a, b) => Math.abs((a.c + 0.5) * TILE - center) - Math.abs((b.c + 0.5) * TILE - center));
    bumpTile(hit.headTiles[0].c, hit.headTiles[0].r);
  }

  if (p.onGround && p.vx !== 0) p.walkCycle += Math.abs(p.vx) * dt * 0.05;
  else if (p.onGround) p.walkCycle = 0;

  // Collect coins Greg is touching.
  const c0 = Math.floor(p.x / TILE), c1 = Math.floor((p.x + p.w) / TILE);
  const r0 = Math.floor(p.y / TILE), r1 = Math.floor((p.y + p.h) / TILE);
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      if (tileAt(c, r) === 'o') {
        level.tiles[r][c] = '.';
        collectCoin();
      }
    }
  }

  // Fell into a pit.
  if (p.y > level.rows * TILE + 64) killPlayer();

  // Reached the flag.
  if (level.flag && p.x + p.w >= level.flag.x - 4) {
    state = 'won';
    stateTimer = 1;
    p.x = level.flag.x - p.w;
    p.vx = 0;
    p.facing = 1;
    const heightBonus = Math.max(0, Math.round((level.flag.baseY - p.y) / TILE)) * 100;
    score += 1000 + heightBonus;
  }
}

function bumpTile(c, r) {
  const t = tileAt(c, r);
  if (t === '?') {
    level.tiles[r][c] = 'U';
    particles.push({ type: 'coin', x: c * TILE + TILE / 2, y: r * TILE, vy: -500, life: 0.5 });
    collectCoin();
  }
  if (t === '?' || t === '=') {
    bumps.set(`${c},${r}`, 0.15);
    // Enemies standing on a bumped block get knocked out.
    for (const e of enemies) {
      if (e.alive && e.onGround && Math.abs(e.y + e.h - r * TILE) < 2 &&
          e.x + e.w > c * TILE && e.x < (c + 1) * TILE) {
        defeatEnemy(e);
      }
    }
  }
}

function collectCoin() {
  coins++;
  score += 100;
  if (coins % 100 === 0) lives++;
}

function killPlayer() {
  if (state !== 'playing') return;
  state = 'dying';
  stateTimer = 1.6;
  player.vy = -600;
  player.vx = 0;
}

function defeatEnemy(e) {
  e.alive = false;
  e.squash = 0.5;
  score += 200;
  particles.push({ type: 'text', text: '200', x: e.x + e.w / 2, y: e.y, vy: -60, life: 0.8 });
}

function updateEnemies(dt) {
  for (const e of enemies) {
    if (!e.alive) {
      e.squash -= dt;
      continue;
    }
    // Enemies wait offscreen until Greg gets close.
    if (!e.active) {
      if (e.x < camX + VIEW_W + TILE * 2) e.active = true;
      else continue;
    }

    e.vy = Math.min(e.vy + GRAVITY * dt, MAX_FALL);
    const speed = e.vx;
    const hit = moveAndCollide(e, dt);
    if (hit.hitWall) e.vx = -speed;

    // Turn around at ledges instead of walking off them.
    if (e.onGround) {
      const frontX = e.vx < 0 ? e.x - 1 : e.x + e.w + 1;
      if (!isSolid(Math.floor(frontX / TILE), Math.floor((e.y + e.h + 1) / TILE))) e.vx = -e.vx;
    }
    if (e.y > level.rows * TILE + 64) e.alive = false;

    if (overlaps(player, e)) {
      const wasAbove = player.y + player.h - player.vy * dt <= e.y + 8;
      if (player.vy > 0 && wasAbove) {
        defeatEnemy(e);
        player.vy = -STOMP_BOUNCE * (input.jumpHeld() ? 1.4 : 1);
        player.y = e.y - player.h;
      } else {
        killPlayer();
      }
    }
  }
  enemies = enemies.filter((e) => e.alive || e.squash > 0);
}

function updateParticles(dt) {
  for (const p of particles) {
    p.life -= dt;
    p.y += p.vy * dt;
    if (p.type === 'coin') p.vy += GRAVITY * 0.6 * dt;
  }
  particles = particles.filter((p) => p.life > 0);
}

// ---------------------------------------------------------------------------
// Rendering

function render() {
  if (state === 'playing' || state === 'won') {
    const target = player.x + player.w / 2 - VIEW_W * 0.4;
    camX = Math.max(0, Math.min(target, level.cols * TILE - VIEW_W));
  }

  drawBackground();

  if (level) {
    ctx.save();
    ctx.translate(-Math.round(camX), 0);
    drawTiles();
    drawFlag();
    for (const e of enemies) drawEnemy(e);
    if (state !== 'title') drawGreg(player);
    drawParticles();
    ctx.restore();
  }

  if (state !== 'title') drawHud();
  if (state === 'title') drawTitle();
  if (state === 'gameover') drawCenterText('GAME OVER', 'Press Enter to try again');
  if (state === 'won' && stateTimer <= 0) drawCenterText('LEVEL COMPLETE!', `Score ${score}  -  Press Enter to play again`);
}

function drawBackground() {
  const sky = ctx.createLinearGradient(0, 0, 0, VIEW_H);
  sky.addColorStop(0, '#5c94fc');
  sky.addColorStop(1, '#a4c8ff');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);

  // Far hills scroll slowly, clouds even slower, for a parallax effect.
  ctx.fillStyle = '#7bc86c';
  const hillOffset = camX * 0.4;
  for (let i = -1; i < 8; i++) {
    const x = i * 260 - (hillOffset % 260);
    ctx.beginPath();
    ctx.ellipse(x + 130, VIEW_H - 64, 150, 110 + (Math.abs(i + Math.floor(hillOffset / 260)) % 3) * 30, 0, Math.PI, 0);
    ctx.fill();
  }

  ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
  const cloudOffset = camX * 0.2;
  for (let i = -1; i < 6; i++) {
    const x = i * 220 - (cloudOffset % 220);
    const y = 50 + (Math.abs(i + Math.floor(cloudOffset / 220)) % 3) * 30;
    ctx.beginPath();
    ctx.arc(x + 40, y, 22, 0, Math.PI * 2);
    ctx.arc(x + 65, y - 10, 28, 0, Math.PI * 2);
    ctx.arc(x + 92, y, 22, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawTiles() {
  const c0 = Math.max(0, Math.floor(camX / TILE));
  const c1 = Math.min(level.cols - 1, Math.ceil((camX + VIEW_W) / TILE));
  for (let r = 0; r < level.rows; r++) {
    for (let c = c0; c <= c1; c++) {
      const t = level.tiles[r][c];
      if (t === '.') continue;
      const bump = bumps.get(`${c},${r}`);
      const x = c * TILE;
      const y = r * TILE - (bump ? Math.sin((bump / 0.15) * Math.PI) * 8 : 0);
      if (t === '#') drawGround(x, y, !isSolid(c, r - 1));
      else if (t === '=') drawBrick(x, y);
      else if (t === '?') drawQuestion(x, y);
      else if (t === 'U') drawUsed(x, y);
      else if (t === 'o') drawCoin(x + TILE / 2, y + TILE / 2);
    }
  }
}

function drawGround(x, y, grassy) {
  ctx.fillStyle = '#b5652b';
  ctx.fillRect(x, y, TILE, TILE);
  ctx.fillStyle = '#8f4c1c';
  ctx.fillRect(x + 4, y + 18, 6, 4);
  ctx.fillRect(x + 20, y + 8, 5, 4);
  if (grassy) {
    ctx.fillStyle = '#3ca83c';
    ctx.fillRect(x, y, TILE, 9);
    ctx.fillStyle = '#2d8a2d';
    ctx.fillRect(x, y + 9, TILE, 3);
  }
}

function drawBrick(x, y) {
  ctx.fillStyle = '#c0582a';
  ctx.fillRect(x, y, TILE, TILE);
  ctx.fillStyle = '#6b2a0e';
  ctx.fillRect(x, y + 15, TILE, 2);
  ctx.fillRect(x, y + 31, TILE, 1);
  ctx.fillRect(x + 15, y, 2, 15);
  ctx.fillRect(x + 7, y + 17, 2, 15);
  ctx.fillRect(x + 23, y + 17, 2, 15);
}

function drawQuestion(x, y) {
  ctx.fillStyle = '#f8b800';
  ctx.fillRect(x, y, TILE, TILE);
  ctx.strokeStyle = '#a05000';
  ctx.lineWidth = 2;
  ctx.strokeRect(x + 1, y + 1, TILE - 2, TILE - 2);
  ctx.fillStyle = Math.floor(time * 3) % 2 ? '#a05000' : '#7a3a00';
  ctx.font = 'bold 22px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('?', x + TILE / 2, y + TILE / 2 + 1);
}

function drawUsed(x, y) {
  ctx.fillStyle = '#8a5a2b';
  ctx.fillRect(x, y, TILE, TILE);
  ctx.strokeStyle = '#5a3a1b';
  ctx.lineWidth = 2;
  ctx.strokeRect(x + 1, y + 1, TILE - 2, TILE - 2);
}

function drawCoin(cx, cy) {
  const squeeze = Math.abs(Math.cos(time * 4 + cx * 0.05));
  ctx.fillStyle = '#ffd700';
  ctx.beginPath();
  ctx.ellipse(cx, cy, 3 + 7 * squeeze, 11, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#e0a800';
  ctx.fillRect(cx - 1, cy - 6, 2, 12);
}

function drawFlag() {
  const f = level.flag;
  if (!f) return;
  ctx.fillStyle = '#ddd';
  ctx.fillRect(f.x - 2, f.topY, 4, f.baseY - f.topY);
  ctx.fillStyle = '#3ca83c';
  ctx.beginPath();
  ctx.arc(f.x, f.topY, 6, 0, Math.PI * 2);
  ctx.fill();
  // The flag slides down with Greg once he's touched the pole.
  const flagY = state === 'won' ? Math.min(player.y, f.baseY - 40) : f.topY + 8;
  ctx.fillStyle = '#e03030';
  ctx.beginPath();
  ctx.moveTo(f.x - 2, flagY);
  ctx.lineTo(f.x - 34, flagY + 12);
  ctx.lineTo(f.x - 2, flagY + 24);
  ctx.fill();
  ctx.fillStyle = '#6b4a2b';
  ctx.fillRect(f.x - 12, f.baseY - TILE, 24, TILE);
}

function drawEnemy(e) {
  const x = e.x, y = e.y;
  if (!e.alive) {
    ctx.fillStyle = '#8b4a1c';
    ctx.fillRect(x, y + e.h - 8, e.w, 8);
    return;
  }
  const step = Math.floor(time * 8) % 2;
  ctx.fillStyle = '#2b1a0e';
  ctx.fillRect(x + (step ? 1 : 3), y + 22, 10, 6);
  ctx.fillRect(x + (step ? 17 : 15), y + 22, 10, 6);
  ctx.fillStyle = '#a0522d';
  ctx.beginPath();
  ctx.ellipse(x + 14, y + 13, 14, 12, 0, Math.PI, 0);
  ctx.fill();
  ctx.fillRect(x + 4, y + 13, 20, 9);
  // Angry eyes.
  ctx.fillStyle = '#fff';
  ctx.fillRect(x + 7, y + 8, 5, 7);
  ctx.fillRect(x + 16, y + 8, 5, 7);
  ctx.fillStyle = '#000';
  const look = e.vx < 0 ? 0 : 2;
  ctx.fillRect(x + 7 + look, y + 10, 3, 4);
  ctx.fillRect(x + 16 + look, y + 10, 3, 4);
  ctx.fillRect(x + 6, y + 6, 7, 2);
  ctx.fillRect(x + 15, y + 6, 7, 2);
}

function drawGreg(p) {
  const x = Math.round(p.x), y = Math.round(p.y);
  const f = p.facing;
  const cx = x + p.w / 2;
  const airborne = !p.onGround && state !== 'won';
  const swing = airborne ? 0 : Math.sin(p.walkCycle) * 5;

  ctx.save();
  if (state === 'dying') {
    ctx.translate(cx, y + p.h / 2);
    ctx.rotate(Math.PI);
    ctx.translate(-cx, -(y + p.h / 2));
  }

  // Legs and shoes.
  ctx.fillStyle = '#2a3f7a';
  if (airborne) {
    ctx.fillRect(cx - 8, y + 28, 7, 8);
    ctx.fillRect(cx + 1, y + 26, 7, 8);
    ctx.fillStyle = '#3a2412';
    ctx.fillRect(cx - 9 + f * 2, y + 35, 9, 5);
    ctx.fillRect(cx + f * 2, y + 33, 9, 5);
  } else {
    ctx.fillRect(cx - 7 + swing, y + 28, 6, 8);
    ctx.fillRect(cx + 1 - swing, y + 28, 6, 8);
    ctx.fillStyle = '#3a2412';
    ctx.fillRect(cx - 8 + swing + f, y + 35, 9, 5);
    ctx.fillRect(cx - swing + f, y + 35, 9, 5);
  }

  // Body: Greg's green shirt with a "G" on it.
  ctx.fillStyle = '#2e9e4f';
  ctx.fillRect(x + 1, y + 16, p.w - 2, 14);
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 10px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('G', cx, y + 23);

  // Arms.
  ctx.fillStyle = '#f1c27d';
  if (airborne) {
    ctx.fillRect(cx + f * 9 - 2, y + 6, 4, 11);
    ctx.fillRect(cx - f * 13 - 2, y + 18, 4, 8);
  } else {
    ctx.fillRect(cx + f * 11 - 2, y + 18 - swing * 0.4, 4, 9);
    ctx.fillRect(cx - f * 12 - 2, y + 18 + swing * 0.4, 4, 9);
  }

  // Head.
  ctx.fillStyle = '#f1c27d';
  ctx.fillRect(x + 3, y + 2, p.w - 6, 15);
  // Hair.
  ctx.fillStyle = '#5a3212';
  ctx.fillRect(x + 2, y - 1, p.w - 4, 6);
  ctx.fillRect(f > 0 ? x + 2 : x + p.w - 6, y + 2, 4, 6);
  // Eye and grin.
  ctx.fillStyle = '#000';
  ctx.fillRect(cx + f * 4 - 1, y + 7, 3, 4);
  ctx.fillRect(cx + f * 2 - 2, y + 13, 6, 2);

  ctx.restore();
}

function drawParticles() {
  for (const p of particles) {
    if (p.type === 'coin') {
      drawCoin(p.x, p.y);
    } else if (p.type === 'text') {
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 14px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(p.text, p.x, p.y);
    }
  }
}

function drawHud() {
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 18px monospace';
  ctx.textBaseline = 'top';
  ctx.shadowColor = '#000';
  ctx.shadowOffsetX = 2;
  ctx.shadowOffsetY = 2;
  ctx.textAlign = 'left';
  ctx.fillText(`GREG  ${String(score).padStart(6, '0')}`, 20, 16);
  ctx.textAlign = 'center';
  ctx.fillText(`COINS x${coins}`, VIEW_W / 2, 16);
  ctx.textAlign = 'right';
  ctx.fillText(`LIVES x${lives}`, VIEW_W - 20, 16);
  ctx.shadowColor = 'transparent';
}

function drawCenterText(title, subtitle) {
  ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 48px monospace';
  ctx.fillText(title, VIEW_W / 2, VIEW_H / 2 - 20);
  ctx.font = '18px monospace';
  ctx.fillText(subtitle, VIEW_W / 2, VIEW_H / 2 + 30);
}

function drawTitle() {
  ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffd700';
  ctx.font = 'bold 64px monospace';
  ctx.fillText('GREG GAME', VIEW_W / 2, 140);
  ctx.fillStyle = '#fff';
  ctx.font = '18px monospace';
  ctx.fillText('A / D  -  run left and right', VIEW_W / 2, 230);
  ctx.fillText('Space or W  -  jump (hold for higher)', VIEW_W / 2, 258);
  ctx.fillText('S  -  fall faster', VIEW_W / 2, 286);
  ctx.fillText('Shift  -  sprint', VIEW_W / 2, 314);
  if (Math.floor(time * 2) % 2 === 0) {
    ctx.font = 'bold 22px monospace';
    ctx.fillText('Click or press Enter to start', VIEW_W / 2, 390);
  }
}

// ---------------------------------------------------------------------------
// Main loop: fixed 60 Hz physics steps, rendered once per animation frame.

const STEP = 1 / 60;
let last = performance.now();
let acc = 0;

function frame(now) {
  acc += Math.min((now - last) / 1000, 0.1);
  last = now;
  while (acc >= STEP) {
    update(STEP);
    acc -= STEP;
  }
  render();
  requestAnimationFrame(frame);
}

loadLevel();
requestAnimationFrame(frame);
