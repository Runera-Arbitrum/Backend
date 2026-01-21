# Runera Backend

Minimal backend for RUNERA MVP+++ using Express + Prisma + PostgreSQL.

## Requirements

- Node.js 18+ (LTS recommended)
- PostgreSQL 14+ (tested with Postgres 18)

## Quick Start (Windows / PowerShell)

```powershell
cd e:\HACKATHON\backend
copy .env.example .env
# edit .env and set DATABASE_URL

npm install
npx prisma generate
npx prisma migrate dev --name init
npm run dev
```

Backend will start on `http://localhost:4000`.

## Environment Variables

Create `backend/.env`:

```env
DATABASE_URL="postgresql://runera_app:password@localhost:5432/runera?schema=public"
PORT=4000
CORS_ORIGIN="http://localhost:3000"
```

Notes:
- If your password contains special characters, URL-encode them.
- `CORS_ORIGIN="*"` is allowed for local dev, but use a specific origin in production.

## Database Setup (PostgreSQL)

From `psql` as `postgres`:

```sql
CREATE DATABASE runera;
CREATE USER runera_app WITH PASSWORD 'runera';
GRANT ALL PRIVILEGES ON DATABASE runera TO runera_app;
\c runera
GRANT ALL ON SCHEMA public TO runera_app;
```

If `runera_app` already exists:

```sql
ALTER USER runera_app WITH PASSWORD 'runera';
```

Prisma `migrate dev` needs permission to create a shadow database. If you see
P3014, run:

```sql
ALTER USER runera_app CREATEDB;
```

## Scripts

```bash
npm run dev             # start server with watch
npm run start           # start server (no watch)
npm run prisma:migrate  # prisma migrate dev
npm run prisma:generate # prisma generate
```

## Endpoints (current)

- `GET /health` -> `{ "status": "ok" }`
- `POST /run/submit` -> submit a run to the backend

### POST /run/submit

Request:
```json
{
  "walletAddress": "0x1111111111111111111111111111111111111111",
  "distanceMeters": 5000,
  "durationSeconds": 1800,
  "startTime": "2025-01-12T11:30:00Z",
  "endTime": "2025-01-12T12:00:00Z",
  "deviceHash": "dev123"
}
```

Response:
```json
{
  "runId": "cuid",
  "status": "VERIFIED",
  "reasonCode": null
}
```

Full API reference is in `backend/API_SPEC.md`.

## Project Structure

```
backend/
  prisma/
    schema.prisma
    migrations/
  src/
    server.js
    prisma.js
  API_SPEC.md
  .env.example
  package.json
```

## Troubleshooting

- P1000 "Authentication failed":
  Check `DATABASE_URL` username/password. Verify with `psql` login.
- P3014 "shadow database":
  Grant `CREATEDB` to `runera_app` or set a `SHADOW_DATABASE_URL`.
- Prisma engine missing:
  Reinstall dependencies: delete `node_modules` and run `npm install`.

## Notes

- Auth is not enforced yet for `/run/submit`. This is for local dev only.
- Prisma models live in `prisma/schema.prisma`.
