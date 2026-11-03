import { BUNDLED_PUBLISHED, STORY_LEVELS, type LevelData } from "./levels";

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
function write(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage is optional */ }
}

export const isDevMode = () => read<boolean>(KEY_DEV, false);
export const setDevMode = (on: boolean) => write(KEY_DEV, on);
export const isLevel1Done = () => read<boolean>(KEY_DONE, false);
export const markLevel1Done = () => write(KEY_DONE, true);

export const loadDrafts = () => read<LevelData[]>(KEY_DRAFTS, []);
export function saveDraft(level: LevelData) {
  const all = loadDrafts().filter((l) => l.id !== level.id);
  write(KEY_DRAFTS, [...all, level]);
}
export function deleteDraft(id: string) {
  write(KEY_DRAFTS, loadDrafts().filter((l) => l.id !== id));
}

export function loadPublished(): LevelData[] {
  const local = read<LevelData[]>(KEY_PUBLISHED, []);
  const ids = new Set(local.map((l) => l.id));
  return [...BUNDLED_PUBLISHED.filter((l) => !ids.has(l.id)), ...local];
}
export function publishLevel(level: LevelData) {
  const local = read<LevelData[]>(KEY_PUBLISHED, []).filter((l) => l.id !== level.id);
  write(KEY_PUBLISHED, [...local, level]);
}
export function unpublishLevel(id: string) {
  write(KEY_PUBLISHED, read<LevelData[]>(KEY_PUBLISHED, []).filter((l) => l.id !== id));
  setStoryOrder(getStoryOrder().filter((x) => x !== id));
}

/** Ordered list of level ids (story ids and published custom ids). */
export function getStoryOrder(): string[] {
  const stored = read<string[] | null>(KEY_ORDER, null);
  const base = stored ?? STORY_LEVELS.map((l) => l.id);
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
