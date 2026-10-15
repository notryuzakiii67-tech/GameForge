# Security model

This document describes the protections present in the MVP and the controls an operator still needs to provide. It is not a security certification or a claim that user content is risk-free.

## Trust boundaries

- **GameForge application server:** handles account sessions, database access, provider requests, and upload validation. Database and S3 credentials are server-only environment variables.
- **User-uploaded and AI-generated game content:** treated as untrusted. The app validates file structure but never executes a game on the application server. Games run in the visitor's browser.
- **AI providers:** receive the prompt and user-supplied key when AI features are used. Each provider has its own privacy, retention, billing, and quota policies.
- **Production content host:** must be a different HTTPS origin from the application host. It serves public published builds and must not share the app's host-only session cookie.

## Implemented controls

### Accounts and authorization

- Passwords are hashed with bcrypt (cost factor 12); no default administrator or hard-coded credentials are created.
- A session uses a random 32-byte opaque token. Only its SHA-256 hash is stored in the database. The cookie is `HttpOnly`, `SameSite=Lax`, `Secure` in production, path `/`, and expires after 14 days. Production uses the `__Host-gf_session` prefix, which requires a host-only Secure cookie.
- Account status and role are checked server-side. Project/game ownership is checked in API routes; administrator and moderator actions require an authorized role.
- Mutating browser routes require an `Origin` or `Referer`. In production, its origin must match `NEXT_PUBLIC_SITE_URL` (or the request origin when that variable is unset). In non-production only, a mismatch may be accepted when it matches the request's forwarded host/protocol, allowing local reverse-proxy previews. Missing, malformed, and cross-origin sources are rejected. Configure the canonical site URL separately for Vercel Production and Preview deployments.
- User input is validated with Zod, API JSON bodies have a size limit, SQL values are parameterized, and rate-limit counters are persisted in the shared database.

### ZIP uploads and publishing

- The archive is inspected before extraction. The validator rejects malformed/multi-disk/ZIP64/encrypted archives, unsupported compression, duplicate/unsafe paths, hidden paths, symlinks and special files, disallowed extensions, missing HTML entry points, and configured count/size overages.
- Defaults are 4 MiB compressed, 40 MiB expanded, 300 archive entries, and 20 MiB per file. Operators may configure limits, but the host's request-body, memory, timeout, and plan limits still apply.
- The accepted files are written to configured storage; the application does not run build scripts, shell commands, or uploaded JavaScript on the server.
- New game submissions are private and pending until an administrator approves them. The public build route serves only published public games; private drafts are restricted to their owner or an authorized moderator on the app origin. The configured game-content origin deliberately returns 404 for private builds.
- Production publishing fails with a clear service-unavailable response unless PostgreSQL, complete S3 credentials, and a separate HTTPS `GAME_CONTENT_ORIGIN` are configured.

Structural validation is **not** antivirus scanning, a malware scan, a human code review, or proof that a game runs correctly. Moderators should inspect submissions and use a disposable browser profile for suspicious content.

### Browser isolation

- Game players use an iframe `sandbox` without `allow-same-origin`, top-navigation, popups, or unrestricted storage permissions. The response also includes a restrictive Content Security Policy, `X-Content-Type-Options: nosniff`, and explicit MIME types.
- Bundled demo resources use `Cross-Origin-Resource-Policy: cross-origin` because a sandboxed document has an opaque origin; `same-site` would block the game from loading its own CSS and JavaScript. This policy does not grant DOM/storage access or add iframe permissions. Demo CSP still sets `connect-src 'none'`, and the iframe does not grant `allow-same-origin`.
- Published games are served from the dedicated production content origin. Production auth cookies use the `__Host-` prefix and do not domain-share with that host.
- The game CSP blocks external connections and limits scripts, frames, forms, and resource types. Local development may serve games on the app origin; the separate-host boundary is a **production requirement**.

A browser sandbox is not a complete resource-isolation system. It cannot guarantee protection from CPU/memory exhaustion, deceptive in-frame content, user-initiated downloads, browser vulnerabilities, or all browser-specific behaviors. Users should keep browsers current and avoid treating unknown games as trusted.

### AI provider keys and output

- The Studio stores the key only in component memory and submits it in the request body for model discovery and generation. There is no key field in the database schema, audit data, or AI-generation record.
- Provider selection is an enum mapped to fixed official API hosts; callers cannot supply a URL. Requests use timeouts and bounded response reads, and provider errors are translated without returning raw provider bodies.
- Application error logs record a request ID and error type, not the request body, prompt, or API key. The key is not intentionally logged by GameForge code. Network intermediaries and the selected AI provider remain separate trust parties; use HTTPS and review their terms.
- Generated projects have path, extension, size, entry-point, external-reference, and JavaScript syntax checks. Syntax checking compiles JavaScript but does **not** execute it. Generated games remain untrusted and are previewed in a sandbox.
- There is no shared or paid fallback. Users are responsible for their provider's usage charges and terms. Per-account daily quotas and account/client-address request limits reduce accidental or abusive usage but are not a provider billing cap.

## Production operator checklist

- [ ] Set `DATABASE_URL` to PostgreSQL with TLS; use a serverless-friendly pooled URL and small `DATABASE_POOL_SIZE`.
- [ ] Back up PostgreSQL and test a restore; keep migrations controlled and apply `npm run db:migrate` before sending traffic to a release.
- [ ] Set all `S3_*` values as encrypted server-only Vercel environment variables. Keep the bucket private/block public access; grant only the required object read/write actions to the game-build prefix.
- [ ] Attach the app and game-content domains to the same Vercel project. Configure `NEXT_PUBLIC_SITE_URL` and `GAME_CONTENT_ORIGIN` as separate HTTPS origins and verify the latter is never an app-cookie domain.
- [ ] Select a supported Node.js runtime version (22.13+), confirm Vercel function durations/body-size limits against configured upload and AI limits, and protect Production, Preview, and Development environments separately.
- [ ] Create the first admin through the interactive `npm run admin:create` script from a trusted operator environment; do not add an admin password or role to a seed fixture.
- [ ] Use unique credentials per environment, rotate/revoke provider and storage keys promptly if exposed, and monitor database/storage/hosting logs.
- [ ] Verify backup retention, resource quotas, and an incident contact before inviting public uploads.

## Known gaps and moderation boundaries

- Email verification, password recovery/reset, OAuth, MFA, and account self-service credential rotation are not implemented.
- ZIP validation does not scan malware; generated project validation does not prove safe or correct runtime behavior.
- The MVP admin console reviews pending game/project submissions and reports. For a non-demo game or AI-project report, moderators can explicitly take down a public/pending item; GameForge marks it removed/private and refuses future platform playback while retaining stored files for review. Merely marking a report actioned does not remove its target. Bundled starter demos are deployment assets and require a deployment update for removal. A site administrator can suspend/restore reported user accounts with an audit note or restore suspended users from a dedicated queue; status changes, session revocation on suspension, and audit notes are committed together. Active-admin decisions are serialized to protect administrator availability; self-suspension and suspending the last active admin are blocked. There is no appeal workflow or storage-file deletion.
- There is no automated malware scanner, user-content sandbox service, database backup/restore automation, object lifecycle/orphan cleanup, or production alerting configured by this repository.

If a key is suspected exposed, revoke it with its provider immediately. For a reported non-demo game or AI project, use the admin report action “Take down & action”; this hides the target from GameForge listings and blocks future build responses but retains storage objects and cannot revoke copies already downloaded by visitors. Bundled starter demos need a deployment update to remove. For a broader content incident, restrict the affected content origin or bucket access at the hosting/storage layer. Site administrators can suspend users from a report and restore them from a report or the suspended-accounts queue; there is no appeal workflow or stored-file deletion control. Document and test the response process before enabling broad public uploads.
