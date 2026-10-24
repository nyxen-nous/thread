# Thread transfer illustration

The “How it works” page has a laptop-and-phone Anatomy SVG illustration.
A private connection, six small file pieces, a receiving progress bar and a
completion check explain sharing without making claims about a live session.
The device geometry has a shared isometric camera, a detailed keyboard,
trackpad, display, camera, phone rim and side buttons. Colours follow Thread’s
quiet light theme with a restrained sage accent.

The figure loads on demand. It adds no service, analytics, WebGL dependency
or change to the transfer protocol. Native buttons select steps and pause or
resume playback at the same position. The loop stops outside the viewport and
in hidden tabs. Reduced motion shows static, selectable states.

## Editing

- `frontend/src/anatomy/TransferFigure.tsx`: controls, SVG display and playback.
- `frontend/src/anatomy/model.ts`: single timeline for progress and file pieces.
- `frontend/src/anatomy/transfer-figure.css`: responsive layout and theme.
- `scripts/build-anatomy.mjs`: device parts, projection and connecting curve.
- `frontend/src/anatomy/art.ts`: generated paths; regenerate rather than editing.

Run `npm run build:anatomy`, then `npm run build` after changing geometry.
The vendored SVG kit and core stylesheet come from
[wheresryan22/anatomy](https://github.com/wheresryan22/anatomy), under the MIT
license in `scripts/anatomy/LICENSE`. No installed skill is needed to build
or deploy the repository.

## Validation

The production TypeScript/Vite build and all 14 existing protocol/transfer
tests pass. Timeline checks verify bounded motion, six arrivals and completion
only after every piece arrives. Device geometry was inspected with offline
vector rendering. Browser preview, mobile screenshots and the browser-based
Anatomy line-end audit remain unverified because browser execution and local
previews were blocked in the implementation session. Before publishing, check
“How it works” on desktop and mobile, pause/resume and reduced motion.
