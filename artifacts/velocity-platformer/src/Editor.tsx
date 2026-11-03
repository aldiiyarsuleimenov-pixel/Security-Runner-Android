import { useCallback, useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import type { GamePlatform, GameRect } from './game/GameEngine';
import { EXIT_HEIGHT, EXIT_WIDTH, FLOOR_Y, GRID, blankLevel, type LevelData } from './game/levels';
import { deleteDraft, loadDrafts, publishLevel, saveDraft } from './game/levelStore';

type Tool = 'hand' | 'block' | 'half' | 'platform' | 'ground' | 'spike' | 'pickup' | 'start' | 'checkpoint' | 'exit' | 'erase';

const TOOLS: Array<{ id: Tool; label: string }> = [
  { id: 'hand', label: '✋ Рука' },
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
const snapX = (v: number) => Math.round(v / GRID) * GRID;
const snapY = (v: number) => FLOOR_Y + Math.round((v - FLOOR_Y) / GRID) * GRID;
const hit = (r: GameRect, x: number, y: number) => x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height;
const clone = (l: LevelData): LevelData => JSON.parse(JSON.stringify(l));

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
  const [, force] = useState(0);
  const [tool, setTool] = useState<Tool>('block');
  const [cameraX, setCameraX] = useState(0);
  const [message, setMessage] = useState('');
  const [drafts, setDrafts] = useState<LevelData[]>(() => loadDrafts());
  const cameraRef = useRef(0);
  const dragRef = useRef<{ id: number; panStartX: number; panStartCam: number } | null>(null);
  const toolRef = useRef<Tool>('block');
  toolRef.current = tool;
  levelRef.current = level;

  const viewW = () => {
    const c = canvasRef.current;
    if (!c) return 960;
    const b = c.getBoundingClientRect();
    return VIEW_H * (b.width / Math.max(b.height, 1));
  };
  const maxCam = () => Math.max(0, (levelRef.current?.worldWidth ?? 0) - viewW());
  const setCam = (x: number) => {
    const next = Math.max(0, Math.min(maxCam(), x));
    cameraRef.current = next;
    setCameraX(next);
  };
  const flash = (text: string) => { setMessage(text); window.setTimeout(() => setMessage(''), 2600); };

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const lvl = levelRef.current;
    if (!canvas || !lvl) return;
    const b = canvas.getBoundingClientRect();
    if (!b.width || !b.height) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (canvas.width !== Math.round(b.width * dpr) || canvas.height !== Math.round(b.height * dpr)) {
      canvas.width = Math.round(b.width * dpr);
      canvas.height = Math.round(b.height * dpr);
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const vw = VIEW_H * (b.width / b.height);
    const s = b.height / VIEW_H;
    ctx.setTransform(dpr * s, 0, 0, dpr * s, 0, 0);
    const cam = cameraRef.current;
    ctx.fillStyle = '#141b1c';
    ctx.fillRect(0, 0, vw, VIEW_H);
    // grid
    ctx.strokeStyle = 'rgba(156,182,168,.10)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let gx = -(cam % GRID); gx < vw; gx += GRID) { ctx.moveTo(gx, 0); ctx.lineTo(gx, VIEW_H); }
    for (let gy = FLOOR_Y % GRID; gy < VIEW_H; gy += GRID) { ctx.moveTo(0, gy); ctx.lineTo(vw, gy); }
    ctx.stroke();
    // world bounds
    ctx.fillStyle = 'rgba(0,0,0,.45)';
    if (-cam > 0) ctx.fillRect(0, 0, -cam, VIEW_H);
    if (lvl.worldWidth - cam < vw) ctx.fillRect(lvl.worldWidth - cam, 0, vw, VIEW_H);

    for (const p of lvl.platforms) {
      const x = p.x - cam;
      if (x + p.width < 0 || x > vw) continue;
      const fills: Record<GamePlatform['kind'], string> = { ground: '#2b3537', platform: '#41605f', block: '#5b6b6e', half: '#6a7e75' };
      ctx.fillStyle = fills[p.kind];
      ctx.fillRect(x, p.y, p.width, p.height);
      ctx.fillStyle = '#9fb3aa';
      ctx.fillRect(x, p.y, p.width, 3);
      ctx.strokeStyle = 'rgba(0,0,0,.35)';
      ctx.strokeRect(x + .5, p.y + .5, p.width - 1, Math.min(p.height, 200) - 1);
    }
    for (const sp of lvl.spikes) {
      const x = sp.x - cam;
      if (x + sp.width < 0 || x > vw) continue;
      const n = Math.max(1, Math.round(sp.width / 24));
      const w = sp.width / n;
      ctx.fillStyle = '#d6d8c9';
      for (let i = 0; i < n; i++) {
        ctx.beginPath();
        ctx.moveTo(x + i * w, sp.y + sp.height);
        ctx.lineTo(x + i * w + w / 2, sp.y);
        ctx.lineTo(x + (i + 1) * w, sp.y + sp.height);
        ctx.fill();
      }
    }
    for (const pk of lvl.pickups) {
      const x = pk.x - cam;
      ctx.fillStyle = '#65e4df';
      ctx.beginPath();
      ctx.moveTo(x, pk.y - 10); ctx.lineTo(x + 9, pk.y); ctx.lineTo(x, pk.y + 10); ctx.lineTo(x - 9, pk.y);
      ctx.fill();
    }
    const marker = (x: number, y: number, w: number, h: number, color: string, text: string) => {
      ctx.fillStyle = color;
      ctx.globalAlpha = .35;
      ctx.fillRect(x - cam, y, w, h);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.strokeRect(x - cam, y, w, h);
      ctx.fillStyle = color;
      ctx.font = 'bold 11px sans-serif';
      ctx.fillText(text, x - cam, y - 5);
    };
    marker(lvl.start.x, lvl.start.y - 48, 32, 48, '#7dff9b', 'СТАРТ');
    if (lvl.checkpoint) marker(lvl.checkpoint.x, lvl.checkpoint.y - 48, 32, 48, '#ffd166', 'ЧЕКПОИНТ');
    marker(lvl.exit.x, lvl.exit.y, lvl.exit.width, lvl.exit.height, '#ff7a59', 'ВЫХОД');
  }, []);

  useEffect(() => {
    let raf = 0;
    const loop = () => { draw(); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [draw]);

  const toWorld = (e: RPointerEvent<HTMLCanvasElement>) => {
    const b = e.currentTarget.getBoundingClientRect();
    const s = VIEW_H / b.height;
    return { x: (e.clientX - b.left) * s + cameraRef.current, y: (e.clientY - b.top) * s };
  };

  const apply = (wx: number, wy: number) => {
    const lvl = levelRef.current;
    if (!lvl) return;
    const t = toolRef.current;
    const next = clone(lvl);
    let changed = false;
    const addPlatform = (kind: GamePlatform['kind'], w: number, h: number) => {
      const x = snapX(wx - w / 2);
      const y = kind === 'ground' ? snapY(wy - GRID / 2) : snapY(wy - h / 2);
      if (x < 0 || x + w > next.worldWidth) return;
      if (next.platforms.some((p) => p.kind === kind && p.x === x && p.y === y)) return;
      const height = kind === 'ground' ? VIEW_H + 100 - y : h;
      next.platforms.push({ id: `${kind}-${Date.now().toString(36)}-${next.platforms.length}`, x, y, width: w, height, kind });
      changed = true;
    };
    switch (t) {
      case 'block': addPlatform('block', GRID * 2, GRID * 2); break;
      case 'half': addPlatform('half', GRID * 2, GRID); break;
      case 'platform': addPlatform('platform', GRID * 4, GRID); break;
      case 'ground': addPlatform('ground', GRID * 4, GRID); break;
      case 'spike': {
        const x = snapX(wx - GRID);
        const y = snapY(wy - GRID / 2);
        if (x < 0 || x + GRID * 2 > next.worldWidth) break;
        if (next.spikes.some((s) => s.x === x && s.y === y)) break;
        next.spikes.push({ id: `spike-${Date.now().toString(36)}-${next.spikes.length}`, x, y, width: GRID * 2, height: GRID });
        changed = true;
        break;
      }
      case 'pickup': {
        const x = snapX(wx);
        const y = snapY(wy);
        if (x < 0 || x > next.worldWidth || next.pickups.some((p) => p.x === x && p.y === y)) break;
        next.pickups.push({ id: `cell-${Date.now().toString(36)}-${next.pickups.length}`, x, y, size: 18 });
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
        const before = next.platforms.length + next.spikes.length + next.pickups.length + (next.checkpoint ? 1 : 0);
        const pi = [...next.platforms].reverse().findIndex((p) => hit(p, wx, wy));
        if (pi >= 0) next.platforms.splice(next.platforms.length - 1 - pi, 1);
        else {
          next.spikes = next.spikes.filter((s) => !hit(s, wx, wy));
          next.pickups = next.pickups.filter((p) => Math.abs(p.x - wx) > 14 || Math.abs(p.y - wy) > 14);
          if (next.checkpoint && hit({ id: 'c', x: next.checkpoint.x, y: next.checkpoint.y - 48, width: 32, height: 48 }, wx, wy)) delete next.checkpoint;
        }
        changed = before !== next.platforms.length + next.spikes.length + next.pickups.length + (next.checkpoint ? 1 : 0);
        break;
      }
      default: break;
    }
    if (changed) { levelRef.current = next; onChange(next); }
  };

  const onDown = (e: RPointerEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { id: e.pointerId, panStartX: e.clientX, panStartCam: cameraRef.current };
    if (toolRef.current !== 'hand') { const w = toWorld(e); apply(w.x, w.y); }
  };
  const onMove = (e: RPointerEvent<HTMLCanvasElement>) => {
    const d = dragRef.current;
    if (!d || d.id !== e.pointerId) return;
    if (toolRef.current === 'hand') {
      const b = e.currentTarget.getBoundingClientRect();
      setCam(d.panStartCam - (e.clientX - d.panStartX) * (VIEW_H / b.height));
    } else if (!['start', 'checkpoint', 'exit'].includes(toolRef.current)) {
      const w = toWorld(e); apply(w.x, w.y);
    }
  };
  const onUp = (e: RPointerEvent<HTMLCanvasElement>) => { if (dragRef.current?.id === e.pointerId) dragRef.current = null; };

  const validate = (l: LevelData): string | null => {
    if (!l.name.trim()) return 'Введите название уровня.';
    if (l.exit.x > l.worldWidth) return 'Выход находится за пределами уровня.';
    if (l.platforms.length === 0) return 'Добавьте хотя бы одну платформу или землю.';
    return null;
  };
  const doSave = () => {
    if (!level) return;
    saveDraft(level); setDrafts(loadDrafts()); flash('Сохранено на этом устройстве.');
  };
  const doPublish = async () => {
    if (!level) return;
    const problem = validate(level);
    if (problem) { flash(problem); return; }
    if (!(await ask('Опубликовать уровень? Он появится в меню «Уровни».'))) return;
    saveDraft(level); publishLevel(level); setDrafts(loadDrafts()); flash('Опубликовано. Смотрите меню «Уровни».');
  };
  const doExport = async () => {
    if (!level) return;
    try { await navigator.clipboard.writeText(JSON.stringify(level)); flash('JSON уровня скопирован.'); }
    catch { void show('Скопируйте JSON уровня:', JSON.stringify(level)); }
  };
  const changeWidth = (delta: number) => {
    if (!level) return;
    const next = clone(level);
    next.worldWidth = Math.max(1440, Math.min(9600, next.worldWidth + delta));
    const g0 = next.platforms.find((p) => p.id === 'g0');
    if (g0) g0.width = 1000 + next.worldWidth;
    levelRef.current = next; onChange(next);
    setCameraX((c) => Math.min(c, Math.max(0, next.worldWidth - viewW())));
  };
  const clearAll = async () => {
    if (!level || !(await ask('Очистить весь уровень?'))) return;
    const fresh = blankLevel();
    const next = { ...fresh, id: level.id, name: level.name, worldWidth: level.worldWidth };
    next.platforms = [{ ...fresh.platforms[0], width: 1000 + level.worldWidth }];
    next.exit = { ...fresh.exit, x: level.worldWidth - 144 };
    levelRef.current = next; onChange(next); force((n) => n + 1);
  };

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

  return (
    <main className="ed-page">
      <header className="ed-bar">
        <input className="ed-name" value={level.name} maxLength={40} onChange={(e) => { const n = { ...level, name: e.target.value }; levelRef.current = n; onChange(n); }} aria-label="Название уровня" />
        <div className="ed-actions">
          <button className="settings-trigger" onClick={() => onTest(level)}>▶ Тест</button>
          <button className="settings-trigger" onClick={doSave}>Сохранить</button>
          <button className="settings-trigger" onClick={doPublish}>Опубликовать</button>
          <button className="settings-trigger" onClick={doExport}>JSON</button>
          <button className="settings-trigger" onClick={() => { doSave(); onChange(null); }}>К списку</button>
        </div>
      </header>
      <div className="ed-tools" role="toolbar" aria-label="Инструменты">
        {TOOLS.map((t) => (
          <button key={t.id} className={`ed-tool ${tool === t.id ? 'is-on' : ''}`} onClick={() => setTool(t.id)}>{t.label}</button>
        ))}
      </div>
      <canvas ref={canvasRef} className="ed-canvas" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} />
      <footer className="ed-foot">
        <input type="range" className="ed-scroll" min={0} max={Math.max(1, Math.round(maxCam()))} value={Math.round(cameraX)} onChange={(e) => setCam(Number(e.target.value))} aria-label="Прокрутка уровня" />
        <span>Длина: {level.worldWidth}</span>
        <button className="settings-trigger" onClick={() => changeWidth(-480)}>−</button>
        <button className="settings-trigger" onClick={() => changeWidth(480)}>＋</button>
        <button className="settings-trigger" onClick={clearAll}>Очистить</button>
        <button className="settings-trigger" onClick={onExit}>В меню</button>
        {message && <b className="ed-msg">{message}</b>}
      </footer>
    </main>
  );
}
