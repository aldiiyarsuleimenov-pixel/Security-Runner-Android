import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import type { GamePlatform, GameRect } from './game/GameEngine';
import { EXIT_HEIGHT, EXIT_WIDTH, FLOOR_Y, GRID, blankLevel, type LevelData, type LevelPickup } from './game/levels';
import { deleteDraft, loadDrafts, publishLevel, saveDraft } from './game/levelStore';

type Tool = 'hand' | 'select' | 'block' | 'half' | 'platform' | 'ground' | 'spike' | 'pickup' | 'start' | 'checkpoint' | 'exit' | 'erase';
type Rot = 0 | 1 | 2 | 3;

const TOOLS: Array<{ id: Tool; label: string }> = [
  { id: 'hand', label: '✋ Рука' },
  { id: 'select', label: '⬚ Выбор' },
  { id: 'block', label: '■ Блок' },
  { id: 'half', label: '▬ Полублок' },
  { id: 'platform', label: '═ Платформа' },
  { id: 'ground', label: '▓ Земля' },
  { id: 'spike', label: '▲ Шип' },
  { id: 'pickup', label: '◆ Осколок' },
  { id: 'start', label: '⚑ Старт' },
  { id: 'checkpoint', label: '✚ Чекпоинт' },
  { id: 'exit', label: '⎆ Выход' },
  { id: 'erase', label: '✕ Ластик' },
];

const VIEW_H = 540;
const MIN_ZOOM = 0.4;
const MAX_ZOOM = 3;
const ARROWS = ['↑', '→', '↓', '←'];

const snapX = (v: number) => Math.round(v / GRID) * GRID;
const snapY = (v: number) => FLOOR_Y + Math.round((v - FLOOR_Y) / GRID) * GRID;
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const uid = (p: string) => `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
const clampZoom = (z: number) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z));

interface Item { id: string; type: 'plat' | 'spike' | 'pick'; x: number; y: number; w: number; h: number; ref: GamePlatform | GameRect | LevelPickup }

function itemsOf(l: LevelData): Item[] {
  const out: Item[] = [];
  for (const p of l.platforms) out.push({ id: p.id, type: 'plat', x: p.x, y: p.y, w: p.width, h: p.height, ref: p });
  for (const s of l.spikes) out.push({ id: s.id, type: 'spike', x: s.x, y: s.y, w: s.width, h: s.height, ref: s });
  for (const k of l.pickups) out.push({ id: k.id, type: 'pick', x: k.x - 10, y: k.y - 10, w: 20, h: 20, ref: k });
  return out;
}
const isGround = (i: Item) => i.type === 'plat' && (i.ref as GamePlatform).kind === 'ground';
const inside = (i: Item, x: number, y: number, pad = 0) => x >= i.x - pad && x <= i.x + i.w + pad && y >= i.y - pad && y <= i.y + i.h + pad;

function drawSpike(ctx: CanvasRenderingContext2D, sp: GameRect) {
  const dir = sp.dir ?? 0;
  const len = dir === 0 || dir === 2 ? sp.width : sp.height;
  const n = Math.max(1, Math.round(len / 24));
  const e = len / n;
  const { x, y, width: w, height: h } = sp;
  ctx.fillStyle = '#d6d8c9';
  for (let i = 0; i < n; i++) {
    const a = i * e, b = (i + 1) * e, m = (a + b) / 2;
    ctx.beginPath();
    if (dir === 0) { ctx.moveTo(x + a, y + h); ctx.lineTo(x + m, y); ctx.lineTo(x + b, y + h); }
    else if (dir === 2) { ctx.moveTo(x + a, y); ctx.lineTo(x + m, y + h); ctx.lineTo(x + b, y); }
    else if (dir === 1) { ctx.moveTo(x, y + a); ctx.lineTo(x + w, y + m); ctx.lineTo(x, y + b); }
    else { ctx.moveTo(x + w, y + a); ctx.lineTo(x, y + m); ctx.lineTo(x + w, y + b); }
    ctx.fill();
  }
}

type Gesture =
  | { type: 'paint'; changed: boolean }
  | { type: 'pan'; sx: number; sy: number; vx: number; vy: number }
  | { type: 'move'; sx: number; sy: number; refs: Array<{ o: { x: number; y: number }; ox: number; oy: number }>; changed: boolean }
  | { type: 'marquee'; ax: number; ay: number; bx: number; by: number }
  | { type: 'pinch'; d0: number; z0: number; wx: number; wy: number }
  | { type: 'idle' };

interface Props {
  level: LevelData | null;
  onChange: (level: LevelData | null) => void;
  onTest: (level: LevelData) => void;
  onExit: () => void;
  ask: (message: string) => Promise<boolean>;
  show: (message: string, text: string) => Promise<boolean>;
}

export default function Editor({ level, onChange, onTest, onExit, ask, show }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const levelRef = useRef<LevelData | null>(level);
  const synced = useRef<LevelData | null>(level);
  if (level !== synced.current) { synced.current = level; levelRef.current = level; }

  const [, setTick] = useState(0);
  const bump = () => setTick((n) => n + 1);
  const [tool, setTool] = useState<Tool>('block');
  const toolRef = useRef<Tool>('block');
  toolRef.current = tool;
  const [placeRot, setPlaceRot] = useState<Rot>(0);
  const placeRotRef = useRef<Rot>(0);
  placeRotRef.current = placeRot;
  const [selected, setSelected] = useState<string[]>([]);
  const selRef = useRef<Set<string>>(new Set());
  const [message, setMessage] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [drafts, setDrafts] = useState<LevelData[]>(() => loadDrafts());
  const viewRef = useRef({ x: 0, y: 0, zoom: 1 });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<Gesture | null>(null);
  const undoRef = useRef<LevelData[]>([]);
  const redoRef = useRef<LevelData[]>([]);
  const actions = useRef<Record<string, () => void>>({});

  const flash = (text: string) => { setMessage(text); window.setTimeout(() => setMessage(''), 2600); };
  const setSel = (ids: string[]) => { selRef.current = new Set(ids); setSelected(ids); };
  const emit = (next: LevelData) => { synced.current = next; levelRef.current = next; onChange(next); };

  // ---------- view helpers ----------
  const metrics = () => {
    const b = canvasRef.current?.getBoundingClientRect();
    const rect = b ?? ({ left: 0, top: 0, width: 960, height: VIEW_H } as DOMRect);
    const k = (rect.height / VIEW_H) * viewRef.current.zoom;
    return { b: rect, k, vw: rect.width / k, vh: rect.height / k };
  };
  const clampView = () => {
    const lvl = levelRef.current;
    if (!lvl) return;
    const { vw, vh } = metrics();
    const v = viewRef.current;
    v.x = vw >= lvl.worldWidth ? (lvl.worldWidth - vw) / 2 : Math.max(0, Math.min(lvl.worldWidth - vw, v.x));
    v.y = vh >= VIEW_H ? (VIEW_H - vh) / 2 : Math.max(0, Math.min(VIEW_H - vh, v.y));
  };
  const toWorld = (cx: number, cy: number) => {
    const { b, k } = metrics();
    return { x: viewRef.current.x + (cx - b.left) / k, y: viewRef.current.y + (cy - b.top) / k };
  };
  const zoomAt = (zoom: number, cx: number, cy: number) => {
    const before = toWorld(cx, cy);
    viewRef.current.zoom = clampZoom(zoom);
    const { b, k } = metrics();
    viewRef.current.x = before.x - (cx - b.left) / k;
    viewRef.current.y = before.y - (cy - b.top) / k;
    clampView();
    bump();
  };
  const zoomCenter = (factor: number) => {
    const { b } = metrics();
    zoomAt(viewRef.current.zoom * factor, b.left + b.width / 2, b.top + b.height / 2);
  };

  // ---------- history & mutation ----------
  const pushHistory = () => {
    if (!levelRef.current) return;
    undoRef.current.push(clone(levelRef.current));
    if (undoRef.current.length > 60) undoRef.current.shift();
    redoRef.current = [];
  };
  const mutate = (fn: (l: LevelData) => void) => {
    const cur = levelRef.current;
    if (!cur) return;
    pushHistory();
    fn(cur);
    emit({ ...cur });
  };
  const pruneSel = () => {
    if (!levelRef.current) return;
    const ids = new Set(itemsOf(levelRef.current).map((i) => i.id));
    setSel([...selRef.current].filter((id) => ids.has(id)));
  };
  const undo = () => {
    const prev = undoRef.current.pop();
    if (!prev || !levelRef.current) return;
    redoRef.current.push(clone(levelRef.current));
    emit(prev); pruneSel(); bump();
  };
  const redo = () => {
    const nxt = redoRef.current.pop();
    if (!nxt || !levelRef.current) return;
    undoRef.current.push(clone(levelRef.current));
    emit(nxt); pruneSel(); bump();
  };

  // ---------- selection actions ----------
  const selectedItems = () => (levelRef.current ? itemsOf(levelRef.current).filter((i) => selRef.current.has(i.id)) : []);
  const rotateSel = (cw: boolean) => {
    const its = selectedItems().filter((i) => !isGround(i));
    if (!its.length) { flash('Нечего вращать (земля не вращается).'); return; }
    const gx = (Math.min(...its.map((i) => i.x)) + Math.max(...its.map((i) => i.x + i.w))) / 2;
    const gy = (Math.min(...its.map((i) => i.y)) + Math.max(...its.map((i) => i.y + i.h))) / 2;
    mutate(() => {
      for (const it of its) {
        const vx = it.x + it.w / 2 - gx;
        const vy = it.y + it.h / 2 - gy;
        const cx = cw ? gx - vy : gx + vy;
        const cy = cw ? gy + vx : gy - vx;
        if (it.type === 'pick') { const p = it.ref as LevelPickup; p.x = snapX(cx); p.y = snapY(cy); continue; }
        const r = it.ref as GameRect;
        r.width = it.h; r.height = it.w;
        r.x = snapX(cx - it.h / 2); r.y = snapY(cy - it.w / 2);
        if (it.type === 'spike') r.dir = (((r.dir ?? 0) + (cw ? 1 : 3)) % 4) as Rot;
      }
    });
  };
  const flipSel = () => {
    const its = selectedItems();
    if (!its.length) return;
    const sum = Math.min(...its.map((i) => i.x)) + Math.max(...its.map((i) => i.x + i.w));
    mutate(() => {
      for (const it of its) {
        if (it.type === 'pick') { const p = it.ref as LevelPickup; p.x = sum - p.x; continue; }
        const r = it.ref as GameRect;
        r.x = sum - (r.x + r.width);
        if (it.type === 'spike' && r.dir === 1) r.dir = 3;
        else if (it.type === 'spike' && r.dir === 3) r.dir = 1;
      }
    });
  };
  const nudgeSel = (dx: number, dy: number) => {
    const its = selectedItems();
    if (!its.length) return;
    mutate(() => { for (const it of its) { const o = it.ref as { x: number; y: number }; o.x += dx; o.y += dy; } });
  };
  const duplicateSel = () => {
    const its = selectedItems();
    if (!its.length) return;
    const ids: string[] = [];
    mutate((l) => {
      for (const it of its) {
        const copy = { ...clone(it.ref), id: uid(it.type) } as GamePlatform & GameRect & LevelPickup;
        copy.x += GRID * 2;
        ids.push(copy.id);
        if (it.type === 'plat') l.platforms.push(copy);
        else if (it.type === 'spike') l.spikes.push(copy);
        else l.pickups.push(copy);
      }
    });
    setSel(ids);
  };
  const deleteSel = () => {
    if (!selRef.current.size) return;
    const ids = selRef.current;
    mutate((l) => {
      l.platforms = l.platforms.filter((p) => !ids.has(p.id));
      l.spikes = l.spikes.filter((s) => !ids.has(s.id));
      l.pickups = l.pickups.filter((k) => !ids.has(k.id));
    });
    setSel([]);
  };
  const selectAll = () => { if (levelRef.current) setSel(itemsOf(levelRef.current).map((i) => i.id)); };

  actions.current = {
    undo, redo, deleteSel, duplicateSel,
    rotate: () => rotateSel(true), rotateBack: () => rotateSel(false),
    left: () => nudgeSel(-GRID, 0), right: () => nudgeSel(GRID, 0), up: () => nudgeSel(0, -GRID), down: () => nudgeSel(0, GRID),
    zoomIn: () => zoomCenter(1.25), zoomOut: () => zoomCenter(0.8),
  };

  // ---------- placing with the paint tools ----------
  const paintAt = (wx: number, wy: number): boolean => {
    const next = levelRef.current;
    if (!next) return false;
    const t = toolRef.current;
    const odd = placeRotRef.current % 2 === 1;
    let changed = false;
    const addPlatform = (kind: GamePlatform['kind'], w0: number, h0: number) => {
      const rotatable = kind !== 'ground';
      const w = rotatable && odd ? h0 : w0;
      const h = rotatable && odd ? w0 : h0;
      const x = snapX(wx - w / 2);
      const y = snapY(wy - h / 2);
      if (x < 0 || x + w > next.worldWidth) return;
      if (next.platforms.some((p) => p.kind === kind && p.x === x && p.y === y && p.width === w)) return;
      const height = kind === 'ground' ? VIEW_H + 100 - y : h;
      next.platforms.push({ id: uid(kind), x, y, width: w, height, kind });
      changed = true;
    };
    switch (t) {
      case 'block': addPlatform('block', GRID * 2, GRID * 2); break;
      case 'half': addPlatform('half', GRID * 2, GRID); break;
      case 'platform': addPlatform('platform', GRID * 4, GRID); break;
      case 'ground': addPlatform('ground', GRID * 4, GRID); break;
      case 'spike': {
        const w = odd ? GRID : GRID * 2;
        const h = odd ? GRID * 2 : GRID;
        const x = snapX(wx - w / 2);
        const y = snapY(wy - h / 2);
        if (x < 0 || x + w > next.worldWidth) break;
        if (next.spikes.some((s) => s.x === x && s.y === y && s.width === w && s.dir === placeRotRef.current)) break;
        next.spikes.push({ id: uid('spike'), x, y, width: w, height: h, dir: placeRotRef.current });
        changed = true;
        break;
      }
      case 'pickup': {
        const x = snapX(wx);
        const y = snapY(wy);
        if (x < 0 || x > next.worldWidth || next.pickups.some((p) => p.x === x && p.y === y)) break;
        next.pickups.push({ id: uid('cell'), x, y, size: 18 });
        changed = true;
        break;
      }
      case 'start': next.start = { x: Math.max(0, snapX(wx - 16)), y: snapY(wy + 24) }; changed = true; break;
      case 'checkpoint': next.checkpoint = { x: Math.max(0, snapX(wx - 16)), y: snapY(wy + 24) }; changed = true; break;
      case 'exit':
        next.exit = { id: 'exit', x: Math.max(0, snapX(wx - EXIT_WIDTH / 2)), y: snapY(wy + 24) - EXIT_HEIGHT, width: EXIT_WIDTH, height: EXIT_HEIGHT };
        changed = true;
        break;
      case 'erase': {
        const its = itemsOf(next).filter((i) => inside(i, wx, wy, i.type === 'pick' ? 4 : 0));
        const target = its.find((i) => i.type === 'pick') ?? its.find((i) => i.type === 'spike') ?? its.reverse().find((i) => i.type === 'plat');
        if (target) {
          next.platforms = next.platforms.filter((p) => p.id !== target.id);
          next.spikes = next.spikes.filter((s) => s.id !== target.id);
          next.pickups = next.pickups.filter((k) => k.id !== target.id);
          changed = true;
        } else if (next.checkpoint && wx >= next.checkpoint.x && wx <= next.checkpoint.x + 32 && wy >= next.checkpoint.y - 48 && wy <= next.checkpoint.y) {
          delete next.checkpoint;
          changed = true;
        }
        break;
      }
      default: break;
    }
    return changed;
  };

  // ---------- pointer handling ----------
  const endGesture = () => {
    const g = gesture.current;
    gesture.current = null;
    if (!g) return;
    if (g.type === 'paint' || g.type === 'move') {
      if (!g.changed) undoRef.current.pop();
      else if (levelRef.current) { emit({ ...levelRef.current }); bump(); }
    } else if (g.type === 'marquee' && levelRef.current) {
      const x1 = Math.min(g.ax, g.bx), x2 = Math.max(g.ax, g.bx), y1 = Math.min(g.ay, g.by), y2 = Math.max(g.ay, g.by);
      const k = metrics().k;
      if ((x2 - x1) * k < 8 && (y2 - y1) * k < 8) { setSel([]); return; }
      setSel(itemsOf(levelRef.current).filter((i) => i.x < x2 && i.x + i.w > x1 && i.y < y2 && i.y + i.h > y1).map((i) => i.id));
    }
  };

  const onDown = (e: RPointerEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const cur = levelRef.current;
    if (!cur) return;
    if (pointers.current.size === 2) {
      endGesture();
      const [a, b] = [...pointers.current.values()];
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const w = toWorld(mid.x, mid.y);
      gesture.current = { type: 'pinch', d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, z0: viewRef.current.zoom, wx: w.x, wy: w.y };
      return;
    }
    if (pointers.current.size > 2) return;
    const w = toWorld(e.clientX, e.clientY);
    const t = toolRef.current;
    if (t === 'hand') {
      gesture.current = { type: 'pan', sx: e.clientX, sy: e.clientY, vx: viewRef.current.x, vy: viewRef.current.y };
    } else if (t === 'select') {
      const its = itemsOf(cur);
      const hitItem = [...its].reverse().find((i) => i.type === 'pick' && inside(i, w.x, w.y, 6))
        ?? [...its].reverse().find((i) => i.type === 'spike' && inside(i, w.x, w.y))
        ?? [...its].reverse().find((i) => i.type === 'plat' && inside(i, w.x, w.y));
      if (hitItem) {
        if (!selRef.current.has(hitItem.id)) setSel([hitItem.id]);
        const refs = its.filter((i) => selRef.current.has(i.id)).map((i) => {
          const o = i.ref as { x: number; y: number };
          return { o, ox: o.x, oy: o.y };
        });
        pushHistory();
        gesture.current = { type: 'move', sx: w.x, sy: w.y, refs, changed: false };
      } else {
        setSel([]);
        gesture.current = { type: 'marquee', ax: w.x, ay: w.y, bx: w.x, by: w.y };
      }
    } else {
      pushHistory();
      const changed = paintAt(w.x, w.y);
      gesture.current = { type: 'paint', changed };
    }
  };

  const onMove = (e: RPointerEvent<HTMLCanvasElement>) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    if (!g) return;
    if (g.type === 'pinch' && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      viewRef.current.zoom = clampZoom(g.z0 * (Math.hypot(a.x - b.x, a.y - b.y) / g.d0));
      const { b: rect, k } = metrics();
      viewRef.current.x = g.wx - (mid.x - rect.left) / k;
      viewRef.current.y = g.wy - (mid.y - rect.top) / k;
      clampView();
      return;
    }
    if (g.type === 'pan') {
      const { k } = metrics();
      viewRef.current.x = g.vx - (e.clientX - g.sx) / k;
      viewRef.current.y = g.vy - (e.clientY - g.sy) / k;
      clampView();
      return;
    }
    const w = toWorld(e.clientX, e.clientY);
    if (g.type === 'marquee') { g.bx = w.x; g.by = w.y; return; }
    if (g.type === 'move') {
      const dx = Math.round((w.x - g.sx) / GRID) * GRID;
      const dy = Math.round((w.y - g.sy) / GRID) * GRID;
      for (const r of g.refs) { r.o.x = r.ox + dx; r.o.y = r.oy + dy; }
      if (dx !== 0 || dy !== 0) g.changed = true;
      return;
    }
    if (g.type === 'paint' && !['start', 'checkpoint', 'exit'].includes(toolRef.current)) {
      if (paintAt(w.x, w.y)) g.changed = true;
    }
  };

  const onUp = (e: RPointerEvent<HTMLCanvasElement>) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.delete(e.pointerId);
    const g = gesture.current;
    if (g?.type === 'pinch') {
      gesture.current = pointers.current.size === 0 ? null : { type: 'idle' };
      bump();
      return;
    }
    if (g?.type === 'idle') { if (pointers.current.size === 0) gesture.current = null; return; }
    endGesture();
  };

  // ---------- rendering ----------
  useEffect(() => {
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const canvas = canvasRef.current;
      const lvl = levelRef.current;
      if (!canvas || !lvl) return;
      const b = canvas.getBoundingClientRect();
      if (!b.width || !b.height) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      if (canvas.width !== Math.round(b.width * dpr) || canvas.height !== Math.round(b.height * dpr)) {
        canvas.width = Math.round(b.width * dpr);
        canvas.height = Math.round(b.height * dpr);
        clampView();
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const v = viewRef.current;
      const k = (b.height / VIEW_H) * v.zoom;
      const vw = b.width / k;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = '#0c1112';
      ctx.fillRect(0, 0, b.width, b.height);
      ctx.setTransform(dpr * k, 0, 0, dpr * k, -v.x * dpr * k, -v.y * dpr * k);
      ctx.fillStyle = '#141b1c';
      ctx.fillRect(0, 0, lvl.worldWidth, VIEW_H);
      ctx.strokeStyle = 'rgba(156,182,168,.10)';
      ctx.lineWidth = 1 / k;
      ctx.beginPath();
      const gx0 = Math.max(0, Math.floor(v.x / GRID) * GRID), gx1 = Math.min(lvl.worldWidth, v.x + vw);
      for (let gx = gx0; gx <= gx1; gx += GRID) { ctx.moveTo(gx, 0); ctx.lineTo(gx, VIEW_H); }
      for (let gy = FLOOR_Y - Math.ceil(FLOOR_Y / GRID) * GRID; gy <= VIEW_H; gy += GRID) { ctx.moveTo(0, gy); ctx.lineTo(lvl.worldWidth, gy); }
      ctx.stroke();
      const fills: Record<GamePlatform['kind'], string> = { ground: '#2b3537', platform: '#41605f', block: '#5b6b6e', half: '#6a7e75' };
      for (const p of lvl.platforms) {
        if (p.x + p.width < v.x || p.x > v.x + vw) continue;
        ctx.fillStyle = fills[p.kind];
        ctx.fillRect(p.x, p.y, p.width, p.height);
        ctx.fillStyle = '#9fb3aa';
        ctx.fillRect(p.x, p.y, p.width, Math.min(3, p.height));
        ctx.strokeStyle = 'rgba(0,0,0,.35)';
        ctx.lineWidth = 1 / k;
        ctx.strokeRect(p.x + .5 / k, p.y + .5 / k, p.width - 1 / k, Math.min(p.height, 200) - 1 / k);
      }
      for (const sp of lvl.spikes) { if (sp.x + sp.width >= v.x && sp.x <= v.x + vw) drawSpike(ctx, sp); }
      for (const pk of lvl.pickups) {
        ctx.fillStyle = '#65e4df';
        ctx.beginPath();
        ctx.moveTo(pk.x, pk.y - 10); ctx.lineTo(pk.x + 9, pk.y); ctx.lineTo(pk.x, pk.y + 10); ctx.lineTo(pk.x - 9, pk.y);
        ctx.fill();
      }
      const marker = (x: number, y: number, w: number, h: number, color: string, text: string) => {
        ctx.globalAlpha = .35; ctx.fillStyle = color; ctx.fillRect(x, y, w, h); ctx.globalAlpha = 1;
        ctx.strokeStyle = color; ctx.lineWidth = 2 / k; ctx.strokeRect(x, y, w, h);
        ctx.fillStyle = color; ctx.font = 'bold 11px sans-serif'; ctx.fillText(text, x, y - 5);
      };
      marker(lvl.start.x, lvl.start.y - 48, 32, 48, '#7dff9b', 'СТАРТ');
      if (lvl.checkpoint) marker(lvl.checkpoint.x, lvl.checkpoint.y - 48, 32, 48, '#ffd166', 'ЧЕКПОИНТ');
      marker(lvl.exit.x, lvl.exit.y, lvl.exit.width, lvl.exit.height, '#ff7a59', 'ВЫХОД');
      ctx.strokeStyle = '#65e4df'; ctx.lineWidth = 2 / k;
      ctx.strokeRect(0, 0, lvl.worldWidth, VIEW_H);
      if (selRef.current.size) {
        ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2 / k; ctx.setLineDash([6 / k, 4 / k]);
        for (const it of itemsOf(lvl)) {
          if (!selRef.current.has(it.id)) continue;
          ctx.strokeRect(it.x - 1 / k, it.y - 1 / k, it.w + 2 / k, Math.min(it.h, 240) + 2 / k);
        }
        ctx.setLineDash([]);
      }
      const g = gesture.current;
      if (g?.type === 'marquee') {
        ctx.fillStyle = 'rgba(101,228,223,.15)'; ctx.strokeStyle = '#65e4df'; ctx.lineWidth = 1.5 / k;
        ctx.fillRect(Math.min(g.ax, g.bx), Math.min(g.ay, g.by), Math.abs(g.bx - g.ax), Math.abs(g.by - g.ay));
        ctx.strokeRect(Math.min(g.ax, g.bx), Math.min(g.ay, g.by), Math.abs(g.bx - g.ax), Math.abs(g.by - g.ay));
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [level === null]);

  // mouse wheel zoom (needs a non-passive native listener)
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      zoomAt(viewRef.current.zoom * Math.exp(-e.deltaY * 0.0015), e.clientX, e.clientY);
    };
    c.addEventListener('wheel', onWheel, { passive: false });
    return () => c.removeEventListener('wheel', onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [level === null]);

  // keyboard shortcuts (desktop)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return;
      const a = actions.current;
      const key = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && key === 'z') { e.preventDefault(); (e.shiftKey ? a.redo : a.undo)(); }
      else if ((e.ctrlKey || e.metaKey) && key === 'y') { e.preventDefault(); a.redo(); }
      else if ((e.ctrlKey || e.metaKey) && key === 'd') { e.preventDefault(); a.duplicateSel(); }
      else if (key === 'delete' || key === 'backspace') a.deleteSel();
      else if (key === 'r') (e.shiftKey ? a.rotateBack : a.rotate)();
      else if (key === 'arrowleft') a.left();
      else if (key === 'arrowright') a.right();
      else if (key === 'arrowup') a.up();
      else if (key === 'arrowdown') a.down();
      else if (key === '+' || key === '=') a.zoomIn();
      else if (key === '-') a.zoomOut();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // reset editor state when a different level is opened
  useEffect(() => {
    undoRef.current = []; redoRef.current = [];
    setSel([]);
    viewRef.current = { x: 0, y: 0, zoom: 1 };
    clampView();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [level?.id]);

  // ---------- save / publish / misc ----------
  const validate = (l: LevelData): string | null => {
    if (!l.name.trim()) return 'Введите название уровня.';
    if (l.exit.x > l.worldWidth) return 'Выход находится за пределами уровня.';
    if (l.platforms.length === 0) return 'Добавьте хотя бы одну платформу или землю.';
    return null;
  };
  const doSave = () => {
    const cur = levelRef.current;
    if (!cur) return;
    saveDraft(cur); setDrafts(loadDrafts()); flash('Сохранено на этом устройстве.');
  };
  const doPublish = async () => {
    const cur = levelRef.current;
    if (!cur) return;
    const problem = validate(cur);
    if (problem) { flash(problem); return; }
    if (!(await ask('Опубликовать уровень? Он появится в меню «Уровни».'))) return;
    saveDraft(cur); publishLevel(cur); setDrafts(loadDrafts()); flash('Опубликовано. Смотрите меню «Уровни».');
  };
  const doExport = async () => {
    const cur = levelRef.current;
    if (!cur) return;
    try { await navigator.clipboard.writeText(JSON.stringify(cur)); flash('JSON уровня скопирован.'); }
    catch { void show('Скопируйте JSON уровня:', JSON.stringify(cur)); }
  };
  const changeWidth = (delta: number) => {
    mutate((l) => {
      l.worldWidth = Math.max(1440, Math.min(9600, l.worldWidth + delta));
      const g0 = l.platforms.find((p) => p.id === 'g0');
      if (g0) g0.width = 1000 + l.worldWidth;
    });
    clampView();
  };
  const clearAll = async () => {
    const cur = levelRef.current;
    if (!cur || !(await ask('Очистить весь уровень?'))) return;
    const fresh = blankLevel();
    mutate((l) => {
      l.platforms = [{ ...fresh.platforms[0], width: 1000 + l.worldWidth }];
      l.spikes = []; l.pickups = []; delete l.checkpoint;
      l.start = fresh.start;
      l.exit = { ...fresh.exit, x: l.worldWidth - 144 };
    });
    setSel([]);
  };

  // ---------- level list ----------
  if (!level) {
    return (
      <main className="ed-page">
        <header className="ed-bar">
          <strong>РЕДАКТОР УРОВНЕЙ</strong>
          <button className="settings-trigger" onClick={onExit}>В меню</button>
        </header>
        <div className="ed-list">
          <button className="sr-menu-button is-primary" onClick={() => onChange(blankLevel())}><span>＋</span> НОВЫЙ УРОВЕНЬ</button>
          {drafts.length === 0 && <p className="ed-empty">Сохранённых черновиков пока нет.</p>}
          {drafts.map((d) => (
            <div className="ed-row" key={d.id}>
              <span>{d.name}</span>
              <button className="settings-trigger" onClick={() => onChange(clone(d))}>Открыть</button>
              <button className="settings-trigger" onClick={async () => { if (await ask('Удалить черновик?')) { deleteDraft(d.id); setDrafts(loadDrafts()); } }}>Удалить</button>
            </div>
          ))}
        </div>
      </main>
    );
  }

  const cur = levelRef.current ?? level;
  const v = viewRef.current;
  const { vw } = metrics();
  const maxX = Math.max(0, cur.worldWidth - vw);
  const hasSel = selected.length > 0;

  return (
    <main className="ed-page">
      <header className="ed-bar">
        <button className="settings-trigger" onClick={() => setMenuOpen((o) => !o)} aria-label="Меню">☰</button>
        <input className="ed-name" value={cur.name} maxLength={40} onChange={(e) => { cur.name = e.target.value; emit({ ...cur }); }} aria-label="Название уровня" />
        <div className="ed-actions">
          <button className="settings-trigger" onClick={() => onTest(levelRef.current ?? level)}>▶ Тест</button>
          <button className="settings-trigger" disabled={!undoRef.current.length} onClick={undo} aria-label="Отменить">↶</button>
          <button className="settings-trigger" disabled={!redoRef.current.length} onClick={redo} aria-label="Повторить">↷</button>
          <button className="settings-trigger" onClick={() => zoomCenter(0.8)} aria-label="Уменьшить">−</button>
          <button className="settings-trigger" onClick={() => { viewRef.current.zoom = 1; clampView(); bump(); }}>{Math.round(v.zoom * 100)}%</button>
          <button className="settings-trigger" onClick={() => zoomCenter(1.25)} aria-label="Увеличить">＋</button>
        </div>
      </header>
      {menuOpen && (
        <div className="ed-menu">
          <button className="settings-trigger" onClick={doSave}>Сохранить</button>
          <button className="settings-trigger" onClick={doPublish}>Опубликовать</button>
          <button className="settings-trigger" onClick={doExport}>JSON</button>
          <button className="settings-trigger" onClick={selectAll}>Выбрать всё</button>
          <button className="settings-trigger" onClick={() => changeWidth(-480)}>Длина −</button>
          <button className="settings-trigger" onClick={() => changeWidth(480)}>Длина ＋</button>
          <span className="ed-len">{cur.worldWidth}</span>
          <button className="settings-trigger" onClick={clearAll}>Очистить</button>
          <button className="settings-trigger" onClick={() => { doSave(); onChange(null); setMenuOpen(false); }}>К списку</button>
          <button className="settings-trigger" onClick={onExit}>В меню</button>
        </div>
      )}
      <div className="ed-tools" role="toolbar" aria-label="Инструменты">
        {TOOLS.map((t) => (
          <button key={t.id} className={`ed-tool ${tool === t.id ? 'is-on' : ''}`} onClick={() => setTool(t.id)}>{t.label}</button>
        ))}
        <button className="ed-tool" onClick={() => setPlaceRot(((placeRot + 1) % 4) as Rot)} aria-label="Поворот нового предмета">⟳ Поворот {ARROWS[placeRot]}</button>
      </div>
      {(hasSel || tool === 'select') && (
        <div className="ed-tools ed-selbar" role="toolbar" aria-label="Выделение">
          <span className="ed-selcount">{hasSel ? `Выбрано: ${selected.length}` : 'Выделите предметы'}</span>
          <button className="ed-tool" disabled={!hasSel} onClick={() => rotateSel(false)}>⟲ 90°</button>
          <button className="ed-tool" disabled={!hasSel} onClick={() => rotateSel(true)}>⟳ 90°</button>
          <button className="ed-tool" disabled={!hasSel} onClick={flipSel}>⇋ Зеркало</button>
          <button className="ed-tool" disabled={!hasSel} onClick={() => nudgeSel(-GRID, 0)}>◀</button>
          <button className="ed-tool" disabled={!hasSel} onClick={() => nudgeSel(0, -GRID)}>▲</button>
          <button className="ed-tool" disabled={!hasSel} onClick={() => nudgeSel(0, GRID)}>▼</button>
          <button className="ed-tool" disabled={!hasSel} onClick={() => nudgeSel(GRID, 0)}>▶</button>
          <button className="ed-tool" disabled={!hasSel} onClick={duplicateSel}>⧉ Дубль</button>
          <button className="ed-tool" disabled={!hasSel} onClick={deleteSel}>🗑 Удалить</button>
          <button className="ed-tool" onClick={selectAll}>Всё</button>
        </div>
      )}
      <canvas ref={canvasRef} className="ed-canvas" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} />
      <footer className="ed-foot">
        <input
          type="range" className="ed-scroll" min={0} max={Math.max(1, Math.round(maxX))} value={Math.min(Math.round(v.x), Math.max(1, Math.round(maxX)))}
          disabled={maxX <= 0}
          onChange={(e) => { viewRef.current.x = Number(e.target.value); clampView(); bump(); }}
          aria-label="Прокрутка уровня"
        />
        {message && <b className="ed-msg">{message}</b>}
      </footer>
    </main>
  );
}
