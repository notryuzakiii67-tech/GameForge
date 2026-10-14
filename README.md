# GameForge

**PLAY. CREATE. PUBLISH. DISCOVER.**

GameForge is a browser-game platform MVP built with Next.js App Router, React, and TypeScript. It combines public game discovery and playback, real account-backed creator workflows, ZIP uploads, AI-assisted browser-game authoring, and moderation. The deployment target is **Vercel**.

This repository contains an implementation, not a production deployment. Production PostgreSQL, private object storage, the isolated game-content hostname, provider accounts/keys, and Vercel environment settings must be provisioned by the operator. Unconfigured production dependencies fail closed; see the [deployment guide](docs/VERCEL.md).

## Ten delivery phases

1. **Platform foundation** — responsive Next.js application, shared design system, navigation, and page shells.
2. **Persistent data layer** — SQLite for local development, PostgreSQL for production, versioned SQL migrations, and database-backed rate limits.
3. **Accounts and roles** — bcrypt password hashes, random opaque sessions stored as hashes, HttpOnly cookies, account status checks, and server-side role authorization.
4. **Discovery** — searchable/filterable game catalog, game details, developer profiles, and starter examples that are explicitly labeled as demos.
5. **Creator workspace and uploads** — saved drafts, profiles, validated ZIP builds, version records, and moderated publishing submissions.
6. **Isolated gameplay** — sandboxed iframes, content security policy, and a separate production content origin for untrusted published builds.
7. **Community basics** — database-backed favorites, ratings, reviews, follows, and report submission/moderation.
8. **AI Studio** — Gemini, Mistral, and Groq BYOK; model discovery; generated/edited drafts; preview, version history, restore, remix, and moderated publication.
9. **Safety and verification** — input validation, ownership/role checks, upload limits, provider timeouts, shared rate limits, and automated tests.
10. **Vercel readiness and operator docs** — Vercel configuration, environment template, setup, security, and deployment guidance.

These phases describe the implementation scope in this codebase, not ten externally verified production releases. AI availability, game upload/publishing, database durability, and the security of the production hostname depend on correctly configured external services.

## Requirements

- Node.js **22.13 or newer** (the app uses the built-in `node:sqlite` module for local development).
- npm.
- For production: a PostgreSQL service, an S3-compatible object-storage bucket, a separate HTTPS game-content hostname attached to the same Vercel project, and (optionally) a user-owned key for a supported AI provider.

## Local setup

```bash
npm install
cp .env.example .env.local
npm run db:migrate
npm run db:seed        # optional: adds clearly labeled, playable demo games
npm run dev
```

Open `http://localhost:3000`. Local development defaults to SQLite at `.gameforge-local/gameforge.sqlite` and ignored local file storage at `.gameforge-local/storage`. These are **not** durable production services. The app also applies pending migrations when it first accesses the database; running `db:migrate` explicitly is useful for setup and deployment checks.

Register a normal account in the app. There is no default admin account or password. To grant moderator access to an existing account in a trusted environment, set `DATABASE_URL` for the intended database and run `npm run admin:create`; the script requires an exact email confirmation and changes only the role. Never commit a production connection string or run this against the wrong database.

See [local setup and operations](docs/SETUP.md) for configuration details and supported workflows.

## Verification commands

```bash
npm test
npm run typecheck
npm run build
```

The tests cover ZIP/path/resource validation, generated-project validation, AI provider request/error handling, database migrations/persistence/rate limits, and mutation-origin checks. Passing these checks is not equivalent to production-service, deployment, or end-to-end browser verification.

## Product boundaries

- Public uploads and AI-created games are **untrusted browser code**. ZIP checks are structural and size/type focused; they are not antivirus scanning, a code audit, or a runtime test.
- Published games require PostgreSQL, object storage, and a dedicated content origin in production. Local disk storage is for local development only.
- AI API keys are entered in the Studio and sent with each provider request. GameForge does not provide a shared or paid fallback key.
- Email verification/recovery, OAuth, multiplayer, active game-jam operations, payments/ads, automatic malware scanning, and broad enterprise moderation tooling are not included in this MVP.

## Documentation

- [Local setup and operations](docs/SETUP.md)
- [Security model and checklist](docs/SECURITY.md)
- [Vercel deployment](docs/VERCEL.md)
- [Ten-phase scope and verification status](docs/PHASES.md)
