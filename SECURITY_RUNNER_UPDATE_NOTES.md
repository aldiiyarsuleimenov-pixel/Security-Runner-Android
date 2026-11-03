# Security Runner update notes

## Implemented in this update
- Slide Jump: jumping during a slide keeps horizontal momentum (up to the slide speed cap) for a short follow-through window.
- Ground Jump: jump input during the 0.22s Ground Slam rebound window applies a stronger vertical impulse and a cyan effect.
- Level Creator UI: grid-based placement for blocks, half-blocks, spikes, springs, moving-platform markers, and checkpoints.
- Local level save/edit: level metadata and placed cells are stored in browser/device localStorage.
- Community list: published levels are listed separately from the campaign.
- Developer panel: the supplied developer code unlocks editing/publishing and campaign inclusion flags.
- Campaign completion gate: the community menu is gated until the current built-in campaign stage reports completion.

## Important limitations
- This project currently contains one hard-coded campaign stage. The community gate therefore uses completion of that shipped stage as the current campaign-complete condition.
- Editor props and saved level data are authored and persisted, but the current gameplay engine still uses its existing hard-coded collision map. This update does not yet convert saved grid levels into playable runtime maps.
- "Add to story" stores a developer-controlled campaign inclusion flag; campaign sequencing/runtime loading of those custom maps still requires a follow-up engine integration.
- Level data is local to the browser/device (localStorage), not synced to GitHub or other devices.
- The developer code is a client-side convenience gate, not secure authentication. It can be discovered in the app bundle and should not be used to protect valuable server-side operations.

## Build
Use the repository's existing pnpm workflow and GitHub Actions Android workflow. A successful ZIP integrity check is not a substitute for a full Android build.
