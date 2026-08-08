# LULU Admin & Monitoring Dashboard

Standalone Next.js dashboard for monitoring and managing the existing LULU local voice server.

The dashboard is additive. It does not modify `server.py`, the AI workflow, Whisper, Piper, ESP32 communication, or existing routes.

## Run

```powershell
cd lulu-dashboard
npm install
npm run dev
```

Open:

```text
http://localhost:3000
```

The dashboard reads the LULU server from:

```text
http://127.0.0.1:8000
```

Override it with:

```powershell
$env:LULU_API_BASE_URL="http://192.168.1.100:8000"
npm run dev
```

## Authentication

Default local dashboard password:

```text
admin
```

Override it with:

```powershell
$env:NEXT_PUBLIC_LULU_DASHBOARD_PASSWORD="your-password"
npm run dev
```

## Existing Backend Reuse

Current LULU routes inspected:

- `GET /health`
- `POST /chat`
- `GET /speak`
- `GET /audio/*`
- `GET /radio/nigeria.wav`
- `GET /radio/nigeria.pcm`
- `POST /remote/command`
- `GET /remote/next`
- `GET /remote/status`

This dashboard consumes `/health` through `src/app/api/lulu/health/route.ts`. The health check runs once when a browser page loads or refreshes. It does not poll in a loop.

Remote control uses an additive command queue:

1. Dashboard posts a command to `/api/lulu/control`.
2. The dashboard adapter forwards it to LULU server `/remote/command`.
3. The ESP32 polls `/remote/next` while idle and executes `speak`, `radio`, `stop`, or `ready`.

Management areas use local dashboard storage until equivalent backend APIs are added, so existing LULU behavior remains unchanged.

## Structure

- `src/app` - Next.js pages and API wrappers
- `src/components/dashboard` - reusable dashboard sections
- `src/components/ui` - shadcn-style UI primitives
- `src/lib` - types, mock data, browser storage helpers, API helpers
- `src/hooks` - realtime dashboard polling/event hooks
