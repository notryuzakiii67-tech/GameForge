# Community Asset Store review policy

This is moderator operating guidance for the current GameForge MVP, not legal advice or a statement that any asset's ownership has been independently verified. Operators should have the process, contact channel, retention rules, and jurisdiction-specific obligations reviewed by qualified counsel before opening a public store.

## What a GameForge approval means

Approval means that a moderator reviewed the submitted file and its listing against the store's technical and declaration requirements at that time. It does **not** mean that GameForge verified copyright ownership, confirmed every license chain, cleared trademarks/privacy/publicity rights, or guaranteed that a later use is lawful. The submitter's rights basis and permissions remain self-attested.

The structural validator checks supported file formats and selected content properties. It is not malware scanning, a full codec decoder, a code audit, or legal review. Moderators must never execute an uploaded file in the GameForge app origin or rely on a successful parser as proof that the file is safe or rights-cleared.

## Pre-publication checklist

Review the exact submitted bytes and listing in the admin review surface. Do not approve based only on a filename, thumbnail, public URL, repository popularity, or the submitter's checkbox.

1. **Technical eligibility:** confirm the file opens in an appropriate isolated/local viewer, the displayed type and size are plausible, validation reports a supported compatible asset, and the SHA-256 shown in the review record is consistent with the submitted file. Never run uploaded scripts or active content in a privileged GameForge session.
2. **Rights basis:** require the owner to choose the applicable basis (created by them, licensed for redistribution, or public domain), confirm the required declarations, and provide truthful attribution. “Found online,” “free download,” “available in a repository,” and “AI-generated” are not by themselves proof of redistribution rights.
3. **License:** verify that the listing selects one supported license—CC BY 4.0, CC BY-SA 4.0, or CC0 1.0—and that the submitter is entitled to apply it. Read the linked license for the intended use; preserve attribution and share-alike obligations where applicable. Do not use a license choice to override a third-party asset's terms.
4. **Content and privacy:** inspect for apparent personal data, private images, prohibited material, deceptive attribution, or third-party marks/content that the submitter may not be entitled to publish. Escalate uncertainty; do not infer consent from public availability.
5. **Decision record:** approve only when the technical checks and available rights basis are consistent. Leave a concise moderator note identifying the checks and any evidence reviewed. If ownership or permission cannot be reasonably assessed, reject or keep the asset private rather than describing it as verified.

A link or screenshot supplied by an owner is context, not conclusive proof. If the asset incorporates multiple components, the owner must have permission for every component and the declared license must cover the offered copy. The current UI does not accept evidence-file attachments, so do not invite users to send identity documents or confidential contracts through the free-text report field.

## Copyright and safety reports

The public listing's **Report** action accepts a reason and optional text details. Ask reporters to identify the listing and, if comfortable, provide a public source or a concise description of the rights concern. Do not request passwords, government IDs, home addresses, or unrelated personal data. The current app does not provide a dedicated legal-notice intake, evidence upload, reporter status page, or guaranteed response time.

A moderator should review specific reports promptly, preserve the listing ID, content hash, report, and decision in the existing audit trail, and restrict or remove public access when the available information leaves a material unresolved concern. Contact the uploader through their account only to request relevant clarification; avoid publishing private allegations or reporter details. A report is not itself proof of infringement, and moderators should not make a legal determination beyond their authority. Escalate formal or disputed claims through the operator's counsel and designated contact process.

Moderators may remove/take down a listing through the existing queue/report-decision workflow. If evidence is incomplete, keep the listing private or removed while the operator reviews it; do not silently re-publish it. The database-backed audit notes help explain GameForge's decision but do not establish legal ownership.

## Appeals and repeat review

An owner may appeal a rejected or removed listing with an explanation. An appeal does not publish the asset or erase prior decisions; the asset returns to ordinary private pending review if a moderator reopens it. Where staffing permits, assign a different moderator for the second review. The current application does not enforce reviewer independence or provide a separate rights-holder arbitration process.

## Downloads, withdrawal, and limits

Store downloads are attachments, and the UI displays the listing's license and attribution. Users must review those terms before using or redistributing a copy. Owners may withdraw access and moderators may remove a listing, but already downloaded copies cannot be recalled by GameForge and may remain subject to the displayed license. Do not promise that a takedown will delete copies held by other users or third-party systems.

Before production launch, the operator must decide how to receive formal rights notices, verify claimant authority where appropriate, retain/restrict evidence, handle repeat claims, meet applicable response deadlines, and communicate outcomes. No automated process or independent rights verification is implemented in this MVP.
