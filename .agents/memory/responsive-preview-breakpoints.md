---
name: Responsive preview breakpoints
description: Mobile-sized app previews may not report touch-only hover capabilities.
---

For responsive game UI, key portrait and landscape layouts and touch-control visibility off viewport dimensions and orientation, not `(hover: none)` alone. The app preview browser can show phone-sized viewports while still reporting hover support, which hides essential mobile controls if they depend only on touch capability.

**Why:** A phone-sized landscape preview did not activate touch controls until the layout query used viewport size and orientation.

**How to apply:** Use width, height, and orientation as the primary responsive guards; reserve hover capability queries for optional styling.
