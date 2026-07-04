# Kapruka AI Shopping Agent

Voice and text-assisted Kapruka shopping built with Next.js and a separate Node WebSocket relay.
The browser never receives `GEMINI_API_KEY` and never calls the Kapruka MCP endpoint
directly. Gemini Flash, Gemini Live, and MCP tool calls run inside the relay.

## Requirements

- Node.js 22 LTS
- npm 10+

Use the pinned version from `.nvmrc` or `.node-version` before installing packages.

## Environment

Create `.env.local` for the Next.js app and relay:

```bash
GEMINI_API_KEY=your_gemini_key
GEMINI_TEXT_MODEL=gemini-3.5-flash
GEMINI_AUDIO_MODEL=gemini-3.5-flash
GEMINI_LIVE_MODEL=gemini-3.1-flash-live-preview
GEMINI_LIVE_ENABLED=true
# GEMINI_TEXT_ENDPOINT=https://generativelanguage.googleapis.com/v1beta/interactions
# GEMINI_LIVE_ENDPOINT=wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent
VOICE_RELAY_TOKEN_SECRET=replace_with_a_long_random_secret
VOICE_RELAY_PUBLIC_URL=ws://127.0.0.1:8787
VOICE_RELAY_PORT=8787
VOICE_RELAY_HOST=0.0.0.0
VOICE_UTTERANCE_MAX_MS=30000
LIVE_SESSION_MAX_MS=180000
MCP_ENDPOINT=https://mcp.kapruka.com/mcp
```

`VOICE_RELAY_PUBLIC_URL` is the websocket URL returned to browsers by
`POST /api/voice-session`. The route adds a short-lived signed token as a query
parameter. In local development, the session route rewrites localhost relay URLs
to the request host when the app is opened from another device on the same LAN,
so a phone using `http://<your-laptop-ip>:3000` receives
`ws://<your-laptop-ip>:8787`.

For a VPS behind Nginx and Cloudflare Tunnel, use a local relay URL with the
public path:

```bash
VOICE_RELAY_PUBLIC_URL=ws://127.0.0.1/relay
VOICE_RELAY_HOST=127.0.0.1
VOICE_RELAY_PORT=8787
VOICE_RELAY_KEEPALIVE_MS=25000
```

When the app is opened through an HTTPS Cloudflare hostname, `/api/voice-session`
rewrites this to `wss://<public-host>/relay`.

## Development

```bash
npm install
npm run dev:all
```

Open `http://localhost:3000`. Type a request or use `Tap to speak` to record
one voice request. The relay transcribes the utterance, runs the same text
shopping agent, and returns products. Use `Live Conversation` only when you need
a continuous real-time spoken discussion.

For Android or another device on the same LAN, open
`http://<your-laptop-ip>:3000`. The LAN host must be listed in
`allowedDevOrigins` in `next.config.ts` so Next.js development resources hydrate
correctly on the device. Restart `npm run dev:all` after changing that config,
and avoid running multiple Next dev servers from this worktree at the same time.
This HTTP LAN URL supports text chat, buttons, filters, cart, and checkout, but
Android Chrome will not expose the microphone on an insecure origin.

For Android voice testing, run the app and relay over local HTTPS/WSS with a
trusted development certificate:

```bash
mkdir -p .certs
mkcert -install
mkcert -key-file .certs/kapruka-local-key.pem \
  -cert-file .certs/kapruka-local.pem \
  localhost 127.0.0.1 192.168.8.107
npm run dev:secure:all
```

Then open `https://192.168.8.107:3000` on Android. Install/trust the mkcert
local CA on the phone as well; otherwise Chrome may load the page but still keep
microphone access blocked. The secure dev scripts expect the certificate files
above and start Next.js with HTTPS plus the relay with `wss://127.0.0.1:8787`.

The `dev` and `build` scripts currently run Next.js with Webpack and the SWC
WASM fallback. On this machine, the installed native `@next/swc-linux-x64-gnu`
binary exits with `Bus error (core dumped)` before Next can fall back. Remove
`NEXT_TEST_WASM=1` and `--webpack` from the scripts after native SWC works on the
target runtime.

## DigitalOcean VPS + Cloudflare Tunnel

The repo includes deployment assets for running the whole app on one Ubuntu VPS:

- `ecosystem.config.cjs` runs the Next.js app and relay with PM2.
- `deploy/nginx/k-concierge.conf` proxies `/` to Next.js and `/relay` to
  the WebSocket relay.
- `deploy/cloudflare/config.example.yml` is a starting point for a named
  Cloudflare Tunnel when you have a domain.

On the VPS:

```bash
git clone <repo-url> k-concierge
cd k-concierge
npm ci
cp .env.example .env.local
```

Edit `.env.local` with real secrets and production values:

```bash
GEMINI_API_KEY=your_gemini_key
VOICE_RELAY_TOKEN_SECRET=<long-random-secret>
VOICE_RELAY_PUBLIC_URL=ws://127.0.0.1/relay
VOICE_RELAY_HOST=127.0.0.1
VOICE_RELAY_PORT=8787
VOICE_RELAY_KEEPALIVE_MS=25000
MCP_ENDPOINT=https://mcp.kapruka.com/mcp
```

Build both runtimes:

```bash
npm run relay:build
npm run build
```

Install PM2 and start the processes:

```bash
sudo npm install -g pm2
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup systemd
```

`pm2 startup systemd` prints a `sudo ... pm2 startup ...` command. Run that
printed command once so PM2 restarts the app after a reboot.

Install the Nginx proxy:

```bash
sudo cp deploy/nginx/k-concierge.conf /etc/nginx/sites-available/k-concierge
sudo ln -sf /etc/nginx/sites-available/k-concierge /etc/nginx/sites-enabled/k-concierge
sudo nginx -t
sudo systemctl reload nginx
```

For a free temporary HTTPS link, run:

```bash
cloudflared tunnel --url http://localhost:80
```

Cloudflare will print a random `https://*.trycloudflare.com` URL. This is good
for demos and testing. For a stable hostname, create a named tunnel in
Cloudflare, adapt `deploy/cloudflare/config.example.yml`, and keep
`VOICE_RELAY_PUBLIC_URL=ws://127.0.0.1/relay` unless the relay is exposed through
a different public path.

Keep the droplet firewall tight: expose SSH as needed, and prefer Cloudflare
Tunnel for public HTTP/HTTPS access instead of opening app ports directly.

## Verification

```bash
npm run lint
npm run typecheck
npm test
npm run relay:build
npm run build
npm audit --omit=dev
```

`npm run check` runs the main static, test, relay build, and Next build checks.

## Architecture

- Next.js serves the UI and issues short-lived relay URLs from `/api/voice-session`.
- The relay validates the token and marks the websocket ready immediately.
- Typed chat uses Gemini Flash through the Interactions API. Normal voice records
  one utterance, transcribes it with Gemini audio understanding, then runs the
  same text shopping path.
- Gemini Live is optional and only starts from the explicit `Live Conversation`
  control for real-time spoken discussion.
- Both model paths use relay-owned shopping tools, and the relay calls Kapruka MCP
  server-side.
- Cart and checkout state are scoped to the current websocket session and mirrored
  to the browser through typed relay events.
- Payment-link creation is not a Gemini tool. The user must click the checkout
  button, and the relay validates cart, delivery, and returned Kapruka payment URL
  before the link reaches the UI.
