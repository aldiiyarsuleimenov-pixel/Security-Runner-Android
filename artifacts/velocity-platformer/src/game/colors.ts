// Colour helpers shared by the game view and the editor (smooth colour changes from triggers).

function parse(c: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c.trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split("").map((x) => x + x).join("");
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function lerpColor(from: string, to: string, k: number): string {
  const a = parse(from);
  const b = parse(to);
  if (!a || !b) return k < 0.5 ? from : to;
  const mix = (i: number) => Math.round(a[i] + (b[i] - a[i]) * Math.max(0, Math.min(1, k)));
  return `rgb(${mix(0)},${mix(1)},${mix(2)})`;
}

/** Colour of an object right now: its own colour, fading in from the previous one while a trigger recolours it. */
export function resolveColor(o: { color?: string; colorFrom?: string; colorK?: number }, def: string): string {
  const k = o.colorK ?? 1;
  const to = o.color ?? def;
  if (k >= 1) return to;
  return lerpColor(o.colorFrom ?? def, to, k);
}
