# Thread: first working release

Scope: independent React/TypeScript + FastAPI implementation; one file, one recipient per share at a time, no file relay. Temporary rooms, encrypted signaling, sender approval, bounded binary chunks, per-chunk SHA-256 integrity, receiver acknowledgements, disk streaming or a clearly bounded 64 MiB memory fallback. Cancel, stop sharing and errors are real actions.

Advanced resume, passwords, ZIP and multi-recipient fan-out are deferred until this core has evidence. No untested feature toggles.

Checks: backend origin/limits/room ownership/cleanup tests; crypto and framing tests; production TypeScript/build; local two-browser end-to-end hash equality, empty file, cancellation and bad secret; responsive UI inspection.

Budget: no paid services or automatic upgrades. Sites' Workers runtime cannot run the chosen FastAPI backend; this milestone produces a locally runnable project and configurations for free hosting. No public availability claimed until a deployed backend is verified.

# Taste decisions
Achromatic ledger, seed 2109443949. Quiet off-white application canvas, white transfer surface, dark primary control. Signature: the Thread mark is a single line joining two endpoints; the same connection path reflects actual peer state. Data blue only for real progress. Actual files and measured bytes only, no sample transfer history or vanity counters. Screen question: 'How do I send this file, and did it arrive?'
Use an open-plane sidebar for send/help/privacy views, with a compact mobile menu and no account or workspace. Fonts self-hosted to avoid third-party requests on a secret-link page. Sparse density, accessible focus and honest empty/error states.
