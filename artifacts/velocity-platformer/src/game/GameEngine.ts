import type { LevelData } from "./levels";

export interface GameInput {
  move: number;
  jump: boolean;
  slide: boolean;
  dash: boolean;
  groundSlam: boolean;
}

export interface GameRect {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Spikes only: direction the teeth point (0 up, 1 right, 2 down, 3 left). */
  dir?: 0 | 1 | 2 | 3;
}

export interface GamePlatform extends GameRect {
  kind: "ground" | "platform" | "block" | "half";
}

export interface GamePickup {
  id: string;
  x: number;
  y: number;
  size: number;
  collected: boolean;
}

export interface GameEffect {
  id: number;
  x: number;
  y: number;
  kind: "dash" | "slam" | "ground-jump" | "checkpoint" | "pickup" | "death" | "damage";
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
  private solids: GamePlatform[] = [];
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

      if (jumpPressed && (this.grounded || this.coyoteTimer > 0)) {
        const jumpingOutOfSlide = this.sliding;
        const boostedAfterSlam = this.grounded && this.slamJumpTimer > 0;
        if (this.sliding) this.setSliding(false);
        this.grounded = false;
        this.coyoteTimer = 0;
        this.vy = boostedAfterSlam ? -790 : -690;
        if (jumpingOutOfSlide) {
          // Preserve the slide's horizontal momentum through the jump.
          this.slideJumpTimer = 0.34;
          this.vx = clamp(this.vx, -520, 520);
        }
        if (boostedAfterSlam) {
          this.slamJumpTimer = 0;
          this.addEffect("ground-jump", this.x + this.width / 2, this.y + this.height, 0.5);
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
    this.resolveSolidsY(previousY);
    if (landed && this.slamming) {
      this.slamming = false;
      this.controlsLocked = false;
      this.vy = -475;
      this.grounded = false;
      // A short input window allows a stronger follow-up jump after the slam bounce.
      this.slamJumpTimer = 0.22;
      this.addEffect("slam", this.x + this.width / 2, this.y + this.height, 0.58);
    }

    if (this.y > VIEW_HEIGHT + 130) {
      this.health = 0;
      this.respawn();
      return;
    }

    const hitSpike =
      this.hitInvulnerability === 0 &&
      this.level.spikes.some((spike) => {
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

    for (const pickup of this.pickups) {
      if (
        !pickup.collected &&
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
      this.addEffect("checkpoint", checkpoint.x, checkpoint.y - 68, 0.8);
    }

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
      platforms: this.level.platforms,
      spikes: this.level.spikes,
      pickups: this.pickups.map((pickup) => ({ ...pickup })),
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
    this.solids = this.level.platforms.filter((p) => p.kind === "block" || p.kind === "half");
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
    this.pickups = this.level.pickups.map((pickup) => ({ ...pickup, collected: false }));
  }

  private resolveLanding(previousBottom: number): boolean {
    if (this.vy < 0) {
      this.grounded = false;
      return false;
    }

    const currentBottom = this.y + this.height;
    const landing = this.level.platforms.find(
      (platform) =>
        previousBottom <= platform.y + 2 &&
        currentBottom >= platform.y &&
        this.x + this.width > platform.x &&
        this.x < platform.x + platform.width,
    );

    if (!landing) {
      this.grounded = false;
      return false;
    }

    this.y = landing.y - this.height;
    this.vy = 0;
    this.grounded = true;
    this.coyoteTimer = 0.11;
    return true;
  }

  private resolveSolidsX(previousX: number): void {
    for (const s of this.solids) {
      if (!overlaps(this.x, this.y, this.width, this.height, s.x, s.y, s.width, s.height)) continue;
      if (previousX + this.width <= s.x + 0.01) this.x = s.x - this.width;
      else if (previousX >= s.x + s.width - 0.01) this.x = s.x + s.width;
      else continue; // already inside vertically-resolved overlap; Y pass handles it
      this.vx = 0;
      if (this.dashing) this.dashTimer = 0;
    }
  }

  private resolveSolidsY(previousY: number): void {
    for (const s of this.solids) {
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
    this.cameraX = this.cameraTargetX();
    this.addEffect("death", this.x + this.width / 2, this.y + this.height / 2, 0.55);
  }

  private activateDash(direction: -1 | 1): void {
    this.facing = direction;
    this.controlsLocked = false;
    this.dashing = true;
    this.slamming = false;
    this.dashTimer = 0.16;
    this.dashCooldown = 0.62;
    this.dashEnergy = Math.max(0, this.dashEnergy - DASH_ENERGY_COST);
    this.dashRegenDelay = 0.72;
    this.vx = direction * 900;
    this.vy = 0;
    this.addEffect("dash", this.x + this.width / 2, this.y + this.height / 2, 0.34);
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
