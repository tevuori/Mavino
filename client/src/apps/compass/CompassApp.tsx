// ===== Compass app (Pro-tier research & literature review assistant) =====
// A research assistant for students doing bigger academic work (thesis,
// seminar paper, literature review). The user creates a project with a
// research question, adds seed papers (PDFs from Files, URLs, or manual
// entries), and Compass:
//   - Extracts key concepts + citation references from each paper (LLM)
//   - Builds a citation graph across the corpus
//   - Finds related work via web search (enriched with the research question)
//   - Tracks reading progress (to_read / reading / read)
//   - Identifies reading gaps (recency, coverage, citation balance)
//   - Drafts a structured literature review with inline citations (LLM)
//
// UI: three-pane layout —
//   Left: project list + paper list (with status badges)
//   Center: citation graph canvas (force-directed) OR paper detail
//   Right: drafted literature review (Markdown) + reading gaps panel
//
// The extraction + review generation use the fire-and-forget + polling
// pattern (same as Atlas/Crunch): POST kicks off the background job, the
// client polls GET until status flips to "ready"/"error".

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import ForceGraph2D, { type NodeObject, type LinkObject } from "react-force-graph-2d";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Compass, Plus, Trash2, RefreshCw, Loader2, AlertCircle, X,
  FileText, Edit3, BookOpen, CheckCircle2, Circle, Clock,
  Search, Sparkles, ChevronLeft, Lightbulb, ExternalLink, Save,
  Network, AlertTriangle, Maximize2, Download,
} from "lucide-react";
import {
  compassApi,
  type CompassProjectSummary, type CompassProject, type CompassPaper,
  type CompassReview, type SearchResult,
  type ReadingGaps,
} from "../../services/compass";
import { filesApi, isPdfFile, isImageFile, isAudioFile, isVideoFile } from "../../services/files";
import { useWindows } from "../../store/windows";
import type { WindowInstance } from "../../store/windows";
import type { VFile } from "../../types";

// ----- helpers -----

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

// ----- graph types -----

interface GraphNode extends NodeObject {
  id: string;
  label: string;
  status: CompassPaper["status"];
  extracted: boolean;
}

interface GraphLink extends LinkObject<GraphNode> {
  source: GraphNode;
  target: GraphNode;
  inCorpus: boolean;
}

// ----- main component -----

export default function CompassApp({ win }: { win: WindowInstance }) {
  const { open } = useWindows();
  const [projects, setProjects] = useState<CompassProjectSummary[]>([]);
  const [activeProject, setActiveProject] = useState<CompassProject | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedPaperId, setSelectedPaperId] = useState<string | null>(null);
  const [showAddPaper, setShowAddPaper] = useState(false);
  const [showCreateProject, setShowCreateProject] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [showGaps, setShowGaps] = useState(false);
  const [rightTab, setRightTab] = useState<"review" | "gaps">("review");

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

  const loadProject = useCallback(async (projectId: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await compassApi.getProject(projectId);
      setActiveProject(res.project);
      setSelectedPaperId(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load project");
    } finally {
      setLoading(false);
    }
  }, []);

  // Focus on a specific project (from Athena open_compass client action).
  useEffect(() => {
    const focusProjectId = sessionStorage.getItem(`compass:focus:${win.id}`);
    if (focusProjectId) {
      sessionStorage.removeItem(`compass:focus:${win.id}`);
      loadProject(focusProjectId);
    }
  }, [win.id, loadProject]);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  // Poll for extraction + review status updates.
  useEffect(() => {
    if (!activeProject) return;
    const hasExtracting = activeProject.papers.some((p) => p.extractStatus === "extracting");
    const reviewBuilding = activeProject.review?.status === "building";
    if (!hasExtracting && !reviewBuilding) return;
    const interval = setInterval(async () => {
      try {
        const res = await compassApi.getProject(activeProject.id);
        setActiveProject(res.project);
      } catch {
        // ignore polling errors
      }
    }, 2500);
    return () => clearInterval(interval);
  }, [activeProject?.id, activeProject?.papers.some((p) => p.extractStatus === "extracting"), activeProject?.review?.status]);

  const selectedPaper = useMemo(
    () => activeProject?.papers.find((p) => p.id === selectedPaperId) ?? null,
    [activeProject, selectedPaperId]
  );

  // ----- graph data -----

  const graphData = useMemo(() => {
    if (!activeProject) return { nodes: [] as GraphNode[], links: [] as GraphLink[] };
    const nodes: GraphNode[] = activeProject.papers.map((p) => ({
      id: p.id,
      label: p.title,
      status: p.status,
      extracted: p.extracted,
    }));
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));
    const links: GraphLink[] = [];
    for (const c of activeProject.citations) {
      const source = nodeMap.get(c.sourcePaperId);
      if (!source) continue;
      if (c.targetPaperId) {
        const target = nodeMap.get(c.targetPaperId);
        if (target) {
          links.push({ source, target, inCorpus: true });
        }
      }
      // External citations (target not in corpus) are not drawn as edges —
      // they'd need phantom nodes. We show them in the gaps panel instead.
    }
    return { nodes, links };
  }, [activeProject]);

  // ----- actions -----

  const handleCreateProject = async (title: string, researchQuestion: string) => {
    try {
      await compassApi.createProject(title, researchQuestion);
      setShowCreateProject(false);
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
      await loadProjects();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete project");
    }
  };

  const handleAddPaper = async (data: {
    sourceType: "file" | "url" | "manual";
    fileId?: string;
    url?: string;
    title?: string;
    authors?: string[];
    year?: number;
    venue?: string;
    doi?: string;
  }) => {
    if (!activeProject) return;
    try {
      await compassApi.addPaper(activeProject.id, data);
      setShowAddPaper(false);
      await loadProject(activeProject.id);
      await loadProjects(); // update paper count
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add paper");
    }
  };

  const handleExtractPaper = async (paperId: string) => {
    if (!activeProject) return;
    try {
      await compassApi.extractPaper(activeProject.id, paperId);
      // Polling will pick up the status change.
      // Optimistically update the UI.
      setActiveProject((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          papers: prev.papers.map((p) =>
            p.id === paperId ? { ...p, extractStatus: "extracting" } : p
          ),
        };
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to start extraction");
    }
  };

  const handleUpdatePaperStatus = async (paperId: string, status: string) => {
    if (!activeProject) return;
    try {
      await compassApi.updatePaper(activeProject.id, paperId, { status });
      setActiveProject((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          papers: prev.papers.map((p) =>
            p.id === paperId ? { ...p, status: status as CompassPaper["status"] } : p
          ),
        };
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update paper");
    }
  };

  const handleDeletePaper = async (paperId: string) => {
    if (!activeProject) return;
    if (!confirm("Remove this paper from the project?")) return;
    try {
      await compassApi.deletePaper(activeProject.id, paperId);
      setSelectedPaperId(null);
      await loadProject(activeProject.id);
      await loadProjects();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete paper");
    }
  };

  const handleGenerateReview = async () => {
    if (!activeProject) return;
    try {
      await compassApi.generateReview(activeProject.id);
      setActiveProject((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          review: prev.review
            ? { ...prev.review, status: "building" }
            : { id: "", projectId: prev.id, content: "", status: "building", error: "", generatedAt: null, updatedAt: new Date().toISOString() },
        };
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to generate review");
    }
  };

  const handleAddSearchResult = async (result: SearchResult) => {
    if (!activeProject) return;
    try {
      await compassApi.addPaper(activeProject.id, {
        sourceType: "url",
        url: result.url,
        title: result.title,
      });
      await loadProject(activeProject.id);
      await loadProjects();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add paper");
    }
  };

  // Open a paper's source file in the appropriate app — Viewer for PDFs/images/
  // audio/video, Editor for text files — matching the Files app convention.
  const handleOpenFile = async (fileId: string) => {
    let file: VFile | undefined;
    try {
      const { files } = await filesApi.all();
      file = files.find((f) => f.id === fileId);
    } catch {
      // fall through — open in Viewer as a best-effort fallback
    }
    const viewable = file && (isPdfFile(file) || isImageFile(file) || isAudioFile(file) || isVideoFile(file));
    if (viewable && file) {
      open({ appId: "viewer", title: file.name, icon: "Eye", payload: { fileId } });
    } else if (file) {
      open({ appId: "editor", title: file.name, icon: "Code2", payload: { fileId } });
    } else {
      open({ appId: "viewer", title: "Paper", icon: "Eye", payload: { fileId } });
    }
  };

  // ----- render -----

  if (loading && !activeProject && projects.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-ink-muted">
        <Loader2 className="animate-spin" size={24} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <AlertCircle className="text-red-400" size={32} />
        <p className="text-sm text-red-400">{error}</p>
        <button
          onClick={() => { setError(null); loadProjects(); }}
          className="rounded-lg bg-surface-3 px-3 py-1.5 text-xs hover:brightness-110"
        >
          Retry
        </button>
      </div>
    );
  }

  // No active project — show project list.
  if (!activeProject) {
    return (
      <ProjectListView
        projects={projects}
        onOpen={loadProject}
        onCreate={() => setShowCreateProject(true)}
        onRefresh={loadProjects}
      >
        {showCreateProject && (
          <CreateProjectDialog
            onSubmit={handleCreateProject}
            onCancel={() => setShowCreateProject(false)}
          />
        )}
      </ProjectListView>
    );
  }

  // Active project — three-pane layout.
  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-surface-3 px-4 py-2">
        <div className="flex items-center gap-2 min-w-0">
          <button
            onClick={() => { setActiveProject(null); setSelectedPaperId(null); loadProjects(); }}
            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-ink-muted hover:bg-surface-3 hover:text-ink"
          >
            <ChevronLeft size={14} /> Projects
          </button>
          <span className="text-ink-muted">/</span>
          <h2 className="truncate text-sm font-semibold text-ink">{activeProject.title}</h2>
          <span className="rounded-full bg-surface-3 px-2 py-0.5 text-[10px] text-ink-muted">
            {activeProject.papers.length} paper{activeProject.papers.length !== 1 ? "s" : ""}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setShowSearch(true)}
            className="flex items-center gap-1 rounded-lg bg-surface-3 px-2 py-1 text-xs hover:brightness-110"
            title="Find related work"
          >
            <Search size={14} /> Find
          </button>
          <button
            onClick={() => setShowGaps(true)}
            className="flex items-center gap-1 rounded-lg bg-surface-3 px-2 py-1 text-xs hover:brightness-110"
            title="Reading gaps"
          >
            <Lightbulb size={14} /> Gaps
          </button>
          <button
            onClick={() => setShowAddPaper(true)}
            className="flex items-center gap-1 rounded-lg bg-indigo-600 px-2 py-1 text-xs text-white hover:bg-indigo-500"
          >
            <Plus size={14} /> Add Paper
          </button>
          <button
            onClick={handleDeleteProject}
            className="rounded-lg p-1.5 text-ink-muted hover:bg-red-500/10 hover:text-red-400"
            title="Delete project"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {/* Research question */}
      {activeProject.researchQuestion && (
        <div className="border-b border-surface-3 bg-surface-2 px-4 py-1.5">
          <p className="text-xs text-ink-muted">
            <span className="font-medium text-ink">Research question:</span> {activeProject.researchQuestion}
          </p>
        </div>
      )}

      {/* Three-pane body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left: paper list */}
        <div className="w-64 shrink-0 overflow-y-auto border-r border-surface-3 bg-surface-2">
          <PaperList
            papers={activeProject.papers}
            selectedId={selectedPaperId}
            onSelect={setSelectedPaperId}
          />
        </div>

        {/* Center: graph or paper detail */}
        <div className="flex-1 overflow-hidden bg-surface">
          {selectedPaper ? (
            <PaperDetail
              paper={selectedPaper}
              onExtract={() => handleExtractPaper(selectedPaper.id)}
              onStatusChange={(s) => handleUpdatePaperStatus(selectedPaper.id, s)}
              onDelete={() => handleDeletePaper(selectedPaper.id)}
              onOpenFile={(fileId) => handleOpenFile(fileId)}
            />
          ) : (
            <CitationGraphView
              nodes={graphData.nodes}
              links={graphData.links}
              onNodeClick={(node) => setSelectedPaperId(node.id)}
            />
          )}
        </div>

        {/* Right: review / gaps */}
        <div className="w-96 shrink-0 overflow-y-auto border-l border-surface-3 bg-surface-2">
          <div className="flex border-b border-surface-3">
            <button
              onClick={() => setRightTab("review")}
              className={`flex-1 px-3 py-2 text-xs font-medium ${rightTab === "review" ? "border-b-2 border-indigo-500 text-ink" : "text-ink-muted hover:text-ink"}`}
            >
              Literature Review
            </button>
            <button
              onClick={() => setRightTab("gaps")}
              className={`flex-1 px-3 py-2 text-xs font-medium ${rightTab === "gaps" ? "border-b-2 border-indigo-500 text-ink" : "text-ink-muted hover:text-ink"}`}
            >
              Reading Gaps
            </button>
          </div>
          {rightTab === "review" ? (
            <ReviewPanel
              projectId={activeProject.id}
              projectTitle={activeProject.title}
              review={activeProject.review}
              onGenerate={handleGenerateReview}
              onOpenEditor={(content) => open({ appId: "editor", title: "Literature Review", icon: "Code2", payload: { name: "Literature Review.md", initialContent: content } })}
            />
          ) : (
            <GapsPanel projectId={activeProject.id} onAddPaper={() => setShowAddPaper(true)} />
          )}
        </div>
      </div>

      {/* Dialogs */}
      {showAddPaper && (
        <AddPaperDialog
          onSubmit={handleAddPaper}
          onCancel={() => setShowAddPaper(false)}
        />
      )}
      {showSearch && (
        <SearchDialog
          projectId={activeProject.id}
          onAddResult={handleAddSearchResult}
          onCancel={() => setShowSearch(false)}
        />
      )}
      {showGaps && (
        <GapsDialog
          projectId={activeProject.id}
          onClose={() => setShowGaps(false)}
        />
      )}
    </div>
  );
}

// ----- project list view -----

function ProjectListView({
  projects,
  onOpen,
  onCreate,
  onRefresh,
  children,
}: {
  projects: CompassProjectSummary[];
  onOpen: (id: string) => void;
  onCreate: () => void;
  onRefresh: () => void;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-surface-3 px-4 py-3">
        <div className="flex items-center gap-2">
          <Compass size={18} className="text-indigo-400" />
          <h2 className="text-sm font-semibold">Compass</h2>
          <span className="text-xs text-ink-muted">— Research & Literature Review</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={onRefresh}
            className="rounded-lg p-1.5 text-ink-muted hover:bg-surface-3 hover:text-ink"
            title="Refresh"
          >
            <RefreshCw size={14} />
          </button>
          <button
            onClick={onCreate}
            className="flex items-center gap-1 rounded-lg bg-indigo-600 px-2.5 py-1.5 text-xs text-white hover:bg-indigo-500"
          >
            <Plus size={14} /> New Project
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        {projects.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <Compass size={48} className="text-ink-muted opacity-40" />
            <p className="text-sm text-ink-muted">No research projects yet.</p>
            <p className="max-w-xs text-xs text-ink-muted">
              Create a project with your research question, add seed papers, and Compass will
              build a citation graph, find related work, and draft a literature review.
            </p>
            <button
              onClick={onCreate}
              className="mt-2 flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-2 text-xs text-white hover:bg-indigo-500"
            >
              <Plus size={14} /> Create your first project
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((p) => (
              <button
                key={p.id}
                onClick={() => onOpen(p.id)}
                className="group flex flex-col gap-2 rounded-xl border border-surface-3 bg-surface-2 p-4 text-left transition hover:border-indigo-500/50 hover:bg-surface-2"
              >
                <div className="flex items-start justify-between">
                  <h3 className="text-sm font-semibold text-ink group-hover:text-indigo-400">{p.title}</h3>
                  <span className="rounded-full bg-surface-3 px-2 py-0.5 text-[10px] text-ink-muted">
                    {p.paperCount} paper{p.paperCount !== 1 ? "s" : ""}
                  </span>
                </div>
                {p.researchQuestion && (
                  <p className="line-clamp-2 text-xs text-ink-muted">{p.researchQuestion}</p>
                )}
                <p className="text-[10px] text-ink-muted">
                  Updated {new Date(p.updatedAt).toLocaleDateString()}
                </p>
              </button>
            ))}
          </div>
        )}
      </div>
      {children}
    </div>
  );
}

// ----- create project dialog -----

function CreateProjectDialog({
  onSubmit,
  onCancel,
}: {
  onSubmit: (title: string, researchQuestion: string) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState("");
  const [question, setQuestion] = useState("");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onCancel}>
      <div className="w-full max-w-md rounded-xl border border-surface-3 bg-surface-2 p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-4 text-sm font-semibold">New Research Project</h3>
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs text-ink-muted">Project title *</label>
            <input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Literature review on transformer architectures"
              className="w-full rounded-lg border border-surface-3 bg-surface px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-ink-muted">Research question</label>
            <textarea
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="e.g. How have attention mechanisms evolved to handle long-range dependencies?"
              rows={3}
              className="w-full rounded-lg border border-surface-3 bg-surface px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
            />
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onCancel} className="rounded-lg px-3 py-1.5 text-xs text-ink-muted hover:bg-surface-3">
            Cancel
          </button>
          <button
            onClick={() => title.trim() && onSubmit(title.trim(), question.trim())}
            disabled={!title.trim()}
            className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs text-white hover:bg-indigo-500 disabled:opacity-50"
          >
            Create
          </button>
        </div>
      </div>
    </div>
  );
}

// ----- paper list -----

function PaperList({
  papers,
  selectedId,
  onSelect,
}: {
  papers: CompassPaper[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  if (papers.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center">
        <FileText size={32} className="text-ink-muted opacity-40" />
        <p className="text-xs text-ink-muted">No papers yet.</p>
        <p className="text-xs text-ink-muted">Click "Add Paper" to start your corpus.</p>
      </div>
    );
  }

  const sorted = [...papers].sort((a, b) => {
    // Sort by status: to_read first, then reading, then read.
    const order = { to_read: 0, reading: 1, read: 2 };
    return order[a.status] - order[b.status];
  });

  return (
    <div className="p-2">
      {sorted.map((p) => {
        const StatusIcon = STATUS_META[p.status].icon;
        const isSelected = p.id === selectedId;
        return (
          <button
            key={p.id}
            onClick={() => onSelect(p.id)}
            className={`mb-1 w-full rounded-lg p-2.5 text-left transition ${
              isSelected ? "bg-indigo-600/20 ring-1 ring-indigo-500/50" : "hover:bg-surface-2"
            }`}
          >
            <div className="flex items-start gap-2">
              <StatusIcon size={14} className={`mt-0.5 shrink-0 ${STATUS_META[p.status].color}`} />
              <div className="min-w-0 flex-1">
                <p className={`line-clamp-2 text-xs font-medium ${isSelected ? "text-ink" : "text-ink"}`}>{p.title}</p>
                {p.authors.length > 0 && (
                  <p className="mt-0.5 truncate text-[10px] text-ink-muted">{authorsString(p.authors)}{p.year ? ` (${p.year})` : ""}</p>
                )}
                <div className="mt-1 flex items-center gap-1.5">
                  <span className={`text-[10px] ${EXTRACT_STATUS_META[p.extractStatus].color}`}>
                    {p.extractStatus === "extracting" && <Loader2 size={9} className="mr-0.5 inline animate-spin" />}
                    {EXTRACT_STATUS_META[p.extractStatus].label}
                  </span>
                </div>
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}

// ----- citation graph view -----

function CitationGraphView({
  nodes,
  links,
  onNodeClick,
}: {
  nodes: GraphNode[];
  links: GraphLink[];
  onNodeClick: (node: GraphNode) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 800, height: 600 });

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(containerRef.current);
    const rect = containerRef.current.getBoundingClientRect();
    setSize({ width: rect.width, height: rect.height });
    return () => observer.disconnect();
  }, []);

  if (nodes.length === 0) {
    return (
      <div ref={containerRef} className="flex h-full flex-col items-center justify-center gap-3 text-center">
        <Network size={48} className="text-ink-muted opacity-40" />
        <p className="text-sm text-ink-muted">No papers in this project yet.</p>
        <p className="max-w-xs text-xs text-ink-muted">
          Add papers and run extraction to build the citation graph. Each paper becomes a node;
          citation edges connect papers that reference each other.
        </p>
      </div>
    );
  }

  if (links.length === 0) {
    return (
      <div ref={containerRef} className="flex h-full flex-col items-center justify-center gap-3 text-center">
        <Network size={48} className="text-ink-muted opacity-40" />
        <p className="text-sm text-ink-muted">{nodes.length} paper{nodes.length !== 1 ? "s" : ""} in the corpus.</p>
        <p className="max-w-xs text-xs text-ink-muted">
          No citation edges yet. Run extraction on papers to detect citations and build the graph.
          Click a paper in the left panel to analyze it.
        </p>
      </div>
    );
  }

  const nodeColor = (n: GraphNode) => {
    if (n.status === "read") return "#34d399";
    if (n.status === "reading") return "#fbbf24";
    return "#94a3b8";
  };

  return (
    <div ref={containerRef} className="relative h-full w-full">
      <ForceGraph2D
        graphData={{ nodes, links }}
        width={size.width}
        height={size.height}
        nodeRelSize={6}
        nodeColor={nodeColor}
        nodeLabel="label"
        linkColor={(l) => (l as GraphLink).inCorpus ? "#6366f1" : "#475569"}
        linkDirectionalArrowLength={4}
        linkDirectionalArrowRelPos={1}
        onNodeClick={(n) => onNodeClick(n as GraphNode)}
        cooldownTicks={100}
      />
      {/* Legend */}
      <div className="absolute bottom-2 left-2 flex flex-col gap-1 rounded-lg bg-surface-2/80 p-2 text-[10px] backdrop-blur">
        <div className="flex items-center gap-1.5"><div className="h-2 w-2 rounded-full bg-emerald-400" /> Read</div>
        <div className="flex items-center gap-1.5"><div className="h-2 w-2 rounded-full bg-amber-400" /> Reading</div>
        <div className="flex items-center gap-1.5"><div className="h-2 w-2 rounded-full bg-slate-400" /> To Read</div>
      </div>
    </div>
  );
}

// ----- paper detail -----

function PaperDetail({
  paper,
  onExtract,
  onStatusChange,
  onDelete,
  onOpenFile,
}: {
  paper: CompassPaper;
  onExtract: () => void;
  onStatusChange: (status: string) => void;
  onDelete: () => void;
  onOpenFile: (fileId: string) => void;
}) {
  const [editingAnnotations, setEditingAnnotations] = useState(false);
  const [annotations, setAnnotations] = useState(paper.annotations);
  const [savingAnnotations, setSavingAnnotations] = useState(false);

  useEffect(() => {
    setAnnotations(paper.annotations);
  }, [paper.id, paper.annotations]);

  const handleSaveAnnotations = async () => {
    setSavingAnnotations(true);
    try {
      // We need the project id — but we can use the paper's projectId.
      // The updatePaper API needs projectId + paperId.
      // We'll use a direct fetch here since we don't have the projectId
      // in this component's props... actually we do: paper.projectId.
      const { compassApi } = await import("../../services/compass");
      await compassApi.updatePaper(paper.projectId, paper.id, { annotations });
      setEditingAnnotations(false);
    } finally {
      setSavingAnnotations(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto p-4">
      {/* Title + metadata */}
      <div className="mb-4">
        <h3 className="text-base font-semibold text-ink">{paper.title}</h3>
        {paper.authors.length > 0 && (
          <p className="mt-1 text-sm text-ink-muted">{paper.authors.join(", ")}</p>
        )}
        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-muted">
          {paper.year && <span>{paper.year}</span>}
          {paper.venue && <span>· {paper.venue}</span>}
          {paper.doi && <span>· DOI: {paper.doi}</span>}
          {paper.url && (
            <a href={paper.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-0.5 text-indigo-400 hover:underline">
              <ExternalLink size={10} /> Link
            </a>
          )}
          {paper.fileId && (
            <button
              onClick={() => onOpenFile(paper.fileId!)}
              className="flex items-center gap-0.5 text-indigo-400 hover:underline"
            >
              <FileText size={10} /> Open file
            </button>
          )}
        </div>
      </div>

      {/* Status selector */}
      <div className="mb-4 flex items-center gap-2">
        <span className="text-xs text-ink-muted">Reading status:</span>
        {(Object.keys(STATUS_META) as CompassPaper["status"][]).map((s) => {
          const Icon = STATUS_META[s].icon;
          return (
            <button
              key={s}
              onClick={() => onStatusChange(s)}
              className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] ${
                paper.status === s
                  ? `bg-surface-3 ${STATUS_META[s].color}`
                  : "text-ink-muted hover:bg-surface-2"
              }`}
            >
              <Icon size={10} /> {STATUS_META[s].label}
            </button>
          );
        })}
      </div>

      {/* Abstract */}
      {paper.abstract && (
        <div className="mb-4">
          <h4 className="mb-1 text-xs font-semibold text-ink-muted">Abstract</h4>
          <p className="text-sm text-ink leading-relaxed">{paper.abstract}</p>
        </div>
      )}

      {/* Extraction */}
      <div className="mb-4 rounded-lg border border-surface-3 bg-surface-2 p-3">
        <div className="mb-2 flex items-center justify-between">
          <h4 className="text-xs font-semibold text-ink-muted">AI Analysis</h4>
          <button
            onClick={onExtract}
            disabled={paper.extractStatus === "extracting" || !paper.fullText}
            className="flex items-center gap-1 rounded-lg bg-indigo-600 px-2 py-1 text-[10px] text-white hover:bg-indigo-500 disabled:opacity-50"
          >
            {paper.extractStatus === "extracting" ? (
              <><Loader2 size={10} className="animate-spin" /> Analyzing…</>
            ) : paper.extracted ? (
              <><RefreshCw size={10} /> Re-analyze</>
            ) : (
              <><Sparkles size={10} /> Extract</>
            )}
          </button>
        </div>
        {!paper.fullText && (
          <p className="text-[10px] text-ink-muted">
            No text available for extraction. Add a PDF or URL source to enable analysis.
          </p>
        )}
        {paper.extractStatus === "error" && (
          <p className="text-[10px] text-red-400">{paper.extractError}</p>
        )}
        {paper.keyConcepts.length > 0 && (
          <div className="mt-2">
            <p className="mb-1 text-[10px] text-ink-muted">Key concepts:</p>
            <div className="flex flex-wrap gap-1">
              {paper.keyConcepts.map((c, i) => (
                <span
                  key={i}
                  className="rounded-full bg-indigo-600/20 px-2 py-0.5 text-[10px] text-indigo-300"
                  title={c.definition}
                >
                  {c.label}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Annotations */}
      <div className="mb-4">
        <div className="mb-1 flex items-center justify-between">
          <h4 className="text-xs font-semibold text-ink-muted">My Notes</h4>
          {!editingAnnotations ? (
            <button
              onClick={() => setEditingAnnotations(true)}
              className="flex items-center gap-0.5 text-[10px] text-indigo-400 hover:underline"
            >
              <Edit3 size={10} /> Edit
            </button>
          ) : (
            <button
              onClick={handleSaveAnnotations}
              disabled={savingAnnotations}
              className="flex items-center gap-0.5 text-[10px] text-emerald-400 hover:underline"
            >
              {savingAnnotations ? <Loader2 size={10} className="animate-spin" /> : <Save size={10} />} Save
            </button>
          )}
        </div>
        {editingAnnotations ? (
          <textarea
            value={annotations}
            onChange={(e) => setAnnotations(e.target.value)}
            rows={6}
            placeholder="Add your notes about this paper…"
            className="w-full rounded-lg border border-surface-3 bg-surface px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
          />
        ) : (
          <p className="text-sm text-ink-muted whitespace-pre-wrap">
            {paper.annotations || "(no notes yet)"}
          </p>
        )}
      </div>

      {/* Delete */}
      <button
        onClick={onDelete}
        className="flex items-center gap-1 text-xs text-red-400 hover:underline"
      >
        <Trash2 size={12} /> Remove from project
      </button>
    </div>
  );
}

// ----- add paper dialog -----

function AddPaperDialog({
  onSubmit,
  onCancel,
}: {
  onSubmit: (data: {
    sourceType: "file" | "url" | "manual";
    fileId?: string;
    url?: string;
    title?: string;
    authors?: string[];
    year?: number;
    venue?: string;
    doi?: string;
  }) => void;
  onCancel: () => void;
}) {
  const [tab, setTab] = useState<"file" | "url" | "manual">("file");
  const [files, setFiles] = useState<VFile[]>([]);
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [authors, setAuthors] = useState("");
  const [year, setYear] = useState("");
  const [venue, setVenue] = useState("");
  const [doi, setDoi] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (tab === "file" && files.length === 0) {
      setLoadingFiles(true);
      filesApi.list(null).then((res) => {
        // Filter to PDFs and text files.
        const relevant = res.files.filter((f) =>
          f.mimeType === "application/pdf" ||
          f.name.toLowerCase().endsWith(".pdf") ||
          f.mimeType.startsWith("text/") ||
          [".txt", ".md", ".markdown"].some((ext) => f.name.toLowerCase().endsWith(ext))
        );
        setFiles(relevant);
      }).catch(() => {}).finally(() => setLoadingFiles(false));
    }
  }, [tab, files.length]);

  const handleSubmit = () => {
    setSubmitting(true);
    const authorsArr = authors.split(",").map((a) => a.trim()).filter(Boolean);
    const yearNum = year ? parseInt(year, 10) : undefined;
    if (tab === "file") {
      if (!selectedFileId) { setSubmitting(false); return; }
      onSubmit({ sourceType: "file", fileId: selectedFileId, authors: authorsArr, year: yearNum, venue, doi });
    } else if (tab === "url") {
      if (!url.trim()) { setSubmitting(false); return; }
      onSubmit({ sourceType: "url", url: url.trim(), title: title.trim() || undefined, authors: authorsArr, year: yearNum, venue, doi });
    } else {
      if (!title.trim()) { setSubmitting(false); return; }
      onSubmit({ sourceType: "manual", title: title.trim(), authors: authorsArr, year: yearNum, venue, doi });
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onCancel}>
      <div className="w-full max-w-lg rounded-xl border border-surface-3 bg-surface-2 p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-semibold">Add Paper</h3>
          <button onClick={onCancel} className="text-ink-muted hover:text-ink"><X size={16} /></button>
        </div>

        {/* Tabs */}
        <div className="mb-4 flex gap-1 border-b border-surface-3">
          {(["file", "url", "manual"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-3 py-1.5 text-xs font-medium ${
                tab === t ? "border-b-2 border-indigo-500 text-ink" : "text-ink-muted hover:text-ink"
              }`}
            >
              {t === "file" ? "From Files" : t === "url" ? "From URL" : "Manual Entry"}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="space-y-3">
          {tab === "file" && (
            <div>
              {loadingFiles ? (
                <div className="flex items-center gap-2 text-xs text-ink-muted"><Loader2 size={14} className="animate-spin" /> Loading files…</div>
              ) : files.length === 0 ? (
                <p className="text-xs text-ink-muted">No PDF or text files found. Upload a paper to Files first.</p>
              ) : (
                <div className="max-h-48 overflow-y-auto rounded-lg border border-surface-3">
                  {files.map((f) => (
                    <button
                      key={f.id}
                      onClick={() => setSelectedFileId(f.id)}
                      className={`flex w-full items-center gap-2 p-2 text-left text-xs transition ${
                        selectedFileId === f.id ? "bg-indigo-600/20" : "hover:bg-surface-2"
                      }`}
                    >
                      <FileText size={14} className="shrink-0 text-ink-muted" />
                      <span className="truncate">{f.name}</span>
                      <span className="ml-auto shrink-0 text-[10px] text-ink-muted">
                        {(f.size / 1024).toFixed(0)} KB
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {tab === "url" && (
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://arxiv.org/abs/..."
              className="w-full rounded-lg border border-surface-3 bg-surface px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
            />
          )}
          {tab === "manual" && (
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Paper title *"
              className="w-full rounded-lg border border-surface-3 bg-surface px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
            />
          )}

          {/* Common metadata fields (optional) */}
          {(tab !== "file" || selectedFileId) && (tab !== "url" || url.trim()) && (tab !== "manual" || title.trim()) && (
            <>
              <input
                value={authors}
                onChange={(e) => setAuthors(e.target.value)}
                placeholder="Authors (comma-separated, optional)"
                className="w-full rounded-lg border border-surface-3 bg-surface px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
              />
              <div className="flex gap-2">
                <input
                  value={year}
                  onChange={(e) => setYear(e.target.value)}
                  placeholder="Year"
                  className="w-24 rounded-lg border border-surface-3 bg-surface px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
                />
                <input
                  value={venue}
                  onChange={(e) => setVenue(e.target.value)}
                  placeholder="Venue (e.g. NeurIPS)"
                  className="flex-1 rounded-lg border border-surface-3 bg-surface px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
                />
              </div>
              <input
                value={doi}
                onChange={(e) => setDoi(e.target.value)}
                placeholder="DOI (optional)"
                className="w-full rounded-lg border border-surface-3 bg-surface px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
              />
            </>
          )}
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onCancel} className="rounded-lg px-3 py-1.5 text-xs text-ink-muted hover:bg-surface-3">
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting ||
              (tab === "file" && !selectedFileId) ||
              (tab === "url" && !url.trim()) ||
              (tab === "manual" && !title.trim())}
            className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs text-white hover:bg-indigo-500 disabled:opacity-50"
          >
            Add Paper
          </button>
        </div>
      </div>
    </div>
  );
}

// ----- search dialog -----

function SearchDialog({
  projectId,
  onAddResult,
  onCancel,
}: {
  projectId: string;
  onAddResult: (result: SearchResult) => void;
  onCancel: () => void;
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

  const handleAdd = (result: SearchResult) => {
    onAddResult(result);
    setAddedUrls((prev) => new Set([...prev, result.url]));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onCancel}>
      <div className="flex max-h-[80vh] w-full max-w-2xl flex-col rounded-xl border border-surface-3 bg-surface-2 p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-semibold">Find Related Work</h3>
          <button onClick={onCancel} className="text-ink-muted hover:text-ink"><X size={16} /></button>
        </div>
        <p className="mb-3 text-xs text-ink-muted">
          Searches the web for related academic work, enriched with your project's research question and key concepts.
        </p>
        <div className="mb-4 flex gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            placeholder="e.g. transformer attention mechanisms survey"
            className="flex-1 rounded-lg border border-surface-3 bg-surface px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
            autoFocus
          />
          <button
            onClick={handleSearch}
            disabled={searching || !query.trim()}
            className="flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-2 text-xs text-white hover:bg-indigo-500 disabled:opacity-50"
          >
            {searching ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
            Search
          </button>
        </div>
        {error && <p className="mb-2 text-xs text-red-400">{error}</p>}
        <div className="flex-1 overflow-y-auto">
          {results.map((r, i) => (
            <div key={i} className="mb-2 rounded-lg border border-surface-3 bg-surface p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <a href={r.url} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-indigo-400 hover:underline">
                    {r.title}
                  </a>
                  <p className="mt-0.5 text-[10px] text-ink-muted">{r.url}</p>
                  <p className="mt-1 text-xs text-ink-muted line-clamp-2">{r.description}</p>
                  {r.inCorpus && <span className="mt-1 inline-block rounded-full bg-emerald-600/20 px-2 py-0.5 text-[10px] text-emerald-400">Already in corpus</span>}
                </div>
                {!r.inCorpus && !addedUrls.has(r.url) && (
                  <button
                    onClick={() => handleAdd(r)}
                    className="shrink-0 rounded-lg bg-surface-3 px-2 py-1 text-[10px] hover:brightness-110"
                  >
                    <Plus size={10} className="mr-0.5 inline" /> Add
                  </button>
                )}
                {addedUrls.has(r.url) && (
                  <span className="shrink-0 text-[10px] text-emerald-400"><CheckCircle2 size={12} className="inline" /> Added</span>
                )}
              </div>
            </div>
          ))}
          {results.length === 0 && !searching && query.trim() && (
            <p className="text-center text-xs text-ink-muted">No results yet. Try a search.</p>
          )}
        </div>
      </div>
    </div>
  );
}

// ----- review panel -----

function ReviewPanel({
  projectId,
  projectTitle,
  review,
  onGenerate,
  onOpenEditor,
}: {
  projectId: string;
  projectTitle: string;
  review: CompassReview | null;
  onGenerate: () => void;
  onOpenEditor: (content: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [showFullscreen, setShowFullscreen] = useState(false);
  const [savingFile, setSavingFile] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  useEffect(() => {
    setEditing(false);
  }, [review?.status]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await compassApi.updateReview(projectId, editContent);
      setEditing(false);
    } catch {
      // ignore — error will show on next poll
    } finally {
      setSaving(false);
    }
  };

  // Save the review as a Markdown file in the user's Files (root folder).
  // The filename is derived from the project title + a "Literature Review"
  // suffix, sanitized for filesystem safety.
  const handleSaveToFile = async () => {
    if (!review || review.status !== "ready") return;
    setSavingFile(true);
    setSaveMsg(null);
    try {
      const safe = projectTitle.replace(/[^a-z0-9\-_ ]/gi, "").trim().replace(/\s+/g, "_") || "review";
      const name = `${safe}_Literature_Review.md`;
      await filesApi.createText({ name, folderId: null, content: review.content });
      setSaveMsg(`Saved as "${name}"`);
      setTimeout(() => setSaveMsg(null), 4000);
    } catch (e) {
      setSaveMsg(e instanceof Error ? `Failed: ${e.message}` : "Failed to save");
    } finally {
      setSavingFile(false);
    }
  };

  if (!review || review.status === "empty") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-4 text-center">
        <BookOpen size={32} className="text-ink-muted opacity-40" />
        <p className="text-sm text-ink-muted">No literature review yet.</p>
        <p className="max-w-xs text-xs text-ink-muted">
          Generate a structured literature review from your paper corpus. The AI will
          synthesize your papers thematically, discuss the citation graph, and identify gaps.
        </p>
        <button
          onClick={onGenerate}
          className="mt-1 flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-2 text-xs text-white hover:bg-indigo-500"
        >
          <Sparkles size={14} /> Generate Review
        </button>
      </div>
    );
  }

  if (review.status === "building") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-4 text-center">
        <Loader2 size={32} className="animate-spin text-indigo-400" />
        <p className="text-sm text-ink-muted">Generating literature review…</p>
        <p className="text-xs text-ink-muted">This may take a minute. The review will appear here automatically.</p>
      </div>
    );
  }

  if (review.status === "error") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-4 text-center">
        <AlertCircle size={32} className="text-red-400" />
        <p className="text-sm text-red-400">Generation failed</p>
        <p className="max-w-xs text-xs text-ink-muted">{review.error}</p>
        <button
          onClick={onGenerate}
          className="mt-1 flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-2 text-xs text-white hover:bg-indigo-500"
        >
          <RefreshCw size={14} /> Retry
        </button>
      </div>
    );
  }

  // Ready
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-surface-3 px-3 py-2">
        <div className="flex items-center gap-1">
          <button
            onClick={onGenerate}
            className="flex items-center gap-1 rounded-lg p-1.5 text-ink-muted hover:bg-surface-3 hover:text-ink"
            title="Regenerate"
          >
            <RefreshCw size={12} />
          </button>
          <button
            onClick={() => onOpenEditor(review.content)}
            className="flex items-center gap-1 rounded-lg p-1.5 text-ink-muted hover:bg-surface-3 hover:text-ink"
            title="Open in Editor"
          >
            <Edit3 size={12} />
          </button>
          <button
            onClick={handleSaveToFile}
            disabled={savingFile}
            className="flex items-center gap-1 rounded-lg p-1.5 text-ink-muted hover:bg-surface-3 hover:text-ink disabled:opacity-50"
            title="Save as Markdown file in Files"
          >
            {savingFile ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
          </button>
          <button
            onClick={() => setShowFullscreen(true)}
            className="flex items-center gap-1 rounded-lg p-1.5 text-ink-muted hover:bg-surface-3 hover:text-ink"
            title="Fullscreen view"
          >
            <Maximize2 size={12} />
          </button>
        </div>
        {!editing ? (
          <button
            onClick={() => { setEditContent(review.content); setEditing(true); }}
            className="text-[10px] text-indigo-400 hover:underline"
          >
            Edit
          </button>
        ) : (
          <div className="flex items-center gap-1">
            <button
              onClick={() => setEditing(false)}
              className="text-[10px] text-ink-muted hover:underline"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-0.5 text-[10px] text-emerald-400 hover:underline"
            >
              {saving ? <Loader2 size={10} className="animate-spin" /> : <Save size={10} />} Save
            </button>
          </div>
        )}
      </div>
      {editing ? (
        <textarea
          value={editContent}
          onChange={(e) => setEditContent(e.target.value)}
          className="flex-1 resize-none bg-surface p-3 font-mono text-xs focus:outline-none"
        />
      ) : (
        <div className="flex-1 overflow-y-auto p-4">
          <ReviewMarkdown content={review.content} />
        </div>
      )}
      <div className="flex items-center justify-between border-t border-surface-3 px-3 py-1.5 text-[10px] text-ink-muted">
        {review.generatedAt ? (
          <span>Generated {new Date(review.generatedAt).toLocaleString()}</span>
        ) : <span />}
        {saveMsg && <span className="text-emerald-400">{saveMsg}</span>}
      </div>
      {showFullscreen && (
        <ReviewFullscreenDialog
          title={projectTitle}
          content={review.content}
          onClose={() => setShowFullscreen(false)}
        />
      )}
    </div>
  );
}

// ----- fullscreen review dialog -----

function ReviewFullscreenDialog({
  title,
  content,
  onClose,
}: {
  title: string;
  content: string;
  onClose: () => void;
}) {
  // Close on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-surface" onClick={onClose}>
      <div
        className="flex items-center justify-between border-b border-surface-3 bg-surface-2 px-4 py-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex min-w-0 items-center gap-2">
          <BookOpen size={16} className="shrink-0 text-indigo-400" />
          <h3 className="truncate text-sm font-semibold">{title} — Literature Review</h3>
        </div>
        <button
          onClick={onClose}
          className="rounded-lg p-1.5 text-ink-muted hover:bg-surface-3 hover:text-ink"
          title="Close (Esc)"
        >
          <X size={18} />
        </button>
      </div>
      <div
        className="flex-1 overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="selectable markdown-body mx-auto max-w-3xl p-8">
          <ReviewMarkdown content={content} />
        </div>
      </div>
    </div>
  );
}

// ----- markdown renderer (react-markdown + clickable [n] citations) -----
//
// Uses react-markdown + remark-gfm for full GFM support (tables, task lists,
// strikethrough, code blocks, blockquotes) styled by the shared `.markdown-body`
// CSS. Inline `[n]` citation references emitted by the LLM are turned into
// clickable superscript badges that scroll to the matching entry in the
// review's References / Bibliography section (matched by a leading "[n]" token
// in a list item). If no matching anchor is found, the badge is still styled
// but non-clickable.

function ReviewMarkdown({ content }: { content: string }) {
  // Collect the set of citation numbers that have a corresponding entry in a
  // "References" / "Bibliography" list, so we can render badges as links only
  // when they resolve. We scan list-item lines starting with "[n]".
  const refNumbers = useMemo(() => {
    const nums = new Set<string>();
    const lines = content.split("\n");
    for (const line of lines) {
      const m = line.match(/^\s*[-*]\s*\[(\d+)\]/);
      if (m) nums.add(m[1]);
    }
    return nums;
  }, [content]);

  const scrollToRef = useCallback((n: string, fromEl?: Element | null) => {
    // Find a list item whose text starts with "[n]" and scroll it into view.
    // Scope the search to the closest .markdown-body ancestor of the clicked
    // badge so the right container is used when both the inline panel and the
    // fullscreen dialog are mounted.
    const container = fromEl?.closest(".markdown-body") ?? document.querySelector(".markdown-body");
    if (!container) return;
    const items = container.querySelectorAll("li");
    for (const li of items) {
      const text = li.textContent?.trim() ?? "";
      if (text.startsWith(`[${n}]`)) {
        li.scrollIntoView({ behavior: "smooth", block: "center" });
        li.classList.add("ring-2", "ring-indigo-500/60", "rounded");
        setTimeout(() => li.classList.remove("ring-2", "ring-indigo-500/60", "rounded"), 1800);
        return;
      }
    }
  }, []);

  // Custom text renderer: walk children, replacing bare "[n]" tokens with
  // clickable citation badges. react-markdown gives us an array of strings
  // and elements as children for text nodes.
  const renderText = useCallback(
    (children: React.ReactNode): React.ReactNode => {
      if (children == null) return children;
      if (typeof children === "string") {
        return splitCitations(children, refNumbers, scrollToRef);
      }
      if (Array.isArray(children)) {
        return children.map((c, i) =>
          typeof c === "string" ? <span key={i}>{splitCitations(c, refNumbers, scrollToRef)}</span> : c
        );
      }
      return children;
    },
    [refNumbers, scrollToRef]
  );

  // Note: splitCitations receives scrollToRef which takes an optional fromEl
  // resolved from the click event target inside the badge button.

  return (
    <div className="selectable markdown-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // Inject citation handling into every text-bearing element.
          p: ({ children }) => <p>{renderText(children)}</p>,
          li: ({ children }) => <li>{renderText(children)}</li>,
          td: ({ children }) => <td>{renderText(children)}</td>,
          th: ({ children }) => <th>{renderText(children)}</th>,
          // Open external links in a new tab.
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

/** Split a string into text + clickable [n] citation badges. */
function splitCitations(
  text: string,
  refNumbers: Set<string>,
  scrollToRef: (n: string, fromEl?: Element | null) => void
): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const re = /\[(\d+)\]/g;
  let last = 0;
  let key = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const n = m[1];
    const hasRef = refNumbers.has(n);
    out.push(
      hasRef ? (
        <button
          key={`cite-${key++}`}
          onClick={(e) => { e.stopPropagation(); scrollToRef(n, e.currentTarget); }}
          className="mx-0.5 align-super text-[0.7em] font-semibold text-indigo-400 hover:text-indigo-300 hover:underline"
          title={`Jump to reference [${n}]`}
        >
          [{n}]
        </button>
      ) : (
        <span key={`cite-${key++}`} className="mx-0.5 align-super text-[0.7em] font-semibold text-indigo-400">
          [{n}]
        </span>
      )
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

// ----- gaps panel -----

function GapsPanel({
  projectId,
  onAddPaper,
}: {
  projectId: string;
  onAddPaper: () => void;
}) {
  const [gaps, setGaps] = useState<ReadingGaps | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    compassApi.getGaps(projectId).then(setGaps).catch(() => {}).finally(() => setLoading(false));
  }, [projectId]);

  if (loading) {
    return <div className="flex items-center justify-center p-4"><Loader2 className="animate-spin text-ink-muted" size={20} /></div>;
  }
  if (!gaps) {
    return <div className="p-4 text-center text-xs text-ink-muted">Failed to load reading gaps.</div>;
  }

  return (
    <div className="p-4">
      {/* Stats */}
      <div className="mb-4 grid grid-cols-3 gap-2">
        <div className="rounded-lg bg-surface-2 p-2 text-center">
          <p className="text-lg font-semibold text-ink">{gaps.totalCount}</p>
          <p className="text-[10px] text-ink-muted">Total</p>
        </div>
        <div className="rounded-lg bg-surface-2 p-2 text-center">
          <p className="text-lg font-semibold text-emerald-400">{gaps.readCount}</p>
          <p className="text-[10px] text-ink-muted">Read</p>
        </div>
        <div className="rounded-lg bg-surface-2 p-2 text-center">
          <p className="text-lg font-semibold text-amber-400">{gaps.unreadCount}</p>
          <p className="text-[10px] text-ink-muted">To Read</p>
        </div>
      </div>

      {/* Gaps */}
      {gaps.gaps.length === 0 ? (
        <div className="mb-4 flex items-center gap-2 rounded-lg bg-emerald-600/10 p-3">
          <CheckCircle2 size={16} className="text-emerald-400" />
          <p className="text-xs text-emerald-400">No significant gaps detected. Your corpus looks well-balanced.</p>
        </div>
      ) : (
        <div className="mb-4 space-y-2">
          {gaps.gaps.map((gap, i) => {
            const Icon = gap.severity === "warning" ? AlertTriangle : Lightbulb;
            const color = gap.severity === "warning" ? "text-amber-400" : "text-indigo-400";
            return (
              <div key={i} className={`rounded-lg bg-surface-2 p-3`}>
                <div className="mb-1 flex items-center gap-1.5">
                  <Icon size={14} className={color} />
                  <span className={`text-xs font-medium ${color}`}>{gap.kind.replace("_", " ")}</span>
                </div>
                <p className="text-xs text-ink-muted">{gap.description}</p>
              </div>
            );
          })}
        </div>
      )}

      {/* Year distribution */}
      {gaps.yearDistribution.length > 0 && (
        <div className="mb-4">
          <h4 className="mb-2 text-xs font-semibold text-ink-muted">Year Distribution</h4>
          <div className="flex items-end gap-1" style={{ height: 60 }}>
            {gaps.yearDistribution.map((y) => {
              const maxCount = Math.max(...gaps.yearDistribution.map((d) => d.count));
              const h = (y.count / maxCount) * 50;
              return (
                <div key={y.year} className="flex flex-1 flex-col items-center gap-0.5" title={`${y.year}: ${y.count} paper${y.count !== 1 ? "s" : ""}`}>
                  <div className="w-full rounded-t bg-indigo-500/60" style={{ height: h }} />
                  <span className="text-[8px] text-ink-muted">{y.year}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <button
        onClick={onAddPaper}
        className="w-full rounded-lg bg-surface-3 py-2 text-xs text-ink-muted hover:brightness-110"
      >
        + Add papers to fill gaps
      </button>
    </div>
  );
}

// ----- gaps dialog (full-screen version) -----

function GapsDialog({
  projectId,
  onClose,
}: {
  projectId: string;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="flex max-h-[80vh] w-full max-w-md flex-col rounded-xl border border-surface-3 bg-surface-2 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-surface-3 px-4 py-3">
          <h3 className="text-sm font-semibold">Reading Gaps Analysis</h3>
          <button onClick={onClose} className="text-ink-muted hover:text-ink"><X size={16} /></button>
        </div>
        <div className="flex-1 overflow-y-auto">
          <GapsPanel projectId={projectId} onAddPaper={onClose} />
        </div>
      </div>
    </div>
  );
}
