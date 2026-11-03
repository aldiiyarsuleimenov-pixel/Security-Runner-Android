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
}

export interface GamePlatform extends GameRect {
  kind: "ground" | "platform";
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
  kind: "dash" | "slam" | "checkpoint" | "pickup" | "death" | "damage";
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
const WORLD_WIDTH = 3240;
const FLOOR_Y = 458;
const PLAYER_WIDTH = 32;
const PLAYER_HEIGHT = 48;
const SLIDE_HEIGHT = 27;
const GRAVITY = 1900;
const START_X = 160;
const MAX_HEALTH = 100;
const MAX_DASH_ENERGY = 100;
const DASH_ENERGY_COST = 34;
const MAX_SLIDE_DURATION = 5;

const PLATFORMS: GamePlatform[] = [
  { id: "start", x: -1000, y: FLOOR_Y, width: 1570, height: 100, kind: "ground" },
  { id: "step-a", x: 615, y: 416, width: 118, height: 24, kind: "platform" },
  { id: "step-b", x: 778, y: 374, width: 150, height: 26, kind: "platform" },
  { id: "lower-run", x: 970, y: FLOOR_Y, width: 385, height: 100, kind: "ground" },
  { id: "upper-run", x: 1060, y: 356, width: 170, height: 24, kind: "platform" },
  { id: "high-run", x: 1280, y: 316, width: 118, height: 24, kind: "platform" },
  { id: "checkpoint-floor", x: 1410, y: FLOOR_Y, width: 440, height: 100, kind: "ground" },
  { id: "checkpoint-step", x: 1508, y: 384, width: 156, height: 24, kind: "platform" },
  { id: "sky-step", x: 1738, y: 346, width: 142, height: 24, kind: "platform" },
  { id: "mid-run", x: 1905, y: FLOOR_Y, width: 360, height: 100, kind: "ground" },
  { id: "mid-platform", x: 1972, y: 386, width: 168, height: 24, kind: "platform" },
  { id: "upper-platform", x: 2182, y: 334, width: 136, height: 24, kind: "platform" },
  { id: "last-run", x: 2320, y: FLOOR_Y, width: 920, height: 100, kind: "ground" },
  { id: "last-step", x: 2465, y: 388, width: 176, height: 24, kind: "platform" },
  { id: "finish-step", x: 2710, y: 348, width: 150, height: 24, kind: "platform" },
];

const SPIKES: GameRect[] = [
  { id: "spike-a", x: 418, y: FLOOR_Y - 25, width: 66, height: 25 },
  { id: "spike-b", x: 1090, y: FLOOR_Y - 25, width: 76, height: 25 },
  { id: "spike-c", x: 1798, y: FLOOR_Y - 25, width: 66, height: 25 },
  { id: "spike-d", x: 2020, y: FLOOR_Y - 25, width: 74, height: 25 },
  { id: "spike-e", x: 2542, y: FLOOR_Y - 25, width: 68, height: 25 },
  { id: "spike-f", x: 2940, y: FLOOR_Y - 25, width: 86, height: 25 },
];

const INITIAL_PICKUPS: GamePickup[] = [
  { id: "cell-a", x: 835, y: 334, size: 18, collected: false },
  { id: "cell-b", x: 1340, y: 274, size: 18, collected: false },
  { id: "cell-c", x: 1795, y: 304, size: 18, collected: false },
  { id: "cell-d", x: 2778, y: 306, size: 18, collected: false },
];

const EXIT: GameRect = {
  id: "exit",
  x: 3132,
  y: FLOOR_Y - 98,
  width: 52,
  height: 98,
};

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
  private x = START_X;
  private y = FLOOR_Y - PLAYER_HEIGHT;
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
  private checkpointX = 0;
  private cameraX = START_X + PLAYER_WIDTH / 2 - VIEW_WIDTH / 2;
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
  private pickups = INITIAL_PICKUPS.map((pickup) => ({ ...pickup }));

  setViewportAspectRatio(aspectRatio: number): void {
    if (!Number.isFinite(aspectRatio) || aspectRatio <= 0) return;
    this.viewportWidth = clamp(VIEW_HEIGHT * aspectRatio, 300, 2000);
    if (this.x === START_X && this.score === 0 && this.deaths === 0) {
      this.cameraX = this.cameraTargetX();
    } else {
      this.cameraX = clamp(this.cameraX, this.cameraMinX(), WORLD_WIDTH - this.viewportWidth);
    }
  }

  step(input: GameInput, dtSeconds: number): void {
    if (this.complete) return;

    const dt = clamp(dtSeconds, 0, 1 / 30);
    if (dt === 0) return;

    this.dashCooldown = Math.max(0, this.dashCooldown - dt);
    this.hitInvulnerability = Math.max(0, this.hitInvulnerability - dt);
    this.dashRegenDelay = Math.max(0, this.dashRegenDelay - dt);
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
        if (this.sliding) this.setSliding(false);
        this.grounded = false;
        this.coyoteTimer = 0;
        this.vy = -690;
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
      const maxSpeed = this.sliding ? 520 : 385;
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
    this.x = clamp(this.x + this.vx * dt, 0, WORLD_WIDTH - this.width);
    this.y += this.vy * dt;

    const landed = this.resolveLanding(previousBottom);
    if (landed && this.slamming) {
      this.slamming = false;
      this.controlsLocked = false;
      this.vy = -475;
      this.grounded = false;
      this.addEffect("slam", this.x + this.width / 2, this.y + this.height, 0.58);
    }

    if (this.y > VIEW_HEIGHT + 130) {
      this.health = 0;
      this.respawn();
      return;
    }

    const hitSpike =
      this.hitInvulnerability === 0 &&
      SPIKES.some((spike) =>
        overlaps(
          this.x + 4,
          this.y + 3,
          this.width - 8,
          this.height - 5,
          spike.x + 4,
          spike.y + 5,
          spike.width - 8,
          spike.height - 5,
        ),
      );
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

    if (this.checkpointX === 0 && this.x > 1420) {
      this.checkpointX = 1450;
      this.addEffect("checkpoint", this.checkpointX, FLOOR_Y - 68, 0.8);
    }

    if (
      overlaps(
        this.x,
        this.y,
        this.width,
        this.height,
        EXIT.x,
        EXIT.y,
        EXIT.width,
        EXIT.height,
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
      worldWidth: WORLD_WIDTH,
      worldHeight: VIEW_HEIGHT,
      platforms: PLATFORMS,
      spikes: SPIKES,
      pickups: this.pickups.map((pickup) => ({ ...pickup })),
      exit: EXIT,
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
    return Math.min(0, START_X + PLAYER_WIDTH / 2 - this.viewportWidth / 2);
  }

  private cameraTargetX(): number {
    return clamp(
      this.x + this.width / 2 - this.viewportWidth / 2,
      this.cameraMinX(),
      WORLD_WIDTH - this.viewportWidth,
    );
  }

  restart(): void {
    this.x = START_X;
    this.y = FLOOR_Y - PLAYER_HEIGHT;
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
    this.checkpointX = 0;
    this.cameraX = this.cameraTargetX();
    this.score = 0;
    this.deaths = 0;
    this.complete = false;
    this.effects = [];
    this.pickups = INITIAL_PICKUPS.map((pickup) => ({ ...pickup }));
  }

  private resolveLanding(previousBottom: number): boolean {
    if (this.vy < 0) {
      this.grounded = false;
      return false;
    }

    const currentBottom = this.y + this.height;
    const landing = PLATFORMS.find(
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
    this.x = this.checkpointX || START_X;
    this.y = FLOOR_Y - PLAYER_HEIGHT;
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
