# How Thread works

1. The sender selects a browser File. The service creates an ephemeral room; the browser generates a 256-bit secret and appends it after `#` in the share URL.
2. The recipient opens that URL. The fragment is not part of HTTP requests. The browsers derive an AES-GCM key with HKDF and exchange encrypted signaling through WebSocket. Session/role binding and sequence counters reject crossed or replayed messages.
3. The recipient proves possession of the link key. Both screens show a short comparison code. The sender explicitly approves before connection negotiation.
4. WebRTC negotiates a direct route, aided by STUN. It encrypts the data channel using DTLS. No TURN relay is configured.
5. The sender sends metadata over the data channel, then reads the selected file in small chunks. Each binary frame carries an offset and SHA-256 digest. The receiver validates ordering and hashes, writes the chunk and acknowledges it. Backpressure limits unacknowledged data.
6. A final digest chain and byte/chunk counts are verified. The destination closes before confirming success. In memory mode success means the bytes are ready for the user to save, not that a disk save has occurred.

## Source map

- `backend/app.py`: temporary rooms, approval coordination, opaque signaling, origin and rate limits.
- `frontend/src/session.ts`: secret links, signaling, WebRTC and UI state.
- `crypto.ts`: key derivation, encryption and digest helpers.
- `protocol.ts`: control/frame validation and size bounds.
- `transfer.ts`: chunks, acknowledgements, integrity, timeouts and cancellation.
- `storage.ts`: file picker streaming and bounded memory fallback.
- `App.tsx` / `styles.css`: sender, receiver, help and privacy UI.

## Threat model and limits

The signaling host sees IP addresses, room IDs, timing and ciphertext. STUN and peers see network metadata. A passive signaling observer should not see file names or file bytes. A compromised app host can serve malicious JavaScript and steal link keys: browser encryption cannot fix that. This code has not had independent cryptographic/security review.

An integrity digest checks transferred bytes; it is not identity verification, antivirus or proof of safety. People with the full link can request approval. The comparison code is useful only if compared over a trusted separate channel.

Room lifetime is four hours from creation, not an inactivity timer. Closing/reloading a tab or losing the connection requires a fresh transfer. Backend limits are 100 rooms and 250 sockets per process. Disk streaming is browser-dependent; memory fallback is capped at 64 MiB. Multiple gigabyte transfers and real internet interoperability remain unverified.
