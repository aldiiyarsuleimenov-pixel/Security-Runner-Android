// Small canvas helpers shared by the game view and the level editor.

const imageCache = new Map<string, HTMLImageElement>();

/** Returns the decoded image for a data URL, or null while it is still loading. */
export function getImg(url: string | undefined): HTMLImageElement | null {
  if (!url) return null;
  let img = imageCache.get(url);
  if (!img) {
    img = new Image();
    img.src = url;
    imageCache.set(url, img);
  }
  return img.complete && img.naturalWidth > 0 ? img : null;
}

/** Fills a rectangle with a repeating square tile of the image; only the visible x-range is drawn. */
export function drawTiled(
  ctx: CanvasRenderingContext2D, img: HTMLImageElement,
  x: number, y: number, w: number, h: number, minX: number, maxX: number,
) {
  const tile = Math.max(12, Math.min(w, h, 48));
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  const startX = x + Math.floor((Math.max(x, minX) - x) / tile) * tile;
  const endX = Math.min(x + w, maxX);
  const endY = Math.min(y + h, 600);
  for (let ty = y; ty < endY; ty += tile) {
    for (let tx = startX; tx < endX; tx += tile) ctx.drawImage(img, tx, ty, tile, tile);
  }
  ctx.restore();
}

/** Rotates the context around the centre of a rectangle (used while a rotate trigger animates). */
export function spinAround(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, deg: number | undefined) {
  if (!deg) return;
  ctx.translate(x + w / 2, y + h / 2);
  ctx.rotate((deg * Math.PI) / 180);
  ctx.translate(-(x + w / 2), -(y + h / 2));
}

/** Stable small number from an id, so animations of different objects are out of phase. */
export function hashId(id: string | number): number {
  const s = String(id);
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 9973;
  return h;
}

/** Approximate size of a text object in world units (used for hit-testing and selection boxes). */
export function textBox(text: string, size: number) {
  const lines = text.split("\n");
  const longest = Math.max(1, ...lines.map((l) => l.length));
  return { w: Math.max(size, longest * size * 0.62), h: lines.length * size * 1.25 };
}

/** Draws (possibly multi-line) text with a dark outline so it stays readable on any background. */
export function drawText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, color: string) {
  ctx.save();
  ctx.font = `700 ${size}px "IBM Plex Mono", monospace`;
  ctx.textBaseline = "top";
  ctx.lineJoin = "round";
  ctx.lineWidth = Math.max(2, size / 5);
  ctx.strokeStyle = "rgba(6,10,11,.85)";
  ctx.fillStyle = color || "#eff3dd";
  text.split("\n").forEach((line, i) => {
    ctx.strokeText(line, x, y + i * size * 1.25);
    ctx.fillText(line, x, y + i * size * 1.25);
  });
  ctx.restore();
}
