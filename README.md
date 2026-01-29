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

## Frontend Team: Clone & Run Backend Locally

Use this when the frontend team needs the backend running on their laptop.

### 1) Clone backend repo

```bash
git clone <BACKEND_REPO_URL>
cd backend
```

### 2) Install dependencies

```bash
npm install
```

### 3) Configure environment

```bash
copy .env.example .env
```

Fill in `.env` with:
- Local database URL
- Latest deployed contract addresses
- Backend signer private key (the wallet that has BACKEND_SIGNER_ROLE)

Example:

```env
DATABASE_URL="postgresql://runera_app:runera@localhost:5432/runera?schema=public"
PORT=4000
CORS_ORIGIN="http://localhost:3000"
JWT_SECRET="replace-with-a-long-random-string"
CHAIN_ID=84532
RPC_URL="https://sepolia.base.org"
API_BASE_URL="http://localhost:4000"
PROFILE_NFT_ADDRESS="0x725d729107C4bC61f3665CE1C813CbcEC7214343"
ACHIEVEMENT_NFT_ADDRESS="0x6941280D4aaFe1FC8Fe07506B50Aff541a1B8bD9"
EVENT_REGISTRY_ADDRESS="0xbb426df3f52701CcC82d0C771D6B3Ef5210db471"
BACKEND_SIGNER_PRIVATE_KEY="0x..."
XP_PER_VERIFIED_RUN=100
```

### 4) Database + Prisma

```bash
npx prisma generate
npx prisma migrate dev --name init
```

### 5) Run backend

```bash
npm run dev
```

Backend will be available at `http://localhost:4000`.

### 6) Frontend integration

Set frontend env:
```
NEXT_PUBLIC_API_URL=http://localhost:4000
```

Then frontend can:
- `POST /run/submit` to get `onchainSync`
- `GET /profile/:address/metadata` for profile NFT metadata

## Environment Variables

Create `backend/.env`:

```env
DATABASE_URL="postgresql://runera_app:password@localhost:5432/runera?schema=public"
PORT=4000
CORS_ORIGIN="http://localhost:3000"
JWT_SECRET="replace-with-a-long-random-string"
CHAIN_ID=84532
RPC_URL="https://sepolia.base.org"
API_BASE_URL="http://localhost:4000"
PROFILE_NFT_ADDRESS="0x..."
ACHIEVEMENT_NFT_ADDRESS="0x..."
EVENT_REGISTRY_ADDRESS="0x..."
BACKEND_SIGNER_PRIVATE_KEY="0x..."
XP_PER_VERIFIED_RUN=100
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
- `GET /profile/:address/metadata` -> profile NFT metadata JSON

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

## Event IDs (bytes32)

Smart contracts expect `eventId` as a `bytes32` hex string (66 chars with 0x prefix).
If you store events in DB, use the same `0x...` string value.

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
