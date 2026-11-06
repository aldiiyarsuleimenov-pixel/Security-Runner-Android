import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { GameEngine } from './game/GameEngine';
import Editor from './Editor';
import { drawText, drawTiled, getImg, hashId, spinAround } from './game/draw';
import { playSound } from './game/audio';
import { resolveColor } from './game/colors';
import * as online from './game/online';
import { LEVEL_1, STORY_LEVELS, type LevelData } from './game/levels';
import {
  DEV_CODE, exportStoryFile, getPB, getPlayerName, getStoryOrder, hasLiked, isCleared, loadDrafts, markLiked, markTestCleared, recordRun, setPlayerName, type RunResult, isDevMode, isLevel1Done, loadPublished, markLevel1Done, setDevMode,
  setStoryOrder, storySequence, unpublishLevel,
} from './game/levelStore';

type PlayMode = { kind: 'story'; index: number } | { kind: 'single' } | { kind: 'test' } | { kind: 'online' };

type InputState = {
  move: number;
  jump: boolean;
  slide: boolean;
  dash: boolean;
  groundSlam: boolean;
};

type Rect = {
  id: string | number; x: number; y: number; width: number; height: number; kind?: string; dir?: 0 | 1 | 2 | 3;
  skin?: string; color?: string; hidden?: boolean; spin?: number;
  alpha?: number; colorFrom?: string; colorK?: number;
  crumbleT?: number; hp?: number; aim?: number; aimOn?: boolean; locked?: boolean; beam?: number; pulse?: number; flash?: number; hitFlash?: number;
};
type Snapshot = {
  player: {
    x: number; y: number; vx: number; vy: number; width: number; height: number;
    grounded: boolean; facing: number; sliding: boolean; dashing: boolean; slamming: boolean;
  };
  cameraX: number; viewportWidth: number; viewportHeight: number;
  worldWidth: number; worldHeight: number;
  platforms: Rect[];
  spikes: Rect[];
  pickups: { id: string | number; x: number; y: number; size: number; collected: boolean; color?: string; colorFrom?: string; colorK?: number; alpha?: number; hidden?: boolean }[];
  texts: { id: string; x: number; y: number; text: string; size: number; color: string; colorFrom?: string; colorK?: number; alpha?: number; hidden?: boolean }[];
  time: number; timerRunning: boolean; style: number; styleActive: boolean;
  popups: { id: number; x: number; y: number; text: string; amount: number; age: number }[];
  bg?: string; images: Record<string, string>;
  techFlash: number; techKind: string; trail: { x: number; y: number; width: number; height: number; age: number }[];
  exit: Rect;
  effects: { id: string | number; x: number; y: number; kind: string; age: number; duration: number }[];
  score: number; deaths: number; complete: boolean; checkpointX: number;
  health: number; maxHealth: number; dashEnergy: number; maxDashEnergy: number; controlsLocked: boolean;
};

type BindingName = 'left' | 'right' | 'jump' | 'dash' | 'slide' | 'slam';
type Bindings = Record<BindingName, string>;
type ControlName = 'joystick' | 'jump' | 'dash' | 'slide' | 'slam';
type ActionControlName = Exclude<ControlName, 'joystick'>;
type ControlPosition = { x: number; y: number; scale: number };
type ControlLayout = Record<ControlName, ControlPosition>;
type ControlGroup = keyof ControlLayout;
const DEFAULT_BINDINGS: Bindings = {
  left: 'KeyA', right: 'KeyD', jump: 'Space', dash: 'ShiftLeft', slide: 'ControlLeft', slam: 'KeyS',
};
const DEFAULT_CONTROL_LAYOUT: ControlLayout = {
  joystick: { x: 10, y: 84, scale: 1 },
  jump: { x: 84, y: 74, scale: 1 },
  dash: { x: 96, y: 74, scale: 1 },
  slide: { x: 84, y: 92, scale: 1 },
  slam: { x: 96, y: 92, scale: 1 },
};
const TOUCH_BUTTONS: Array<{ name: ActionControlName; abbreviation: string; label: string }> = [
  { name: 'jump', abbreviation: 'ПР', label: 'ПРЫЖОК' },
  { name: 'dash', abbreviation: 'Р', label: 'РЫВОК' },
  { name: 'slide', abbreviation: 'СЛ', label: 'СЛАЙД 5С' },
  { name: 'slam', abbreviation: 'УД', label: 'ГР. СЛЭМ' },
];
const BINDING_LABELS: Record<BindingName, string> = {
  left: 'Влево', right: 'Вправо', jump: 'Прыжок', dash: 'Рывок', slide: 'Слайд', slam: 'Удар вниз',
};
const BINDING_ORDER: BindingName[] = ['left', 'right', 'jump', 'dash', 'slide', 'slam'];
const KEY_NAMES: Record<string, string> = {
  Space: 'ПРОБЕЛ', ShiftLeft: 'ЛЕВЫЙ SHIFT', ShiftRight: 'ПРАВЫЙ SHIFT',
  ControlLeft: 'ЛЕВЫЙ CTRL', ControlRight: 'ПРАВЫЙ CTRL', ArrowLeft: '←', ArrowRight: '→',
  ArrowUp: '↑', ArrowDown: '↓', Enter: 'ENTER', Escape: 'ESC',
};
const codeLabel = (code: string) => KEY_NAMES[code] || (code.startsWith('Key') ? code.slice(3) : code.startsWith('Digit') ? code.slice(5) : code);

function loadSettings(): { bindings: Bindings; sensitivity: number; controlLayout: ControlLayout } {
  const fallback = { bindings: DEFAULT_BINDINGS, sensitivity: 1, controlLayout: DEFAULT_CONTROL_LAYOUT };
  try {
    const stored = localStorage.getItem('velocity-impact-settings');
    if (!stored) return fallback;
    const parsed = JSON.parse(stored);
    const bindings = { ...DEFAULT_BINDINGS, ...(parsed.bindings || {}) } as Bindings;
    const unique = new Set(Object.values(bindings));
    if (unique.size !== BINDING_ORDER.length || BINDING_ORDER.some((key) => !bindings[key])) return fallback;
    const savedLayout = parsed.controlLayout || {};
    const legacyActions = savedLayout.actions || {};
    const legacyOffsets: Record<ActionControlName, { x: number; y: number }> = {
      jump: { x: -6, y: -10 },
      dash: { x: 6, y: -10 },
      slide: { x: -6, y: 8 },
      slam: { x: 6, y: 8 },
    };
    const coordinate = (value: unknown, fallbackValue: number) => (
      typeof value === 'number' && Number.isFinite(value)
        ? Math.max(0, Math.min(100, value))
        : fallbackValue
    );
    const savedScale = (value: unknown, fallbackValue: number) => (
      typeof value === 'number' && Number.isFinite(value)
        ? Math.max(.7, Math.min(1.5, value))
        : fallbackValue
    );
    const readPosition = (group: ControlGroup): ControlPosition => {
      const saved = savedLayout[group] || {};
      const fallbackPosition = DEFAULT_CONTROL_LAYOUT[group];
      const legacyOffset = group === 'joystick' ? null : legacyOffsets[group];
      const legacyCenterX = coordinate(legacyActions.x, DEFAULT_CONTROL_LAYOUT.jump.x + 6);
      const legacyCenterY = coordinate(legacyActions.y, DEFAULT_CONTROL_LAYOUT.jump.y + 10);
      const legacyX = legacyOffset
        ? legacyCenterX + legacyOffset.x
        : fallbackPosition.x;
      const legacyY = legacyOffset
        ? legacyCenterY + legacyOffset.y
        : fallbackPosition.y;
      return {
        x: coordinate(saved.x, legacyX),
        y: coordinate(saved.y, legacyY),
        scale: savedScale(saved.scale, savedScale(legacyActions.scale, fallbackPosition.scale)),
      };
    };
    return {
      bindings,
      sensitivity: Math.max(.5, Math.min(1.5, Number(parsed.sensitivity) || 1)),
      controlLayout: {
        joystick: readPosition('joystick'),
        jump: readPosition('jump'),
        dash: readPosition('dash'),
        slide: readPosition('slide'),
        slam: readPosition('slam'),
      },
    };
  } catch {
    return fallback;
  }
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function formatTime(t: number): string {
  const cs = Math.floor(t * 100);
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const sec = Math.floor((cs % 6000) / 100);
  const c2 = String(cs % 100).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${c2}` : `${m}:${String(sec).padStart(2, '0')}.${c2}`;
}

/** Green translucent security wall (СББ): breaks when the player dashes into it. */
function drawSbb(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, clock: number, seed: number) {
  const pulse = .5 + .5 * Math.sin(clock * 3 + seed);
  ctx.fillStyle = `rgba(48,255,128,${(.2 + .1 * pulse).toFixed(3)})`;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = 'rgba(190,255,215,.16)';
  for (let sy = y + ((clock * 14) % 8); sy < y + h; sy += 8) ctx.fillRect(x, sy, w, 1.5);
  ctx.strokeStyle = `rgba(90,255,160,${(.75 + .25 * pulse).toFixed(3)})`;
  ctx.lineWidth = 2;
  ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
  if (Math.max(w, h) >= 44) {
    ctx.save();
    ctx.translate(x + w / 2, y + h / 2);
    if (h > w) ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = 'rgba(205,255,225,.85)';
    ctx.font = '700 10px "IBM Plex Mono", monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('СББ', 0, 0);
    ctx.restore();
  }
}

/** Iron floor tile. `crumbleT` (seconds since stepped on) makes the very fragile kind shake, crack and glow red. */
function drawIron(ctx: CanvasRenderingContext2D, x0: number, y: number, w: number, h: number, kind: 'fragile' | 'crumble', crumbleT: number | undefined, clock: number) {
  const t = crumbleT ?? 0;
  const shake = crumbleT !== undefined ? Math.sin(clock * 90) * (1 + 3 * t) : 0;
  const x = x0 + shake;
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, kind === 'crumble' ? '#9a8478' : '#a7b2b4');
  g.addColorStop(1, kind === 'crumble' ? '#5b4a43' : '#5c696c');
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = 'rgba(255,255,255,.35)';
  ctx.fillRect(x, y, w, 2);
  ctx.strokeStyle = 'rgba(0,0,0,.45)'; ctx.lineWidth = 1;
  for (let px = x + 24; px < x + w - 1; px += 24) { ctx.beginPath(); ctx.moveTo(px, y + 1); ctx.lineTo(px, y + h); ctx.stroke(); }
  ctx.fillStyle = 'rgba(20,26,28,.7)';
  for (let px = x + 6; px < x + w - 3; px += 24) { ctx.fillRect(px, y + h / 2 - 1, 3, 3); }
  if (kind === 'crumble') {
    ctx.fillStyle = 'rgba(240,150,60,.55)';
    for (let px = x; px < x + w; px += 14) { ctx.beginPath(); ctx.moveTo(px, y + h); ctx.lineTo(px + 7, y + h); ctx.lineTo(px + 14, y + h - 5); ctx.lineTo(px + 7, y + h - 5); ctx.fill(); }
  }
  // cracks: a single one on fragile floors, more of them as a crumbling floor is about to give way
  ctx.strokeStyle = 'rgba(12,16,17,.85)'; ctx.lineWidth = 1.6;
  const cracks = kind === 'crumble' ? 1 + Math.floor(t * 4) : 1;
  for (let i = 0; i < cracks; i++) {
    const cx = x + w * (0.25 + 0.5 * ((i * 0.37) % 1));
    ctx.beginPath(); ctx.moveTo(cx, y); ctx.lineTo(cx + 3, y + h * .35); ctx.lineTo(cx - 2, y + h * .65); ctx.lineTo(cx + 4, y + h); ctx.stroke();
  }
  if (crumbleT !== undefined && t > .6) {
    ctx.fillStyle = `rgba(255,70,40,${(((t - .6) / .4) * (.35 + .25 * Math.sin(clock * 40))).toFixed(3)})`;
    ctx.fillRect(x, y, w, h);
  }
}

/** Turret body with a barrel that follows the locked-on target. */
function drawTurret(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, t: Rect, clock: number) {
  const cx = x + w / 2, cy = y + h / 2;
  ctx.fillStyle = '#243033';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = '#3b4b4f';
  ctx.fillRect(x, y, w, 4);
  ctx.strokeStyle = '#0d1213'; ctx.lineWidth = 2;
  ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(t.aim ?? -Math.PI / 2);
  ctx.fillStyle = t.locked ? '#ff5a3d' : '#6c7f84';
  ctx.fillRect(2, -4, w * .62, 8);
  ctx.restore();
  ctx.fillStyle = '#10181a';
  ctx.beginPath(); ctx.arc(cx, cy, 9, 0, Math.PI * 2); ctx.fill();
  const lit = t.aimOn || (t.flash ?? 0) > 0;
  ctx.fillStyle = lit ? (t.locked ? '#ffffff' : '#ff3d2e') : '#4a5558';
  if (lit && !t.locked && !(t.pulse && t.pulse > 0)) ctx.fillStyle = '#7a2a24';
  ctx.beginPath(); ctx.arc(cx, cy, 4.5, 0, Math.PI * 2); ctx.fill();
  const hp = t.hp ?? 6;
  if (hp < 6) {
    ctx.fillStyle = 'rgba(8,12,13,.8)'; ctx.fillRect(x, y - 9, w, 6);
    ctx.fillStyle = '#ff7a59'; ctx.fillRect(x + 1, y - 8, (w - 2) * (hp / 6), 4);
  }
  if (t.hitFlash && t.hitFlash > 0) { ctx.fillStyle = `rgba(255,255,255,${Math.min(.8, t.hitFlash * 5).toFixed(2)})`; ctx.fillRect(x, y, w, h); }
}

function drawArena(canvas: HTMLCanvasElement, snap: Snapshot, clock: number) {
  const bounds = canvas.getBoundingClientRect();
  if (!bounds.width || !bounds.height || !snap.viewportWidth || !snap.viewportHeight) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const pixelW = Math.round(bounds.width * dpr);
  const pixelH = Math.round(bounds.height * dpr);
  if (canvas.width !== pixelW || canvas.height !== pixelH) {
    canvas.width = pixelW;
    canvas.height = pixelH;
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const sx = bounds.width / snap.viewportWidth;
  const sy = bounds.height / snap.viewportHeight;
  ctx.setTransform(dpr * sx, 0, 0, dpr * sy, 0, 0);
  const vw = snap.viewportWidth;
  const vh = snap.viewportHeight;
  const camera = snap.cameraX;
  const player = snap.player;
  const worldX = (x: number) => x - camera;

  const sky = ctx.createLinearGradient(0, 0, 0, vh);
  sky.addColorStop(0, '#20292b');
  sky.addColorStop(.48, '#1a2223');
  sky.addColorStop(1, '#111718');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, vw, vh);

  // A receding steel city, deliberately offset from the collision geometry.
  ctx.save();
  ctx.globalAlpha = .55;
  for (let i = 0; i < 16; i++) {
    const parallax = camera * .17;
    const step = 154;
    const base = i * step - (parallax % step);
    const x = base - 60;
    const h = 90 + ((i * 47) % 175);
    ctx.fillStyle = i % 3 === 0 ? '#293335' : '#242d2f';
    ctx.fillRect(x, vh * .58 - h, 104 + ((i * 23) % 40), h);
    ctx.fillStyle = '#394548';
    ctx.fillRect(x + 8, vh * .58 - h + 12, 3, h - 14);
    for (let row = 0; row < Math.floor(h / 27); row++) {
      ctx.fillStyle = row % 2 === 0 ? 'rgba(107,145,140,.19)' : 'rgba(242,116,79,.1)';
      ctx.fillRect(x + 23, vh * .58 - h + 15 + row * 27, 9, 3);
      ctx.fillRect(x + 42, vh * .58 - h + 15 + row * 27, 9, 3);
    }
  }
  ctx.restore();

  // Haze bands and thin measurement grid lend the arena its industrial depth.
  const haze = ctx.createLinearGradient(0, vh * .43, 0, vh * .82);
  haze.addColorStop(0, 'rgba(90,125,120,0)');
  haze.addColorStop(.7, 'rgba(91,131,124,.09)');
  haze.addColorStop(1, 'rgba(8,13,14,0)');
  ctx.fillStyle = haze;
  ctx.fillRect(0, vh * .4, vw, vh * .5);
  ctx.strokeStyle = 'rgba(156,182,168,.06)';
  ctx.lineWidth = 1;
  for (let x = -((camera * .38) % 64); x < vw; x += 64) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, vh); ctx.stroke();
  }
  for (let y = 26; y < vh; y += 44) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(vw, y); ctx.stroke();
  }

  // Huge machinery silhouettes in the far plane.
  ctx.fillStyle = '#151d1f';
  const machineOffset = (camera * .42) % 370;
  for (let i = -1; i < 6; i++) {
    const x = i * 370 - machineOffset;
    const top = vh * .25 + ((i + 1) % 3) * 16;
    ctx.fillRect(x + 34, top, 132, vh * .42);
    ctx.fillStyle = '#293537';
    ctx.fillRect(x + 27, top + 12, 146, 6);
    ctx.fillRect(x + 52, top + 28, 3, vh * .37);
    ctx.fillRect(x + 145, top + 28, 3, vh * .37);
    ctx.fillStyle = '#151d1f';
    ctx.beginPath(); ctx.arc(x + 100, top + 81, 30, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(102,142,136,.35)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x + 100, top + 81, 25, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#151d1f';
  }

  // Custom level background image (parallax, repeated horizontally) replaces the default scenery.
  const bgImg = getImg(snap.bg ? snap.images[snap.bg] : undefined);
  if (bgImg) {
    const scale = vh / bgImg.naturalHeight;
    const tileW = bgImg.naturalWidth * scale;
    let bx = -((camera * .25) % tileW);
    if (bx > 0) bx -= tileW;
    for (; bx < vw; bx += tileW) ctx.drawImage(bgImg, bx, 0, tileW + 1, vh);
    ctx.fillStyle = 'rgba(8,12,13,.22)';
    ctx.fillRect(0, 0, vw, vh);
  }

  // Platforms: top edges catch the light so every landing reads at speed.
  for (const platform of snap.platforms) {
    if (platform.hidden) continue;
    const x = worldX(platform.x);
    if (x + platform.width < -100 || x > vw + 100) continue;
    ctx.save();
    ctx.globalAlpha = platform.alpha ?? 1;
    spinAround(ctx, x, platform.y, platform.width, platform.height, platform.spin);
    if (platform.kind === 'sbb') { drawSbb(ctx, x, platform.y, platform.width, platform.height, clock, hashId(platform.id)); ctx.restore(); continue; }
    if (platform.kind === 'fragile' || platform.kind === 'crumble') { drawIron(ctx, x, platform.y, platform.width, platform.height, platform.kind, platform.crumbleT, clock); ctx.restore(); continue; }
    if (platform.kind === 'turret') { drawTurret(ctx, x, platform.y, platform.width, platform.height, platform, clock); ctx.restore(); continue; }
    const skin = getImg(platform.skin ? snap.images[platform.skin] : undefined);
    const isSolid = platform.kind === 'block' || platform.kind === 'half';
    if (skin) {
      drawTiled(ctx, skin, x, platform.y, platform.width, platform.height, 0, vw);
      if (platform.color || platform.colorFrom) { ctx.globalAlpha = .4 * (platform.alpha ?? 1); ctx.fillStyle = resolveColor(platform, '#000000'); ctx.fillRect(x, platform.y, platform.width, platform.height); ctx.globalAlpha = platform.alpha ?? 1; }
      ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = 1;
      ctx.strokeRect(x + .5, platform.y + .5, platform.width - 1, Math.min(platform.height, 200) - 1);
    } else {
      ctx.fillStyle = resolveColor(platform, isSolid ? '#3b5052' : '#2b3537');
      ctx.fillRect(x, platform.y, platform.width, platform.height);
      ctx.fillStyle = (platform.color || platform.colorFrom) ? 'rgba(255,255,255,.35)' : '#85958e';
      ctx.fillRect(x, platform.y, platform.width, Math.min(3, platform.height));
      ctx.fillStyle = 'rgba(7,12,13,.35)';
      ctx.fillRect(x, platform.y + 5, platform.width, Math.max(0, platform.height - 5));
      ctx.fillStyle = '#586563';
      for (let bx = x + 13; bx < x + platform.width - 8; bx += 52) {
        ctx.fillRect(bx, platform.y + 9, 3, 3);
      }
      if (platform.height > 15) {
        ctx.strokeStyle = 'rgba(120,142,135,.17)';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x, platform.y + 11); ctx.lineTo(x + platform.width, platform.y + 11); ctx.stroke();
      }
    }
    ctx.restore();
  }

  // Turret aim lines: dashed while tracking (blinks with each beep), solid once locked, a thick flash on firing.
  for (const t of snap.platforms) {
    if (t.kind !== 'turret' || t.hidden) continue;
    const ang = t.aim ?? 0;
    const len = t.beam ?? 0;
    if (len <= 0) continue;
    const bx = worldX(t.x + t.width / 2);
    const by = t.y + t.height / 2;
    const ex2 = bx + Math.cos(ang) * len;
    const ey2 = by + Math.sin(ang) * len;
    if ((t.flash ?? 0) > 0) {
      const f = (t.flash ?? 0) / .22;
      ctx.save();
      ctx.shadowColor = '#ff6a3d'; ctx.shadowBlur = 24;
      ctx.strokeStyle = `rgba(255,245,230,${f.toFixed(2)})`; ctx.lineWidth = 3 + 9 * f;
      ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(ex2, ey2); ctx.stroke();
      ctx.restore();
    } else if (t.aimOn) {
      ctx.save();
      const beep = (t.pulse ?? 0) > 0;
      if (t.locked) {
        ctx.shadowColor = '#ff3d2e'; ctx.shadowBlur = 14;
        ctx.strokeStyle = '#ff5a3d'; ctx.lineWidth = 3;
      } else {
        ctx.setLineDash([10, 9]); ctx.lineDashOffset = -clock * 40;
        ctx.strokeStyle = beep ? 'rgba(255,90,60,.95)' : 'rgba(255,90,60,.38)';
        ctx.lineWidth = beep ? 2.6 : 1.4;
      }
      ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(ex2, ey2); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = t.locked ? '#ffffff' : 'rgba(255,90,60,.8)';
      ctx.beginPath(); ctx.arc(ex2, ey2, t.locked ? 4.5 : 3, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
  }

  // Hazard teeth are high-contrast silhouettes with a hot warning edge.
  for (const spike of snap.spikes) {
    const x = worldX(spike.x);
    if (spike.hidden || x + spike.width < -60 || x > vw + 60) continue;
    ctx.save();
    ctx.globalAlpha = spike.alpha ?? 1;
    spinAround(ctx, x, spike.y, spike.width, spike.height, spike.spin);
    const dir = spike.dir ?? 0;
    const horiz = dir === 0 || dir === 2;
    const len = horiz ? spike.width : spike.height;
    const count = Math.max(1, Math.floor(len / 17));
    const each = len / count;
    const sy = spike.y, w = spike.width, h = spike.height;
    for (let i = 0; i < count; i++) {
      const p0 = i * each, p1 = (i + 1) * each, pm = (p0 + p1) / 2;
      ctx.beginPath();
      if (dir === 0) { ctx.moveTo(x + p0, sy + h); ctx.lineTo(x + pm, sy); ctx.lineTo(x + p1, sy + h); }
      else if (dir === 2) { ctx.moveTo(x + p0, sy); ctx.lineTo(x + pm, sy + h); ctx.lineTo(x + p1, sy); }
      else if (dir === 1) { ctx.moveTo(x, sy + p0); ctx.lineTo(x + w, sy + pm); ctx.lineTo(x, sy + p1); }
      else { ctx.moveTo(x + w, sy + p0); ctx.lineTo(x, sy + pm); ctx.lineTo(x + w, sy + p1); }
      ctx.closePath();
      ctx.fillStyle = resolveColor(spike, '#c3c5b7');
      ctx.fill();
      ctx.strokeStyle = '#f2744f'; ctx.lineWidth = 1.4; ctx.stroke();
    }
    ctx.fillStyle = 'rgba(242,116,79,.13)';
    if (dir === 0) ctx.fillRect(x, sy + h - 2, w, 6);
    else if (dir === 2) ctx.fillRect(x, sy - 4, w, 6);
    else if (dir === 1) ctx.fillRect(x - 4, sy, 6, h);
    else ctx.fillRect(x + w - 2, sy, 6, h);
    ctx.restore();
  }

  // Uncollected score shards: large, glowing and bobbing so they read from far away.
  for (const pickup of snap.pickups) {
    if (pickup.collected || pickup.hidden) continue;
    const x = worldX(pickup.x);
    if (x < -40 || x > vw + 40) continue;
    const phase = hashId(pickup.id) * .7;
    const pulse = 1 + Math.sin(clock * 5 + phase) * .14;
    const size = Math.max(pickup.size, 18) * 1.45 * pulse;
    const bob = Math.sin(clock * 2.6 + phase) * 4;
    const main = resolveColor(pickup, '#65e4df');
    ctx.save();
    ctx.globalAlpha = pickup.alpha ?? 1;
    ctx.translate(x, pickup.y + bob);
    // soft halo + ring
    const halo = ctx.createRadialGradient(0, 0, 2, 0, 0, size * 1.7);
    halo.addColorStop(0, 'rgba(101,228,223,.45)');
    halo.addColorStop(1, 'rgba(101,228,223,0)');
    ctx.fillStyle = halo;
    ctx.beginPath(); ctx.arc(0, 0, size * 1.7, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(239,243,221,.55)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(0, 0, size * (.95 + Math.sin(clock * 3 + phase) * .08), 0, Math.PI * 2); ctx.stroke();
    // diamond body
    ctx.rotate(clock * .55);
    ctx.shadowColor = main; ctx.shadowBlur = 22;
    ctx.fillStyle = main;
    ctx.fillRect(-size * .5, -size * .5, size, size);
    ctx.shadowBlur = 0;
    ctx.strokeStyle = '#effcff'; ctx.lineWidth = 2;
    ctx.strokeRect(-size * .5, -size * .5, size, size);
    ctx.fillStyle = '#eff3dd';
    ctx.fillRect(-size * .2, -size * .2, size * .4, size * .4);
    ctx.restore();
  }

  // Free text placed by the level author.
  for (const t of snap.texts) {
    if (t.hidden) continue;
    const tx = worldX(t.x);
    if (tx > vw + 400 || tx < -600) continue;
    ctx.globalAlpha = t.alpha ?? 1;
    drawText(ctx, t.text, tx, t.y, t.size, resolveColor(t, '#eff3dd'));
    ctx.globalAlpha = 1;
  }

  // Exit gate.
  const gateX = worldX(snap.exit.x);
  if (gateX < vw + 120 && gateX + snap.exit.width > -120) {
    const gatePulse = .45 + (Math.sin(clock * 3.4) + 1) * .12;
    ctx.fillStyle = 'rgba(101,228,223,.08)';
    ctx.fillRect(gateX - 18, snap.exit.y - 22, snap.exit.width + 36, snap.exit.height + 22);
    ctx.fillStyle = '#1a3334';
    ctx.fillRect(gateX, snap.exit.y, snap.exit.width, snap.exit.height);
    ctx.strokeStyle = `rgba(101,228,223,${gatePulse})`; ctx.lineWidth = 3;
    ctx.strokeRect(gateX + 4, snap.exit.y + 4, snap.exit.width - 8, snap.exit.height - 4);
    ctx.fillStyle = '#65e4df';
    ctx.fillRect(gateX + snap.exit.width * .47, snap.exit.y + 20, 4, snap.exit.height - 40);
    ctx.font = '600 9px "IBM Plex Mono"';
    ctx.fillText('ВЫХОД', gateX + 5, snap.exit.y - 8);
  }

  // Player wakes, impacts, and slash marks.
  for (const effect of snap.effects) {
    const life = Math.max(0, 1 - effect.age / Math.max(effect.duration, .001));
    const ex = worldX(effect.x);
    if (effect.kind === 'break') {
      const grow = 1 - life;
      ctx.save();
      ctx.globalAlpha = life;
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2 + Number(effect.id) * .7;
        const sp = 40 + (i % 3) * 22;
        const dx2 = Math.cos(a) * sp * grow;
        const dy2 = Math.sin(a) * sp * grow + 160 * grow * grow;
        ctx.fillStyle = i % 2 ? '#9aa6a8' : '#e0864f';
        ctx.save();
        ctx.translate(ex + dx2, effect.y + dy2);
        ctx.rotate(grow * 6 + i);
        ctx.fillRect(-4, -3, 8, 6);
        ctx.restore();
      }
      ctx.restore();
    } else if (effect.kind === 'tech') {
      // Blue burst: expanding ring, a second echo ring and radial sparks.
      const grow = 1 - life;
      ctx.save();
      ctx.shadowColor = '#3da9ff'; ctx.shadowBlur = 18;
      ctx.globalAlpha = life * .9;
      ctx.strokeStyle = '#59b9ff'; ctx.lineWidth = 3 + 5 * life;
      ctx.beginPath(); ctx.arc(ex, effect.y, 12 + grow * 70, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = life * .6;
      ctx.strokeStyle = '#bfe7ff'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(ex, effect.y, 8 + grow * 44, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = life;
      ctx.strokeStyle = '#8fd3ff'; ctx.lineWidth = 2;
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2 + Number(effect.id) * .3;
        ctx.beginPath();
        ctx.moveTo(ex + Math.cos(a) * (18 + grow * 40), effect.y + Math.sin(a) * (18 + grow * 40));
        ctx.lineTo(ex + Math.cos(a) * (30 + grow * 70), effect.y + Math.sin(a) * (30 + grow * 70));
        ctx.stroke();
      }
      ctx.restore();
      ctx.globalAlpha = 1;
    } else if (effect.kind.toLowerCase().includes('dash')) {
      ctx.globalAlpha = life * .52;
      ctx.fillStyle = '#65e4df';
      ctx.fillRect(ex - 48, effect.y - 2, 48, 4);
      ctx.fillRect(ex - 31, effect.y + 6, 28, 2);
      ctx.globalAlpha = 1;
    } else {
      ctx.globalAlpha = life * .75;
      ctx.strokeStyle = effect.kind.toLowerCase().includes('slam') ? '#f2744f' : '#e5ead8';
      ctx.lineWidth = 2 + 4 * (1 - life);
      ctx.beginPath();
      ctx.arc(ex, effect.y, 10 + (1 - life) * 42, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  // Speed streaks only appear when the runner is really moving.
  if (Math.abs(player.vx) > 4 || player.dashing) {
    const streakAlpha = Math.min(.26, Math.abs(player.vx) * .018);
    ctx.strokeStyle = `rgba(101,228,223,${streakAlpha})`; ctx.lineWidth = 1;
    for (let i = 0; i < 8; i++) {
      const y = vh * .25 + ((i * 67 + clock * 130) % (vh * .62));
      const x = ((i * 113 + clock * 290) % vw);
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 28 - Math.abs(player.vx) * 2, y); ctx.stroke();
    }
  }

  // Blue afterimages trail behind a successful Ground Jump / Slide Jump.
  for (const ghost of snap.trail) {
    const fade = Math.max(0, 1 - ghost.age / .42);
    ctx.globalAlpha = fade * .38;
    ctx.fillStyle = '#4db4ff';
    roundedRect(ctx, worldX(ghost.x) + 3, ghost.y + 4, ghost.width - 6, ghost.height - 6, 4);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  const px = worldX(player.x);
  const py = player.y;
  const pw = player.width;
  const ph = player.height;
  ctx.save();
  if (player.dashing) {
    ctx.globalAlpha = .28;
    ctx.fillStyle = '#65e4df';
    ctx.fillRect(px - player.facing * 34, py + 5, pw + 25, ph - 7);
    ctx.globalAlpha = 1;
  }
  // Leaning silhouette: luminous visor and orange suit seam make the runner legible.
  ctx.translate(px + pw / 2, py + ph / 2);
  const lean = player.grounded ? Math.max(-.12, Math.min(.12, player.vx * .015)) : Math.max(-.2, Math.min(.2, player.vy * .009));
  ctx.rotate(lean);
  const bodyX = -pw / 2;
  const bodyY = -ph / 2;
  if (snap.techFlash > 0) { ctx.shadowColor = '#3da9ff'; ctx.shadowBlur = 10 + 26 * snap.techFlash; }
  ctx.fillStyle = snap.techFlash > 0 ? '#9fdcff' : player.slamming ? '#f2744f' : '#d8ddd0';
  roundedRect(ctx, bodyX + pw * .12, bodyY + ph * .16, pw * .76, ph * .78, 4);
  ctx.fill();
  ctx.fillStyle = '#536365';
  ctx.fillRect(bodyX + pw * .2, bodyY + ph * .48, pw * .6, ph * .25);
  ctx.fillStyle = '#f2744f';
  ctx.fillRect(bodyX + (player.facing > 0 ? pw * .72 : pw * .13), bodyY + ph * .35, pw * .16, ph * .08);
  ctx.fillStyle = '#65e4df';
  ctx.fillRect(bodyX + (player.facing > 0 ? pw * .59 : pw * .19), bodyY + ph * .25, pw * .2, Math.max(3, ph * .07));
  ctx.fillStyle = '#273234';
  ctx.fillRect(bodyX + pw * .15, bodyY + ph * .88, pw * .7, ph * .1);
  ctx.restore();

  // Floating style-point popups: green for rewards, red for wasted techniques.
  for (const pop of snap.popups) {
    const life = Math.max(0, 1 - pop.age / 1.3);
    ctx.save();
    ctx.globalAlpha = Math.min(1, life * 1.6);
    ctx.font = '800 15px "IBM Plex Mono", monospace';
    ctx.textAlign = 'center';
    ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(6,10,11,.85)'; ctx.lineJoin = 'round';
    const py2 = pop.y - pop.age * 46;
    ctx.strokeText(pop.text, worldX(pop.x), py2);
    ctx.fillStyle = pop.amount >= 0 ? '#7dff9b' : '#ff6a5a';
    ctx.fillText(pop.text, worldX(pop.x), py2);
    ctx.restore();
  }

  // Short blue flash around the screen edges confirms a technique was performed.
  if (snap.techFlash > 0) {
    const edge = ctx.createRadialGradient(vw / 2, vh / 2, vh * .35, vw / 2, vh / 2, vw * .62);
    edge.addColorStop(0, 'rgba(61,169,255,0)');
    edge.addColorStop(1, `rgba(61,169,255,${(.34 * snap.techFlash).toFixed(3)})`);
    ctx.fillStyle = edge;
    ctx.fillRect(0, 0, vw, vh);
  }

  // Bottom edge glow / camera calibration ticks.
  ctx.fillStyle = 'rgba(101,228,223,.35)';
  ctx.fillRect(0, vh - 2, vw, 1);
  ctx.fillStyle = 'rgba(224,230,214,.23)';
  for (let x = -((camera * .6) % 52); x < vw; x += 52) ctx.fillRect(x, vh - 6, 1, 3);
}

function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<GameEngine | null>(null);
  const keyboardRef = useRef(new Set<string>());
  const touchActionsRef = useRef(new Set<string>());
  const joystickRef = useRef({ pointerId: -1, x: 0 });
  const layoutPreviewRef = useRef<HTMLDivElement>(null);
  const layoutDragRef = useRef<{ group: ControlGroup; pointerId: number; offsetX: number; offsetY: number } | null>(null);
  const settings = useRef(loadSettings());
  const bindingsRef = useRef<Bindings>(settings.current.bindings);
  const sensitivityRef = useRef(settings.current.sensitivity);
  const controlLayoutRef = useRef<ControlLayout>(settings.current.controlLayout);
  const captureRef = useRef<BindingName | null>(null);
  const [hud, setHud] = useState({
    score: 0, deaths: 0, progress: 0, complete: false,
    health: 100, maxHealth: 100, dashEnergy: 100, maxDashEnergy: 100, controlsLocked: false, style: 0, styleActive: false,
  });
  const [activeTouches, setActiveTouches] = useState<Set<string>>(new Set());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [page, setPage] = useState<'title' | 'settings' | 'game' | 'levels' | 'editor' | 'online'>('title');
  const pageRef = useRef<string>('title');
  const currentLevelRef = useRef<LevelData>(LEVEL_1);
  const playModeRef = useRef<PlayMode>({ kind: 'story', index: 0 });
  const timerElRef = useRef<HTMLDivElement>(null);
  const [result, setResult] = useState<(RunResult & { time: number; style: number; styleActive: boolean; testOnly: boolean }) | null>(null);
  const [onlineSort, setOnlineSort] = useState<'new' | 'top'>('new');
  const [onlineList, setOnlineList] = useState<online.OnlineLevelInfo[]>([]);
  const [onlineBusy, setOnlineBusy] = useState(false);
  const [onlineError, setOnlineError] = useState('');
  const [currentLevel, setCurrentLevel] = useState<LevelData>(LEVEL_1);
  const [playMode, setPlayMode] = useState<PlayMode>({ kind: 'story', index: 0 });
  const [editing, setEditing] = useState<LevelData | null>(null);
  pageRef.current = page;
  const [devMode, setDevModeState] = useState(() => isDevMode());
  const [level1Done, setLevel1Done] = useState(() => isLevel1Done());
  const [levelsTick, setLevelsTick] = useState(0);
  const versionTaps = useRef({ count: 0, last: 0 });
  const [tapCount, setTapCount] = useState(0);
  const [devDialog, setDevDialog] = useState<'closed' | 'enter' | 'leave'>('closed');
  const [devInput, setDevInput] = useState('');
  const [devError, setDevError] = useState(false);
  const [dialog, setDialog] = useState<{ message: string; text?: string; input?: boolean; resolve: (v: boolean | string | null) => void } | null>(null);
  const [dialogInput, setDialogInput] = useState('');
  const askConfirm = useCallback((message: string) => new Promise<boolean>((resolve) => setDialog({ message, resolve: (v) => resolve(v === true) })), []);
  const showText = useCallback((message: string, text: string) => new Promise<boolean>((resolve) => setDialog({ message, text, resolve: () => resolve(true) })), []);
  const askText = useCallback((message: string, initial = '') => new Promise<string | null>((resolve) => {
    setDialogInput(initial);
    setDialog({ message, input: true, resolve: (v) => resolve(typeof v === 'string' ? v : null) });
  }), []);
  const closeDialog = (value: boolean | string | null) => { dialog?.resolve(value); setDialog(null); };
  const dialogNode = dialog && (
    <div className="sr-dev-dialog" role="dialog" aria-modal="true">
      <div className="sr-dev-card">
        <strong>{dialog.message}</strong>
        {dialog.input && <textarea rows={3} autoFocus value={dialogInput} onChange={(e) => setDialogInput(e.target.value)} />}
        {dialog.text !== undefined && <textarea readOnly rows={5} value={dialog.text} onFocus={(e) => e.currentTarget.select()} />}
        <div>
          {dialog.input ? (
            <>
              <button className="settings-trigger" onClick={() => closeDialog(dialogInput)}>OK</button>
              <button className="settings-trigger" onClick={() => closeDialog(null)}>Отмена</button>
            </>
          ) : (
            <>
              <button className="settings-trigger" onClick={() => closeDialog(true)}>{dialog.text !== undefined ? 'Закрыть' : 'Да'}</button>
              {dialog.text === undefined && <button className="settings-trigger" onClick={() => closeDialog(false)}>Нет</button>}
            </>
          )}
        </div>
      </div>
    </div>
  );
  const [settingsReturnPage, setSettingsReturnPage] = useState<'title' | 'game'>('title');
  const [settingsTab, setSettingsTab] = useState<'controls' | 'audio' | 'video'>('controls');
  const [musicVolume, setMusicVolume] = useState(() => Number(localStorage.getItem('sr-music-volume') ?? 70));
  const [effectsVolume, setEffectsVolume] = useState(() => Number(localStorage.getItem('sr-effects-volume') ?? 85));
  const [masterVolume, setMasterVolume] = useState(() => Number(localStorage.getItem('sr-master-volume') ?? 80));
  const [showEffects, setShowEffects] = useState(() => localStorage.getItem('sr-effects') !== 'off');
  const [bindings, setBindings] = useState<Bindings>(settings.current.bindings);
  const [sensitivity, setSensitivity] = useState(settings.current.sensitivity);
  const [controlLayout, setControlLayout] = useState<ControlLayout>(settings.current.controlLayout);
  const [draggingControl, setDraggingControl] = useState<ControlGroup | null>(null);
  const [capturing, setCapturing] = useState<BindingName | null>(null);
  const [orientationMessage, setOrientationMessage] = useState('');
  const initial = useRef<Snapshot | null>(null);

  const persistSettings = useCallback((nextBindings: Bindings, nextSensitivity: number, nextLayout: ControlLayout) => {
    bindingsRef.current = nextBindings;
    sensitivityRef.current = nextSensitivity;
    controlLayoutRef.current = nextLayout;
    try {
      localStorage.setItem('velocity-impact-settings', JSON.stringify({
        bindings: nextBindings,
        sensitivity: nextSensitivity,
        controlLayout: nextLayout,
      }));
    } catch { /* Local settings remain usable for this session when storage is unavailable. */ }
  }, []);

  const restart = useCallback(() => {
    engineRef.current?.restart();
    engineRef.current?.setStyleActive(playModeRef.current.kind !== 'test' && isCleared(currentLevelRef.current.id));
    if (timerElRef.current) timerElRef.current.textContent = '0:00.00';
    keyboardRef.current.clear();
    touchActionsRef.current.clear();
    joystickRef.current = { pointerId: -1, x: 0 };
    setActiveTouches(new Set());
    if (engineRef.current) {
      const snap = engineRef.current.getSnapshot() as Snapshot;
      setHud({
        score: snap.score, deaths: snap.deaths,
        progress: Math.round((snap.player.x / Math.max(snap.worldWidth, 1)) * 100),
        complete: snap.complete,
        health: snap.health, maxHealth: snap.maxHealth, dashEnergy: snap.dashEnergy,
        maxDashEnergy: snap.maxDashEnergy, controlsLocked: snap.controlsLocked, style: snap.style, styleActive: snap.styleActive,
      });
    }
  }, []);

  useEffect(() => {
    const engine = new GameEngine(currentLevelRef.current);
    engineRef.current = engine;
    initial.current = engine.getSnapshot() as Snapshot;
    let running = true;
    let frame = 0;
    let previous = performance.now();
    let lastHud = 0;
    const tick = (now: number) => {
      if (!running) return;
      const dt = Math.min((now - previous) / 1000, .04);
      previous = now;
      const keys = keyboardRef.current;
      const touch = touchActionsRef.current;
      const map = bindingsRef.current;
      const input: InputState = {
        move: ((keys.has(map.right) ? 1 : 0) - (keys.has(map.left) ? 1 : 0))
          || Math.max(-1, Math.min(1, joystickRef.current.x * sensitivityRef.current)),
        jump: keys.has(map.jump) || touch.has('jump'),
        slide: keys.has(map.slide) || touch.has('slide'),
        dash: keys.has(map.dash) || touch.has('dash'),
        groundSlam: keys.has(map.slam) || touch.has('slam'),
      };
      const canvas = canvasRef.current;
      if (canvas) {
        const bounds = canvas.getBoundingClientRect();
        engine.setViewportAspectRatio(bounds.width / Math.max(bounds.height, 1));
      }
      // Only the game screen advances the simulation (turrets must not shoot while you edit or browse menus).
      if (pageRef.current === 'game') {
        engine.step(input, dt);
        for (const name of engine.drainSounds()) playSound(name);
      } else {
        engine.drainSounds();
      }
      const snap = engine.getSnapshot() as Snapshot;
      if (timerElRef.current) timerElRef.current.textContent = formatTime(snap.time);
      if (canvas) drawArena(canvas, snap, now / 1000);
      if (now - lastHud > 110) {
        lastHud = now;
        setHud({
          score: snap.score, deaths: snap.deaths,
          progress: Math.max(0, Math.min(100, Math.round((snap.player.x / Math.max(snap.worldWidth, 1)) * 100))),
          complete: snap.complete,
          health: snap.health, maxHealth: snap.maxHealth, dashEnergy: snap.dashEnergy,
          maxDashEnergy: snap.maxDashEnergy, controlsLocked: snap.controlsLocked, style: snap.style, styleActive: snap.styleActive,
        });
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      running = false;
      cancelAnimationFrame(frame);
      engineRef.current = null;
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (captureRef.current) {
        event.preventDefault();
        event.stopPropagation();
        if (event.code === 'Escape') {
          captureRef.current = null;
          setCapturing(null);
          return;
        }
        const target = captureRef.current;
        const collision = BINDING_ORDER.find((name) => name !== target && bindingsRef.current[name] === event.code);
        if (collision) return;
        const next = { ...bindingsRef.current, [target]: event.code };
        setBindings(next);
        captureRef.current = null;
        setCapturing(null);
        persistSettings(next, sensitivityRef.current, controlLayoutRef.current);
        keyboardRef.current.clear();
        return;
      }
      if (settingsOpen || page !== 'game') return;
      if (!BINDING_ORDER.some((name) => bindingsRef.current[name] === event.code)) return;
      event.preventDefault();
      keyboardRef.current.add(event.code);
    };
    const onKeyUp = (event: KeyboardEvent) => keyboardRef.current.delete(event.code);
    const onBlur = () => keyboardRef.current.clear();
    window.addEventListener('keydown', onKeyDown, { passive: false });
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [persistSettings, settingsOpen, page]);

  const updateJoystick = (event: ReactPointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const dx = event.clientX - (rect.left + rect.width / 2);
    joystickRef.current.x = Math.max(-1, Math.min(1, dx / (rect.width * .34)));
    event.currentTarget.style.setProperty('--stick-x', `${Math.max(-25, Math.min(25, dx * .28))}px`);
    event.currentTarget.style.setProperty('--stick-y', `${Math.max(-25, Math.min(25, (event.clientY - (rect.top + rect.height / 2)) * .28))}px`);
  };
  const startJoystick = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    joystickRef.current.pointerId = event.pointerId;
    updateJoystick(event);
  };
  const endJoystick = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (joystickRef.current.pointerId !== event.pointerId) return;
    joystickRef.current = { pointerId: -1, x: 0 };
    event.currentTarget.style.setProperty('--stick-x', '0px');
    event.currentTarget.style.setProperty('--stick-y', '0px');
  };
  const startAction = (event: ReactPointerEvent<HTMLButtonElement>, action: string) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    touchActionsRef.current.add(action);
    setActiveTouches(new Set(touchActionsRef.current));
  };
  const endAction = (event: ReactPointerEvent<HTMLButtonElement>, action: string) => {
    event.preventDefault();
    touchActionsRef.current.delete(action);
    setActiveTouches(new Set(touchActionsRef.current));
  };

  const assignBinding = (name: BindingName) => {
    captureRef.current = name;
    setCapturing(name);
  };
  const changeSensitivity = (value: number) => {
    setSensitivity(value);
    persistSettings(bindingsRef.current, value, controlLayoutRef.current);
  };
  const changeControlPosition = (group: ControlGroup, x: number, y: number, shouldPersist = true) => {
    const next = {
      ...controlLayoutRef.current,
      [group]: {
        x: Math.max(0, Math.min(100, x)),
        y: Math.max(0, Math.min(100, y)),
      },
    };
    controlLayoutRef.current = next;
    setControlLayout(next);
    if (shouldPersist) persistSettings(bindingsRef.current, sensitivityRef.current, next);
  };
  const changeControlScale = (group: ControlGroup, scale: number) => {
    const next = {
      ...controlLayoutRef.current,
      [group]: { ...controlLayoutRef.current[group], scale },
    };
    controlLayoutRef.current = next;
    setControlLayout(next);
    persistSettings(bindingsRef.current, sensitivityRef.current, next);
  };
  const changeActionScale = (scale: number) => {
    const next: ControlLayout = {
      ...controlLayoutRef.current,
      jump: { ...controlLayoutRef.current.jump, scale },
      dash: { ...controlLayoutRef.current.dash, scale },
      slide: { ...controlLayoutRef.current.slide, scale },
      slam: { ...controlLayoutRef.current.slam, scale },
    };
    controlLayoutRef.current = next;
    setControlLayout(next);
    persistSettings(bindingsRef.current, sensitivityRef.current, next);
  };
  const startControlDrag = (event: ReactPointerEvent<HTMLDivElement>, group: ControlGroup) => {
    event.preventDefault();
    const preview = layoutPreviewRef.current;
    if (!preview) return;
    const targetBounds = event.currentTarget.getBoundingClientRect();
    layoutDragRef.current = {
      group,
      pointerId: event.pointerId,
      offsetX: event.clientX - (targetBounds.left + targetBounds.width / 2),
      offsetY: event.clientY - (targetBounds.top + targetBounds.height / 2),
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setDraggingControl(group);
  };
  const moveControlDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = layoutDragRef.current;
    const preview = layoutPreviewRef.current;
    if (!drag || drag.pointerId !== event.pointerId || !preview) return;
    event.preventDefault();
    const bounds = preview.getBoundingClientRect();
    const targetBounds = event.currentTarget.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    const centerX = Math.max(targetBounds.width / 2, Math.min(bounds.width - targetBounds.width / 2, event.clientX - bounds.left - drag.offsetX));
    const centerY = Math.max(targetBounds.height / 2, Math.min(bounds.height - targetBounds.height / 2, event.clientY - bounds.top - drag.offsetY));
    changeControlPosition(drag.group, (centerX / bounds.width) * 100, (centerY / bounds.height) * 100, false);
  };
  const endControlDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (layoutDragRef.current?.pointerId !== event.pointerId) return;
    layoutDragRef.current = null;
    setDraggingControl(null);
    persistSettings(bindingsRef.current, sensitivityRef.current, controlLayoutRef.current);
  };
  const nudgeControl = (event: ReactKeyboardEvent<HTMLDivElement>, group: ControlGroup) => {
    const directions: Record<string, { x: number; y: number }> = {
      ArrowLeft: { x: -1, y: 0 },
      ArrowRight: { x: 1, y: 0 },
      ArrowUp: { x: 0, y: -1 },
      ArrowDown: { x: 0, y: 1 },
    };
    const direction = directions[event.key];
    if (!direction) return;
    event.preventDefault();
    const step = event.shiftKey ? 5 : 1;
    const position = controlLayoutRef.current[group];
    changeControlPosition(group, position.x + direction.x * step, position.y + direction.y * step);
  };
  const resetControlLayout = () => {
    const defaults: ControlLayout = {
      joystick: { ...DEFAULT_CONTROL_LAYOUT.joystick },
      jump: { ...DEFAULT_CONTROL_LAYOUT.jump },
      dash: { ...DEFAULT_CONTROL_LAYOUT.dash },
      slide: { ...DEFAULT_CONTROL_LAYOUT.slide },
      slam: { ...DEFAULT_CONTROL_LAYOUT.slam },
    };
    setControlLayout(defaults);
    persistSettings(bindingsRef.current, sensitivityRef.current, defaults);
  };
  const resetSettings = () => {
    setBindings(DEFAULT_BINDINGS);
    setSensitivity(1);
    captureRef.current = null;
    setCapturing(null);
    persistSettings(DEFAULT_BINDINGS, 1, controlLayoutRef.current);
  };
  const requestLandscape = async () => {
    setOrientationMessage('');
    try {
      if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
        await document.documentElement.requestFullscreen();
      }
      const orientation = screen.orientation as ScreenOrientation & { lock?: (orientation: string) => Promise<void> };
      if (orientation?.lock) {
        await orientation.lock('landscape');
        setOrientationMessage('Экран переведён в альбомный режим.');
      } else {
        setOrientationMessage('Автоповорот недоступен. Поверните устройство вручную — игра продолжит работу.');
      }
    } catch {
      setOrientationMessage('Автоповорот недоступен. Поверните устройство вручную — игра продолжит работу.');
    }
  };

  const snap = initial.current;
  const progress = `${hud.progress.toString().padStart(2, '0')}%`;
  const energyPercent = hud.maxDashEnergy > 0 ? Math.max(0, Math.min(100, (hud.dashEnergy / hud.maxDashEnergy) * 100)) : 0;
  const healthPercent = hud.maxHealth > 0 ? Math.max(0, Math.min(100, (hud.health / hud.maxHealth) * 100)) : 0;
  const saveUiSetting = (key: string, value: string) => { try { localStorage.setItem(key, value); } catch { /* storage is optional */ } };
  const audioSettings: Array<{ label: string; value: number; onChange: (value: number) => void; storageKey: string }> = [
    { label: 'Общая громкость', value: masterVolume, onChange: setMasterVolume, storageKey: 'sr-master-volume' },
    { label: 'Музыка', value: musicVolume, onChange: setMusicVolume, storageKey: 'sr-music-volume' },
    { label: 'Звуковые эффекты', value: effectsVolume, onChange: setEffectsVolume, storageKey: 'sr-effects-volume' },
  ];
  const startLevel = (level: LevelData, mode: PlayMode) => {
    currentLevelRef.current = level;
    playModeRef.current = mode;
    setCurrentLevel(level);
    setPlayMode(mode);
    setResult(null);
    engineRef.current?.loadLevel(level);
    restart();
    initial.current = engineRef.current ? (engineRef.current.getSnapshot() as Snapshot) : initial.current;
    setPage('game');
  };
  const beginGame = () => {
    const sequence = storySequence();
    startLevel(sequence[0] ?? LEVEL_1, { kind: 'story', index: 0 });
  };
  const nextStoryLevel = () => {
    if (playMode.kind !== 'story') return;
    const next = storySequence()[playMode.index + 1];
    if (next) startLevel(next, { kind: 'story', index: playMode.index + 1 });
  };
  const hasNextStory = playMode.kind === 'story' && !!storySequence()[playMode.index + 1];
  const editorUnlocked = level1Done;
  const tapVersion = () => {
    const now = Date.now();
    const t = versionTaps.current;
    t.count = now - t.last < 1200 ? t.count + 1 : 1;
    t.last = now;
    setTapCount(t.count < 5 ? t.count : 0);
    if (t.count < 5) return;
    t.count = 0;
    setDevInput('');
    setDevError(false);
    setDevDialog(devMode ? 'leave' : 'enter');
  };
  const submitDevCode = () => {
    if (devInput.trim() === DEV_CODE) { setDevMode(true); setDevModeState(true); setDevDialog('closed'); }
    else setDevError(true);
  };
  useEffect(() => {
    if (hud.complete && currentLevel.id === LEVEL_1.id && !level1Done) { markLevel1Done(); setLevel1Done(true); }
  }, [hud.complete, currentLevel.id, level1Done]);

  // When a run ends: store the time / style records, or remember that a test run was cleared (needed to share online).
  useEffect(() => {
    if (!hud.complete) return;
    const snap = engineRef.current?.getSnapshot() as Snapshot | undefined;
    if (!snap) return;
    const lvl = currentLevelRef.current;
    if (playModeRef.current.kind === 'test') {
      markTestCleared(lvl);
      setResult({ time: snap.time, style: 0, styleActive: false, testOnly: true, newPB: false, pb: snap.time, firstClear: false, newBestStyle: false, bestStyle: undefined });
      return;
    }
    const r = recordRun(lvl.id, snap.time, snap.style, snap.styleActive);
    setResult({ ...r, time: snap.time, style: snap.style, styleActive: snap.styleActive, testOnly: false });
  }, [hud.complete]);

  const loadOnline = async (sort = onlineSort) => {
    setOnlineBusy(true);
    setOnlineError('');
    try { setOnlineList(await online.listLevels(sort)); }
    catch (e) { setOnlineError(e instanceof Error ? e.message : 'Не удалось загрузить список.'); }
    setOnlineBusy(false);
  };
  useEffect(() => {
    if (page === 'online' && online.onlineEnabled()) void loadOnline(onlineSort);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, onlineSort]);
  const playOnline = async (info: online.OnlineLevelInfo) => {
    setOnlineBusy(true);
    setOnlineError('');
    try { startLevel(await online.fetchLevel(info), { kind: 'online' }); }
    catch (e) { setOnlineError(e instanceof Error ? e.message : 'Не удалось открыть уровень.'); }
    setOnlineBusy(false);
  };
  const likeOnline = async (info: online.OnlineLevelInfo) => {
    if (hasLiked(info.id)) return;
    try {
      await online.likeLevel(info.id);
      markLiked(info.id);
      setOnlineList((list) => list.map((l) => (l.id === info.id ? { ...l, likes: l.likes + 1 } : l)));
    } catch (e) { setOnlineError(e instanceof Error ? e.message : 'Не удалось поставить лайк.'); }
  };
  const uploadToOnline = async (level: LevelData): Promise<string> => {
    if (!online.onlineEnabled()) return 'Онлайн-сервер ещё не настроен (см. ONLINE_SETUP_RU.md).';
    let name = getPlayerName();
    if (!name) {
      const typed = await askText('Ваше имя для подписи уровней:', '');
      if (!typed || !typed.trim()) return 'Загрузка отменена.';
      name = typed.trim().slice(0, 24);
      setPlayerName(name);
    }
    if (!(await askConfirm(`Выложить «${level.name}» в сеть от имени ${name}? Его увидят все игроки.`))) return 'Загрузка отменена.';
    try { await online.uploadLevel(level, name); return 'Уровень выложен! Он появится в разделе «ОНЛАЙН».'; }
    catch (e) { return e instanceof Error ? e.message : 'Не удалось выложить уровень.'; }
  };
  const goToTitle = () => { setSettingsOpen(false); setPage(playMode.kind === 'test' && page === 'game' ? 'editor' : 'title'); keyboardRef.current.clear(); };
  const openSettings = () => { setSettingsReturnPage(page === 'game' ? 'game' : 'title'); setSettingsTab('controls'); setPage('settings'); };
  const closeSettingsPage = () => { setPage(settingsReturnPage); keyboardRef.current.clear(); };

  if (page === 'title') return (
    <main className={`sr-title-screen ${showEffects ? '' : 'no-neon'}`}>
      <div className="sr-title-city" />
      <div className="sr-title-scanlines" />
      <div className="sr-title-brand" onClick={tapVersion}><span>SECURITY</span><span>RUNNER</span><i /></div>
      <nav className="sr-title-nav" aria-label="Главное меню">
        <button className="sr-menu-button is-primary" onClick={beginGame}><span>▶</span> НАЧАТЬ</button>
        <button className="sr-menu-button" onClick={() => setPage('levels')}>УРОВНИ</button>
        <button className="sr-menu-button" onClick={() => setPage('online')}>ОНЛАЙН</button>
        {editorUnlocked && <button className="sr-menu-button" onClick={() => setPage('editor')}>РЕДАКТОР</button>}
        <button className="sr-menu-button" onClick={openSettings}>НАСТРОЙКИ</button>
        <button className="sr-menu-button" onClick={() => { const d = (window as unknown as { srDesktop?: { quit: () => void } }).srDesktop; if (d) d.quit(); else window.alert('Чтобы выйти из игры, закройте вкладку браузера.'); }}>ВЫХОД</button>
      </nav>
      <div className="sr-rooftop"><div className="sr-robot"><i /><b /><span /></div></div>
      <div className="sr-version" onClick={tapVersion}>v1.5.0{devMode ? ' · DEV' : ''}{tapCount > 0 ? ` · ${tapCount}/5` : ''}</div>
      {devDialog !== 'closed' && (
        <div className="sr-dev-dialog" role="dialog" aria-modal="true">
          <div className="sr-dev-card">
            {devDialog === 'enter' ? (
              <>
                <strong>КОД РАЗРАБОТЧИКА</strong>
                <input value={devInput} autoFocus onChange={(e) => { setDevInput(e.target.value); setDevError(false); }} onKeyDown={(e) => { if (e.key === 'Enter') submitDevCode(); }} />
                {devError && <small>Неверный код</small>}
                <div><button className="settings-trigger" onClick={submitDevCode}>OK</button><button className="settings-trigger" onClick={() => setDevDialog('closed')}>Отмена</button></div>
              </>
            ) : (
              <>
                <strong>Выключить режим разработчика?</strong>
                <div><button className="settings-trigger" onClick={() => { setDevMode(false); setDevModeState(false); setDevDialog('closed'); }}>Выключить</button><button className="settings-trigger" onClick={() => setDevDialog('closed')}>Отмена</button></div>
              </>
            )}
          </div>
        </div>
      )}
      <div className="sr-title-status"><span className="live-dot" /> SYSTEM ONLINE / BUILD 01</div>
    </main>
  );

  if (page === 'editor' && editorUnlocked) return (
    <>
      <Editor
        level={editing}
        onChange={setEditing}
        onTest={(lvl) => startLevel(lvl, { kind: 'test' })}
        onExit={() => setPage('title')}
        ask={askConfirm}
        show={showText}
        input={askText}
        isDev={devMode}
        onUpload={uploadToOnline}
      />
      {dialogNode}
    </>
  );

  if (page === 'online') {
    const enabled = online.onlineEnabled();
    return (
      <main className="sr-levels-screen">
        {dialogNode}
        <div className="sr-levels-inner">
          <button className="settings-trigger" onClick={() => setPage('title')}>← В меню</button>
          <h2>ОНЛАЙН-УРОВНИ</h2>
          {!enabled && <p className="ed-empty">Онлайн-раздел ещё не настроен: разработчику нужно подключить сервер (инструкция в файле ONLINE_SETUP_RU.md).</p>}
          {enabled && (
            <>
              <div className="ed-field">
                <button className={`ed-tool ${onlineSort === 'new' ? 'is-on' : ''}`} onClick={() => setOnlineSort('new')}>Новые</button>
                <button className={`ed-tool ${onlineSort === 'top' ? 'is-on' : ''}`} onClick={() => setOnlineSort('top')}>Лучшие</button>
                <button className="ed-tool" onClick={() => void loadOnline()}>⟳ Обновить</button>
              </div>
              {onlineBusy && <p className="ed-empty">Загрузка…</p>}
              {onlineError && <p className="ed-empty" style={{ color: '#ff8a70' }}>{onlineError}</p>}
              {!onlineBusy && !onlineError && onlineList.length === 0 && <p className="ed-empty">Пока никто не выложил уровни. Будь первым: пройди свой уровень в редакторе и нажми «Выложить в сеть».</p>}
              {onlineList.map((l) => (
                <div className="ed-row" key={l.id}>
                  <span>{l.name}<br /><small style={{ opacity: .6 }}>автор: {l.author}</small></span>
                  <button className="settings-trigger" disabled={hasLiked(l.id)} onClick={() => void likeOnline(l)}>👍 {l.likes}</button>
                  <button className="settings-trigger" disabled={onlineBusy} onClick={() => void playOnline(l)}>Играть</button>
                </div>
              ))}
            </>
          )}
        </div>
      </main>
    );
  }

  if (page === 'levels') {
    void levelsTick;
    const published = loadPublished();
    const order = getStoryOrder();
    const sequence = storySequence();
    const move = (id: string, delta: number) => {
      const i = order.indexOf(id);
      const j = i + delta;
      if (i < 0 || j < 0 || j >= order.length) return;
      const next = [...order];
      [next[i], next[j]] = [next[j], next[i]];
      setStoryOrder(next);
      setLevelsTick((n) => n + 1);
    };
    const addToStory = (id: string) => { setStoryOrder([...order.filter((x) => x !== id), id]); setLevelsTick((n) => n + 1); };
    const removeFromStory = (id: string) => { setStoryOrder(order.filter((x) => x !== id)); setLevelsTick((n) => n + 1); };
    return (
      <main className="sr-levels-screen">
        {dialogNode}
        <div className="sr-levels-inner">
          <button className="settings-trigger" onClick={() => setPage('title')}>← В меню</button>
          {editorUnlocked && (
            <>
              <h2>МОИ УРОВНИ</h2>
              {loadDrafts().length === 0 && <p className="ed-empty">Здесь появятся уровни, сохранённые в редакторе.</p>}
              {loadDrafts().map((l) => (
                <div className="ed-row" key={l.id}>
                  <span>{l.name}</span>
                  <button className="settings-trigger" onClick={() => startLevel(l, { kind: 'single' })}>Играть</button>
                </div>
              ))}
            </>
          )}
          <h2>ОПУБЛИКОВАННЫЕ УРОВНИ</h2>
          {published.length === 0 && <p className="ed-empty">Опубликованных уровней пока нет.</p>}
          {published.map((l) => (
            <div className="ed-row" key={l.id}>
              <span>{l.name}{order.includes(l.id) ? ' · в сюжете' : ''}</span>
              <button className="settings-trigger" onClick={() => startLevel(l, { kind: 'single' })}>Играть</button>
              {devMode && (order.includes(l.id)
                ? <button className="settings-trigger" onClick={() => removeFromStory(l.id)}>Из сюжета</button>
                : <button className="settings-trigger" onClick={() => addToStory(l.id)}>В сюжет</button>)}
              {devMode && <button className="settings-trigger" onClick={async () => { if (await askConfirm('Снять с публикации?')) { unpublishLevel(l.id); setLevelsTick((n) => n + 1); } }}>Снять</button>}
            </div>
          ))}
          {devMode && (
            <>
              <h2>ПОРЯДОК СЮЖЕТА</h2>
              <button className="settings-trigger" onClick={async () => {
                const text = exportStoryFile();
                const android = (window as unknown as { srAndroid?: { saveTextFile: (n: string, c: string) => string } }).srAndroid;
                const info = `Размер: ${text.length} символов. Положите файл в папку game репозитория вместо старого bundledStory.json.`;
                if (android && android.saveTextFile('bundledStory.json', text)) {
                  await showText('Файл bundledStory.json сохранён в папку «Загрузки».', info);
                  return;
                }
                try {
                  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
                  const link = document.createElement('a');
                  link.href = url; link.download = 'bundledStory.json';
                  document.body.appendChild(link); link.click(); link.remove();
                  window.setTimeout(() => URL.revokeObjectURL(url), 5000);
                  await showText('Файл bundledStory.json скачивается.', info);
                } catch {
                  await showText('Скопируйте весь текст и вставьте в bundledStory.json:', text);
                }
              }}>📋 Экспорт сюжета</button>
              {sequence.map((l, i) => (
                <div className="ed-row" key={l.id}>
                  <span>{i + 1}. {l.name}{STORY_LEVELS.some((x) => x.id === l.id) ? ' (сюжетный)' : ''}</span>
                  <button className="settings-trigger" onClick={() => move(l.id, -1)} aria-label="Выше">▲</button>
                  <button className="settings-trigger" onClick={() => move(l.id, 1)} aria-label="Ниже">▼</button>
                </div>
              ))}
            </>
          )}
        </div>
      </main>
    );
  }

  if (page === 'settings') return (
    <main className={`sr-settings-screen ${showEffects ? '' : 'no-neon'}`}>
      <div className="sr-settings-city" />
      <div className="sr-settings-wrap">
        <header className="sr-settings-title"><span />НАСТРОЙКИ<span /></header>
        <div className="sr-settings-layout">
          <nav className="sr-settings-tabs" aria-label="Разделы настроек">
            <button className={settingsTab === 'controls' ? 'active' : ''} onClick={() => setSettingsTab('controls')}>Управление <b>›</b></button>
            <button className={settingsTab === 'audio' ? 'active' : ''} onClick={() => setSettingsTab('audio')}>Аудио <b>›</b></button>
            <button className={settingsTab === 'video' ? 'active' : ''} onClick={() => setSettingsTab('video')}>Видео <b>›</b></button>
            <button className="sr-back-tab" onClick={closeSettingsPage}>Назад</button>
          </nav>
          <section className="sr-settings-panel">
            {settingsTab === 'controls' && <>
              <p className="sr-panel-kicker">СИСТЕМА ВВОДА / 01</p>
              <h2>УПРАВЛЕНИЕ</h2>
              <div className="sr-binding-grid">{BINDING_ORDER.map((name) => <div className="sr-binding-row" key={name}><span>{BINDING_LABELS[name]}</span><button className={capturing === name ? 'capturing' : ''} onClick={() => assignBinding(name)}>{capturing === name ? 'НАЖМИТЕ КЛАВИШУ' : codeLabel(bindings[name])}</button></div>)}</div>
              <div className="sr-range-row"><label htmlFor="sr-sensitivity">Чувствительность джойстика</label><output>{Math.round(sensitivity * 100)}%</output></div>
              <input id="sr-sensitivity" className="sr-range" type="range" min="0.5" max="1.5" step="0.05" value={sensitivity} onChange={e => changeSensitivity(Number(e.target.value))} />
              <p className="sr-hint">Сенсорную раскладку и размер кнопок можно настроить во время игры.</p>
              <button className="sr-reset" onClick={resetSettings}>СБРОСИТЬ УПРАВЛЕНИЕ</button>
            </>}
            {settingsTab === 'audio' && <>
              <p className="sr-panel-kicker">СИСТЕМА ЗВУКА / 02</p><h2>АУДИО</h2>
              <div className="sr-audio-note">УРОВНИ ГРОМКОСТИ</div>
              {audioSettings.map(({ label, value, onChange, storageKey }) => <div className="sr-audio-row" key={storageKey}><div className="sr-range-row"><label>{label}</label><output>{value}%</output></div><input className="sr-range" type="range" min="0" max="100" value={value} onChange={e => { const v=Number(e.target.value); onChange(v); saveUiSetting(storageKey,String(v)); }} /></div>)}
              <p className="sr-hint">Уровни сохраняются на этом устройстве. В текущей сборке игровые аудиодорожки ещё не подключены.</p>
            </>}
            {settingsTab === 'video' && <>
              <p className="sr-panel-kicker">СИСТЕМА ИЗОБРАЖЕНИЯ / 03</p><h2>ВИДЕО</h2>
              <div className="sr-video-row"><div><strong>Неоновые эффекты</strong><small>Свечение и декоративные эффекты интерфейса</small></div><button className={`sr-toggle ${showEffects ? 'on' : ''}`} onClick={() => { const v=!showEffects; setShowEffects(v); saveUiSetting('sr-effects',v?'on':'off'); }} aria-pressed={showEffects}>{showEffects?'ВКЛ':'ВЫКЛ'}</button></div>
              <div className="sr-video-row"><div><strong>Полноэкранный режим</strong><small>Развернуть игру на весь экран</small></div><button className="sr-action" onClick={() => { if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(()=>{}); else document.exitFullscreen?.(); }}>ПЕРЕКЛЮЧИТЬ</button></div>
              <div className="sr-video-row"><div><strong>Ориентация</strong><small>Рекомендуется альбомный режим на телефоне</small></div><span className="sr-video-value">16:9 / LANDSCAPE</span></div>
            </>}
          </section>
        </div>
        <footer className="sr-settings-foot"><span>SECURITY RUNNER / CONFIGURATION</span><button onClick={closeSettingsPage}>ESC&nbsp; НАЗАД</button></footer>
      </div>
    </main>
  );

  return (
    <main className="game-page">
      <div className="game-shell">
        <header className="topbar">
          <div className="brand-lockup">
            <div className="brand-mark"><span>V</span></div>
            <div>
              <div className="brand-name">Security Runner</div>
              <div className="brand-sub">NEON CITY / IMPACT PROTOCOL</div>
            </div>
          </div>
          <div className="topbar-tools">
            <div className="protocol-tag"><span className="live-dot" /> Забег 01 <span style={{ color: '#566260' }}>/</span> В процессе</div>
            <button className="settings-trigger" onClick={goToTitle}>В меню</button><button className="settings-trigger" onClick={openSettings}>Настройки</button><button className="settings-trigger" onClick={() => setSettingsOpen(true)} aria-haspopup="dialog">Раскладка</button>
          </div>
        </header>

        <section className="arena-frame" aria-label="Игровая арена-платформер">
          <canvas ref={canvasRef} className="game-canvas" aria-label="Игровой мир. Управляйте клавиатурой или сенсорными кнопками." />
          <div className="arena-top-overlay">
            <div>
              <div className="stage-label">Сектор 01 / Линия сдерживания</div>
              <div className="stage-title">{currentLevel.id === LEVEL_1.id ? <>ПРОРЫВ <em>ВПЕРЁД.</em></> : currentLevel.name}</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
              <div className="mission-tag">Достигни выхода</div>
              <button className="restart-button" onClick={restart} aria-label="Начать заново">Сначала</button>
            </div>
          </div>
          <div className="hud" aria-live="polite">
            <div className="hud-cell score-cell"><div className="hud-label">Осколки</div><div className="hud-value">{hud.score.toString().padStart(4, '0')}</div></div>
            <div className="hud-cell"><div className="hud-label">Прорыв</div><div className="hud-value">{progress}</div></div>
            <div className="hud-cell"><div className="hud-label">Падения</div><div className="hud-value">{hud.deaths.toString().padStart(2, '0')}</div></div>
            <div className="hud-cell"><div className="hud-label">Время</div><div className="hud-value" ref={timerElRef}>0:00.00</div></div>
            {hud.styleActive && <div className="hud-cell"><div className="hud-label">Стиль</div><div className="hud-value" style={{ color: hud.style < 0 ? '#ff6a5a' : '#7dff9b' }}>{hud.style}</div></div>}
          </div>
          <div className="vitals" aria-label="Состояние игрока">
            <div className="vital-block health-block">
              <div className="meter-heading"><span>ЗДОРОВЬЕ</span><b>{hud.health}/{hud.maxHealth}</b></div>
              <div className="health-track" role="meter" aria-label="Здоровье" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(healthPercent)}>
                <span style={{ transform: `scaleX(${healthPercent / 100})` }} />
              </div>
            </div>
            <div className="vital-block dash-block">
              <div className="meter-heading"><span>ЭНЕРГИЯ РЫВКА</span><b>{Math.round(energyPercent)}%</b></div>
              <div className="energy-track" role="meter" aria-label="Энергия рывка" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(energyPercent)}>
                <span style={{ transform: `scaleX(${energyPercent / 100})` }} />
              </div>
            </div>
          </div>
          {hud.controlsLocked && (
            <div className="lock-warning" role="status">
              <span className="lock-mark" aria-hidden="true">!</span>
              <span><strong>БЛОКИРОВКА НА ВРЕМЯ ПАДЕНИЯ</strong><small>Приземление вернёт управление; рывок — раньше</small></span>
            </div>
          )}
          <div className="checkpoint"><strong>Точка сохранения</strong> &nbsp; {snap ? Math.round((snap.checkpointX / Math.max(snap.worldWidth, 1)) * 100) : 0}% пройдено</div>

          <div
            className="mobile-controls"
            aria-label="Сенсорное управление"
            style={{
              '--joystick-x': `${controlLayout.joystick.x}%`,
              '--joystick-y': `${controlLayout.joystick.y}%`,
              '--joystick-scale': controlLayout.joystick.scale,
            } as CSSProperties}
          >
            <div
              className="joystick"
              data-testid="touch-joystick"
              role="slider"
              aria-label="Джойстик движения"
              aria-valuemin={-1}
              aria-valuemax={1}
              aria-valuenow={Math.max(-1, Math.min(1, joystickRef.current.x * sensitivity))}
              onPointerDown={startJoystick}
              onPointerMove={(event) => { if (joystickRef.current.pointerId === event.pointerId) updateJoystick(event); }}
              onPointerUp={endJoystick}
              onPointerCancel={endJoystick}
            >
              <span className="stick-knob" />
            </div>
            {TOUCH_BUTTONS.map(({ name, abbreviation, label }) => (
              <button
                key={name}
                data-testid={`touch-${name}`}
                className={`touch-action ${activeTouches.has(name) ? 'is-active' : ''}`}
                style={{
                  '--button-x': `${controlLayout[name].x}%`,
                  '--button-y': `${controlLayout[name].y}%`,
                  '--button-scale': controlLayout[name].scale,
                } as CSSProperties}
                onPointerDown={(event) => startAction(event, name)}
                onPointerUp={(event) => endAction(event, name)}
                onPointerCancel={(event) => endAction(event, name)}
              >
                <span>{abbreviation}</span><small>{label}</small>
              </button>
            ))}
          </div>

          {hud.complete && (
            <div className="finish-screen" role="dialog" aria-modal="true" aria-label="Забег завершён">
              <div className="finish-card">
                <div className="finish-kicker">Линия прорвана / Выход достигнут</div>
                <h1 className="finish-title">ЗАБЕГ<br />ЗАВЕРШЁН.</h1>
                <div className="finish-copy">Осколков собрано: {hud.score.toString().padStart(4, '0')} &nbsp;·&nbsp; Падений: {hud.deaths}</div>
                {result && (
                  <div className="finish-copy" style={{ marginTop: 6 }}>
                    <b>Время: {formatTime(result.time)}</b>
                    {!result.testOnly && (result.newPB ? <span style={{ color: '#7dff9b' }}> · НОВЫЙ РЕКОРД!</span> : <span> · рекорд {formatTime(result.pb)}</span>)}
                    {result.styleActive && <div>Стиль: <b style={{ color: result.style < 0 ? '#ff6a5a' : '#7dff9b' }}>{result.style}</b>{result.newBestStyle && <span style={{ color: '#7dff9b' }}> · лучший!</span>}</div>}
                    {!result.testOnly && result.firstClear && <div style={{ opacity: .75 }}>Очки стиля начнут считаться со следующего прохождения.</div>}
                    {result.testOnly && <div style={{ opacity: .75 }}>Уровень пройден: теперь его можно выложить в сеть.</div>}
                  </div>
                )}
                <div className="finish-actions">
                  <button className="restart-button" onClick={restart}>Ещё раз</button>
                  {hasNextStory && <button className="restart-button" onClick={nextStoryLevel}>Следующий уровень</button>}
                  {playMode.kind === 'test' && <button className="restart-button" onClick={() => setPage('editor')}>В редактор</button>}
                  {playMode.kind === 'single' && <button className="restart-button" onClick={() => setPage('levels')}>К уровням</button>}
                  {playMode.kind === 'online' && <button className="restart-button" onClick={() => setPage('online')}>К онлайн-уровням</button>}
                </div>
              </div>
            </div>
          )}
          <div className="portrait-rotate" role="region" aria-label="Поверните устройство для игры">
            <div className="rotate-glyph" aria-hidden="true"><span /></div>
            <p className="rotate-kicker">Режим оператора / сенсорный экран</p>
            <h2>ПОВЕРНИТЕ<br />УСТРОЙСТВО</h2>
            <p className="rotate-copy">Арена рассчитана на альбомный формат. Поверните телефон, чтобы видеть путь и все органы управления.</p>
            <button className="rotate-button" onClick={requestLandscape}>Включить альбомный режим</button>
            <p className="rotate-note">{orientationMessage || 'Если поворот не включился, поверните устройство вручную. Игра останется доступна.'}</p>
          </div>
        </section>

        <footer className="control-deck">
          <div className="keyboard-guide">
            <span className="guide-title">Управление</span>
            <span className="move-guide"><span className="keycap">{codeLabel(bindings.left)}</span><span className="keycap">{codeLabel(bindings.right)}</span><span>движение</span></span>
            <span className="move-guide"><span className="keycap wide">{codeLabel(bindings.jump)}</span><span>прыжок</span></span>
            <span className="move-guide"><span className="keycap">{codeLabel(bindings.dash)}</span><span>рывок</span></span>
            <span className="move-guide"><span className="keycap">{codeLabel(bindings.slide)}</span><span>слайд · 5 сек</span></span>
            <span className="move-guide"><span className="keycap">{codeLabel(bindings.slam)}</span><span>удар вниз</span></span>
          </div>
          <div className="actions-legend">
            <span className="legend-item"><i className="legend-line" /> Скорость — твоё оружие</span>
            <span className="legend-item"><i className="legend-line cyan" /> Собирай осколки на пути</span>
          </div>
        </footer>
      </div>
      {settingsOpen && (
        <div className="settings-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setSettingsOpen(false); }}>
          <section className="settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title" aria-describedby="settings-description">
            <header className="settings-head">
              <div><p className="settings-kicker">Панель конфигурации / 01</p><h2 id="settings-title">УПРАВЛЕНИЕ</h2></div>
              <button className="dialog-close" onClick={() => { setSettingsOpen(false); captureRef.current = null; setCapturing(null); }} aria-label="Закрыть настройки">×</button>
            </header>
            <p id="settings-description" className="settings-intro">Назначьте клавиши под свой хват. Каждая команда использует отдельную клавишу.</p>
            <div className="binding-list">
              {BINDING_ORDER.map((name, index) => (
                <div className="binding-row" key={name}>
                  <span className="binding-index">0{index + 1}</span>
                  <span className="binding-name">{BINDING_LABELS[name]}</span>
                  <button className={`binding-key ${capturing === name ? 'is-capturing' : ''}`} onClick={() => assignBinding(name)} aria-label={`Назначить клавишу для: ${BINDING_LABELS[name]}`}>
                    {capturing === name ? 'НАЖМИТЕ КЛАВИШУ' : codeLabel(bindings[name])}
                  </button>
                </div>
              ))}
            </div>
            <div className="sensitivity-setting">
              <div className="sensitivity-top"><label htmlFor="joystick-sensitivity">Чувствительность джойстика</label><output htmlFor="joystick-sensitivity">{Math.round(sensitivity * 100)}%</output></div>
              <input id="joystick-sensitivity" type="range" min="0.5" max="1.5" step="0.05" value={sensitivity} onChange={(event) => changeSensitivity(Number(event.target.value))} />
              <div className="range-labels"><span>МЕДЛЕННО</span><span>БЫСТРО</span></div>
            </div>
            <div className="control-layout-setting">
              <div className="sensitivity-top"><span>РАСКЛАДКА СЕНСОРНОГО УПРАВЛЕНИЯ</span><span className="layout-drag-hint">ПЕРЕТАЩИТЕ ЭЛЕМЕНТЫ</span></div>
              <p className="layout-intro">Перетаскивайте джойстик и каждую кнопку отдельно.</p>
              <div className="control-scale-settings">
                <div className="control-scale-setting">
                  <div className="sensitivity-top">
                    <label htmlFor="joystick-size">Размер джойстика</label>
                    <output htmlFor="joystick-size">{Math.round(controlLayout.joystick.scale * 100)}%</output>
                  </div>
                  <input id="joystick-size" data-testid="joystick-size" type="range" min="0.7" max="1.5" step="0.05" value={controlLayout.joystick.scale} onChange={(event) => changeControlScale('joystick', Number(event.target.value))} />
                </div>
                <div className="control-scale-setting">
                  <div className="sensitivity-top">
                  <label htmlFor="actions-size">Размер кнопок действий</label>
                  <output htmlFor="actions-size">{Math.round(controlLayout.jump.scale * 100)}%</output>
                  </div>
                <input id="actions-size" data-testid="actions-size" type="range" min="0.7" max="1.5" step="0.05" value={controlLayout.jump.scale} onChange={(event) => changeActionScale(Number(event.target.value))} />
                </div>
              </div>
              <div className="control-layout-preview" ref={layoutPreviewRef} aria-label="Предпросмотр сенсорного управления">
                <div className="layout-preview-label">ПОЛЕ ИГРЫ</div>
                <div
                  className={`layout-control layout-joystick ${draggingControl === 'joystick' ? 'is-dragging' : ''}`}
                  data-testid="layout-joystick"
                  style={{
                    '--control-x': `${controlLayout.joystick.x}%`,
                    '--control-y': `${controlLayout.joystick.y}%`,
                    '--control-scale': controlLayout.joystick.scale,
                  } as CSSProperties}
                  role="button"
                  tabIndex={0}
                  aria-label="Переместить джойстик. Используйте стрелки для точной настройки."
                  aria-roledescription="перетаскиваемый элемент"
                  onPointerDown={(event) => startControlDrag(event, 'joystick')}
                  onPointerMove={moveControlDrag}
                  onPointerUp={endControlDrag}
                  onPointerCancel={endControlDrag}
                  onLostPointerCapture={endControlDrag}
                  onKeyDown={(event) => nudgeControl(event, 'joystick')}
                >
                  <div className="joystick" aria-hidden="true"><span className="stick-knob" /></div>
                </div>
                {TOUCH_BUTTONS.map(({ name, abbreviation, label }) => (
                  <div
                    key={name}
                    className={`layout-control layout-action ${draggingControl === name ? 'is-dragging' : ''}`}
                    data-testid={`layout-${name}`}
                    style={{
                      '--control-x': `${controlLayout[name].x}%`,
                      '--control-y': `${controlLayout[name].y}%`,
                      '--control-scale': controlLayout[name].scale,
                    } as CSSProperties}
                    role="button"
                    tabIndex={0}
                    aria-label={`Переместить кнопку «${label}». Используйте стрелки для точной настройки.`}
                    aria-roledescription="перетаскиваемый элемент"
                    onPointerDown={(event) => startControlDrag(event, name)}
                    onPointerMove={moveControlDrag}
                    onPointerUp={endControlDrag}
                    onPointerCancel={endControlDrag}
                    onLostPointerCapture={endControlDrag}
                    onKeyDown={(event) => nudgeControl(event, name)}
                  >
                    <div className="touch-action" aria-hidden="true">
                      <span>{abbreviation}</span><small>{label}</small>
                    </div>
                  </div>
                ))}
              </div>
              <div className="layout-footer">
                <span>Точное перемещение: стрелки · Shift + стрелка — быстрее</span>
                <button data-testid="reset-control-layout" className="reset-settings" onClick={resetControlLayout}>Сбросить раскладку</button>
              </div>
            </div>
            <div className="settings-footer">
              <button className="reset-settings" onClick={resetSettings}>Сбросить назначения</button>
              <button className="settings-done" onClick={() => { setSettingsOpen(false); captureRef.current = null; setCapturing(null); }}>Сохранено / Готово</button>
            </div>
            <p className="settings-storage">Настройки сохраняются только на этом устройстве.</p>
          </section>
        </div>
      )}
    </main>
  );
}

export default App;
