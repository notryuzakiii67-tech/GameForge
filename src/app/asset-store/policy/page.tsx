import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, ShieldCheck } from "lucide-react";

export const metadata: Metadata = { title: "Asset Store review policy" };

export default function AssetStorePolicyPage() {
  return <div className="page-wrap page-content asset-store-policy">
    <Link className="button button-dark button-small" href="/asset-store"><ArrowLeft size={13} /> Back to Asset Store</Link>
    <header className="page-header">
      <div className="eyebrow"><ShieldCheck size={13} /> COMMUNITY ASSET STORE</div>
      <h1>Review, rights &amp; reports</h1>
      <p>How GameForge handles public asset listings. This policy describes the current MVP workflow; it is not legal advice or a promise that ownership has been independently verified.</p>
    </header>
    <div className="asset-policy-grid">
      <section className="panel-card"><h2>What approval means</h2><p>A moderator reviews the submitted file and its listing against technical checks and the owner's declarations. Approval is not independent proof of copyright ownership, a complete license-chain review, or a guarantee that every future use is lawful.</p><p>File validation is structural, not malware scanning or legal review. Uploaded content is not executed in GameForge's application origin.</p></section>
      <section className="panel-card"><h2>Before downloading</h2><p>Listings display a supported license—CC BY 4.0, CC BY-SA 4.0, or CC0 1.0—and attribution. Read the linked license and preserve its conditions. A public download is not blanket permission to redistribute under different terms.</p><p>Rights declarations are self-attested. Public availability, a “free download” label, or a repository link is not by itself proof of permission.</p></section>
      <section className="panel-card"><h2>Report a concern</h2><p>Use <strong>Report</strong> on a listing and choose copyright/ownership, safety, spam, or another concern. Optional details can identify the issue or a public source. Do not include passwords, government IDs, addresses, or unrelated personal information.</p><p>The current form does not accept evidence files, provide a dedicated legal-notice intake, or promise a response time. Operators must establish a separate contact and escalation process for formal or disputed rights claims.</p></section>
      <section className="panel-card"><h2>Withdrawal &amp; appeals</h2><p>Owners may withdraw access; moderators can remove a listing. An owner may appeal a rejection or removal, but an appeal does not automatically republish the file.</p><p>GameForge cannot recall copies already downloaded. They may remain subject to the license shown at download, even after a listing is removed.</p></section>
    </div>
    <p className="asset-policy-footnote">GameForge does not provide legal advice. The operator's review process and local legal obligations should be reviewed before production launch.</p>
  </div>;
}
