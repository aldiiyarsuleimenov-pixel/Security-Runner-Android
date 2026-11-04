import { useState } from 'react';
import type { LevelData, LevelTrigger, TriggerAction } from './game/levels';
import { GRID } from './game/levels';

const SWATCHES = ['#ff7a59', '#ffd166', '#7dff9b', '#65e4df', '#59b9ff', '#b48cff', '#ff6fb1', '#eff3dd', '#6a7e75', '#202a2c'];
const ACTIONS: Array<{ id: TriggerAction; label: string }> = [
  { id: 'move', label: '⇄ Двигать' },
  { id: 'rotate', label: '⟳ Вращать' },
  { id: 'hide', label: '◌ Спрятать' },
  { id: 'show', label: '● Показать' },
  { id: 'color', label: '◐ Цвет' },
];

interface Props {
  level: LevelData;
  selIds: string[];
  onApply: (fn: (l: LevelData) => void) => void;
  onPickImage: (target: 'skin' | 'bg') => void;
  onClose: () => void;
}

/** Properties of the current selection: group tag, colour, texture, text and trigger settings. */
export default function EditorPanel({ level, selIds, onApply, onPickImage, onClose }: Props) {
  const ids = new Set(selIds);
  const plats = level.platforms.filter((p) => ids.has(p.id));
  const spikes = level.spikes.filter((s) => ids.has(s.id));
  const picks = level.pickups.filter((k) => ids.has(k.id));
  const texts = (level.texts ?? []).filter((t) => ids.has(t.id));
  const trigs = (level.triggers ?? []).filter((t) => ids.has(t.id));
  const groupable = plats.length + spikes.length + picks.length + texts.length;
  const firstGroup = [...plats, ...spikes, ...picks, ...texts].find((o) => o.group)?.group ?? '';
  const t0 = trigs[0];

  const [group, setGroup] = useState(firstGroup);
  const [target, setTarget] = useState(t0?.target ?? '');
  const [textValue, setTextValue] = useState(texts[0]?.text ?? '');

  const forObjects = (fn: (o: { group?: string; color?: string }) => void) =>
    onApply((l) => {
      for (const o of [...l.platforms, ...l.spikes, ...l.pickups, ...(l.texts ?? [])]) if (ids.has(o.id)) fn(o);
    });
  const forTriggers = (fn: (t: LevelTrigger) => void) =>
    onApply((l) => { for (const t of l.triggers ?? []) if (ids.has(t.id)) fn(t); });
  const stepper = (label: string, value: string, minus: () => void, plus: () => void) => (
    <div className="ed-field">
      <span>{label}</span>
      <button className="ed-tool" onClick={minus}>−</button>
      <b>{value}</b>
      <button className="ed-tool" onClick={plus}>＋</button>
    </div>
  );
  const swatchRow = (apply: (c: string) => void, reset?: () => void) => (
    <div className="ed-swatches">
      {SWATCHES.map((c) => (
        <button key={c} className="ed-swatch" style={{ background: c }} onClick={() => apply(c)} aria-label={`Цвет ${c}`} />
      ))}
      {reset && <button className="ed-tool" onClick={reset}>Сброс</button>}
    </div>
  );

  return (
    <section className="ed-panel" aria-label="Свойства">
      <div className="ed-panel-head">
        <strong>Свойства · {selIds.length}</strong>
        <button className="ed-tool" onClick={onClose}>✕ Закрыть</button>
      </div>

      {groupable > 0 && (
        <>
          <div className="ed-field">
            <span>Группа</span>
            <input value={group} maxLength={16} placeholder="например A" onChange={(e) => setGroup(e.target.value)} />
            <button className="ed-tool" onClick={() => { const g = group.trim(); forObjects((o) => { o.group = g || undefined; }); }}>✓</button>
          </div>
          <div className="ed-hint">Триггер действует на все объекты с такой же группой.</div>
          <div className="ed-field"><span>Цвет</span></div>
          {swatchRow(
            (c) => forObjects((o) => { o.color = c; }),
            () => forObjects((o) => { if ('text' in o) o.color = '#eff3dd'; else delete o.color; }),
          )}
        </>
      )}

      {plats.length > 0 && (
        <>
          <div className="ed-field"><span>Текстура блока (PNG / JPG)</span></div>
          <div className="ed-swatches">
            <button className="ed-tool" onClick={() => onPickImage('skin')}>📁 Загрузить…</button>
            {Object.entries(level.images ?? {}).map(([id, url]) => (
              <button
                key={id} className="ed-swatch ed-thumb" style={{ backgroundImage: `url(${url})` }} aria-label="Применить текстуру"
                onClick={() => onApply((l) => { for (const p of l.platforms) if (ids.has(p.id)) p.skin = id; })}
              />
            ))}
            <button className="ed-tool" onClick={() => onApply((l) => { for (const p of l.platforms) if (ids.has(p.id)) delete p.skin; })}>Без текстуры</button>
          </div>
        </>
      )}

      {texts.length > 0 && (
        <>
          <div className="ed-field">
            <span>Текст</span>
            <textarea rows={2} value={textValue} onChange={(e) => setTextValue(e.target.value)} />
            <button className="ed-tool" onClick={() => onApply((l) => { for (const t of l.texts ?? []) if (ids.has(t.id)) t.text = textValue; })}>✓</button>
          </div>
          {stepper('Размер', String(texts[0].size),
            () => onApply((l) => { for (const t of l.texts ?? []) if (ids.has(t.id)) t.size = Math.max(10, t.size - 4); }),
            () => onApply((l) => { for (const t of l.texts ?? []) if (ids.has(t.id)) t.size = Math.min(64, t.size + 4); }))}
        </>
      )}

      {t0 && (
        <>
          <div className="ed-field"><span>Действие триггера</span></div>
          <div className="ed-swatches">
            {ACTIONS.map((a) => (
              <button key={a.id} className={`ed-tool ${t0.action === a.id ? 'is-on' : ''}`} onClick={() => forTriggers((t) => { t.action = a.id; })}>{a.label}</button>
            ))}
          </div>
          <div className="ed-field">
            <span>Цель (группа)</span>
            <input value={target} maxLength={16} placeholder="A" onChange={(e) => setTarget(e.target.value)} />
            <button className="ed-tool" onClick={() => { const g = target.trim(); forTriggers((t) => { t.target = g; }); }}>✓</button>
          </div>
          <div className="ed-field">
            <span>Срабатывает</span>
            <button className={`ed-tool ${t0.once ? 'is-on' : ''}`} onClick={() => forTriggers((t) => { t.once = true; })}>1 раз</button>
            <button className={`ed-tool ${!t0.once ? 'is-on' : ''}`} onClick={() => forTriggers((t) => { t.once = false; })}>каждый вход</button>
          </div>
          {(t0.action === 'move' || t0.action === 'rotate') &&
            stepper('Время, c', t0.duration.toFixed(1),
              () => forTriggers((t) => { t.duration = Math.max(0.1, Math.round((t.duration - 0.1) * 10) / 10); }),
              () => forTriggers((t) => { t.duration = Math.min(5, Math.round((t.duration + 0.1) * 10) / 10); }))}
          {t0.action === 'move' && (
            <>
              {stepper('Сдвиг по X, клеток', String(t0.dx / GRID),
                () => forTriggers((t) => { t.dx -= GRID; }), () => forTriggers((t) => { t.dx += GRID; }))}
              {stepper('Сдвиг по Y (вниз +)', String(t0.dy / GRID),
                () => forTriggers((t) => { t.dy -= GRID; }), () => forTriggers((t) => { t.dy += GRID; }))}
            </>
          )}
          {t0.action === 'rotate' && (
            <div className="ed-field">
              <span>Поворот</span>
              <button className={`ed-tool ${t0.angle === -90 ? 'is-on' : ''}`} onClick={() => forTriggers((t) => { t.angle = -90; })}>⟲ 90°</button>
              <button className={`ed-tool ${t0.angle === 90 ? 'is-on' : ''}`} onClick={() => forTriggers((t) => { t.angle = 90; })}>⟳ 90°</button>
            </div>
          )}
          {t0.action === 'color' && (
            <>
              <div className="ed-field"><span>Новый цвет</span></div>
              {swatchRow((c) => forTriggers((t) => { t.color = c; }))}
            </>
          )}
          {stepper('Зона: ширина', String(t0.width / GRID),
            () => forTriggers((t) => { t.width = Math.max(GRID, t.width - GRID); }), () => forTriggers((t) => { t.width += GRID; }))}
          {stepper('Зона: высота', String(t0.height / GRID),
            () => forTriggers((t) => { t.height = Math.max(GRID, t.height - GRID); }), () => forTriggers((t) => { t.height += GRID; }))}
        </>
      )}
    </section>
  );
}
