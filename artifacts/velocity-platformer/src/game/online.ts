import { ONLINE } from "./onlineConfig";
import { normalizeLevel, type LevelData } from "./levels";

export interface OnlineLevelInfo {
  id: string;
  name: string;
  author: string;
  likes: number;
  created_at: string;
}

export const onlineEnabled = () => !!ONLINE.url && !!ONLINE.anonKey;

const MAX_UPLOAD_BYTES = 900_000;

function baseUrl(): string {
  // Tolerate a pasted URL with spaces, a trailing slash or a "/rest/v1" tail.
  return ONLINE.url.trim().replace(/\/+$/, "").replace(/\/rest\/v1$/, "");
}

async function call(path: string, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  let res: Response;
  try {
    res = await fetch(`${baseUrl()}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        apikey: ONLINE.anonKey.trim(),
        Authorization: `Bearer ${ONLINE.anonKey.trim()}`,
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
    });
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") throw new Error("Сервер не отвечает. Проверьте интернет.");
    throw new Error("Нет связи с сервером. Проверьте интернет и адрес сервера в onlineConfig.ts.");
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    let detail = "";
    try {
      const body = (await res.json()) as { message?: string; code?: string; hint?: string };
      detail = [body.code, body.message].filter(Boolean).join(": ");
    } catch { /* the body is not JSON */ }
    if (res.status === 404) throw new Error(`Ошибка 404: таблица levels не найдена или неверный адрес. Выполните SQL из ONLINE_SETUP_RU.md и проверьте url. ${detail}`.trim());
    if (res.status === 401 || res.status === 403) throw new Error(`Ошибка ${res.status}: сервер не принял ключ anon или права. ${detail}`.trim());
    throw new Error(`Ошибка сервера ${res.status}. ${detail}`.trim());
  }
  return res;
}

export async function listLevels(sort: "new" | "top"): Promise<OnlineLevelInfo[]> {
  const order = sort === "top" ? "likes.desc,created_at.desc" : "created_at.desc";
  const res = await call(`/rest/v1/levels?select=id,name,author,likes,created_at&hidden=eq.false&order=${order}&limit=50`);
  return (await res.json()) as OnlineLevelInfo[];
}

const num = (v: unknown, fallback: number, min: number, max: number) =>
  typeof v === "number" && Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : fallback;

/** Downloaded levels are untrusted data: keep only what the game understands and clamp the numbers. */
export function sanitizeLevel(raw: unknown, id: string, name: string): LevelData {
  if (!raw || typeof raw !== "object") throw new Error("Уровень повреждён.");
  const l = raw as Partial<LevelData>;
  if (!Array.isArray(l.platforms) || !l.start || !l.exit) throw new Error("Уровень повреждён.");
  const images: Record<string, string> = {};
  for (const [k, v] of Object.entries(l.images ?? {})) {
    if (typeof v === "string" && /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(v) && v.length < 700_000) images[k] = v;
  }
  const level = normalizeLevel({
    ...(l as LevelData),
    id: `online-${id}`,
    name: String(name).slice(0, 40),
    worldWidth: num(l.worldWidth, 2400, 480, 12000),
    platforms: l.platforms.slice(0, 3000),
    spikes: (l.spikes ?? []).slice(0, 2000),
    pickups: (l.pickups ?? []).slice(0, 500),
    texts: (l.texts ?? []).slice(0, 200).map((t) => ({ ...t, text: String(t.text).slice(0, 200), size: num(t.size, 20, 10, 64) })),
    triggers: (l.triggers ?? []).slice(0, 300),
    images,
    bg: l.bg && images[l.bg] ? l.bg : undefined,
  });
  return level;
}

export async function fetchLevel(info: OnlineLevelInfo): Promise<LevelData> {
  const res = await call(`/rest/v1/levels?id=eq.${encodeURIComponent(info.id)}&select=data`);
  const rows = (await res.json()) as Array<{ data: unknown }>;
  if (!rows.length) throw new Error("Уровень не найден (возможно, удалён).");
  return sanitizeLevel(rows[0].data, info.id, info.name);
}

export async function uploadLevel(level: LevelData, author: string): Promise<void> {
  const data = JSON.stringify(level);
  if (data.length > MAX_UPLOAD_BYTES) throw new Error("Уровень слишком большой для загрузки. Уменьшите картинки или число объектов.");
  await call("/rest/v1/levels", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ name: level.name.slice(0, 40), author: author.slice(0, 24), data: JSON.parse(data) }),
  });
}

export async function likeLevel(id: string): Promise<void> {
  await call("/rest/v1/rpc/like_level", { method: "POST", body: JSON.stringify({ lid: id }) });
}
