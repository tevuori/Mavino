import { useEffect, useMemo, useState } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { filesApi } from "../../services/files";
import { latexToMarkdown } from "./latex";

export function LatexViewer({ fileId }: { fileId: string }) {
  const [source, setSource] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    filesApi.getContent(fileId)
      .then(({ content }) => {
        if (!cancelled) setSource(content);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "Failed to load LaTeX document");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [fileId]);

  const markdown = useMemo(() => latexToMarkdown(source), [source]);

  if (loading) {
    return <div className="flex h-full items-center justify-center"><Loader2 size={24} className="animate-spin text-ink-muted" /></div>;
  }
  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-ink-muted">
        <AlertCircle size={32} className="text-danger" />
        <p className="text-sm">{error}</p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto bg-surface p-6">
      <article className="markdown-body prose-sm mx-auto max-w-3xl text-ink">
        <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
          {markdown}
        </ReactMarkdown>
      </article>
    </div>
  );
}
