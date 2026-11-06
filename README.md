# Marial-LouNews (MLN)

Kenya & East Africa news portal: a static frontend served by an Express backend that stores
articles in Supabase, plus an admin console and an automated wire feed (RSS ingest).

```
backend/     Express API, session auth, RSS ingest worker (ESM)
frontend/    index.html (site), admin.html (newsroom console)
supabase/    schema.sql — one-time DDL for all tables
```

## Run locally

```bash
cd backend
npm install
npm run dev          
```
`npm run add-admin -- <email> <password> "<name>"`
creates a newsroom login.

## Configuration

`backend/.env` (git-ignored; never commit real values):

| Variable | Purpose |
| --- | --- |
| `SUPABASE_URL` | Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only key, bypasses RLS |
| `SUPABASE_ANON_KEY` | Public key (reserved for per-user clients) |
| `JWT_SECRET` | Signs the `admin_session` cookie |
| `PORT` | Defaults to `3000` |
| `RSS_FETCH_CRON` | Ingest schedule, default `*/20 * * * *` |
| `RSS_RETENTION_DAYS` | Wire item retention, default `30` |

## Database

Apply `supabase/schema.sql` to create `articles`, `admins`, `rss_sources` and `rss_articles`.
Wire headlines are deduped per feed on `(source_id, guid)`.

## API

Public — `GET /api/articles`, `GET /api/articles/:id`, `GET /api/auth/login|me|logout`,
`GET /api/rss?source=&category=&q=&page=&limit=`, `GET /api/rss/sources`.

Authenticated (cookie session) — `POST/PUT/DELETE /api/articles/:id`, and under
`/api/admin/rss`: `GET/POST /sources`, `PUT/DELETE /sources/:id`,
`POST /sources/:id/ingest`, `POST /ingest`.

## Wire feed

`backend/rss-ingest.js` polls every active `rss_sources` row on a schedule (and on demand from
the admin console), stores short excerpts, and the homepage renders them under **From the Wire**
with links out to the publishing site. Add only feeds whose publisher you are licensed to carry.
