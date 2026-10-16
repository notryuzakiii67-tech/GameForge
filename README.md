# GameForge

**PLAY. CREATE. PUBLISH. DISCOVER.**

GameForge is a browser-game platform MVP built with Next.js App Router, React, and TypeScript. It combines public game discovery and playback, real account-backed creator workflows, ZIP uploads, AI-assisted browser-game authoring, and moderation. The deployment target is **Vercel**.

This repository contains an implementation, not a production deployment. Production PostgreSQL, private object storage, the isolated game-content hostname, provider accounts/keys, and Vercel environment settings must be provisioned by the operator. Unconfigured production dependencies fail closed; see the [deployment guide](docs/VERCEL.md).

## Ten delivery phases

1. **Repository audit, platform foundation, and game catalog** — inspect the existing app, retain the working catalog, and audit candidate games and dependencies.
2. **Gameplay and publishing** — verify playable mechanics and keep user-game drafts, versions, moderation, and release states persistent.
3. **Username/password authentication and profile security** — optional-email signup, username login, password hashing, safe sessions, and role/ownership checks.
4. **Forgot password and recovery settings** — verified email recovery is implemented conditionally; provider setup is still required, and SMS is not implemented.
5. **AI Game Studio and providers** — Gemini-default Studio with server-side Gemini → Mistral → Groq quota fallback, private projects, preview, versioning, and moderated submission; provider keys stay server-side and fallback can send prompts to another external provider. No live provider is configured here.
6. **AI Asset Studio and chatbox uploads** — partially implemented: private uploads, server-side validation, owner-scoped preview/delete, progress, and metadata-only AI prompt attachments exist; asset generation and binary-to-AI input are not implemented.
7. **Asset import and placeholder replacement** — partially implemented: version-scoped private bindings, placeholder resolution in previews and ZIP exports, and safe public-sharing blocks; format-specific replacement adapters remain.
8. **Community Asset Store and moderation** — not implemented; the game catalog is not an Asset Store.
9. **Storage and production infrastructure** — game-storage/security foundations exist, but production services and asset-specific storage are not provisioned.
10. **Tests, deployment, and honest reporting** — local verification passes for implemented paths; deployment/provider/asset acceptance checks remain open.

This phase list follows the uploaded master prompt and is a status-aware scope summary, not a claim that all ten phases are complete. See the [phase-by-phase audit](docs/PHASES.md) for completed, partial, blocked, and unimplemented requirements. AI availability, game upload/publishing, database durability, and production-origin isolation still depend on correctly configured external services.

## Requirements

- Node.js **22.13 or newer** (the app uses the built-in `node:sqlite` module for local development).
- npm.
- For production: a PostgreSQL service, an S3-compatible object-storage bucket, a separate HTTPS game-content hostname attached to the same Vercel project, and (optionally) a user-owned key for a supported AI provider.

## Local setup

```bash
npm install
cp .env.example .env.local
npm run db:migrate
npm run db:seed        # optional: adds labeled starter builds with verification notes
npm run dev
```

Open `http://localhost:3000`. Local development defaults to SQLite at `.gameforge-local/gameforge.sqlite` and ignored local file storage at `.gameforge-local/storage`. These are **not** durable production services. The app also applies pending migrations when it first accesses the database; running `db:migrate` explicitly is useful for setup and deployment checks.

Register a normal account in the app. There is no default admin account or password. To grant moderator access to an existing account in a trusted environment, set `DATABASE_URL` for the intended database and run `npm run admin:create`; the script requires an exact username confirmation and changes only the role. Never commit a production connection string or run this against the wrong database.

See [local setup and operations](docs/SETUP.md) for configuration details and supported workflows.

## Verification commands

```bash
npm test
npm run typecheck
npm run build
```

The tests cover ZIP/path/resource validation, generated-project validation, AI provider request/error handling, private asset validation and upload routes, migration/persistence/rate limits, and mutation-origin checks. Passing these checks is not equivalent to production-service, deployment, or full browser/device verification.

## Product boundaries

- Public uploads and AI-created games are **untrusted browser code**. ZIP checks are structural and size/type focused; they are not antivirus scanning, a code audit, or a runtime test.
- Published games require PostgreSQL, object storage, and a dedicated content origin in production. Local disk storage is for local development only.
- Private Asset Studio accepts structurally validated PNG/JPEG/WebP, self-contained glTF 2.0/GLB 2.0, PCM/IEEE-float WAV, and OGG Vorbis/Opus uploads. It is not malware scanning. AI prompts receive selected filenames, validated metadata, and asset UUID placeholders—not file bytes. Private bindings are versioned and delivered through short-lived preview grants; ZIP export resolves them to local relative files. Format-specific scene/sprite replacement and public asset publishing, rights/license review, and moderation remain unimplemented.
- AI API keys must be configured by the operator as server-only `GEMINI_API_KEY`, `MISTRAL_API_KEY`, and/or `GROQ_API_KEY`. Gemini is the UI default; quota/rate-limit fallback tries later configured providers in Gemini → Mistral → Groq order. A fallback may send the prompt and selected metadata to another external provider. Provider quotas, pricing, and availability are account-specific; no key is configured or externally tested in this workspace.
- Email contact verification and password recovery require server-side `ACCOUNT_RECOVERY_SECRET`, `RESEND_API_KEY`, and a Resend-verified `GAMEFORGE_EMAIL_FROM`; none is configured or externally tested in this workspace. Registration still needs no email, and only a previously verified email may be used for recovery. SMS recovery and OAuth are not implemented.
- Multiplayer, active game-jam operations, payments/ads, automatic malware scanning, and broad enterprise moderation tooling are not included in this MVP.

## Documentation

- [Local setup and operations](docs/SETUP.md)
- [Security model and checklist](docs/SECURITY.md)
- [Vercel deployment](docs/VERCEL.md)
- [Ten-phase scope and verification status](docs/PHASES.md)
- [Game candidate, license, and verification audit](docs/game-candidate-audit.md)
- [Third-party software notices](THIRD_PARTY_NOTICES.md)
