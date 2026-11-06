import { BUNDLED_PUBLISHED, BUNDLED_STORY, STORY_LEVELS, normalizeLevel, pruneImages, type LevelData } from "./levels";

const KEY_DRAFTS = "sr-custom-levels";
const KEY_PUBLISHED = "sr-published-levels";
const KEY_ORDER = "sr-story-order";
const KEY_DONE = "sr-level1-done";
const KEY_DEV = "sr-dev-mode";

/** Change this before shipping. It is only a client-side gate, not real security. */
export const DEV_CODE = "SR-DEV-2026";

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function write(key: string, value: unknown): boolean {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
}

export const isDevMode = () => read<boolean>(KEY_DEV, false);
export const setDevMode = (on: boolean) => write(KEY_DEV, on);
export const isLevel1Done = () => read<boolean>(KEY_DONE, false);
export const markLevel1Done = () => write(KEY_DONE, true);

export const loadDrafts = () => read<LevelData[]>(KEY_DRAFTS, []).map(normalizeLevel);
/** Returns false when the device storage is full (large images are the usual cause). */
export function saveDraft(level: LevelData): boolean {
  const all = loadDrafts().filter((l) => l.id !== level.id);
  return write(KEY_DRAFTS, [...all, pruneImages(level)]);
}
export function deleteDraft(id: string) {
  write(KEY_DRAFTS, loadDrafts().filter((l) => l.id !== id));
}

export function loadPublished(): LevelData[] {
  const local = read<LevelData[]>(KEY_PUBLISHED, []).map(normalizeLevel);
  const ids = new Set(local.map((l) => l.id));
  return [...BUNDLED_PUBLISHED.map(normalizeLevel).filter((l) => !ids.has(l.id)), ...local];
}
export function publishLevel(level: LevelData): boolean {
  const local = read<LevelData[]>(KEY_PUBLISHED, []).filter((l) => l.id !== level.id);
  return write(KEY_PUBLISHED, [...local, pruneImages(level)]);
}
export function unpublishLevel(id: string) {
  write(KEY_PUBLISHED, read<LevelData[]>(KEY_PUBLISHED, []).filter((l) => l.id !== id));
  setStoryOrder(getStoryOrder().filter((x) => x !== id));
}

/** Ordered list of level ids (story ids and published custom ids). */
export function getStoryOrder(): string[] {
  const stored = read<string[] | null>(KEY_ORDER, null);
  // Players never edit the order, so they follow the one shipped with the build.
  const base = stored ?? (BUNDLED_STORY.order.length ? BUNDLED_STORY.order : STORY_LEVELS.map((l) => l.id));
  const known = new Set([...STORY_LEVELS.map((l) => l.id), ...loadPublished().map((l) => l.id)]);
  const cleaned = base.filter((id) => known.has(id));
  // Story levels can never be dropped from the sequence.
  for (const l of STORY_LEVELS) if (!cleaned.includes(l.id)) cleaned.push(l.id);
  return cleaned;
}
export const setStoryOrder = (order: string[]) => write(KEY_ORDER, order);

export function findLevel(id: string): LevelData | undefined {
  return STORY_LEVELS.find((l) => l.id === id) ?? loadPublished().find((l) => l.id === id) ?? loadDrafts().find((l) => l.id === id);
}
export function storySequence(): LevelData[] {
  return getStoryOrder().map(findLevel).filter((l): l is LevelData => !!l);
}

/** Text for game/bundledStory.json: every published level plus the story order, ready to paste into that file. */
export function exportStoryFile(): string {
  return JSON.stringify({ levels: loadPublished(), order: getStoryOrder() });
}

// ---------- records, style, online helpers ----------
const KEY_PB = "sr-pb";
const KEY_STYLE_BEST = "sr-style-best";
const KEY_CLEARED = "sr-cleared-levels";
const KEY_TEST_FP = "sr-tested-fp";
const KEY_NAME = "sr-player-name";
const KEY_LIKED = "sr-liked";

export const isCleared = (levelId: string) => read<string[]>(KEY_CLEARED, []).includes(levelId);
export const getPB = (levelId: string): number | undefined => read<Record<string, number>>(KEY_PB, {})[levelId];

export interface RunResult { newPB: boolean; pb: number; firstClear: boolean; newBestStyle: boolean; bestStyle: number | undefined }

/** Stores the time / style of a finished run and reports what improved. */
export function recordRun(levelId: string, time: number, style: number, styleActive: boolean): RunResult {
  const firstClear = !isCleared(levelId);
  if (firstClear) write(KEY_CLEARED, [...read<string[]>(KEY_CLEARED, []), levelId]);
  const pbs = read<Record<string, number>>(KEY_PB, {});
  const newPB = pbs[levelId] === undefined || time < pbs[levelId];
  if (newPB) { pbs[levelId] = time; write(KEY_PB, pbs); }
  const best = read<Record<string, number>>(KEY_STYLE_BEST, {});
  const newBestStyle = styleActive && (best[levelId] === undefined || style > best[levelId]);
  if (newBestStyle) { best[levelId] = style; write(KEY_STYLE_BEST, best); }
  return { newPB, pb: pbs[levelId], firstClear, newBestStyle, bestStyle: best[levelId] };
}

/** Short hash of everything that affects how a level plays (not its name or images). */
export function levelFingerprint(l: LevelData): string {
  const text = JSON.stringify([l.worldWidth, l.start, l.checkpoint, l.exit, l.platforms, l.spikes, l.pickups, l.texts, l.triggers]);
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0;
  return `${text.length}:${h}`;
}
/** The author has to beat the level in test mode before it can be shared online. */
export function markTestCleared(l: LevelData) {
  write(KEY_TEST_FP, { ...read<Record<string, string>>(KEY_TEST_FP, {}), [l.id]: levelFingerprint(l) });
}
export const wasTestCleared = (l: LevelData) => read<Record<string, string>>(KEY_TEST_FP, {})[l.id] === levelFingerprint(l);

export const getPlayerName = () => read<string>(KEY_NAME, "");
export const setPlayerName = (name: string) => write(KEY_NAME, name);
export const hasLiked = (id: string) => read<string[]>(KEY_LIKED, []).includes(id);
export const markLiked = (id: string) => write(KEY_LIKED, [...read<string[]>(KEY_LIKED, []), id]);
