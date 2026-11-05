import type { LevelData, LevelText, LevelTrigger } from "./levels";

export interface GameInput {
  move: number;
  jump: boolean;
  slide: boolean;
  dash: boolean;
  groundSlam: boolean;
}

export interface MoveAnim { fx: number; fy: number; tx: number; ty: number; t: number; dur: number }
export interface SpinAnim { from: number; t: number; dur: number }

/** Runtime state that triggers can change on any level object. */
export interface Dynamic {
  group?: string;
  color?: string;
  hidden?: boolean;
  mv?: MoveAnim;
  /** Visual rotation in degrees that eases back to 0 after a rotate trigger. */
  spin?: number;
  spinAnim?: SpinAnim;
  /** Very fragile floor: seconds since the player stepped on it. */
  crumbleT?: number;
  /** Turret state (see updateTurrets). */
  hp?: number;
  tcd?: number;
  aim?: number;
  aimOn?: boolean;
  locked?: boolean;
  beam?: number;
  beepT?: number;
  pulse?: number;
  flash?: number;
  hitFlash?: number;
}

export interface GameRect extends Dynamic {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Spikes only: direction the teeth point (0 up, 1 right, 2 down, 3 left). */
  dir?: 0 | 1 | 2 | 3;
  /** Platforms only: id of an image in the level's `images`. */
  skin?: string;
}

export interface GamePlatform extends GameRect {
  kind: "ground" | "platform" | "block" | "half" | "sbb" | "fragile" | "crumble" | "turret";
}

export interface GamePickup extends Dynamic {
  id: string;
  x: number;
  y: number;
  size: number;
  collected: boolean;
}

export type GameText = LevelText & Dynamic;

interface WorldCapture {
  platforms: GamePlatform[];
  spikes: GameRect[];
  pickups: GamePickup[];
  texts: GameText[];
  fired: string[];
}

export interface TrailGhost { x: number; y: number; width: number; height: number; age: number }

export interface GameEffect {
  id: number;
  x: number;
  y: number;
  kind: "dash" | "slam" | "ground-jump" | "checkpoint" | "pickup" | "death" | "damage" | "tech" | "break";
  age: number;
  duration: number;
}

export interface GamePlayer {
  x: number;
  y: number;
  vx: number;
  vy: number;
  width: number;
  height: number;
  grounded: boolean;
  facing: -1 | 1;
  sliding: boolean;
  dashing: boolean;
  slamming: boolean;
}

export interface GameSnapshot {
  player: GamePlayer;
  cameraX: number;
  viewportWidth: number;
  viewportHeight: number;
  worldWidth: number;
  worldHeight: number;
  platforms: GamePlatform[];
  spikes: GameRect[];
  pickups: GamePickup[];
  texts: GameText[];
  bg?: string;
  images: Record<string, string>;
  /** 1 right after a successful technique (Ground Jump / Slide Jump), fading to 0. */
  techFlash: number;
  techKind: "ground" | "slide" | "";
  trail: TrailGhost[];
  exit: GameRect;
  effects: GameEffect[];
  health: number;
  maxHealth: number;
  dashEnergy: number;
  maxDashEnergy: number;
  controlsLocked: boolean;
  score: number;
  deaths: number;
  complete: boolean;
  checkpointX: number;
}

const VIEW_WIDTH = 960;
const VIEW_HEIGHT = 540;
const PLAYER_WIDTH = 32;
const PLAYER_HEIGHT = 48;
const SLIDE_HEIGHT = 27;
const GRAVITY = 1900;
const MAX_HEALTH = 100;
const MAX_DASH_ENERGY = 100;
const DASH_ENERGY_COST = 34;
const MAX_SLIDE_DURATION = 5;

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

const TURRET_RANGE = 620;
const TURRET_PERIOD = 3;
const TURRET_LOCK = 0.3;
const TURRET_HP = 6;
const DASH_DAMAGE = 2; // 3 dashes destroy a turret
const SLAM_DAMAGE = 3; // 2 ground slams destroy a turret
const FRAGILE_IMPACT = 380; // landing faster than this (a jump onto it) breaks a fragile floor
const CRUMBLE_DELAY = 1;

const ease = (k: number) => {
  const c = Math.max(0, Math.min(1, k));
  return c * c * (3 - 2 * c);
};

const overlaps = (
  ax: number,
  ay: number,
  aw: number,
  ah: number,
  bx: number,
  by: number,
  bw: number,
  bh: number,
) => ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;

export class GameEngine {
  private level: LevelData;
  private platforms: GamePlatform[] = [];
  private spikes: GameRect[] = [];
  private texts: GameText[] = [];
  private triggers: LevelTrigger[] = [];
  private fired = new Set<string>();
  private inside = new Set<string>();
  private checkpointWorld: WorldCapture | null = null;
  private techTimer = 0;
  private techDuration = 0.5;
  private techKind: "ground" | "slide" | "" = "";
  private trail: TrailGhost[] = [];
  private trailTimer = 0;
  private sounds: string[] = [];
  private dashHits = new Set<string>();
  private lastLand: { p: GamePlatform; vy: number } | null = null;
  private x = 0;
  private y = 0;
  private vx = 0;
  private vy = 0;
  private width = PLAYER_WIDTH;
  private height = PLAYER_HEIGHT;
  private grounded = true;
  private facing: -1 | 1 = 1;
  private sliding = false;
  private dashing = false;
  private slamming = false;
  private dashTimer = 0;
  private dashCooldown = 0;
  private slideTimer = 0;
  private coyoteTimer = 0.1;
  private previousJump = false;
  private previousDash = false;
  private previousSlide = false;
  private previousGroundSlam = false;
  private slideJumpTimer = 0;
  private slamJumpTimer = 0;
  private checkpointX = 0;
  private cameraX = 0;
  private viewportWidth = VIEW_WIDTH;
  private score = 0;
  private deaths = 0;
  private complete = false;
  private health = MAX_HEALTH;
  private dashEnergy = MAX_DASH_ENERGY;
  private dashRegenDelay = 0;
  private hitInvulnerability = 0;
  private controlsLocked = false;
  private effectId = 0;
  private effects: GameEffect[] = [];
  private pickups: GamePickup[] = [];

  constructor(level: LevelData) {
    this.level = level;
    this.restart();
  }

  loadLevel(level: LevelData): void {
    this.level = level;
    this.restart();
  }

  setViewportAspectRatio(aspectRatio: number): void {
    if (!Number.isFinite(aspectRatio) || aspectRatio <= 0) return;
    this.viewportWidth = clamp(VIEW_HEIGHT * aspectRatio, 300, 2000);
    if (this.x === this.level.start.x && this.score === 0 && this.deaths === 0) {
      this.cameraX = this.cameraTargetX();
    } else {
      this.cameraX = clamp(this.cameraX, this.cameraMinX(), this.level.worldWidth - this.viewportWidth);
    }
  }

  step(input: GameInput, dtSeconds: number): void {
    if (this.complete) return;

    const dt = clamp(dtSeconds, 0, 1 / 30);
    if (dt === 0) return;

    this.dashCooldown = Math.max(0, this.dashCooldown - dt);
    this.hitInvulnerability = Math.max(0, this.hitInvulnerability - dt);
    this.dashRegenDelay = Math.max(0, this.dashRegenDelay - dt);
    this.slideJumpTimer = Math.max(0, this.slideJumpTimer - dt);
    this.slamJumpTimer = Math.max(0, this.slamJumpTimer - dt);
    this.techTimer = Math.max(0, this.techTimer - dt);
    this.updateWorld(dt);
    this.updateTrail(dt);
    if (this.dashRegenDelay === 0) {
      this.dashEnergy = Math.min(MAX_DASH_ENERGY, this.dashEnergy + 26 * dt);
    }
    this.coyoteTimer = this.grounded
      ? 0.11
      : Math.max(0, this.coyoteTimer - dt);
    this.effects = this.effects
      .map((effect) => ({ ...effect, age: effect.age + dt }))
      .filter((effect) => effect.age < effect.duration);

    const requestedMove = clamp(input.move, -1, 1);
    const jumpPressed = input.jump && !this.previousJump;
    const dashPressed = input.dash && !this.previousDash;
    const slidePressed = input.slide && !this.previousSlide;
    const slamPressed = input.groundSlam && !this.previousGroundSlam;
    this.previousJump = input.jump;
    this.previousDash = input.dash;
    this.previousSlide = input.slide;
    this.previousGroundSlam = input.groundSlam;

    if (!input.slide && this.sliding) this.setSliding(false);
    if (this.sliding && !this.grounded && !this.dashing) this.setSliding(false);
    if (this.sliding) {
      this.slideTimer = Math.max(0, this.slideTimer - dt);
      if (this.slideTimer === 0) this.setSliding(false);
    }

    if (this.controlsLocked) {
      if (dashPressed && this.dashEnergy >= DASH_ENERGY_COST && !this.dashing) {
        const direction = requestedMove === 0 ? this.facing : requestedMove < 0 ? -1 : 1;
        this.activateDash(direction);
      }
    } else {
      const move = requestedMove;
      if (move !== 0) this.facing = move < 0 ? -1 : 1;

      if (slidePressed && this.grounded && !this.dashing && !this.sliding) {
        this.setSliding(true);
      }

      // Right after a slam the player bounces; pressing jump during that short window is a Ground Jump.
      const slamWindow = this.slamJumpTimer > 0 && !this.slamming;
      if (jumpPressed && (this.grounded || this.coyoteTimer > 0 || slamWindow)) {
        const jumpingOutOfSlide = this.sliding;
        const boostedAfterSlam = slamWindow;
        if (this.sliding) this.setSliding(false);
        this.grounded = false;
        this.coyoteTimer = 0;
        // A Ground Jump rises roughly twice as high as a normal jump so it reads at a glance.
        this.vy = boostedAfterSlam ? -960 : -690;
        if (jumpingOutOfSlide) {
          // Preserve the slide's horizontal momentum through the jump.
          this.slideJumpTimer = 0.34;
          this.vx = clamp(this.vx, -520, 520);
          if (!boostedAfterSlam) this.startTech("slide");
        }
        if (boostedAfterSlam) {
          this.slamJumpTimer = 0;
          this.startTech("ground");
        }
        this.slamming = false;
      }

      if (
        dashPressed &&
        this.dashCooldown === 0 &&
        this.dashEnergy >= DASH_ENERGY_COST &&
        !this.dashing
      ) {
        const direction = move === 0 ? this.facing : move < 0 ? -1 : 1;
        this.activateDash(direction);
      }

      if (
        slamPressed &&
        !this.grounded &&
        !this.dashing &&
        !this.slamming
      ) {
        if (this.sliding) this.setSliding(false);
        this.slamming = true;
        this.controlsLocked = true;
        this.dashEnergy = Math.max(this.dashEnergy, DASH_ENERGY_COST);
        this.dashCooldown = 0;
        this.dashRegenDelay = 0;
        this.vy = 1180;
        this.vx = 0;
      }
    }

    if (this.dashing) {
      this.dashTimer -= dt;
      if (this.dashTimer <= 0) {
        this.dashing = false;
        this.vx = this.facing * Math.max(Math.abs(this.vx) * 0.42, 300);
      }
    } else {
      const move = this.controlsLocked ? 0 : requestedMove;
      const acceleration = this.grounded ? 2050 : 1280;
      const maxSpeed = this.sliding || this.slideJumpTimer > 0 ? 520 : 385;
      if (move !== 0) {
        this.vx += move * acceleration * dt;
      } else if (this.grounded) {
        this.vx = this.approachZero(this.vx, (this.sliding ? 280 : 2200) * dt);
      } else {
        this.vx = this.approachZero(this.vx, 165 * dt);
      }
      this.vx = clamp(this.vx, -maxSpeed, maxSpeed);
      this.vy += GRAVITY * dt;
    }

    const previousBottom = this.y + this.height;
    const previousX = this.x;
    const previousY = this.y;
    this.x = clamp(this.x + this.vx * dt, 0, this.level.worldWidth - this.width);
    this.resolveSolidsX(previousX);
    this.y += this.vy * dt;

    const landed = this.resolveLanding(previousBottom);
    if (landed) this.onLanded();
    this.resolveSolidsY(previousY);
    if (landed && this.slamming) {
      this.slamming = false;
      this.controlsLocked = false;
      this.vy = -475;
      this.grounded = false;
      // A short input window allows a stronger follow-up jump after the slam bounce.
      this.slamJumpTimer = 0.3;
      this.addEffect("slam", this.x + this.width / 2, this.y + this.height, 0.58);
    }

    if (this.y > VIEW_HEIGHT + 130) {
      this.health = 0;
      this.respawn();
      return;
    }

    const hitSpike =
      this.hitInvulnerability === 0 &&
      this.spikes.some((spike) => {
        if (spike.hidden) return false;
        const d = spike.dir ?? 0;
        const hx = d === 1 ? 0 : d === 3 ? 5 : 4;
        const hy = d === 0 ? 5 : d === 2 ? 0 : 4;
        const hw = spike.width - (d === 1 || d === 3 ? 5 : 8);
        const hh = spike.height - (d === 0 || d === 2 ? 5 : 8);
        return overlaps(this.x + 4, this.y + 3, this.width - 8, this.height - 5, spike.x + hx, spike.y + hy, hw, hh);
      });
    if (hitSpike) {
      this.health = Math.max(0, this.health - 34);
      this.hitInvulnerability = 1.15;
      if (this.sliding) this.setSliding(false);
      this.slamming = false;
      this.controlsLocked = false;
      this.dashing = false;
      this.dashTimer = 0;
      this.vx = -this.facing * 230;
      this.vy = -360;
      this.grounded = false;
      this.addEffect("damage", this.x + this.width / 2, this.y + this.height / 2, 0.42);
      if (this.health === 0) {
        this.respawn();
        return;
      }
    }

    if (this.updateTurrets(dt)) return;

    for (const pickup of this.pickups) {
      if (
        !pickup.collected &&
        !pickup.hidden &&
        overlaps(
          this.x,
          this.y,
          this.width,
          this.height,
          pickup.x - pickup.size / 2,
          pickup.y - pickup.size / 2,
          pickup.size,
          pickup.size,
        )
      ) {
        pickup.collected = true;
        this.score += 1;
        this.addEffect("pickup", pickup.x, pickup.y, 0.48);
      }
    }

    const checkpoint = this.level.checkpoint;
    if (checkpoint && this.checkpointX === 0 && this.x > checkpoint.x - 30) {
      this.checkpointX = checkpoint.x;
      this.checkpointWorld = this.captureWorld();
      this.addEffect("checkpoint", checkpoint.x, checkpoint.y - 68, 0.8);
    }

    this.updateTriggers();

    if (
      overlaps(
        this.x,
        this.y,
        this.width,
        this.height,
        this.level.exit.x,
        this.level.exit.y,
        this.level.exit.width,
        this.level.exit.height,
      )
    ) {
      this.complete = true;
    }

    const desiredCameraX = this.cameraTargetX();
    this.cameraX += (desiredCameraX - this.cameraX) * Math.min(1, dt * 12);
  }

  getSnapshot(): GameSnapshot {
    return {
      player: {
        x: this.x,
        y: this.y,
        vx: this.vx,
        vy: this.vy,
        width: this.width,
        height: this.height,
        grounded: this.grounded,
        facing: this.facing,
        sliding: this.sliding,
        dashing: this.dashing,
        slamming: this.slamming,
      },
      cameraX: this.cameraX,
      viewportWidth: this.viewportWidth,
      viewportHeight: VIEW_HEIGHT,
      worldWidth: this.level.worldWidth,
      worldHeight: VIEW_HEIGHT,
      platforms: this.platforms,
      spikes: this.spikes,
      pickups: this.pickups.map((pickup) => ({ ...pickup })),
      texts: this.texts,
      bg: this.level.bg,
      images: this.level.images ?? {},
      techFlash: this.techDuration > 0 ? this.techTimer / this.techDuration : 0,
      techKind: this.techTimer > 0 ? this.techKind : "",
      trail: this.trail.map((g) => ({ ...g })),
      exit: this.level.exit,
      effects: this.effects.map((effect) => ({ ...effect })),
      health: this.health,
      maxHealth: MAX_HEALTH,
      dashEnergy: this.dashEnergy,
      maxDashEnergy: MAX_DASH_ENERGY,
      controlsLocked: this.controlsLocked,
      score: this.score,
      deaths: this.deaths,
      complete: this.complete,
      checkpointX: this.checkpointX,
    };
  }

  private cameraMinX(): number {
    return Math.min(0, this.level.start.x + PLAYER_WIDTH / 2 - this.viewportWidth / 2);
  }

  private cameraTargetX(): number {
    return clamp(
      this.x + this.width / 2 - this.viewportWidth / 2,
      this.cameraMinX(),
      this.level.worldWidth - this.viewportWidth,
    );
  }

  restart(): void {
    this.restoreWorld(null);
    this.pickups = this.level.pickups.map((pickup) => ({ ...pickup, collected: false }));
    this.checkpointWorld = null;
    this.techTimer = 0;
    this.trail = [];
    this.x = this.level.start.x;
    this.y = this.level.start.y - PLAYER_HEIGHT;
    this.vx = 0;
    this.vy = 0;
    this.width = PLAYER_WIDTH;
    this.height = PLAYER_HEIGHT;
    this.grounded = true;
    this.facing = 1;
    this.sliding = false;
    this.dashing = false;
    this.slamming = false;
    this.controlsLocked = false;
    this.dashTimer = 0;
    this.dashCooldown = 0;
    this.slideTimer = 0;
    this.health = MAX_HEALTH;
    this.dashEnergy = MAX_DASH_ENERGY;
    this.dashRegenDelay = 0;
    this.hitInvulnerability = 0;
    this.coyoteTimer = 0.1;
    this.previousJump = false;
    this.previousDash = false;
    this.previousSlide = false;
    this.previousGroundSlam = false;
    this.slideJumpTimer = 0;
    this.slamJumpTimer = 0;
    this.checkpointX = 0;
    this.cameraX = this.cameraTargetX();
    this.score = 0;
    this.deaths = 0;
    this.complete = false;
    this.effects = [];
  }

  private resolveLanding(previousBottom: number): boolean {
    this.lastLand = null;
    if (this.vy < 0) {
      this.grounded = false;
      return false;
    }

    const currentBottom = this.y + this.height;
    const landing = this.platforms.find(
      (platform) =>
        !platform.hidden &&
        previousBottom <= platform.y + 2 &&
        currentBottom >= platform.y &&
        this.x + this.width > platform.x &&
        this.x < platform.x + platform.width,
    );

    if (!landing) {
      this.grounded = false;
      return false;
    }

    this.lastLand = { p: landing, vy: this.vy };
    this.y = landing.y - this.height;
    this.vy = 0;
    this.grounded = true;
    this.coyoteTimer = 0.11;
    return true;
  }

  private solidList(): GamePlatform[] {
    return this.platforms.filter(
      (p) => !p.hidden && (p.kind === "block" || p.kind === "half" || p.kind === "sbb" || p.kind === "turret"),
    );
  }

  private resolveSolidsX(previousX: number): void {
    for (const s of this.solidList()) {
      if (!overlaps(this.x, this.y, this.width, this.height, s.x, s.y, s.width, s.height)) continue;
      // A dash smashes through green SBB walls and chips turrets.
      if (s.kind === "sbb" && this.dashing) { this.breakPlatform(s); continue; }
      if (s.kind === "turret" && this.dashing && !this.dashHits.has(s.id)) {
        this.dashHits.add(s.id);
        this.damageTurret(s, DASH_DAMAGE);
        if (s.hidden) continue;
      }
      if (previousX + this.width <= s.x + 0.01) this.x = s.x - this.width;
      else if (previousX >= s.x + s.width - 0.01) this.x = s.x + s.width;
      else continue; // already inside vertically-resolved overlap; Y pass handles it
      this.vx = 0;
      if (this.dashing) this.dashTimer = 0;
    }
  }

  private resolveSolidsY(previousY: number): void {
    for (const s of this.solidList()) {
      if (!overlaps(this.x, this.y, this.width, this.height, s.x, s.y, s.width, s.height)) continue;
      if (this.vy < 0 && previousY >= s.y + s.height - 1) {
        this.y = s.y + s.height;
        this.vy = 0;
      } else if (this.y + this.height / 2 < s.y + s.height / 2) {
        this.y = s.y - this.height;
        this.vy = Math.min(this.vy, 0);
        this.grounded = true;
      } else {
        this.y = s.y + s.height;
        this.vy = Math.max(this.vy, 0);
      }
    }
  }

  private setSliding(sliding: boolean): void {
    if (sliding) {
      if (this.sliding) return;
      this.y += this.height - SLIDE_HEIGHT;
      this.height = SLIDE_HEIGHT;
      this.sliding = true;
      this.slideTimer = MAX_SLIDE_DURATION;
      return;
    }

    if (!this.sliding) {
      this.slideTimer = 0;
      return;
    }
    this.y -= PLAYER_HEIGHT - this.height;
    this.height = PLAYER_HEIGHT;
    this.sliding = false;
    this.slideTimer = 0;
  }

  private respawn(): void {
    this.deaths += 1;
    const cp = this.level.checkpoint;
    this.x = this.checkpointX && cp ? cp.x : this.level.start.x;
    this.y = (this.checkpointX && cp ? cp.y : this.level.start.y) - PLAYER_HEIGHT;
    this.vx = 0;
    this.vy = 0;
    this.width = PLAYER_WIDTH;
    this.height = PLAYER_HEIGHT;
    this.grounded = true;
    this.sliding = false;
    this.dashing = false;
    this.slamming = false;
    this.controlsLocked = false;
    this.dashTimer = 0;
    this.dashCooldown = 0.45;
    this.slideTimer = 0;
    this.health = MAX_HEALTH;
    this.dashEnergy = MAX_DASH_ENERGY;
    this.dashRegenDelay = 0;
    this.hitInvulnerability = 1.15;
    this.coyoteTimer = 0.1;
    this.previousJump = false;
    this.previousDash = false;
    this.previousSlide = false;
    this.previousGroundSlam = false;
    this.slideJumpTimer = 0;
    this.slamJumpTimer = 0;
    this.restoreWorld(this.checkpointWorld);
    this.techTimer = 0;
    this.trail = [];
    this.cameraX = this.cameraTargetX();
    this.addEffect("death", this.x + this.width / 2, this.y + this.height / 2, 0.55);
  }

  private activateDash(direction: -1 | 1): void {
    this.facing = direction;
    this.controlsLocked = false;
    this.dashing = true;
    this.dashHits.clear();
    this.slamming = false;
    this.dashTimer = 0.16;
    this.dashCooldown = 0.62;
    this.dashEnergy = Math.max(0, this.dashEnergy - DASH_ENERGY_COST);
    this.dashRegenDelay = 0.72;
    this.vx = direction * 900;
    this.vy = 0;
    this.addEffect("dash", this.x + this.width / 2, this.y + this.height / 2, 0.34);
  }

  // ---------- dynamic world: triggers, moving / rotating / hiding objects ----------

  private startTech(kind: "ground" | "slide"): void {
    this.techKind = kind;
    this.techDuration = kind === "ground" ? 0.85 : 0.5;
    this.techTimer = this.techDuration;
    this.trailTimer = 0;
    this.sound("tech");
    this.addEffect("tech", this.x + this.width / 2, this.y + this.height, kind === "ground" ? 0.7 : 0.5);
  }

  drainSounds(): string[] {
    const out = this.sounds;
    this.sounds = [];
    return out;
  }

  private sound(name: string): void {
    if (this.sounds.length < 16) this.sounds.push(name);
  }

  private breakPlatform(p: GamePlatform): void {
    p.hidden = true;
    this.sound("break");
    this.addEffect("break", p.x + p.width / 2, p.y + p.height / 2, 0.55);
  }

  private damageTurret(t: GamePlatform, amount: number): void {
    t.hp = (t.hp ?? TURRET_HP) - amount;
    t.hitFlash = 0.18;
    this.sound("hit");
    if (t.hp <= 0) this.breakPlatform(t);
  }

  /** Called every frame the player rests on a platform; `lastLand.vy` is the speed of the touchdown. */
  private onLanded(): void {
    const land = this.lastLand;
    if (!land) return;
    const p = land.p;
    if (p.kind === "fragile" && (this.slamming || land.vy >= FRAGILE_IMPACT)) {
      this.breakPlatform(p);
    } else if (p.kind === "crumble" && p.crumbleT === undefined) {
      p.crumbleT = 0;
      this.sound("crack");
    } else if (p.kind === "turret" && this.slamming) {
      this.damageTurret(p, SLAM_DAMAGE);
    }
  }

  /** Distance along a ray (unit direction) to a rectangle, or null if it is not hit within maxLen. */
  private rayRect(ox: number, oy: number, ux: number, uy: number, maxLen: number, rx: number, ry: number, rw: number, rh: number): number | null {
    let tmin = 0;
    let tmax = maxLen;
    const axes: Array<[number, number, number, number]> = [[ox, ux, rx, rx + rw], [oy, uy, ry, ry + rh]];
    for (const [o, d, lo, hi] of axes) {
      if (Math.abs(d) < 1e-9) {
        if (o < lo || o > hi) return null;
      } else {
        let t1 = (lo - o) / d;
        let t2 = (hi - o) / d;
        if (t1 > t2) [t1, t2] = [t2, t1];
        tmin = Math.max(tmin, t1);
        tmax = Math.min(tmax, t2);
        if (tmin > tmax) return null;
      }
    }
    return tmin;
  }

  /** How far a laser from (ox, oy) travels before something solid stops it. */
  private rayDistance(ox: number, oy: number, dx: number, dy: number, maxLen: number, exclude: GamePlatform): number {
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    let best = maxLen;
    for (const p of this.platforms) {
      if (p === exclude || p.hidden) continue;
      const t = this.rayRect(ox, oy, ux, uy, best, p.x, p.y, p.width, p.height);
      if (t !== null && t < best) best = t;
    }
    return best;
  }

  /**
   * Turrets: every 3 s they track the player (beeping, with an aim line). During the last 0.3 s the line
   * freezes, then they fire along it. Returns true when the player was killed.
   */
  private updateTurrets(dt: number): boolean {
    const px = this.x + this.width / 2;
    const py = this.y + this.height / 2;
    for (const t of this.platforms) {
      if (t.kind !== "turret" || t.hidden) continue;
      const cx = t.x + t.width / 2;
      const cy = t.y + t.height / 2;
      const dx = px - cx;
      const dy = py - cy;
      const dist = Math.hypot(dx, dy);
      if (!t.locked) {
        const seen = dist <= TURRET_RANGE && this.rayDistance(cx, cy, dx, dy, dist, t) >= dist - 1;
        if (!seen) { t.tcd = 0; t.aimOn = false; t.beepT = 0; continue; }
        t.aimOn = true;
        t.aim = Math.atan2(dy, dx);
      }
      const before = t.tcd ?? 0;
      t.tcd = before + dt;
      if (!t.locked) {
        t.beepT = (t.beepT ?? 0) - dt;
        if (t.beepT <= 0) {
          this.sound("beep");
          t.pulse = 0.09;
          // The closer to the shot, the faster it beeps.
          t.beepT = 0.55 - 0.4 * Math.min(1, t.tcd / (TURRET_PERIOD - TURRET_LOCK));
        }
        if (t.tcd >= TURRET_PERIOD - TURRET_LOCK) {
          t.locked = true;
          this.sound("lock");
        }
      }
      const ang = t.aim ?? 0;
      const ux = Math.cos(ang);
      const uy = Math.sin(ang);
      t.beam = this.rayDistance(cx, cy, ux, uy, TURRET_RANGE * 1.25, t);
      if (t.tcd >= TURRET_PERIOD) {
        const hit = this.rayRect(cx, cy, ux, uy, t.beam, this.x - 3, this.y - 3, this.width + 6, this.height + 6);
        t.flash = 0.22;
        t.tcd = 0;
        t.locked = false;
        t.aimOn = false;
        t.beepT = 0;
        this.sound("shot");
        if (hit !== null) {
          this.health = 0;
          this.respawn();
          return true;
        }
      }
    }
    return false;
  }

  private updateTrail(dt: number): void {
    this.trail = this.trail.map((g) => ({ ...g, age: g.age + dt })).filter((g) => g.age < 0.42);
    if (this.techTimer > 0) {
      this.trailTimer -= dt;
      if (this.trailTimer <= 0) {
        this.trailTimer = 0.035;
        this.trail.push({ x: this.x, y: this.y, width: this.width, height: this.height, age: 0 });
      }
    }
  }

  private buildWorld(): WorldCapture {
    return {
      platforms: this.level.platforms.map((p) => ({ ...p, hp: p.kind === "turret" ? TURRET_HP : undefined })),
      spikes: this.level.spikes.map((s) => ({ ...s })),
      pickups: this.level.pickups.map((p) => ({ ...p, collected: false })),
      texts: (this.level.texts ?? []).map((t) => ({ ...t })),
      fired: [],
    };
  }

  private captureWorld(): WorldCapture {
    return JSON.parse(
      JSON.stringify({
        platforms: this.platforms,
        spikes: this.spikes,
        pickups: this.pickups,
        texts: this.texts,
        fired: [...this.fired],
      }),
    ) as WorldCapture;
  }

  /** Put every level object back to its initial state, or to the state it had at the checkpoint. */
  private restoreWorld(from: WorldCapture | null): void {
    const collected = new Map(this.pickups.map((p) => [p.id, p.collected]));
    const base = from ? (JSON.parse(JSON.stringify(from)) as WorldCapture) : this.buildWorld();
    this.platforms = base.platforms;
    for (const p of this.platforms) {
      // Timers of half-finished crumbling or aiming never carry over a respawn.
      delete p.crumbleT; delete p.tcd; delete p.aimOn; delete p.locked; delete p.beam; delete p.beepT; delete p.pulse; delete p.flash;
    }
    this.spikes = base.spikes;
    this.texts = base.texts;
    this.pickups = base.pickups.map((p) => ({ ...p, collected: collected.get(p.id) ?? false }));
    this.triggers = this.level.triggers ?? [];
    this.fired = new Set(base.fired);
    this.inside = new Set();
  }

  private updateWorld(dt: number): void {
    const ride = this.grounded
      ? this.platforms.find(
          (p) =>
            !p.hidden &&
            p.mv &&
            Math.abs(this.y + this.height - p.y) <= 3 &&
            this.x + this.width > p.x &&
            this.x < p.x + p.width,
        )
      : undefined;
    const all: Array<GameRect | GamePickup | GameText> = [...this.platforms, ...this.spikes, ...this.pickups, ...this.texts];
    for (const o of all) {
      if (o.mv) {
        const ox = o.x;
        const oy = o.y;
        o.mv.t = Math.min(o.mv.dur, o.mv.t + dt);
        const k = ease(o.mv.t / o.mv.dur);
        o.x = o.mv.fx + (o.mv.tx - o.mv.fx) * k;
        o.y = o.mv.fy + (o.mv.ty - o.mv.fy) * k;
        if (o === ride) {
          this.x += o.x - ox;
          this.y += o.y - oy;
        }
        if (o.mv.t >= o.mv.dur) delete o.mv;
      }
      if (o.spinAnim) {
        o.spinAnim.t = Math.min(o.spinAnim.dur, o.spinAnim.t + dt);
        o.spin = o.spinAnim.from * (1 - ease(o.spinAnim.t / o.spinAnim.dur));
        if (o.spinAnim.t >= o.spinAnim.dur) {
          delete o.spinAnim;
          delete o.spin;
        }
      }
    }
    for (const p of this.platforms) {
      if (p.kind === "crumble" && !p.hidden && p.crumbleT !== undefined) {
        p.crumbleT += dt;
        if (p.crumbleT >= CRUMBLE_DELAY) this.breakPlatform(p);
      }
      if (p.hitFlash) p.hitFlash = Math.max(0, p.hitFlash - dt);
      if (p.pulse) p.pulse = Math.max(0, p.pulse - dt);
      if (p.flash) p.flash = Math.max(0, p.flash - dt);
    }
    // A moving or rotating block can end up inside the player: push out along the shortest way.
    for (const s of this.solidList()) {
      if (!overlaps(this.x, this.y, this.width, this.height, s.x, s.y, s.width, s.height)) continue;
      const left = this.x + this.width - s.x;
      const right = s.x + s.width - this.x;
      const up = this.y + this.height - s.y;
      const down = s.y + s.height - this.y;
      const m = Math.min(left, right, up, down);
      if (m === up) { this.y -= up; this.vy = Math.min(this.vy, 0); this.grounded = true; }
      else if (m === down) { this.y += down; this.vy = Math.max(this.vy, 0); }
      else if (m === left) { this.x -= left; this.vx = 0; }
      else { this.x += right; this.vx = 0; }
    }
  }

  private updateTriggers(): void {
    for (const t of this.triggers) {
      const inZone = overlaps(this.x, this.y, this.width, this.height, t.x, t.y, t.width, t.height);
      const was = this.inside.has(t.id);
      if (inZone && !was) {
        this.inside.add(t.id);
        if (!(t.once && this.fired.has(t.id))) {
          this.fired.add(t.id);
          this.fireTrigger(t);
        }
      } else if (!inZone && was) {
        this.inside.delete(t.id);
      }
    }
  }

  private fireTrigger(t: LevelTrigger): void {
    if (!t.target) return;
    const dur = Math.max(0.05, t.duration || 0.5);
    const hit = <T extends Dynamic>(list: T[]) => list.filter((o) => o.group === t.target);
    const everything: Array<GameRect | GamePickup | GameText> = [
      ...hit(this.platforms), ...hit(this.spikes), ...hit(this.pickups), ...hit(this.texts),
    ];
    if (t.action === "move") {
      for (const o of everything) o.mv = { fx: o.x, fy: o.y, tx: o.x + t.dx, ty: o.y + t.dy, t: 0, dur };
    } else if (t.action === "hide" || t.action === "show") {
      for (const o of everything) o.hidden = t.action === "hide";
    } else if (t.action === "color") {
      for (const o of everything) o.color = (t.color || undefined) as string;
    } else if (t.action === "rotate") {
      for (const o of [...hit(this.platforms), ...hit(this.spikes)]) {
        if ("kind" in o && o.kind === "ground") continue;
        const cx = o.x + o.width / 2;
        const cy = o.y + o.height / 2;
        const oldX = o.x;
        const oldY = o.y;
        const w = o.width;
        o.width = o.height;
        o.height = w;
        o.x = cx - o.width / 2;
        o.y = cy - o.height / 2;
        if (o.mv) {
          o.mv.fx += o.x - oldX; o.mv.tx += o.x - oldX;
          o.mv.fy += o.y - oldY; o.mv.ty += o.y - oldY;
        }
        if (!("kind" in o)) o.dir = (((o.dir ?? 0) + (t.angle > 0 ? 1 : 3)) % 4) as 0 | 1 | 2 | 3;
        o.spinAnim = { from: -t.angle, t: 0, dur };
        o.spin = -t.angle;
      }
    }
  }

  private addEffect(
    kind: GameEffect["kind"],
    x: number,
    y: number,
    duration: number,
  ): void {
    this.effects.push({
      id: ++this.effectId,
      x,
      y,
      kind,
      age: 0,
      duration,
    });
  }

  private approachZero(value: number, amount: number): number {
    if (Math.abs(value) <= amount) return 0;
    return value - Math.sign(value) * amount;
  }
}
