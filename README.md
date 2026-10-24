# Thread

An independent, accountless browser-to-browser file transfer app. React + TypeScript frontend, FastAPI signaling backend, WebRTC data channels. No file storage or relay on the application server.

## Run on your Mac

Open Terminal in this `thread` folder, then run:

```sh
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r backend/requirements.txt
sh scripts/run.sh
```

Open **http://127.0.0.1:8787**. The ZIP includes a compiled `dist` folder, so Node is only needed when changing the frontend. Keep the terminal running; Ctrl+C stops it. Python 3.12+ recommended.

Choose a file → create a private link → open the link in another browser → connect → compare codes → sender approves → recipient receives. Localhost links only work on the same computer. For sharing between devices, deploy with HTTPS as described in [DEPLOY.md](DEPLOY.md).

## Develop

Node 22.18+ or 24+, Python 3.12+:

```sh
npm ci
npm run build
python -m pip install -r backend/requirements-dev.txt
npm test
npm run test:backend
```

For frontend hot reload, run `npm run dev` in a second terminal while the backend runs. Use http://127.0.0.1:5173. Vite proxies API/WebSocket requests. `npm run preview` alone is not a complete app server.

## First-release scope

- One file and one approved recipient at a time; secret links expire after four hours or sender disconnect.
- AES-GCM encrypted signaling; WebRTC DTLS transport encryption.
- Small chunks, acknowledgements and SHA-256 integrity checks.
- Direct-to-disk downloads when the browser supports the file picker. No app size cap in that mode, but large files are not yet validated in real browsers.
- Other browsers use a **64 MiB** memory fallback and a save link after verification.
- No accounts, analytics, paid APIs, database, file upload endpoint or TURN relay.

Both devices must stay awake with tabs open. Restrictive networks may prevent connection. No resume, passwords, ZIP assembly or simultaneous recipients in v0.1. No account does not mean anonymous: peers and network providers can see IP addresses.

This is an early implementation, not a security-audited or production-validated service. See [architecture](docs/ARCHITECTURE.md), [verification](docs/VERIFICATION.md) and [deployment](DEPLOY.md).
