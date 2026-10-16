# Local setup and operations

## Prerequisites

- Node.js 22.13+ and npm.
- A supported AI account/key only if you want to use AI Studio.

No external database or bucket is needed to run locally: the default configuration uses SQLite and ignored local files. Those development conveniences are not suitable for Vercel production.

## Start locally

```bash
npm install
cp .env.example .env.local
npm run db:migrate
npm run db:seed        # optional starter content
npm run dev
```

Visit `http://localhost:3000`. `npm run db:migrate`, `npm run db:seed`, and `npm run admin:create` load `.env.local` through Next's environment loader. The app also applies migrations when it first uses the database. Local database files and uploaded builds are written under `.gameforge-local/`, which is excluded from Git.

To start with an empty catalog, skip `npm run db:seed`. Seeded games are labeled as demos and use checked-in static HTML examples; they do not represent user uploads. The seed script refuses to seed in production unless `SEED_DEMO_CONTENT=1` is deliberately set.

Check local readiness at `http://localhost:3000/api/health`. A local 200 response confirms the database is reachable and reports which storage mode is configured; it does not exercise a real production bucket.

## Accounts and moderation

1. Register a normal account in the app. Passwords are bcrypt-hashed; sessions are random, opaque tokens stored as hashes in the database.
2. There is no built-in administrator, hard-coded password, or backdoor. To grant an existing account the administrator role, run `npm run admin:create` while `DATABASE_URL` targets the intended database. Confirm the exact account username at the prompt. Use a trusted operator workstation for production and do not paste a production URL into Git or chat.
3. Moderators can review the game, AI-project, and report queues in the admin console. Permissions are checked again on the server; hiding an admin control in the UI is not authorization.

`npm run admin:create` only changes an existing user's role and records an audit event. It does not create or reset a password. Protect the production database connection string like an administrator credential.

## Email verification and password recovery

Email verification and password recovery are available only when all of the following server-side settings are configured: `ACCOUNT_RECOVERY_SECRET` (at least 32 random bytes encoded as hex), `RESEND_API_KEY`, and `GAMEFORGE_EMAIL_FROM` (a sender address verified with Resend). Copy `.env.example` for the names and use `openssl rand -hex 32` to generate a secret. Never add these values to `NEXT_PUBLIC_` variables, a prompt, a client bundle, or Git.

Registration remains username-first; an email is optional and is not verified during signup. A user must re-enter their current password to add/change an email, then enter the code sent to that address. Password recovery accepts only an email address that was already verified; a username-only or unverified contact cannot reset a password. Recovery-start responses do not reveal whether an account exists. SMS/phone recovery is not implemented. When the secret/provider configuration is absent, the routes report that recovery is unavailable and do not simulate delivery. No live Resend delivery has been verified in this workspace.

## Environment variables

Copy `.env.example` and set values as appropriate. The local defaults are shown below; production requirements are in the [Vercel guide](VERCEL.md).

| Variable | Local default | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | `file:.gameforge-local/gameforge.sqlite` | SQLite locally; must be PostgreSQL in production. |
| `NEXT_PUBLIC_SITE_URL` | `http://localhost:3000` | Canonical app origin used by same-origin mutation checks. Set the exact deployment origin in Vercel. |
| `GAME_CONTENT_ORIGIN` | empty | Required in production for publishing. A separate HTTPS hostname, attached to the same Vercel deployment, used to serve untrusted builds. |
| `S3_ENDPOINT` | empty | Optional custom S3-compatible API endpoint; leave empty for AWS S3. |
| `S3_BUCKET` | empty | Private bucket/container name. |
| `S3_REGION` | `us-east-1` | Storage region required by the S3 client. |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | empty | Server-only storage credentials. Never use a `NEXT_PUBLIC_` prefix. |
| `LOCAL_STORAGE_DIR` | `.gameforge-local/storage` | Local-only disk storage; Vercel filesystems are not durable. |
| `MAX_UPLOAD_BYTES` | `4194304` | Compressed ZIP upload cap (4 MiB by default). Vercel request-body limits still apply. |
| `MAX_EXPANDED_BYTES` | `41943040` | Expanded ZIP cap (40 MiB by default). |
| `MAX_ARCHIVE_FILES` | `300` | Maximum archive entries. |
| `MAX_GAME_VERSIONS` | `8` | Maximum retained uploaded build versions per game. |
| `MAX_AI_VERSIONS` | `20` | Maximum AI Studio versions per project. |
| `MAX_ASSET_BYTES` | `20971520` | Per-file private asset cap (20 MiB default, application maximum 50 MiB). |
| `ASSET_USER_QUOTA_BYTES` | `104857600` | Per-account quota for active private assets (100 MiB default, maximum 2 GiB). |
| `ASSET_MAX_PER_USER` | `100` | Per-account active asset count (default 100, maximum 500). |
| `AI_DAILY_LIMIT` | `5` | Per-account daily generation quota. The AI provider may impose separate limits/costs. |
| `AI_HOURLY_LIMIT` | `5` | Fixed-hour AI-generation limit per account/client-address bucket. |
| `AI_TIMEOUT_MS` | `45000` | AI-generation provider timeout; bounded by the application. |
| `GEMINI_API_KEY` | unset | Optional Gemini key used only by server-side AI routes. |
| `MISTRAL_API_KEY` | unset | Optional Mistral key used only by server-side AI routes. |
| `GROQ_API_KEY` | unset | Optional Groq key used only by server-side AI routes. |
| `AI_MISTRAL_FALLBACK_MODEL` | unset | Optional preferred Mistral model ID for quota fallback; must be returned by the configured key, otherwise the first discovered generative model is used. |
| `AI_GROQ_FALLBACK_MODEL` | unset | Optional preferred Groq model ID for quota fallback; must be returned by the configured key, otherwise the first discovered generative model is used. |
| `ACCOUNT_RECOVERY_SECRET` | unset | Server-only HMAC secret; generate at least 32 random bytes as hex. Required to verify contact and recovery codes. |
| `RESEND_API_KEY` | unset | Server-only Resend key used to deliver verification and recovery email. |
| `GAMEFORGE_EMAIL_FROM` | unset | Sender email address verified with Resend. |
| `DATABASE_POOL_SIZE` | `1` | Per-process PostgreSQL connection pool size. Use a provider's pooled connection URL for serverless. |

Invalid numeric resource-limit values fall back to safe application defaults. Increasing them does not override the limits imposed by Vercel or your database/storage plan.

## Private Asset Studio (Phase 6 foundation)

Signed-in users can upload files at `/assets`, review their private library, preview approved formats, and delete their own assets. Accepted extensions are PNG/JPEG/WebP; GLB and self-contained glTF 2.0 with embedded buffers and supported PNG/JPEG/WebP textures; PCM/IEEE-float WAV; and OGG Vorbis/Opus. SVG, OBJ/FBX, archives, video, external model URLs, Draco/meshopt-compressed models, and other formats are rejected. Image dimensions are limited to 16,384 pixels per side and 100 megapixels. These structural checks and browser previews are not malware scanning or a complete media decoder.

Each account defaults to 100 MiB and 100 active assets; the defaults can be adjusted with the server-only `ASSET_USER_QUOTA_BYTES` and `ASSET_MAX_PER_USER` values, capped in code at 2 GiB and 500 assets. Individual size defaults to 20 MiB, configurable with `MAX_ASSET_BYTES` up to 50 MiB. Upload intents expire after 10 minutes; S3-compatible direct uploads use a five-minute presigned POST policy that restricts the uploaded object to the exact declared size. A completed upload is read back by the server, inspected, hashed, and only then listed as ready.

Local development writes private files below `LOCAL_STORAGE_DIR`. Production must use a private S3-compatible bucket. Validated objects are owner-scoped under `assets/private/`; short-lived uploads land under `assets/pending/` and are promoted server-side to the private key after validation. A replayed presigned form can therefore never overwrite a validated preview. Previews stream through authenticated `/api/assets/{id}/file` responses with `private, no-store` caching, `nosniff`, and owner checks. Never enable public bucket access. The S3-compatible bucket CORS policy must allow `POST` from the exact deployed GameForge app origin (and only the separate preview origins you operate); do not use `*` in production. The service credential needs scoped `PutObject`, `HeadObject`, `GetObject`, and `DeleteObject` access under `assets/private/` in addition to the game-build prefix. The code expires pending intents when that same account starts another upload; a scheduled orphan sweeper is not implemented yet.

The AI Studio can attach up to six private assets as prompt context. Selected filenames, validated structural metadata, and opaque asset UUID placeholders may be sent to the selected AI provider and, after a quota/rate-limit response, to a configured fallback provider; private binary contents, storage keys, and private preview URLs are not sent. Selected files bind to that saved project version. Studio preview uses a 15-minute project/version-scoped bearer grant stored as a hash and renewed while the preview stays open; private bytes are size/hash-checked and returned no-store. ZIP exports include the bound files and resolve placeholders to relative archive paths. Binding changes create a new version and preserve earlier associations. Public sharing/game submissions are blocked while private bindings or unresolved placeholders remain. Format-specific scene/sprite adapters, AI asset generation, public Asset Store, public rights/license declarations, moderation/appeals/takedowns, malware/conversion service, and scheduled cleanup remain unimplemented.

## AI Studio (server-configured providers)

The Studio defaults to Gemini. It does not accept API keys from browser clients. An operator may configure `GEMINI_API_KEY`, `MISTRAL_API_KEY`, and/or `GROQ_API_KEY` as server-only environment variables. If a provider responds with a quota/rate-limit error, GameForge tries the remaining configured providers in this order: **Gemini → Mistral → Groq**. When using Mistral or Groq as a fallback, an optional `AI_MISTRAL_FALLBACK_MODEL` or `AI_GROQ_FALLBACK_MODEL` selects a preferred model ID; it must be available to that key or the first discovered generative model is selected. When model discovery itself is rate-limited, the Studio can select the fallback provider and list its models; during generation, the actual provider/model used is saved in project history and reported in the response/UI. A manually selected provider only falls through to providers later in the chain.

Fallback is conditional, not a promise of free quota, capacity, or success: a fallback key must be configured and valid, the provider must expose a usable model, and that account may have its own limits or charges. If fallback is used, the prompt and selected private-asset metadata may be sent to more than one external provider (for example, the selected provider may have already received the generation request before returning a quota error). Review each provider's privacy, retention, data-handling, quota, and billing terms before enabling its server key. The application does not return keys to the browser or save them in project data/audit records. No provider key is configured or externally tested in this workspace; local tests mock provider responses.

Generation requires a signed-in account and available GameForge quota. The provider must accept the key and model, and the generated project must pass path, file-size, entry-point, static resource, and JavaScript syntax checks. These checks do not run the game or guarantee it works. See [security notes](SECURITY.md).

## Useful commands

```bash
npm test
npm run typecheck
npm run build
npm run db:migrate
npm run db:seed
npm run admin:create
```

Before production deploys, apply migrations explicitly against the intended production `DATABASE_URL` from a trusted environment (`npm run db:migrate`) and verify the active schema. First-request migrations exist as a safety net, not as a substitute for a controlled release process. Never use the local SQLite path in production.

## Troubleshooting

- **`DATABASE_NOT_CONFIGURED` / 503** — set the Vercel Production `DATABASE_URL` to PostgreSQL and redeploy; local SQLite is rejected when `NODE_ENV=production`.
- **Publishing says storage is not configured** — set all required S3 variables, then configure `GAME_CONTENT_ORIGIN` as a distinct HTTPS origin. The publish flow intentionally returns a service-unavailable error until those are valid.
- **Email recovery returns 503** — set `ACCOUNT_RECOVERY_SECRET`, `RESEND_API_KEY`, and a Resend-verified `GAMEFORGE_EMAIL_FROM` in the server environment; redeploy/restart, then test with an account whose email you have verified. No code is returned by the app if delivery fails.
- **AI provider not configured** — set the matching server-only `GEMINI_API_KEY`, `MISTRAL_API_KEY`, or `GROQ_API_KEY`, then restart/redeploy. Gemini is the default; only provider quota/rate-limit errors trigger ordered fallback to later configured providers (Gemini → Mistral → Groq). Missing/invalid primary configuration is not treated as quota exhaustion. If the fallback chain is exhausted, verify each configured key, usable model, provider quota, and billing account. Fallback can send a prompt to another external provider; see the disclosure above.
- **A generated game fails validation** — ask the provider to revise the project; do not bypass validation by treating generated code as trusted.
