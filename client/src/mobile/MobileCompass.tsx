// ===== Mobile Compass (Pro-tier research & literature review assistant) =====
// Mobile-optimized view of Compass — the desktop app's citation-graph canvas
// is impractical on touch, so mobile focuses on the paper list, status
// management, related-work search, reading gaps, and literature review
// drafting. A MobileDesktopNote points users to the interactive graph on
// desktop (same "list instead of canvas" strategy as MobileAtlas).

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Compass, Plus, Trash2, RefreshCw, Loader2, AlertCircle,
  BookOpen, CheckCircle2, Circle, Clock,
  Search, Sparkles, Lightbulb, ExternalLink, ChevronDown,
  AlertTriangle,
} from "lucide-react";
import {
  compassApi,
  type CompassProjectSummary, type CompassProject, type CompassPaper,
  type SearchResult, type ReadingGaps,
} from "../services/compass";
import type { MobileTool } from "./MobileLauncher";
import {
  MobileContainer, MobileHeader, MobileEmpty, MobileLoading, MobileCard,
  MobileChip, MobileInput, MobileTextarea, MobileButton,
  MobileModal, MobileMarkdown, MobileDesktopNote,
} from "./MobileUi";

const STATUS_META: Record<CompassPaper["status"], { label: string; icon: typeof Circle; color: string }> = {
  to_read: { label: "To Read", icon: Circle, color: "text-ink-muted" },
  reading: { label: "Reading", icon: Clock, color: "text-amber-400" },
  read: { label: "Read", icon: CheckCircle2, color: "text-emerald-400" },
};

const EXTRACT_STATUS_META: Record<CompassPaper["extractStatus"], { label: string; color: string }> = {
  idle: { label: "Not analyzed", color: "text-ink-muted" },
  extracting: { label: "Analyzing…", color: "text-amber-400" },
  done: { label: "Analyzed", color: "text-emerald-400" },
  error: { label: "Analysis failed", color: "text-red-400" },
};

function authorsString(authors: string[]): string {
  if (authors.length === 0) return "";
  if (authors.length <= 2) return authors.join(", ");
  return `${authors[0]} et al.`;
}

type View = "list" | "project";

export default function MobileCompass({ onClose }: { onClose: () => void; onOpenTool: (tool: MobileTool) => void }) {
  const [view, setView] = useState<View>("list");
  const [projects, setProjects] = useState<CompassProjectSummary[]>([]);
  const [activeProject, setActiveProject] = useState<CompassProject | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const loadProjects = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await compassApi.listProjects();
      setProjects(res.projects);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load projects");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadProject = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await compassApi.getProject(id);
      setActiveProject(res.project);
      setView("project");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load project");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadProjects(); }, [loadProjects]);

  // Poll while extraction or review generation is running.
  useEffect(() => {
    if (!activeProject) return;
    const hasExtracting = activeProject.papers.some((p) => p.extractStatus === "extracting");
    const reviewBuilding = activeProject.review?.status === "building";
    if (!hasExtracting && !reviewBuilding) return;
    const id = setInterval(async () => {
      try {
        const res = await compassApi.getProject(activeProject.id);
        setActiveProject(res.project);
      } catch {
        // ignore polling errors
      }
    }, 2500);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProject?.id, activeProject?.papers.some((p) => p.extractStatus === "extracting"), activeProject?.review?.status]);

  const handleCreateProject = async (title: string, researchQuestion: string) => {
    try {
      await compassApi.createProject(title, researchQuestion || undefined);
      setShowCreate(false);
      await loadProjects();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create project");
    }
  };

  const handleDeleteProject = async () => {
    if (!activeProject) return;
    if (!confirm(`Delete "${activeProject.title}" and all its papers?`)) return;
    try {
      await compassApi.deleteProject(activeProject.id);
      setActiveProject(null);
      setView("list");
      await loadProjects();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete project");
    }
  };

  if (view === "project" && activeProject) {
    return (
      <ProjectDetail
        project={activeProject}
        loading={loading}
        error={error}
        onBack={() => { setActiveProject(null); setView("list"); void loadProjects(); }}
        onRefresh={() => loadProject(activeProject.id)}
        onDelete={handleDeleteProject}
        onUpdate={setActiveProject}
        setError={setError}
      />
    );
  }

  return (
    <MobileContainer>
      <MobileHeader
        title="Compass"
        subtitle="Research & lit review"
        onClose={onClose}
        right={
          <button
            onClick={() => setShowCreate(true)}
            className="flex h-11 w-11 items-center justify-center rounded-2xl bg-accent text-ink"
          >
            <Plus size={20} />
          </button>
        }
      />

      {error && (
        <div className="mb-4 flex items-center gap-2 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          <AlertCircle size={16} /> {error}
        </div>
      )}

      {loading && projects.length === 0 ? (
        <MobileLoading />
      ) : projects.length === 0 ? (
        <div className="flex flex-col items-center gap-4 py-10 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-accent/15">
            <Compass size={32} className="text-accent" />
          </div>
          <p className="max-w-xs text-sm leading-6 text-ink-muted">
            Compass helps you manage papers, spot reading gaps, and draft a structured literature review for your research.
          </p>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 rounded-2xl bg-accent px-5 py-3 text-sm font-semibold text-ink active:scale-[.98]"
          >
            <Plus size={16} /> New project
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {projects.map((p) => (
            <MobileCard key={p.id} onClick={() => loadProject(p.id)}>
              <p className="font-semibold text-ink">{p.title}</p>
              {p.researchQuestion && (
                <p className="mt-1 line-clamp-2 text-xs leading-5 text-ink-muted">{p.researchQuestion}</p>
              )}
              <p className="mt-2 text-[11px] text-ink-muted">
                {p.paperCount} paper{p.paperCount !== 1 ? "s" : ""}
              </p>
            </MobileCard>
          ))}
        </div>
      )}

      <MobileModal open={showCreate} onClose={() => setShowCreate(false)} title="New research project">
        <CreateProjectForm onSubmit={handleCreateProject} onCancel={() => setShowCreate(false)} />
      </MobileModal>
    </MobileContainer>
  );
}

function CreateProjectForm({ onSubmit, onCancel }: { onSubmit: (title: string, rq: string) => void; onCancel: () => void }) {
  const [title, setTitle] = useState("");
  const [researchQuestion, setResearchQuestion] = useState("");
  return (
    <div className="space-y-3">
      <MobileInput value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Project title *" />
      <MobileTextarea
        value={researchQuestion}
        onChange={(e) => setResearchQuestion(e.target.value)}
        placeholder="Research question (optional)"
        rows={3}
      />
      <div className="flex justify-end gap-2 pt-1">
        <MobileButton variant="ghost" onClick={onCancel}>Cancel</MobileButton>
        <MobileButton onClick={() => onSubmit(title.trim(), researchQuestion.trim())} disabled={!title.trim()}>
          <Plus size={16} /> Create
        </MobileButton>
      </div>
    </div>
  );
}

// ----- project detail -----

type ProjectTab = "papers" | "review" | "gaps";

function ProjectDetail({
  project, loading, error, onBack, onRefresh, onDelete, onUpdate, setError,
}: {
  project: CompassProject;
  loading: boolean;
  error: string | null;
  onBack: () => void;
  onRefresh: () => void;
  onDelete: () => void;
  onUpdate: (p: CompassProject) => void;
  setError: (e: string | null) => void;
}) {
  const [tab, setTab] = useState<ProjectTab>("papers");
  const [showAddPaper, setShowAddPaper] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [statusMenuPaperId, setStatusMenuPaperId] = useState<string | null>(null);

  const handleAddPaper = async (data: { title: string; authors: string; year: string; venue: string; url: string }) => {
    try {
      const authorsArr = data.authors.split(",").map((a) => a.trim()).filter(Boolean);
      const yearNum = data.year ? parseInt(data.year, 10) : undefined;
      await compassApi.addPaper(project.id, {
        sourceType: data.url.trim() ? "url" : "manual",
        url: data.url.trim() || undefined,
        title: data.title.trim(),
        authors: authorsArr,
        year: yearNum,
        venue: data.venue.trim() || undefined,
      });
      setShowAddPaper(false);
      onRefresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add paper");
    }
  };

  const handleExtract = async (paperId: string) => {
    try {
      await compassApi.extractPaper(project.id, paperId);
      onUpdate({
        ...project,
        papers: project.papers.map((p) => (p.id === paperId ? { ...p, extractStatus: "extracting" } : p)),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to start analysis");
    }
  };

  const handleStatusChange = async (paperId: string, status: CompassPaper["status"]) => {
    setStatusMenuPaperId(null);
    try {
      await compassApi.updatePaper(project.id, paperId, { status });
      onUpdate({
        ...project,
        papers: project.papers.map((p) => (p.id === paperId ? { ...p, status } : p)),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update paper");
    }
  };

  const handleDeletePaper = async (paperId: string) => {
    if (!confirm("Remove this paper from the project?")) return;
    try {
      await compassApi.deletePaper(project.id, paperId);
      onRefresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to remove paper");
    }
  };

  const handleAddSearchResult = async (result: SearchResult) => {
    try {
      await compassApi.addPaper(project.id, { sourceType: "url", url: result.url, title: result.title });
      onRefresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add paper");
    }
  };

  const handleGenerateReview = async () => {
    try {
      await compassApi.generateReview(project.id);
      onUpdate({
        ...project,
        review: project.review
          ? { ...project.review, status: "building" }
          : { id: "", projectId: project.id, content: "", status: "building", error: "", generatedAt: null, updatedAt: new Date().toISOString() },
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to generate review");
    }
  };

  const statusMenuPaper = useMemo(
    () => project.papers.find((p) => p.id === statusMenuPaperId) ?? null,
    [project.papers, statusMenuPaperId]
  );

  return (
    <MobileContainer>
      <MobileHeader
        title={project.title}
        subtitle="Compass project"
        onBack={onBack}
        right={
          <button onClick={onDelete} className="flex h-11 w-11 items-center justify-center rounded-2xl bg-surface-2 text-red-300">
            <Trash2 size={20} />
          </button>
        }
      />

      {error && (
        <div className="mb-4 flex items-center gap-2 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          <AlertCircle size={16} /> {error}
        </div>
      )}

      {project.researchQuestion && (
        <div className="mb-4 rounded-2xl border border-edge bg-surface-2 px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">Research question</p>
          <p className="mt-1 text-sm text-ink">{project.researchQuestion}</p>
        </div>
      )}

      <MobileDesktopNote text="Compass' interactive citation graph (drag-and-connect view of how papers cite each other) is available on desktop. On mobile, papers are listed below sorted for quick triage." />

      <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
        <MobileChip active={tab === "papers"} onClick={() => setTab("papers")}>Papers ({project.papers.length})</MobileChip>
        <MobileChip active={tab === "review"} onClick={() => setTab("review")}>Review</MobileChip>
        <MobileChip active={tab === "gaps"} onClick={() => setTab("gaps")}>Gaps</MobileChip>
      </div>

      {tab === "papers" && (
        <>
          <div className="mb-3 flex gap-2">
            <MobileButton className="flex-1" onClick={() => setShowAddPaper(true)}>
              <Plus size={16} /> Add paper
            </MobileButton>
            <MobileButton variant="ghost" className="flex-1" onClick={() => setShowSearch(true)}>
              <Search size={16} /> Find related
            </MobileButton>
          </div>

          <MobileDesktopNote text="Adding papers from your Files library (PDF upload + extraction from a file) is available on desktop. Mobile supports adding papers by URL or manual entry." />

          {loading ? (
            <MobileLoading />
          ) : project.papers.length === 0 ? (
            <MobileEmpty text="No papers yet. Add one to get started." />
          ) : (
            <div className="space-y-2">
              {project.papers.map((paper) => (
                <PaperCard
                  key={paper.id}
                  paper={paper}
                  onChangeStatus={() => setStatusMenuPaperId(paper.id)}
                  onExtract={() => handleExtract(paper.id)}
                  onDelete={() => handleDeletePaper(paper.id)}
                />
              ))}
            </div>
          )}
        </>
      )}

      {tab === "review" && (
        <ReviewTab project={project} onGenerate={handleGenerateReview} />
      )}

      {tab === "gaps" && (
        <GapsTab projectId={project.id} onAddPaper={() => setTab("papers")} />
      )}

      <MobileModal open={showAddPaper} onClose={() => setShowAddPaper(false)} title="Add paper">
        <AddPaperForm onSubmit={handleAddPaper} onCancel={() => setShowAddPaper(false)} />
      </MobileModal>

      <MobileModal open={showSearch} onClose={() => setShowSearch(false)} title="Find related work">
        <SearchForm projectId={project.id} existingPapers={project.papers} onAdd={handleAddSearchResult} />
      </MobileModal>

      <MobileModal open={!!statusMenuPaper} onClose={() => setStatusMenuPaperId(null)} title="Update status">
        {statusMenuPaper && (
          <div className="space-y-2">
            {(Object.keys(STATUS_META) as CompassPaper["status"][]).map((s) => {
              const meta = STATUS_META[s];
              const Icon = meta.icon;
              return (
                <button
                  key={s}
                  onClick={() => handleStatusChange(statusMenuPaper.id, s)}
                  className={`flex w-full items-center gap-3 rounded-2xl border p-3.5 text-left transition ${
                    statusMenuPaper.status === s ? "border-accent/60 bg-accent/10" : "border-edge bg-surface-2"
                  }`}
                >
                  <Icon size={18} className={meta.color} />
                  <span className="text-sm font-medium text-ink">{meta.label}</span>
                </button>
              );
            })}
          </div>
        )}
      </MobileModal>
    </MobileContainer>
  );
}

function PaperCard({
  paper, onChangeStatus, onExtract, onDelete,
}: {
  paper: CompassPaper;
  onChangeStatus: () => void;
  onExtract: () => void;
  onDelete: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const statusMeta = STATUS_META[paper.status];
  const extractMeta = EXTRACT_STATUS_META[paper.extractStatus];
  const StatusIcon = statusMeta.icon;

  return (
    <div className="rounded-2xl border border-edge bg-surface-2 p-3.5">
      <button onClick={() => setExpanded((v) => !v)} className="flex w-full items-start justify-between gap-2 text-left">
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-ink">{paper.title}</p>
          {(paper.authors.length > 0 || paper.year) && (
            <p className="mt-0.5 text-xs text-ink-muted">
              {authorsString(paper.authors)}{paper.authors.length > 0 && paper.year ? " · " : ""}{paper.year ?? ""}
            </p>
          )}
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <span className={`flex items-center gap-1 text-[11px] ${statusMeta.color}`}>
              <StatusIcon size={11} /> {statusMeta.label}
            </span>
            <span className={`text-[11px] ${extractMeta.color}`}>{extractMeta.label}</span>
          </div>
        </div>
        <ChevronDown size={18} className={`mt-1 shrink-0 text-ink-muted transition ${expanded ? "rotate-180" : ""}`} />
      </button>

      {expanded && (
        <div className="mt-3 space-y-2 border-t border-edge pt-3">
          {paper.abstract && <p className="text-xs leading-5 text-ink-muted">{paper.abstract}</p>}
          {paper.keyConcepts.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {paper.keyConcepts.map((c, i) => (
                <span key={i} className="rounded-full bg-surface-3 px-2 py-1 text-[10px] text-ink-muted">{c.label}</span>
              ))}
            </div>
          )}
          <div className="flex flex-wrap gap-2 pt-1">
            <MobileButton variant="ghost" onClick={onChangeStatus}>
              <StatusIcon size={14} /> Status
            </MobileButton>
            <MobileButton
              variant="ghost"
              onClick={onExtract}
              disabled={paper.extractStatus === "extracting"}
            >
              {paper.extractStatus === "extracting" ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
              Analyze
            </MobileButton>
            {paper.url && (
              <a
                href={paper.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-2xl bg-surface-2 px-4 py-2.5 text-sm font-semibold text-ink-muted active:bg-surface-3"
              >
                <ExternalLink size={14} /> Open
              </a>
            )}
            <MobileButton variant="danger" onClick={onDelete}>
              <Trash2 size={14} />
            </MobileButton>
          </div>
        </div>
      )}
    </div>
  );
}

function AddPaperForm({
  onSubmit, onCancel,
}: {
  onSubmit: (data: { title: string; authors: string; year: string; venue: string; url: string }) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState("");
  const [authors, setAuthors] = useState("");
  const [year, setYear] = useState("");
  const [venue, setVenue] = useState("");
  const [url, setUrl] = useState("");

  return (
    <div className="space-y-3">
      <MobileInput value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Paper URL (optional)" type="url" />
      <MobileInput value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title *" />
      <MobileInput value={authors} onChange={(e) => setAuthors(e.target.value)} placeholder="Authors (comma-separated)" />
      <div className="flex gap-2">
        <MobileInput value={year} onChange={(e) => setYear(e.target.value)} placeholder="Year" inputMode="numeric" className="w-24" />
        <MobileInput value={venue} onChange={(e) => setVenue(e.target.value)} placeholder="Venue" className="flex-1" />
      </div>
      <div className="flex justify-end gap-2 pt-1">
        <MobileButton variant="ghost" onClick={onCancel}>Cancel</MobileButton>
        <MobileButton
          onClick={() => onSubmit({ title, authors, year, venue, url })}
          disabled={!title.trim()}
        >
          <Plus size={16} /> Add
        </MobileButton>
      </div>
    </div>
  );
}

function SearchForm({
  projectId, existingPapers, onAdd,
}: {
  projectId: string;
  existingPapers: CompassPaper[];
  onAdd: (r: SearchResult) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addedUrls, setAddedUrls] = useState<Set<string>>(new Set());

  const handleSearch = async () => {
    if (!query.trim()) return;
    setSearching(true);
    setError(null);
    try {
      const res = await compassApi.search(projectId, query.trim());
      setResults(res.results);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Search failed");
    } finally {
      setSearching(false);
    }
  };

  const handleAdd = (r: SearchResult) => {
    onAdd(r);
    setAddedUrls((prev) => new Set([...prev, r.url]));
  };

  return (
    <div className="space-y-3">
      <p className="text-xs leading-5 text-ink-muted">
        Searches the web for related academic work, enriched with your project's research question.
      </p>
      <div className="flex gap-2">
        <MobileInput
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSearch()}
          placeholder="e.g. transformer attention survey"
          className="flex-1"
        />
        <MobileButton onClick={handleSearch} disabled={searching || !query.trim()}>
          {searching ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
        </MobileButton>
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
      <div className="max-h-[50vh] space-y-2 overflow-y-auto">
        {results.map((r, i) => {
          const alreadyInCorpus = r.inCorpus || existingPapers.some((p) => p.url === r.url);
          return (
            <div key={i} className="rounded-2xl border border-edge bg-surface-2 p-3">
              <a href={r.url} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-accent">
                {r.title}
              </a>
              <p className="mt-1 line-clamp-2 text-xs text-ink-muted">{r.description}</p>
              {alreadyInCorpus ? (
                <span className="mt-2 inline-block rounded-full bg-emerald-500/15 px-2 py-1 text-[10px] text-emerald-400">In corpus</span>
              ) : addedUrls.has(r.url) ? (
                <span className="mt-2 inline-flex items-center gap-1 text-[10px] text-emerald-400"><CheckCircle2 size={11} /> Added</span>
              ) : (
                <button onClick={() => handleAdd(r)} className="mt-2 rounded-full bg-surface-3 px-3 py-1 text-[10px] text-ink active:bg-surface-2">
                  <Plus size={10} className="mr-1 inline" /> Add
                </button>
              )}
            </div>
          );
        })}
        {results.length === 0 && !searching && query.trim() && (
          <p className="text-center text-xs text-ink-muted">No results yet. Try searching.</p>
        )}
      </div>
    </div>
  );
}

function ReviewTab({ project, onGenerate }: { project: CompassProject; onGenerate: () => void }) {
  const review = project.review;

  if (!review || review.status === "empty") {
    return (
      <div className="flex flex-col items-center gap-3 py-8 text-center">
        <BookOpen size={28} className="text-ink-muted opacity-50" />
        <p className="text-sm text-ink-muted">No literature review yet.</p>
        <p className="max-w-xs text-xs leading-5 text-ink-muted">
          Generate a structured literature review synthesizing your papers, discussing the citation graph, and highlighting gaps.
        </p>
        <MobileButton onClick={onGenerate}>
          <Sparkles size={16} /> Generate review
        </MobileButton>
      </div>
    );
  }

  if (review.status === "building") {
    return (
      <div className="flex flex-col items-center gap-3 py-10 text-center">
        <Loader2 size={28} className="animate-spin text-accent" />
        <p className="text-sm text-ink-muted">Generating literature review…</p>
        <p className="text-xs text-ink-muted">This may take a minute.</p>
      </div>
    );
  }

  if (review.status === "error") {
    return (
      <div className="flex flex-col items-center gap-3 py-8 text-center">
        <AlertCircle size={28} className="text-red-400" />
        <p className="text-sm text-red-400">Generation failed</p>
        <p className="max-w-xs text-xs text-ink-muted">{review.error}</p>
        <MobileButton onClick={onGenerate}>
          <RefreshCw size={16} /> Retry
        </MobileButton>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <MobileButton variant="ghost" onClick={onGenerate}>
          <RefreshCw size={14} /> Regenerate
        </MobileButton>
      </div>
      <MobileMarkdown content={review.content} />
    </div>
  );
}

function GapsTab({ projectId, onAddPaper }: { projectId: string; onAddPaper: () => void }) {
  const [gaps, setGaps] = useState<ReadingGaps | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    compassApi.getGaps(projectId).then(setGaps).catch(() => {}).finally(() => setLoading(false));
  }, [projectId]);

  if (loading) return <MobileLoading />;
  if (!gaps) return <MobileEmpty text="Failed to load reading gaps." />;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-2xl border border-edge bg-surface-2 p-3 text-center">
          <p className="text-xl font-bold text-ink">{gaps.totalCount}</p>
          <p className="text-[11px] text-ink-muted">Total</p>
        </div>
        <div className="rounded-2xl border border-edge bg-surface-2 p-3 text-center">
          <p className="text-xl font-bold text-emerald-400">{gaps.readCount}</p>
          <p className="text-[11px] text-ink-muted">Read</p>
        </div>
        <div className="rounded-2xl border border-edge bg-surface-2 p-3 text-center">
          <p className="text-xl font-bold text-amber-400">{gaps.unreadCount}</p>
          <p className="text-[11px] text-ink-muted">To Read</p>
        </div>
      </div>

      {gaps.gaps.length === 0 ? (
        <div className="flex items-center gap-2 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
          <CheckCircle2 size={16} /> No significant gaps detected.
        </div>
      ) : (
        <div className="space-y-2">
          {gaps.gaps.map((gap, i) => {
            const Icon = gap.severity === "warning" ? AlertTriangle : Lightbulb;
            const color = gap.severity === "warning" ? "text-amber-400" : "text-accent";
            return (
              <div key={i} className="rounded-2xl border border-edge bg-surface-2 p-3.5">
                <div className="mb-1 flex items-center gap-1.5">
                  <Icon size={14} className={color} />
                  <span className={`text-xs font-semibold capitalize ${color}`}>{gap.kind.replace("_", " ")}</span>
                </div>
                <p className="text-xs leading-5 text-ink-muted">{gap.description}</p>
              </div>
            );
          })}
        </div>
      )}

      <MobileButton variant="ghost" className="w-full" onClick={onAddPaper}>
        <Plus size={16} /> Add papers to fill gaps
      </MobileButton>
    </div>
  );
}
