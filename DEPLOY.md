# Public hosting without buying a domain

The app can use a provider's HTTPS subdomain. A Linktree page can point to it, but cannot run the FastAPI/WebSocket service itself.

## Render free web service

1. Put the contents of this folder in your own GitHub repository. Do not commit `.env`, `.venv`, `node_modules` or local test output.
2. Create a Render **Web Service** from that repository. Select the **Docker** runtime and **Free** instance. Use this folder as the root directory if it lives below the repository root.
3. Obtain the service's assigned `https://...onrender.com` URL. Set environment variable `ALLOWED_ORIGINS` to that exact origin (no trailing path). Set `STUN_URLS=stun:stun.cloudflare.com:3478`.
4. Deploy/redeploy. The Docker image builds the frontend and serves it with FastAPI. No separate frontend host, database, disk or paid relay is needed. `render.yaml` is an optional Blueprint equivalent; supply the origin when prompted and update it to the assigned URL.
5. Open `/api/health` and check `ok: true`. Open the home page, then test a real transfer between two devices on different networks. Check downloaded bytes match the original. Test decline, cancellation, a broken link and a mobile browser.

No deployment has been made for you. Docker and the public host configuration have not been executed in this development session.

## Cost boundaries

Checked 24 October 2026: Render documents free web services, an `onrender.com` address, 750 free instance hours per workspace each month, and sleep after 15 idle minutes. Other usage quotas also apply; free hosting is not unlimited or guaranteed forever. Stay on Free, avoid paid add-ons and check billing controls before enabling any payment method. Cold starts can exceed the app's connection timeout: wait for the home page/service to wake, then retry.

Official references: https://render.com/docs/free and https://render.com/docs/web-services

Cloudflare documents its STUN service as free. STUN only helps discover routes; no TURN file relay is configured. This cannot guarantee connections from every network. Reference: https://developers.cloudflare.com/realtime/turn/faq/

## Operations

Run **one process/worker and one replica**: rooms live in process memory. Restarting the server loses rooms. HTTPS/WSS is required outside localhost. Never use `ALLOWED_ORIGINS=*`. Keep origins limited to your actual app URL.

Uvicorn only trusts its configured proxy addresses. If rate limits group users behind the hosting proxy, configure `FORWARDED_ALLOW_IPS` to that provider's trusted proxy addresses after checking its network setup. Do not blindly trust all forwarded headers on an internet-reachable origin. This implementation limits rooms/connections and messages but still needs deployment-specific abuse/load testing.

Application access logs are disabled by the run commands; the hosting provider may retain logs. Link fragments stay out of HTTP requests, but browser history, screenshots or forwarded messages can expose links. Do not add analytics to share pages.
