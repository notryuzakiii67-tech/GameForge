# Security model

This document describes the protections present in the MVP and the controls an operator still needs to provide. It is not a security certification or a claim that user content is risk-free.

## Trust boundaries

- **GameForge application server:** handles account sessions, database access, provider requests, and upload validation. Database and S3 credentials are server-only environment variables.
- **User-uploaded and AI-generated content:** treated as untrusted. The app validates structure but never executes a game on the application server. Game builds run in the visitor's browser; private media assets are served only through owner-authenticated routes.
- **AI providers:** receive prompts and generated project context when the server-side integration is used. Provider credentials come from server-only environment variables; providers apply their own privacy, retention, billing, and quota policies.
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

### Individual private assets

- Asset uploads accept only PNG/JPEG/WebP, self-contained glTF 2.0/GLB 2.0 with embedded resources, PCM/IEEE-float WAV, and OGG Vorbis/Opus. File signatures, structural lengths, format fields, CRCs where supported, image dimensions, embedded model references, and bounded model complexity are checked; extension/MIME metadata alone is not trusted. This does not fully decode every media codec or scan for malware.
- Default limits are 20 MiB/file, 100 MiB per account, and 100 active assets. Server-configured values are bounded. S3 uploads use a five-minute presigned POST policy bound to one owner-scoped `assets/pending/` key, exact file size, binary content type, and private cache metadata. Completion reads the staged object, rechecks size, inspects the content, writes the validated bytes to a separate `assets/private/` key, and records a SHA-256 digest before it can be listed as ready; replaying an unexpired POST cannot overwrite the final preview.
- The object bucket remains private. Uploads use `assets/private/{ownerId}/{assetId}` keys; no public URL or unauthenticated bucket read is returned. Listing, deletion, and `/api/assets/{id}/file` require the authenticated owner. Cross-owner access is hidden as 404. File responses verify stored size and SHA-256 content integrity, then use `private, no-store`, explicit validated MIME types, `nosniff`, a same-origin resource policy, and a restrictive CSP.
- The Asset Studio renders only the supported image/audio formats in browser-native controls and self-contained GLB/glTF through the pinned Three.js loader. External model resources are rejected by validation. Preview parsing still occurs in a browser process; browser decoder/WebGL vulnerabilities and resource exhaustion are not eliminated.
- AI Game Studio can attach up to six user-selected assets as prompt references. It sends filenames, measured validation metadata, and opaque asset UUIDs/placeholders to the chosen external provider; it does not send file bytes, storage keys, or private preview URLs. Selected assets are bound to the saved project version. Preview resolution uses a random 32-byte bearer token whose hash is stored server-side, scoped to one project/version, expires after 15 minutes, and grants only bound private asset reads. Preview responses are private/no-store, size/hash-checked, and do not rely on account cookies; the UI renews the grant while the preview is open. ZIP export includes only the owner’s bound files and rewrites placeholders to relative paths. Public sharing/game submission are blocked while private bindings or unresolved asset placeholders remain.
- A pending intent expires after 10 minutes and direct S3 POST signatures expire after five. When a user starts a later upload, the service closes that user's expired pending rows and attempts to delete their objects. There is no scheduled/global orphan sweeper, so operators must monitor/clean abandoned S3 objects and should apply a suitable bucket lifecycle/monitoring policy.

### Public Asset Store (Phase 8 limited foundation)

- Assets remain private unless the owner submits them. Submission requires an asserted rights basis, attribution, a supported license (CC BY 4.0, CC BY-SA 4.0, or CC0 1.0), confirmation of ownership/redistribution authority, and a separate, explicit authorization for public listing/download. Rights claims are self-attested; GameForge does not independently prove ownership, check source provenance, or give legal advice.
- Only validated, moderator-approved assets owned by an active account are listed or downloadable. Moderators can fetch pending files, and retain an admin-only review-attachment route for published/reported-removed files, always as `application/octet-stream` attachments with `nosniff`, no-store, and stored size/SHA-256 checks. Approval re-reads the object, verifies its stored size/hash, and runs the structural validator again. Public downloads repeat size/hash checks and are attachments, not embedded previews or executable content in the GameForge origin.
- The displayed license controls permitted reuse. Public visibility/download permission is not a blanket right to redistribute beyond those license terms. The supported options are CC BY 4.0, CC BY-SA 4.0, and CC0 1.0; creators must choose the license only when authorized. Attribution is retained in the public listing.
- Owners may withdraw pending or published assets; moderators may reject submissions with a note or remove a reported listing with a note. These actions prevent future GameForge listing/download access, but cannot recall or revoke copies already downloaded under the license. There is no appeal workflow, automated rights verification, malware scanner, direct store-to-project import, or production database/storage validation yet.

### Browser isolation

- Game players use an iframe `sandbox` without `allow-same-origin`, top-navigation, popups, or unrestricted storage permissions. The response also includes a restrictive Content Security Policy, `X-Content-Type-Options: nosniff`, and explicit MIME types.
- Bundled demo resources use `Cross-Origin-Resource-Policy: cross-origin` because a sandboxed document has an opaque origin; `same-site` would block the game from loading its own CSS and JavaScript. This policy does not grant DOM/storage access or add iframe permissions. Demo CSP still sets `connect-src 'none'`, and the iframe does not grant `allow-same-origin`.
- Published games are served from the dedicated production content origin. Production auth cookies use the `__Host-` prefix and do not domain-share with that host.
- The game CSP blocks external connections and limits scripts, frames, forms, and resource types. Local development may serve games on the app origin; the separate-host boundary is a **production requirement**.

A browser sandbox is not a complete resource-isolation system. It cannot guarantee protection from CPU/memory exhaustion, deceptive in-frame content, user-initiated downloads, browser vulnerabilities, or all browser-specific behaviors. Users should keep browsers current and avoid treating unknown games as trusted.

### AI provider keys and output

- The Studio defaults to Gemini and never accepts a provider key from a client. Server routes read `GEMINI_API_KEY`, `MISTRAL_API_KEY`, and/or `GROQ_API_KEY` from the server environment and do not include them in responses, prompts, project files, audit data, or AI-generation records. Operators must manage them with the hosting secret manager.
- A provider quota/rate-limit response triggers sequential fallback through the fixed Gemini → Mistral → Groq order; only later providers with valid configured keys and discoverable models are attempted. A manually selected Mistral provider can fall back only to Groq. Fallback model IDs may be configured with `AI_MISTRAL_FALLBACK_MODEL` and `AI_GROQ_FALLBACK_MODEL`; otherwise the first discovered generative model is used.
- The Studio explains that fallback may send prompts and selected asset metadata to another external provider. In some cases the selected provider already received the prompt before returning its quota response. Operators must review privacy, retention, data-handling, quota, and billing terms for every configured provider. Fallback does not guarantee a free quota or successful generation.
- Provider selection is an enum mapped to fixed official API hosts; callers cannot supply a URL. Requests use timeouts and bounded response reads, and provider errors are translated without returning raw provider bodies.
- Application error logs record a request ID and error type, not the request body, prompt, or API key. The key is not intentionally logged by GameForge code. Network intermediaries and each attempted AI provider remain separate trust parties; use HTTPS and review their terms.
- Generated projects have path, extension, size, entry-point, external-reference, and JavaScript syntax checks. Syntax checking compiles JavaScript but does **not** execute it. Generated games remain untrusted and are previewed in a sandbox.
- Configured provider keys are server-managed and may incur shared platform charges. Per-account daily quotas and account/client-address request limits reduce accidental or abusive usage, but are not a provider billing cap. No provider key is configured or externally tested in this workspace.

## Production operator checklist

- [ ] Set `DATABASE_URL` to PostgreSQL with TLS; use a serverless-friendly pooled URL and small `DATABASE_POOL_SIZE`.
- [ ] Back up PostgreSQL and test a restore; keep migrations controlled and apply `npm run db:migrate` before sending traffic to a release.
- [ ] Set all `S3_*` values as encrypted server-only Vercel environment variables. Keep the bucket private/block public access; scope object read/write/delete permissions to the game-build, `assets/private/`, and `assets/pending/` prefixes.
- [ ] Configure storage CORS for presigned `POST` uploads from exact app origins only; test valid upload, corrupt-file rejection, cross-owner 404, private/no-store previews, quota behavior, and storage cleanup with a disposable account.
- [ ] If enabling an AI provider, add only the intended `GEMINI_API_KEY`, `MISTRAL_API_KEY`, and/or `GROQ_API_KEY` to the server secret manager; test a real model and monitor provider billing separately.
- [ ] If enabling email verification/recovery, configure `ACCOUNT_RECOVERY_SECRET`, `RESEND_API_KEY`, and a verified `GAMEFORGE_EMAIL_FROM`; test delivery, attempt limits, and session revocation with an owned account.
- [ ] Attach the app and game-content domains to the same Vercel project. Configure `NEXT_PUBLIC_SITE_URL` and `GAME_CONTENT_ORIGIN` as separate HTTPS origins and verify the latter is never an app-cookie domain.
- [ ] Select a supported Node.js runtime version (22.13+), confirm Vercel function durations/body-size limits against configured upload and AI limits, and protect Production, Preview, and Development environments separately.
- [ ] Create the first admin through the interactive `npm run admin:create` script from a trusted operator environment; do not add an admin password or role to a seed fixture.
- [ ] Use unique credentials per environment, rotate/revoke provider and storage keys promptly if exposed, and monitor database/storage/hosting logs.
- [ ] Verify backup retention, resource quotas, and an incident contact before inviting public uploads.

## Known gaps and moderation boundaries

- Email verification and password reset are implemented only when `ACCOUNT_RECOVERY_SECRET`, `RESEND_API_KEY`, and `GAMEFORGE_EMAIL_FROM` are configured; no live email provider was tested here. SMS, OAuth, MFA, and account self-service password-change/credential-rotation flows are not implemented.
- ZIP validation does not scan malware; generated project validation does not prove safe or correct runtime behavior.
- The MVP admin console reviews pending game/project submissions and reports. For a non-demo game or AI-project report, moderators can explicitly take down a public/pending item; GameForge marks it removed/private and refuses future platform playback while retaining stored files for review. Merely marking a report actioned does not remove its target. Bundled starter demos are deployment assets and require a deployment update for removal. A site administrator can suspend/restore reported user accounts with an audit note or restore suspended users from a dedicated queue; status changes, session revocation on suspension, and audit notes are committed together. Active-admin decisions are serialized to protect administrator availability; self-suspension and suspending the last active admin are blocked. There is no appeal workflow or storage-file deletion.
- There is no automated malware scanner, user-content sandbox service, database backup/restore automation, object lifecycle/orphan cleanup, or production alerting configured by this repository.

If a key is suspected exposed, revoke it with its provider immediately. For a reported non-demo game or AI project, use the admin report action “Take down & action”; this hides the target from GameForge listings and blocks future build responses but retains storage objects and cannot revoke copies already downloaded by visitors. Bundled starter demos need a deployment update to remove. For a broader content incident, restrict the affected content origin or bucket access at the hosting/storage layer. Site administrators can suspend users from a report and restore them from a report or the suspended-accounts queue; there is no appeal workflow or stored-file deletion control. Document and test the response process before enabling broad public uploads.
