---
name: Movement-control semantics
description: User-specified platformer behavior for ground slam, dash, slide, touch controls, and camera tracking.
---

Ground slam disables steering and jumping only while the player is descending. Landing restores control automatically; dash may cancel the lock before landing. Do not keep the lock after impact.

Slide is a temporary sprint with a five-second maximum per press. Holding the button must not restart the timer automatically; release is required before starting another slide.

Jump, dash, slide, and ground-slam touch buttons are independent controls that can be positioned separately. Keep the player near the center of the camera view, including at the start where the level allows it.

**Why:** The user corrected an earlier interpretation of the ground-slam lock and specified the intended movement.

**How to apply:** Preserve these behaviors when changing game input, slide timing, touchscreen layout, or camera tracking.
