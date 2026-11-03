import type { GamePlatform, GameRect } from "./GameEngine";

export interface LevelPickup {
  id: string;
  x: number;
  y: number;
  size: number;
}

export interface LevelData {
  id: string;
  name: string;
  worldWidth: number;
  /** Player start: x is the left edge, y is the floor line the player stands on. */
  start: { x: number; y: number };
  /** Optional checkpoint: x is the trigger/spawn position, y the floor line. */
  checkpoint?: { x: number; y: number };
  exit: GameRect;
  /** ground/platform are one-way landings; block/half are fully solid. */
  platforms: GamePlatform[];
  spikes: GameRect[];
  pickups: LevelPickup[];
}

export const GRID = 24;
export const FLOOR_Y = 458;
export const EXIT_WIDTH = 52;
export const EXIT_HEIGHT = 98;

const p = (id: string, x: number, y: number, width: number, height: number, kind: GamePlatform["kind"]): GamePlatform => ({
  id, x, y, width, height, kind,
});
const spike = (id: string, x: number, width: number): GameRect => ({
  id, x, y: FLOOR_Y - 25, width, height: 25,
});

export const LEVEL_1: LevelData = {
  id: "story-1",
  name: "Прорыв вперёд",
  worldWidth: 3240,
  start: { x: 160, y: FLOOR_Y },
  checkpoint: { x: 1450, y: FLOOR_Y },
  exit: { id: "exit", x: 3132, y: FLOOR_Y - EXIT_HEIGHT, width: EXIT_WIDTH, height: EXIT_HEIGHT },
  platforms: [
    p("start", -1000, FLOOR_Y, 1570, 100, "ground"),
    p("step-a", 615, 416, 118, 24, "platform"),
    p("step-b", 778, 374, 150, 26, "platform"),
    p("lower-run", 970, FLOOR_Y, 385, 100, "ground"),
    p("upper-run", 1060, 356, 170, 24, "platform"),
    p("high-run", 1280, 316, 118, 24, "platform"),
    p("checkpoint-floor", 1410, FLOOR_Y, 440, 100, "ground"),
    p("checkpoint-step", 1508, 384, 156, 24, "platform"),
    p("sky-step", 1738, 346, 142, 24, "platform"),
    p("mid-run", 1905, FLOOR_Y, 360, 100, "ground"),
    p("mid-platform", 1972, 386, 168, 24, "platform"),
    p("upper-platform", 2182, 334, 136, 24, "platform"),
    p("last-run", 2320, FLOOR_Y, 920, 100, "ground"),
    p("last-step", 2465, 388, 176, 24, "platform"),
    p("finish-step", 2710, 348, 150, 24, "platform"),
  ],
  spikes: [
    spike("spike-a", 418, 66),
    spike("spike-b", 1090, 76),
    spike("spike-c", 1798, 66),
    spike("spike-d", 2020, 74),
    spike("spike-e", 2542, 68),
    spike("spike-f", 2940, 86),
  ],
  pickups: [
    { id: "cell-a", x: 835, y: 334, size: 18 },
    { id: "cell-b", x: 1340, y: 274, size: 18 },
    { id: "cell-c", x: 1795, y: 304, size: 18 },
    { id: "cell-d", x: 2778, y: 306, size: 18 },
  ],
};

/** Story levels shipped with the game, in default order. */
export const STORY_LEVELS: LevelData[] = [LEVEL_1];

/** Levels the developer published and bundled into the build (paste exported JSON here). */
export const BUNDLED_PUBLISHED: LevelData[] = [];

export function blankLevel(): LevelData {
  const id = `custom-${Date.now().toString(36)}`;
  return {
    id,
    name: "Новый уровень",
    worldWidth: 2400,
    start: { x: 96, y: FLOOR_Y },
    exit: { id: "exit", x: 2400 - 144, y: FLOOR_Y - EXIT_HEIGHT, width: EXIT_WIDTH, height: EXIT_HEIGHT },
    platforms: [p("g0", -1000, FLOOR_Y, 1000 + 2400, 100, "ground")],
    spikes: [],
    pickups: [],
  };
}
