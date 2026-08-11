import { useCallback, useEffect, useRef, useState } from "react";
import {
  ChevronRight, Folder as FolderIcon, MoreVertical, Pencil, Plus, Search,
  Star, Trash2, Upload, FolderInput, GraduationCap, ExternalLink,
} from "lucide-react";
import {
  filesApi, formatBytes, isImageFile, isTextFile,
  openTargetForFile,
} from "../services/files";
import type { VFile, VFolder } from "../types";
import type { MobileTool } from "./MobileLauncher";
import type { MobileToolPayload } from "./MobileToolPage";
import {
  MobileButton, MobileContainer, MobileEmpty, MobileFab, MobileInput, MobileLoading, MobileModal,
} from "./MobileUi";

const EXT_EMOJI: Record<string, string> = {
  image: "🖼️", pdf: "📕", audio: "🎵", video: "🎬", text: "📝", archive: "🗜️", code: "💻", default: "📄",
};

function emojiFor(file: VFile): string {
  if (file.mimeType.startsWith("image/")) return EXT_EMOJI.image;
  if (file.mimeType === "application/pdf") return EXT_EMOJI.pdf;
  if (file.mimeType.startsWith("audio/")) return EXT_EMOJI.audio;
  if (file.mimeType.startsWith("video/")) return EXT_EMOJI.video;
  if (isTextFile(file)) return EXT_EMOJI.text;
  if (file.mimeType.includes("zip") || file.mimeType.includes("compressed")) return EXT_EMOJI.archive;
  if (file.mimeType.startsWith("text/") || file.name.match(/\.(js|ts|jsx|tsx|py|go|rs|java|cpp|c|html|css|json)$/)) return EXT_EMOJI.code;
  return EXT_EMOJI.default;
}

export default function MobileFiles({
  onClose,
  onOpenTool,
}: {
  onClose?: () => void;
  onOpenTool?: (tool: MobileTool, payload?: MobileToolPayload) => void;
}) {
  const [folders, setFolders] = useState<VFolder[]>([]);
  const [files, setFiles] = useState<VFile[]>([]);
  const [folderId, setFolderId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);

  // Breadcrumb trail (folder id -> name). Root is null.
  const [crumbs, setCrumbs] = useState<{ id: string; name: string }[]>([]);

  // Modals
  const [showCreate, setShowCreate] = useState(false);
  const [newFolder, setNewFolder] = useState("");
  const [renameTarget, setRenameTarget] = useState<{ kind: "file" | "folder"; id: string; name: string } | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [moveTarget, setMoveTarget] = useState<VFile | null>(null);
  const [fileMenu, setFileMenu] = useState<VFile | null>(null);

  // Image preview
  const [previewImg, setPreviewImg] = useState<VFile | null>(null);

  const fileRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [fRes, allRes] = await Promise.all([
      filesApi.listFolders(folderId).catch(() => null),
      query.trim() ? filesApi.all({ q: query.trim() }).catch(() => null) : filesApi.list(folderId).catch(() => null),
    ]);
    if (fRes) setFolders(fRes.folders);
    setFiles(allRes?.files ?? []);
    setLoading(false);
  }, [folderId, query]);

  useEffect(() => {
    const t = setTimeout(() => { void load(); }, 250);
    return () => clearTimeout(t);
  }, [load]);

  const enterFolder = (folder: VFolder) => {
    setCrumbs((c) => [...c, { id: folder.id, name: folder.name }]);
    setFolderId(folder.id);
  };

  const goToCrumb = (index: number) => {
    if (index < 0) {
      setCrumbs([]);
      setFolderId(null);
    } else {
      setCrumbs((c) => c.slice(0, index + 1));
      setFolderId(crumbs[index].id);
    }
  };

  const createFolder = async () => {
    if (!newFolder.trim()) return;
    const res = await filesApi.createFolder({ name: newFolder.trim(), parentId: folderId }).catch(() => null);
    if (res?.folder) setFolders((list) => [...list, res.folder]);
    setNewFolder("");
    setShowCreate(false);
  };

  const upload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await filesApi.upload(file, folderId).catch(() => {});
    e.target.value = "";
    void load();
  };

  const toggleStar = async (f: VFile) => {
    await filesApi.toggleStar(f.id).catch(() => {});
    setFiles((list) => list.map((x) => x.id === f.id ? { ...x, starred: !x.starred } : x));
    setFileMenu(null);
  };

  const remove = async (f: VFile) => {
    if (!window.confirm(`Delete ${f.name}?`)) return;
    await filesApi.delete(f.id).catch(() => {});
    setFiles((list) => list.filter((x) => x.id !== f.id));
    setFileMenu(null);
  };

  const startRename = (target: { kind: "file" | "folder"; id: string; name: string }) => {
    setRenameTarget(target);
    setRenameValue(target.name);
    setFileMenu(null);
  };

  const confirmRename = async () => {
    if (!renameTarget || !renameValue.trim()) {
      setRenameTarget(null);
      return;
    }
    if (renameTarget.kind === "file") {
      await filesApi.rename(renameTarget.id, renameValue.trim()).catch(() => {});
      setFiles((list) => list.map((f) => (f.id === renameTarget.id ? { ...f, name: renameValue.trim() } : f)));
    } else {
      await filesApi.renameFolder(renameTarget.id, renameValue.trim()).catch(() => {});
      setFolders((list) => list.map((f) => (f.id === renameTarget.id ? { ...f, name: renameValue.trim() } : f)));
    }
    setRenameTarget(null);
  };

  const moveFile = async (targetFolderId: string | null) => {
    if (!moveTarget) return;
    await filesApi.move(moveTarget.id, targetFolderId).catch(() => {});
    setFiles((list) => list.filter((f) => f.id !== moveTarget.id));
    setMoveTarget(null);
  };

  const openFile = (f: VFile) => {
    setFileMenu(null);
    if (isImageFile(f)) {
      setPreviewImg(f);
      return;
    }
    const target = openTargetForFile(f);
    if (target === "editor") {
      onOpenTool?.("editor", { /* editor opens by file id via payload not supported yet */ });
      // Fall back to download if no editor payload wiring
      window.open(filesApi.downloadUrl(f.id), "_blank");
    } else {
      // Viewer: open in new tab via download URL (mobile doesn't have a Viewer tool page)
      window.open(filesApi.downloadUrl(f.id), "_blank");
    }
  };

  const openInStudy = (f: VFile) => {
    onOpenTool?.("study", {
      study: { mode: "summarize", sourceKind: "file", sourceId: f.id, sourceName: f.name },
    });
    setFileMenu(null);
  };

  return (
    <MobileContainer>
      <header className="mb-6 flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-accent">Your materials</p>
          <h1 className="mt-1 text-3xl font-bold text-ink">Files</h1>
        </div>
        <div className="flex items-center gap-2">
          <MobileFab onClick={() => fileRef.current?.click()} icon={<Upload size={20} />} label="Upload" />
          <MobileFab onClick={() => setShowCreate(true)} icon={<Plus size={22} />} label="New folder" />
        </div>
      </header>

      <input type="file" ref={fileRef} onChange={(e) => void upload(e)} className="hidden" />

      <div className="mb-4 flex items-center gap-2 rounded-2xl border border-edge bg-surface-2 px-3 py-2">
        <Search size={18} className="text-ink-muted" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search files"
          className="min-w-0 flex-1 bg-transparent px-2 py-1 text-sm text-ink outline-none placeholder:text-ink-muted"
        />
      </div>

      {/* Breadcrumb */}
      {!query.trim() && (
        <nav className="mb-4 flex flex-wrap items-center gap-1 text-sm">
          <button type="button" onClick={() => goToCrumb(-1)} className={`font-medium ${folderId === null ? "text-ink" : "text-accent"}`}>Home</button>
          {crumbs.map((c, i) => (
            <span key={c.id} className="flex items-center gap-1">
              <ChevronRight size={14} className="text-ink-muted" />
              <button type="button" onClick={() => goToCrumb(i)} className={`font-medium ${i === crumbs.length - 1 ? "text-ink" : "text-accent"}`}>{c.name}</button>
            </span>
          ))}
        </nav>
      )}

      {/* Subfolders */}
      {!query.trim() && folders.length > 0 && (
        <div className="mb-4 space-y-2">
          {folders.map((f) => (
            <div key={f.id} className="relative">
              <button type="button" onClick={() => enterFolder(f)} className="flex w-full items-center gap-3 rounded-2xl border border-edge bg-surface-2 p-4 text-left active:bg-surface-3">
                <FolderIcon size={22} className="text-accent" />
                <span className="min-w-0 flex-1 truncate font-medium text-ink">{f.name}</span>
                <ChevronRight size={18} className="text-ink-muted" />
              </button>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); startRename({ kind: "folder", id: f.id, name: f.name }); }}
                className="absolute right-12 top-1/2 -translate-y-1/2 flex h-8 w-8 items-center justify-center rounded-xl bg-surface-3 text-ink-muted active:bg-surface-3"
                aria-label="Folder options"
              >
                <MoreVertical size={16} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Files */}
      <div className="space-y-2">
        {loading ? (
          <MobileLoading />
        ) : files.length ? (
          files.map((f) => (
            <article key={f.id} className="flex items-center gap-3 rounded-2xl border border-edge bg-surface-2 p-4">
              <button type="button" onClick={() => openFile(f)} className="min-w-0 flex-1 text-left">
                <div className="flex items-center gap-2">
                  <span className="text-xl">{emojiFor(f)}</span>
                  <span className="min-w-0 flex-1 truncate font-medium text-ink">{f.name}</span>
                </div>
                <p className="mt-1 text-xs text-ink-muted">
                  {formatBytes(f.size)} · {new Date(f.updatedAt).toLocaleDateString()}
                </p>
              </button>
              <div className="flex items-center gap-1">
                <button type="button" onClick={() => void toggleStar(f)} className={`rounded-xl p-2 ${f.starred ? "text-amber-400" : "text-ink-muted"}`} aria-label="Star">
                  <Star size={18} fill={f.starred ? "currentColor" : "none"} />
                </button>
                <button type="button" onClick={() => setFileMenu(f)} className="rounded-xl p-2 text-ink-muted active:bg-surface-3" aria-label="More">
                  <MoreVertical size={18} />
                </button>
              </div>
            </article>
          ))
        ) : (
          <MobileEmpty text="No files here. Upload or create a folder." />
        )}
      </div>

      {/* File context menu */}
      {fileMenu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setFileMenu(null)} />
          <div className="fixed bottom-0 left-1/2 z-50 w-full max-w-md -translate-x-1/2 rounded-t-3xl border border-edge bg-surface p-2 shadow-2xl sm:bottom-auto sm:top-1/3 sm:rounded-3xl">
            <p className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">{fileMenu.name}</p>
            <button type="button" onClick={() => openFile(fileMenu)} className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-sm text-ink active:bg-surface-2">
              <ExternalLink size={18} /> Open
            </button>
            <button type="button" onClick={() => startRename({ kind: "file", id: fileMenu.id, name: fileMenu.name })} className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-sm text-ink active:bg-surface-2">
              <Pencil size={18} /> Rename
            </button>
            <button type="button" onClick={() => { setMoveTarget(fileMenu); setFileMenu(null); }} className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-sm text-ink active:bg-surface-2">
              <FolderInput size={18} /> Move
            </button>
            <button type="button" onClick={() => openInStudy(fileMenu)} className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-sm text-ink active:bg-surface-2">
              <GraduationCap size={18} /> Open in Study Hub
            </button>
            <button type="button" onClick={() => void toggleStar(fileMenu)} className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-sm text-ink active:bg-surface-2">
              <Star size={18} /> {fileMenu.starred ? "Unstar" : "Star"}
            </button>
            <div className="my-1 border-t border-edge" />
            <button type="button" onClick={() => void remove(fileMenu)} className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-sm text-rose-400 active:bg-surface-2">
              <Trash2 size={18} /> Delete
            </button>
          </div>
        </>
      )}

      {/* New folder modal */}
      <MobileModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        title="New folder"
        footer={
          <>
            <MobileButton variant="ghost" onClick={() => setShowCreate(false)}>Cancel</MobileButton>
            <MobileButton onClick={() => void createFolder()}>Create</MobileButton>
          </>
        }
      >
        <MobileInput value={newFolder} onChange={(e) => setNewFolder(e.target.value)} placeholder="Folder name" autoFocus />
      </MobileModal>

      {/* Rename modal */}
      <MobileModal
        open={!!renameTarget}
        onClose={() => setRenameTarget(null)}
        title={`Rename ${renameTarget?.kind ?? ""}`}
        footer={
          <>
            <MobileButton variant="ghost" onClick={() => setRenameTarget(null)}>Cancel</MobileButton>
            <MobileButton onClick={() => void confirmRename()}>Save</MobileButton>
          </>
        }
      >
        <MobileInput value={renameValue} onChange={(e) => setRenameValue(e.target.value)} placeholder="Name" autoFocus />
      </MobileModal>

      {/* Move modal */}
      <MobileModal
        open={!!moveTarget}
        onClose={() => setMoveTarget(null)}
        title="Move file"
      >
        <button type="button" onClick={() => void moveFile(null)} className="flex w-full items-center gap-3 rounded-xl bg-surface-2 px-3 py-3 text-left text-ink active:bg-surface-3">
          <FolderIcon size={18} className="text-accent" /> Home (root)
        </button>
        {folders.map((f) => (
          <button key={f.id} type="button" onClick={() => void moveFile(f.id)} className="flex w-full items-center gap-3 rounded-xl bg-surface-2 px-3 py-3 text-left text-ink active:bg-surface-3">
            <FolderIcon size={18} className="text-accent" /> {f.name}
          </button>
        ))}
        <p className="text-xs text-ink-muted">Note: moving between subfolders uses the current folder list. For deep moves, navigate first.</p>
      </MobileModal>

      {/* Image preview */}
      {previewImg && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onClick={() => setPreviewImg(null)}>
          <button className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-surface-2 text-ink" aria-label="Close">
            <Plus size={22} className="rotate-45" />
          </button>
          <img src={filesApi.downloadUrl(previewImg.id)} alt={previewImg.name} className="max-h-[90vh] max-w-full rounded-2xl" onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </MobileContainer>
  );
}
