# Deploy GameForge on Vercel

GameForge targets **Vercel**. No Railway configuration or deployment step is required. This guide describes the deployment boundary; the repository does not provision or verify external services on your behalf.

## Production dependencies

Provision these before accepting public uploads or AI publishing:

1. **PostgreSQL** with a TLS-enabled, serverless-friendly connection URL. A provider pooler is recommended; `DATABASE_POOL_SIZE` defaults to one connection per warm function process.
2. **Private S3-compatible object storage**. GameForge uses the S3 API to write and read objects; it does not make the bucket public. The current storage adapter uses `PutObject` and `GetObject` under the `games/` prefix.
3. **Two HTTPS origins attached to the same Vercel project:** the GameForge app origin and a distinct game-content origin. For example, `https://play.example.com` and `https://games.example.com`. The content origin is essential: it keeps arbitrary published HTML/JavaScript away from the app's origin and host-only session cookie.
4. **Optional AI provider access.** Users supply their own Gemini, Mistral, or Groq keys at request time. Do not configure or ship a shared provider key.

## 1. Create and connect the Vercel project

1. Import this GitHub repository into Vercel and deploy the session branch or your chosen production branch.
2. Set the project root to the repository root. Keep the Next.js framework preset, `npm install`, and `npm run build`; these values are also recorded in `vercel.json`.
3. In the Vercel Project Settings, select a Node.js version of **22.x or newer that satisfies Node 22.13+**. `package.json` declares `node >=22.13`; the local SQLite development adapter needs the built-in `node:sqlite` module available in that runtime, while production must use PostgreSQL.
4. Confirm the Vercel plan's Node function duration and request-body limits accommodate the configured AI and upload routes. `vercel.json` sets AI generation to 60 seconds and ZIP upload/AI publishing to 30 seconds. Provider timeouts and ZIP limits are bounded in the application, but cannot override plan/platform limits.
5. Add both the app and content hostnames to this same Vercel project and complete Vercel's HTTPS/DNS verification. The content hostname must route to the same Next.js deployment so `/api/builds/...` reaches GameForge's content handler.

Use separate Vercel environments, databases, buckets, and credentials for Preview and Production. Do not point Preview uploads or migrations at production data. Public publishing in a Vercel Preview is intentionally not enabled unless that environment also has its own valid PostgreSQL database, storage credentials, and a distinct preview content origin attached to the preview deployment.

## 2. Configure PostgreSQL

- Create a production database and a TLS-enabled connection URL that Vercel Functions can reach. Prefer the provider's pooled URL for serverless workloads.
- Set the Vercel **Production** `DATABASE_URL` to a `postgres://` or `postgresql://` URL. `file:` SQLite URLs are rejected in production.
- Keep `DATABASE_POOL_SIZE` small (default `1`) and follow the database provider's connection guidance. Multiple warm Vercel instances each have their own pool.
- Apply migrations before opening traffic: from a trusted operator environment with the production connection available, run `npm run db:migrate`. The app also checks/applies migrations on first database use, but that is a safety net, not the preferred release procedure.
- Back up the database and verify a restore before inviting users. No backup plan or restore automation is created by this repository.

The migration script loads `.env.local` using Next's environment loader. For production, inject the connection string from a password manager/provider CLI or other approved secret source into the operator process; do not save it into the repository or a shared `.env.local` file.

## 3. Configure private object storage

Create a private bucket/container and a dedicated service credential. Block public access. Grant only the operations needed for objects under the `games/` prefix (currently object `GetObject` and `PutObject`); the app does not require public bucket reads. For an S3-compatible provider, set its API URL in `S3_ENDPOINT`; leave it blank for AWS S3. Set `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, and `S3_SECRET_ACCESS_KEY` as server-only environment variables.

GameForge serves stored files through `/api/builds/...`; do not return direct public bucket URLs or make the bucket public. The implementation does not currently configure lifecycle cleanup, orphan-object cleanup, or a production malware scanner.

## 4. Add the content origin

Attach a second hostname to the same Vercel project/deployment. For example:

- App: `https://play.example.com`
- Content: `https://games.example.com`

Set `GAME_CONTENT_ORIGIN` to the content origin only, with no path/query/hash. It must be HTTPS and different from `NEXT_PUBLIC_SITE_URL`. The app URL is used by mutation-origin checks and must be the exact app origin (scheme + host), without a route path.

The app returns published game URLs on `GAME_CONTENT_ORIGIN`. The content handler verifies a build is public and approved before loading it; it deliberately refuses private builds on that host. The iframe and response CSP/sandbox controls are an additional boundary, not a substitute for the separate origin. Do not configure the content origin as a cookie domain or share session cookies with it.

## 5. Set Vercel environment variables

In **Project Settings → Environment Variables**, add the following for Production, then redeploy:

```text
DATABASE_URL=postgresql://…
NEXT_PUBLIC_SITE_URL=https://play.example.com
GAME_CONTENT_ORIGIN=https://games.example.com
S3_BUCKET=…
S3_REGION=…
S3_ACCESS_KEY_ID=…
S3_SECRET_ACCESS_KEY=…
```

For a non-AWS endpoint, also set `S3_ENDPOINT`. Set optional resource limits only after checking your database, Vercel function, and storage quotas. See the complete list and defaults in [local setup](SETUP.md#environment-variables) and `.env.example`.

- Mark database/storage values as sensitive in Vercel and never prefix secrets with `NEXT_PUBLIC_`.
- Set `NEXT_PUBLIC_SITE_URL` per deployment environment. It is used to validate mutation origins; a production value will reject requests sent from a different preview hostname.
- Do not set local `LOCAL_STORAGE_DIR` as a substitute for production storage. Vercel function filesystems are not durable.
- No AI-provider environment variable is required or supported for a shared key; users provide their own keys in Studio.
- Keep `SEED_DEMO_CONTENT` unset in Production unless you intentionally choose to add clearly labeled demo records.

## 6. First administrator and migrations

After the production database is reachable, register your own account through the app. Then run `npm run admin:create` from a trusted operator environment configured with the same production `DATABASE_URL`. Confirm the exact account email when prompted. This elevates an existing account and records an audit event; it does not set a password. Do not create an administrator by adding credentials to a seed file or hard-coding a password.

Run `npm run db:migrate` against each environment before traffic is moved to that release. Verify the command reports migrations up to date. Avoid changing schema manually; if you must run an emergency database operation, document it and add a forward migration afterwards.

## 7. Deployment smoke checklist

After a deployment, verify each item against the actual deployed hostnames and services:

- [ ] The Vercel deployment reaches Ready and the home page loads on the app hostname.
- [ ] `GET /api/health` returns 200 and reports database, storage configuration, and game-content origin. **Storage status here checks configuration presence, not a real bucket read/write.**
- [ ] Register, sign in, refresh, and sign out. Confirm the production session cookie is Secure, HttpOnly, SameSite=Lax, and host-only (`__Host-gf_session`).
- [ ] Check that unauthenticated writes fail and cross-origin/missing-Origin-and-Referer mutations receive 403.
- [ ] From a test developer account, create a draft, upload a small known-safe ZIP, and submit it. Confirm it remains private/pending until a moderator approves it.
- [ ] Approve a test submission with the administrator account and verify the published game loads on the content hostname in the sandboxed player. Inspect the HTML response's CSP and `X-Content-Type-Options` headers.
- [ ] Confirm private drafts are not served from the content hostname and published URLs do not point to the object-storage bucket.
- [ ] Try an invalid ZIP and a missing/malformed AI key using a test account. Confirm the app reports a validation/provider error, not success.
- [ ] If enabling AI Studio, verify each provider/model with a test key, check provider-side quota, and confirm a reload clears the key field. Never put real keys in test fixtures or logs.
- [ ] Check Vercel function logs, PostgreSQL metrics, and storage metrics for configuration or quota errors.

The health endpoint cannot prove the storage bucket is writable, the game origin is correctly isolated in every browser, the AI provider account is active, or the full browser workflow is error-free. Those checks require the actual provisioned services and manual deployment verification.
