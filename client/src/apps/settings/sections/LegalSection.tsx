import { Shield, FileText, ExternalLink, Trash2, Download, Mail } from "lucide-react";
import { SectionHeader, Card } from "../ui";

export default function LegalSection() {
  return (
    <section id="legal" className="mb-8">
      <SectionHeader
        icon={<Shield size={18} />}
        title="Legal"
        description="Privacy policy, terms of service, and your data-protection rights."
      />

      <Card className="mb-3">
        <h4 className="mb-1 flex items-center gap-2 text-sm font-semibold text-ink">
          <FileText size={15} /> Privacy Policy
        </h4>
        <p className="mb-3 text-xs text-ink-muted">
          How Mavino collects, stores, and processes your personal data — including what is sent to
          LLM providers, ElevenLabs, Microsoft Graph, and other third parties, and your
          GDPR rights.
        </p>
        <a
          href="/privacy.html"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-lg border border-edge px-3 py-2 text-sm text-ink hover:bg-surface-3"
        >
          <ExternalLink size={14} /> Read Privacy Policy
        </a>
      </Card>

      <Card className="mb-3">
        <h4 className="mb-1 flex items-center gap-2 text-sm font-semibold text-ink">
          <FileText size={15} /> Terms of Service
        </h4>
        <p className="mb-3 text-xs text-ink-muted">
          The terms governing your use of the hosted Mavino service at mavino.net —
          acceptable use, your content, third-party services, warranties, and governing law.
        </p>
        <a
          href="/terms.html"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-lg border border-edge px-3 py-2 text-sm text-ink hover:bg-surface-3"
        >
          <ExternalLink size={14} /> Read Terms of Service
        </a>
      </Card>

      <Card className="mb-3">
        <h4 className="mb-1 flex items-center gap-2 text-sm font-semibold text-ink">
          <Download size={15} /> Export your data
        </h4>
        <p className="mb-3 text-xs text-ink-muted">
          Download a JSON copy of all your data (GDPR right to data portability). Available in
          Data &amp; Storage.
        </p>
        <p className="text-xs text-ink-muted">
          Go to <span className="text-ink">Settings → Data &amp; Storage → Export</span>.
        </p>
      </Card>

      <Card className="mb-3 border-red-500/40">
        <h4 className="mb-1 flex items-center gap-2 text-sm font-semibold text-red-500">
          <Trash2 size={15} /> Delete your account
        </h4>
        <p className="mb-3 text-xs text-ink-muted">
          Permanently delete your account and all associated data (GDPR right to erasure). This is
          irreversible. Available in Data &amp; Storage.
        </p>
        <p className="text-xs text-ink-muted">
          Go to <span className="text-ink">Settings → Data &amp; Storage → Danger zone</span>.
        </p>
      </Card>

      <Card>
        <h4 className="mb-1 flex items-center gap-2 text-sm font-semibold text-ink">
          <Mail size={15} /> Data protection contact
        </h4>
        <p className="text-xs text-ink-muted">
          Data Controller: Jakub Horák. For any privacy request, complaint, or question, email{" "}
          <a
            href="mailto:tevuori@mavino.net"
            className="text-accent hover:underline"
          >
            tevuori@mavino.net
          </a>
          . You may also lodge a complaint with the Czech Data Protection Authority (ÚOOÚ).
        </p>
      </Card>
    </section>
  );
}
