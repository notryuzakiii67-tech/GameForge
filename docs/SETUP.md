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
2. There is no built-in administrator, hard-coded password, or backdoor. To grant an existing account the administrator role, run `npm run admin:create` while `DATABASE_URL` targets the intended database. Confirm the exact account email at the prompt. Use a trusted operator workstation for production and do not paste a production URL into Git or chat.
3. Moderators can review the game, AI-project, and report queues in the admin console. Permissions are checked again on the server; hiding an admin control in the UI is not authorization.

`npm run admin:create` only changes an existing user's role and records an audit event. It does not create or reset a password. Protect the production database connection string like an administrator credential.

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
| `AI_DAILY_LIMIT` | `5` | Per-account daily generation quota. The AI provider may impose separate limits/costs. |
| `AI_HOURLY_LIMIT` | `5` | Fixed-hour AI-generation limit per account/client-address bucket. |
| `AI_TIMEOUT_MS` | `45000` | AI-generation provider timeout; bounded by the application. |
| `DATABASE_POOL_SIZE` | `1` | Per-process PostgreSQL connection pool size. Use a provider's pooled connection URL for serverless. |

Invalid numeric resource-limit values fall back to safe application defaults. Increasing them does not override the limits imposed by Vercel or your database/storage plan.

## AI Studio (BYOK)

Choose Gemini, Mistral, or Groq, paste your own API key, load the models available to that key, and submit a prompt. The key is held in the Studio component's in-memory state and sent in the HTTPS request body for model discovery and generation. It is not saved to the GameForge database, browser storage, or audit records, and the app has no paid/shared fallback. Reloading the page clears it. Your chosen provider processes the prompt and applies its own privacy, quota, and billing policies.

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
- **AI key/model errors** — verify the selected provider, account quota, model availability, and key in that provider's console. GameForge does not silently switch providers.
- **A generated game fails validation** — ask the provider to revise the project; do not bypass validation by treating generated code as trusted.
