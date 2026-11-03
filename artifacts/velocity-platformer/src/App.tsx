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

type InputState = {
  move: number;
  jump: boolean;
  slide: boolean;
  dash: boolean;
  groundSlam: boolean;
};

type Rect = { id: string | number; x: number; y: number; width: number; height: number; kind?: string };
type Snapshot = {
  player: {
    x: number; y: number; vx: number; vy: number; width: number; height: number;
    grounded: boolean; facing: number; sliding: boolean; dashing: boolean; slamming: boolean;
  };
  cameraX: number; viewportWidth: number; viewportHeight: number;
  worldWidth: number; worldHeight: number;
  platforms: Rect[];
  spikes: Rect[];
  pickups: { id: string | number; x: number; y: number; size: number; collected: boolean }[];
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

  // Platforms: top edges catch the light so every landing reads at speed.
  for (const platform of snap.platforms) {
    const x = worldX(platform.x);
    if (x + platform.width < -100 || x > vw + 100) continue;
    const isMetal = platform.kind?.toLowerCase().includes('metal') || platform.kind?.toLowerCase().includes('steel');
    ctx.fillStyle = isMetal ? '#394649' : '#2b3537';
    ctx.fillRect(x, platform.y, platform.width, platform.height);
    ctx.fillStyle = '#85958e';
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

  // Hazard teeth are high-contrast silhouettes with a hot warning edge.
  for (const spike of snap.spikes) {
    const x = worldX(spike.x);
    if (x + spike.width < -60 || x > vw + 60) continue;
    const count = Math.max(1, Math.floor(spike.width / 17));
    const each = spike.width / count;
    for (let i = 0; i < count; i++) {
      const left = x + i * each;
      ctx.beginPath();
      ctx.moveTo(left, spike.y + spike.height);
      ctx.lineTo(left + each * .5, spike.y);
      ctx.lineTo(left + each, spike.y + spike.height);
      ctx.closePath();
      ctx.fillStyle = '#c3c5b7';
      ctx.fill();
      ctx.strokeStyle = '#f2744f'; ctx.lineWidth = 1.4; ctx.stroke();
    }
    ctx.fillStyle = 'rgba(242,116,79,.13)';
    ctx.fillRect(x, spike.y + spike.height - 2, spike.width, 6);
  }

  // Uncollected score shards pulse between cyan and pale metal.
  for (const pickup of snap.pickups) {
    if (pickup.collected) continue;
    const x = worldX(pickup.x);
    const pulse = 1 + Math.sin(clock * 5 + Number(pickup.id) * .7) * .12;
    const size = pickup.size * pulse;
    ctx.save();
    ctx.translate(x, pickup.y);
    ctx.rotate(clock * .55);
    ctx.shadowColor = '#65e4df'; ctx.shadowBlur = 17;
    ctx.fillStyle = '#65e4df';
    ctx.fillRect(-size * .47, -size * .47, size * .94, size * .94);
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#eff3dd';
    ctx.fillRect(-size * .18, -size * .18, size * .36, size * .36);
    ctx.restore();
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
    if (effect.kind.toLowerCase().includes('dash')) {
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
  ctx.fillStyle = player.slamming ? '#f2744f' : '#d8ddd0';
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
    health: 100, maxHealth: 100, dashEnergy: 100, maxDashEnergy: 100, controlsLocked: false,
  });
  const [activeTouches, setActiveTouches] = useState<Set<string>>(new Set());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [page, setPage] = useState<'title' | 'settings' | 'game'>('title');
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
        maxDashEnergy: snap.maxDashEnergy, controlsLocked: snap.controlsLocked,
      });
    }
  }, []);

  useEffect(() => {
    const engine = new GameEngine();
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
      engine.step(input, dt);
      const snap = engine.getSnapshot() as Snapshot;
      if (canvas) drawArena(canvas, snap, now / 1000);
      if (now - lastHud > 110) {
        lastHud = now;
        setHud({
          score: snap.score, deaths: snap.deaths,
          progress: Math.max(0, Math.min(100, Math.round((snap.player.x / Math.max(snap.worldWidth, 1)) * 100))),
          complete: snap.complete,
          health: snap.health, maxHealth: snap.maxHealth, dashEnergy: snap.dashEnergy,
          maxDashEnergy: snap.maxDashEnergy, controlsLocked: snap.controlsLocked,
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
  const beginGame = () => { restart(); setPage('game'); };
  const goToTitle = () => { setSettingsOpen(false); setPage('title'); keyboardRef.current.clear(); };
  const openSettings = () => { setSettingsReturnPage(page === 'game' ? 'game' : 'title'); setSettingsTab('controls'); setPage('settings'); };
  const closeSettingsPage = () => { setPage(settingsReturnPage); keyboardRef.current.clear(); };

  if (page === 'title') return (
    <main className={`sr-title-screen ${showEffects ? '' : 'no-neon'}`}>
      <div className="sr-title-city" />
      <div className="sr-title-scanlines" />
      <div className="sr-title-brand"><span>SECURITY</span><span>RUNNER</span><i /></div>
      <nav className="sr-title-nav" aria-label="Главное меню">
        <button className="sr-menu-button is-primary" onClick={beginGame}><span>▶</span> НАЧАТЬ</button>
        <button className="sr-menu-button" onClick={openSettings}>НАСТРОЙКИ</button>
        <button className="sr-menu-button" onClick={() => window.alert('Чтобы выйти из игры, закройте вкладку браузера.')}>ВЫХОД</button>
      </nav>
      <div className="sr-rooftop"><div className="sr-robot"><i /><b /><span /></div></div>
      <div className="sr-version">v1.0.0</div>
      <div className="sr-title-status"><span className="live-dot" /> SYSTEM ONLINE / BUILD 01</div>
    </main>
  );

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
              <div className="stage-title">ПРОРЫВ <em>ВПЕРЁД.</em></div>
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
                <button className="restart-button" onClick={restart}>Ещё раз</button>
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
