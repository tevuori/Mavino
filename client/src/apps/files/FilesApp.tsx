import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import {
  Folder, File as FileIcon, FileText, Image as ImageIcon, Upload, Download,
  Trash2, FolderPlus, ChevronRight, ChevronDown, Loader2, X, FileCode,
  Search, Grid3x3, List as ListIcon, ArrowUp,
  Star, Copy, Scissors, ClipboardPaste, FilePlus, RefreshCw,
  Music as MusicIcon, Video as VideoIcon, Archive, HardDrive, Clock,
  Home, FileSymlink, Pencil,
} from "lucide-react";
import {
  filesApi, formatBytes, fileIconColor, extOf,
  isTextFile, isImageFile, isPdfFile, isAudioFile, isVideoFile,
  openTargetForFile, buildFolderTree,
} from "../../services/files";
import type { VFile, VFolder, FolderTreeNode, StorageInfo } from "../../types";
import type { WindowInstance } from "../../store/windows";
import { useWindows } from "../../store/windows";
import { useDataRefreshVersion } from "../../store/dataRefresh";
import ContextMenu, { type MenuItem } from "../../shell/ContextMenu";
import CollapsibleSidebar from "../../wm/CollapsibleSidebar";
import { setLinkPayload } from "../links/linkDnd";

type ViewMode = "grid" | "list";
type SortKey = "name" | "size" | "modified" | "type";
type SortDir = "asc" | "desc";
type SmartCollection = "home" | "recent" | "starred" | "all";

interface ClipboardItem {
  type: "file";
  id: string;
  cut: boolean;
}

export default function FilesApp(_: { win: WindowInstance }) {
  const { open: openWindow } = useWindows();
  const refreshVersion = useDataRefreshVersion("files");

  // ---- State ----
  const [folders, setFolders] = useState<VFolder[]>([]);
  const [files, setFiles] = useState<VFile[]>([]);
  const [allFolders, setAllFolders] = useState<VFolder[]>([]);
  const [fileCounts, setFileCounts] = useState<Record<string, number>>({});
  const [currentFolder, setCurrentFolder] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<SmartCollection | "folder">("home");
  const [breadcrumb, setBreadcrumb] = useState<{ id: string | null; name: string }[]>([
    { id: null, name: "Home" },
  ]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [searchQuery, setSearchQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [lastSelected, setLastSelected] = useState<string | null>(null);
  const [preview, setPreview] = useState<VFile | null>(null);
  const [clipboard, setClipboard] = useState<ClipboardItem[]>([]);
  const [storage, setStorage] = useState<StorageInfo | null>(null);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const [renaming, setRenaming] = useState<{ type: "file" | "folder"; id: string; value: string } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragCounter = useRef(0);
  const [dragOver, setDragOver] = useState(false);

  // Rubber band (lasso) selection state
  const fileAreaRef = useRef<HTMLDivElement>(null);
  const [rubberBand, setRubberBand] = useState<{ startX: number; startY: number; endX: number; endY: number } | null>(null);
  const rubberBandRef = useRef<{ startX: number; startY: number; endX: number; endY: number } | null>(null);
  const rubberBaseSelection = useRef<Set<string>>(new Set());
  const isRubberBanding = useRef(false);
  // Whether the pointer actually moved beyond a small threshold during the
  // current rubber-band interaction (vs. a simple click on empty space).
  const rubberMoved = useRef(false);
  // Suppresses the click that fires after a rubber-band drag ends, so the
  // file-area click handler doesn't wipe the selection we just made.
  const suppressNextClick = useRef(false);

  // ---- Data loading ----
  const loadTree = useCallback(async () => {
    try {
      const { folders: treeFolders, fileCounts: counts } = await filesApi.tree();
      setAllFolders(treeFolders);
      setFileCounts(counts);
    } catch (e) {
      console.error("Failed to load tree", e);
    }
  }, []);

  const loadStorage = useCallback(async () => {
    try {
      const s = await filesApi.storage();
      setStorage(s);
    } catch (e) {
      console.error("Failed to load storage", e);
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (activeView === "folder") {
        const [folderRes, fileRes] = await Promise.all([
          filesApi.listFolders(currentFolder),
          filesApi.list(currentFolder),
        ]);
        setFolders(folderRes.folders);
        setFiles(fileRes.files);
      } else if (activeView === "recent") {
        setFolders([]);
        const { files: f } = await filesApi.all({ recent: true });
        setFiles(f);
      } else if (activeView === "starred") {
        setFolders([]);
        const { files: f } = await filesApi.all({ starred: true });
        setFiles(f);
      } else if (activeView === "all") {
        setFolders([]);
        const { files: f } = await filesApi.all();
        setFiles(f);
      } else if (activeView === "home") {
        const [folderRes, fileRes] = await Promise.all([
          filesApi.listFolders(null),
          filesApi.list(null),
        ]);
        setFolders(folderRes.folders);
        setFiles(fileRes.files);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [activeView, currentFolder]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    loadTree();
    loadStorage();
  }, [loadTree, loadStorage]);

  // Refresh when Athena mutates files data (edit_file, create_file)
  useEffect(() => {
    if (refreshVersion > 0) {
      load();
      loadTree();
      loadStorage();
    }
  }, [refreshVersion, load, loadTree, loadStorage]);

  // ---- Navigation ----
  const navigateToFolder = useCallback((folder: VFolder) => {
    setActiveView("folder");
    setCurrentFolder(folder.id);
    setSelected(new Set());
    setPreview(null);
    // Build breadcrumb by walking up the tree
    const path: { id: string | null; name: string }[] = [];
    let cur: VFolder | undefined = folder;
    const folderMap = new Map(allFolders.map((f) => [f.id, f]));
    while (cur) {
      path.unshift({ id: cur.id, name: cur.name });
      cur = cur.parentId ? folderMap.get(cur.parentId) : undefined;
    }
    path.unshift({ id: null, name: "Home" });
    setBreadcrumb(path);
  }, [allFolders]);

  const navigateToSmart = useCallback((view: SmartCollection) => {
    setActiveView(view);
    setCurrentFolder(null);
    setSelected(new Set());
    setPreview(null);
    if (view === "home") {
      setBreadcrumb([{ id: null, name: "Home" }]);
    } else if (view === "recent") {
      setBreadcrumb([{ id: null, name: "Recent" }]);
    } else if (view === "starred") {
      setBreadcrumb([{ id: null, name: "Starred" }]);
    } else if (view === "all") {
      setBreadcrumb([{ id: null, name: "All Files" }]);
    }
  }, []);

  const navigateBreadcrumb = useCallback((index: number) => {
    if (index === 0) {
      navigateToSmart("home");
      return;
    }
    const target = breadcrumb[index];
    if (target.id) {
      const folder = allFolders.find((f) => f.id === target.id);
      if (folder) navigateToFolder(folder);
    } else {
      navigateToSmart("home");
    }
  }, [breadcrumb, allFolders, navigateToFolder]);

  const goUp = useCallback(() => {
    if (breadcrumb.length <= 1) return;
    navigateBreadcrumb(breadcrumb.length - 2);
  }, [breadcrumb, navigateBreadcrumb]);

  // ---- Sorting ----
  const sortedFolders = useMemo(() => {
    const arr = [...folders];
    arr.sort((a, b) => a.name.localeCompare(b.name) * (sortDir === "asc" ? 1 : -1));
    return arr;
  }, [folders, sortDir]);

  const sortedFiles = useMemo(() => {
    const arr = [...files];
    arr.sort((a, b) => {
      let cmp = 0;
      if (sortKey === "name") cmp = a.name.localeCompare(b.name);
      else if (sortKey === "size") cmp = a.size - b.size;
      else if (sortKey === "modified") cmp = new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
      else if (sortKey === "type") cmp = extOf(a.name).localeCompare(extOf(b.name));
      return cmp * (sortDir === "asc" ? 1 : -1);
    });
    // Filter by search query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return arr.filter((f) => f.name.toLowerCase().includes(q));
    }
    return arr;
  }, [files, sortKey, sortDir, searchQuery]);

  // ---- Selection ----
  const selectFile = useCallback((id: string, e: React.MouseEvent) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (e.ctrlKey || e.metaKey) {
        if (next.has(id)) next.delete(id);
        else next.add(id);
      } else if (e.shiftKey && lastSelected) {
        // Range select
        const ids = sortedFiles.map((f) => f.id);
        const start = ids.indexOf(lastSelected);
        const end = ids.indexOf(id);
        if (start !== -1 && end !== -1) {
          const [from, to] = [Math.min(start, end), Math.max(start, end)];
          for (let i = from; i <= to; i++) next.add(ids[i]);
        } else {
          next.clear();
          next.add(id);
        }
      } else {
        next.clear();
        next.add(id);
      }
      return next;
    });
    setLastSelected(id);
  }, [lastSelected, sortedFiles]);

  const selectAll = useCallback(() => {
    setSelected(new Set(sortedFiles.map((f) => f.id)));
  }, [sortedFiles]);

  const clearSelection = useCallback(() => {
    setSelected(new Set());
  }, []);

  // ---- Rubber band (lasso) selection ----
  const onFileAreaMouseDown = useCallback((e: React.MouseEvent) => {
    // Only start rubber band on left-click on empty area (not on a file/folder item)
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest("[data-file-item]") || target.closest("[data-folder-item]")) return;
    const area = fileAreaRef.current;
    if (!area) return;
    const rect = area.getBoundingClientRect();
    const startX = e.clientX - rect.left + area.scrollLeft;
    const startY = e.clientY - rect.top + area.scrollTop;
    isRubberBanding.current = true;
    rubberMoved.current = false;
    rubberBaseSelection.current = e.ctrlKey || e.metaKey ? new Set(selected) : new Set();
    const band = { startX, startY, endX: startX, endY: startY };
    rubberBandRef.current = band;
    setRubberBand({ ...band });
    // Don't clear selection yet — we'll set it based on intersection
    e.preventDefault();
  }, [selected]);

  const onFileAreaMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isRubberBanding.current || !fileAreaRef.current) return;
    const area = fileAreaRef.current;
    const rect = area.getBoundingClientRect();
    const endX = e.clientX - rect.left + area.scrollLeft;
    const endY = e.clientY - rect.top + area.scrollTop;
    const band = rubberBandRef.current;
    if (!band) return;
    // Mark that a real drag is happening (vs. a stationary click).
    if (Math.abs(endX - band.startX) > 3 || Math.abs(endY - band.startY) > 3) {
      rubberMoved.current = true;
    }
    band.endX = endX;
    band.endY = endY;
    setRubberBand({ ...band });

    // Compute which file items intersect with the rubber band rectangle
    const rbLeft = Math.min(band.startX, band.endX);
    const rbTop = Math.min(band.startY, band.endY);
    const rbRight = Math.max(band.startX, band.endX);
    const rbBottom = Math.max(band.startY, band.endY);

    const items = area.querySelectorAll("[data-file-item]");
    const intersecting = new Set(rubberBaseSelection.current);
    items.forEach((item) => {
      const el = item as HTMLElement;
      const elRect = el.getBoundingClientRect();
      const elLeft = elRect.left - rect.left + area.scrollLeft;
      const elTop = elRect.top - rect.top + area.scrollTop;
      const elRight = elLeft + elRect.width;
      const elBottom = elTop + elRect.height;
      if (rbLeft < elRight && rbRight > elLeft && rbTop < elBottom && rbBottom > elTop) {
        intersecting.add(el.dataset.fileId ?? "");
      }
    });
    setSelected(intersecting);
  }, []);

  const onFileAreaMouseUp = useCallback(() => {
    if (isRubberBanding.current && rubberMoved.current) {
      // A real rubber-band drag just ended — the browser will fire a click
      // event on the file area next. Suppress it so it doesn't clear the
      // selection we just made. A stationary click (no movement) is allowed
      // through so it still clears the selection as before.
      suppressNextClick.current = true;
    }
    isRubberBanding.current = false;
    rubberMoved.current = false;
    rubberBandRef.current = null;
    setRubberBand(null);
  }, []);

  // ---- File operations ----
  const createFolder = useCallback(async (parentId?: string | null) => {
    const name = prompt("Folder name:");
    if (!name) return;
    try {
      const { folder } = await filesApi.createFolder({ name, parentId: parentId ?? currentFolder });
      setFolders((prev) => [...prev, folder]);
      setAllFolders((prev) => [...prev, folder]);
      void loadTree();
    } catch (e) {
      console.error(e);
      alert("Failed to create folder");
    }
  }, [currentFolder, loadTree]);

  const createTextFile = useCallback(async () => {
    const name = prompt("File name (e.g. notes.txt):", "untitled.txt");
    if (!name) return;
    try {
      const { file } = await filesApi.createText({ name, folderId: currentFolder, content: "" });
      setFiles((prev) => [...prev, file]);
      void loadStorage();
      // Open in editor
      openWindow({
        appId: "editor",
        title: file.name,
        icon: "Code2",
        payload: { fileId: file.id },
      });
    } catch (e) {
      console.error(e);
      alert("Failed to create file");
    }
  }, [currentFolder, openWindow, loadStorage]);

  const onUpload = useCallback(async (fileList: FileList | File[], folderId?: string | null) => {
    const target = folderId ?? currentFolder;
    setUploading(true);
    try {
      for (const file of Array.from(fileList)) {
        const { file: record } = await filesApi.upload(file, target);
        if (folderId === undefined || folderId === currentFolder) {
          setFiles((prev) => [...prev, record]);
        }
      }
      void loadStorage();
      void loadTree();
    } catch (err) {
      console.error(err);
      alert("Upload failed");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }, [currentFolder, loadStorage, loadTree]);

  const download = useCallback(async (file: VFile) => {
    try {
      const res = await filesApi.download(file.id);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = file.name;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error(e);
    }
  }, []);

  const downloadZip = useCallback(async (fileIds: string[]) => {
    try {
      const res = await filesApi.zip(fileIds);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `download-${Date.now()}.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error(e);
      alert("Failed to create zip");
    }
  }, []);

  const downloadFolderZip = useCallback(async (folder: VFolder) => {
    try {
      const res = await filesApi.zipFolder(folder.id);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${folder.name}.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error(e);
      alert("Failed to create zip");
    }
  }, []);

  const deleteFile = useCallback(async (file: VFile) => {
    if (!confirm(`Delete "${file.name}"?`)) return;
    try {
      await filesApi.delete(file.id);
      setFiles((prev) => prev.filter((f) => f.id !== file.id));
      setSelected((prev) => { const n = new Set(prev); n.delete(file.id); return n; });
      if (preview?.id === file.id) setPreview(null);
      void loadStorage();
      void loadTree();
    } catch (e) {
      console.error(e);
    }
  }, [preview, loadStorage, loadTree]);

  const deleteFolder = useCallback(async (folder: VFolder) => {
    if (!confirm(`Delete folder "${folder.name}" and all its contents?`)) return;
    try {
      await filesApi.deleteFolder(folder.id);
      setFolders((prev) => prev.filter((f) => f.id !== folder.id));
      setAllFolders((prev) => prev.filter((f) => f.id !== folder.id));
      void loadStorage();
      void loadTree();
    } catch (e) {
      console.error(e);
    }
  }, [loadStorage, loadTree]);

  const deleteSelected = useCallback(async () => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    if (!confirm(`Delete ${ids.length} file(s)?`)) return;
    try {
      await Promise.all(ids.map((id) => filesApi.delete(id)));
      setFiles((prev) => prev.filter((f) => !selected.has(f.id)));
      setSelected(new Set());
      if (preview && selected.has(preview.id)) setPreview(null);
      void loadStorage();
      void loadTree();
    } catch (e) {
      console.error(e);
      alert("Some files failed to delete");
    }
  }, [selected, preview, loadStorage, loadTree]);

  const renameFile = useCallback(async (id: string, newName: string) => {
    if (!newName.trim()) return;
    try {
      await filesApi.rename(id, newName.trim());
      setFiles((prev) => prev.map((f) => f.id === id ? { ...f, name: newName.trim() } : f));
      if (preview?.id === id) setPreview({ ...preview, name: newName.trim() });
    } catch (e) {
      console.error(e);
      alert("Rename failed");
    }
  }, [preview]);

  const renameFolder = useCallback(async (id: string, newName: string) => {
    if (!newName.trim()) return;
    try {
      await filesApi.renameFolder(id, newName.trim());
      setFolders((prev) => prev.map((f) => f.id === id ? { ...f, name: newName.trim() } : f));
      setAllFolders((prev) => prev.map((f) => f.id === id ? { ...f, name: newName.trim() } : f));
    } catch (e) {
      console.error(e);
      alert("Rename failed");
    }
  }, []);

  const moveFile = useCallback(async (fileId: string, targetFolderId: string | null) => {
    try {
      await filesApi.move(fileId, targetFolderId);
      setFiles((prev) => prev.filter((f) => f.id !== fileId));
      setSelected((prev) => { const n = new Set(prev); n.delete(fileId); return n; });
      void loadTree();
    } catch (e) {
      console.error(e);
      alert("Move failed");
    }
  }, [loadTree]);

  const moveFolder = useCallback(async (folderId: string, targetFolderId: string | null) => {
    try {
      await filesApi.moveFolder(folderId, targetFolderId);
      void load();
      void loadTree();
    } catch (e) {
      console.error(e);
      alert("Move failed");
    }
  }, [load, loadTree]);

  const duplicateFile = useCallback(async (file: VFile) => {
    try {
      const { file: dup } = await filesApi.duplicate(file.id);
      setFiles((prev) => [...prev, dup]);
      void loadStorage();
    } catch (e) {
      console.error(e);
      alert("Duplicate failed");
    }
  }, [loadStorage]);

  const toggleStar = useCallback(async (file: VFile) => {
    try {
      const { file: updated } = await filesApi.toggleStar(file.id);
      setFiles((prev) => prev.map((f) => f.id === file.id ? updated : f));
      if (preview?.id === file.id) setPreview(updated);
    } catch (e) {
      console.error(e);
    }
  }, [preview]);

  // ---- Clipboard ----
  const copySelected = useCallback(() => {
    setClipboard(Array.from(selected).map((id) => ({ type: "file" as const, id, cut: false })));
  }, [selected]);

  const cutSelected = useCallback(() => {
    setClipboard(Array.from(selected).map((id) => ({ type: "file" as const, id, cut: true })));
  }, [selected]);

  const pasteFiles = useCallback(async () => {
    if (clipboard.length === 0) return;
    try {
      for (const item of clipboard) {
        await filesApi.move(item.id, currentFolder);
        if (item.cut) {
          setFiles((prev) => prev.filter((f) => f.id !== item.id));
        }
      }
      if (clipboard.some((c) => c.cut)) {
        setClipboard([]);
      }
      void load();
      void loadTree();
    } catch (e) {
      console.error(e);
      alert("Paste failed");
    }
  }, [clipboard, currentFolder, load, loadTree]);

  // ---- Open file ----
  const openFile = useCallback((file: VFile) => {
    const target = openTargetForFile(file);
    openWindow({
      appId: target,
      title: file.name,
      icon: target === "editor" ? "Code2" : "Eye",
      payload: { fileId: file.id },
    });
  }, [openWindow]);

  // ---- Context menus ----
  const showFileContextMenu = useCallback((e: React.MouseEvent, file: VFile) => {
    e.preventDefault();
    e.stopPropagation();
    if (!selected.has(file.id)) {
      setSelected(new Set([file.id]));
      setLastSelected(file.id);
    }
    // Moodle-managed virtual files are read-only (synced via the Moodle app).
    const isMoodle = file.source === "moodle" && !!file.externalUrl;
    const items: MenuItem[] = [
      { label: "Open", icon: <FileSymlink size={14} />, onClick: () => openFile(file) },
      ...(isImageFile(file) || isPdfFile(file) || isAudioFile(file) || isVideoFile(file) ? [{ label: "Open in Viewer", icon: <ImageIcon size={14} />, onClick: () => openWindow({ appId: "viewer", title: file.name, icon: "Eye", payload: { fileId: file.id } }) }] : []),
      ...(isTextFile(file) && !isMoodle ? [{ label: "Open in Editor", icon: <FileCode size={14} />, onClick: () => openWindow({ appId: "editor", title: file.name, icon: "Code2", payload: { fileId: file.id } }) }] : []),
      { separator: true },
      { label: "Download", icon: <Download size={14} />, onClick: () => download(file) },
      ...(isMoodle ? [] : [
        { label: "Rename", icon: <Pencil size={14} />, onClick: () => setRenaming({ type: "file", id: file.id, value: file.name }) },
        { label: "Duplicate", icon: <Copy size={14} />, onClick: () => duplicateFile(file) },
      ]),
      { label: file.starred ? "Unstar" : "Star", icon: <Star size={14} />, onClick: () => toggleStar(file) },
      ...(isMoodle ? [] : [
        { separator: true },
        { label: "Delete", icon: <Trash2 size={14} />, danger: true, onClick: () => deleteFile(file) },
      ]),
    ];
    setContextMenu({ x: e.clientX, y: e.clientY, items });
  }, [selected, openFile, openWindow, download, duplicateFile, toggleStar, deleteFile]);

  const showFolderContextMenu = useCallback((e: React.MouseEvent, folder: VFolder) => {
    e.preventDefault();
    e.stopPropagation();
    const items: MenuItem[] = [
      { label: "Open", icon: <Folder size={14} />, onClick: () => navigateToFolder(folder) },
      { label: "Rename", icon: <Pencil size={14} />, onClick: () => setRenaming({ type: "folder", id: folder.id, value: folder.name }) },
      { label: "Download as ZIP", icon: <Archive size={14} />, onClick: () => downloadFolderZip(folder) },
      { separator: true },
      { label: "Delete", icon: <Trash2 size={14} />, danger: true, onClick: () => deleteFolder(folder) },
    ];
    setContextMenu({ x: e.clientX, y: e.clientY, items });
  }, [navigateToFolder, downloadFolderZip, deleteFolder]);

  const showEmptyContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const items: MenuItem[] = [
      { label: "New Folder", icon: <FolderPlus size={14} />, onClick: () => createFolder() },
      { label: "New Text File", icon: <FilePlus size={14} />, onClick: () => createTextFile() },
      { label: "Upload", icon: <Upload size={14} />, onClick: () => fileInputRef.current?.click() },
      ...(clipboard.length > 0 ? [{ label: `Paste (${clipboard.length})`, icon: <ClipboardPaste size={14} />, onClick: () => pasteFiles() }] : []),
      { separator: true },
      { label: "Refresh", icon: <RefreshCw size={14} />, onClick: () => { void load(); void loadTree(); void loadStorage(); } },
    ];
    setContextMenu({ x: e.clientX, y: e.clientY, items });
  }, [createFolder, createTextFile, clipboard, pasteFiles, load, loadTree, loadStorage]);

  // ---- Keyboard shortcuts ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
      if (renaming) return;

      if (e.key === "Delete" && selected.size > 0) {
        e.preventDefault();
        void deleteSelected();
      } else if (e.key === "F2" && lastSelected) {
        e.preventDefault();
        const file = files.find((f) => f.id === lastSelected);
        if (file) setRenaming({ type: "file", id: file.id, value: file.name });
      } else if (e.key === "Enter" && lastSelected) {
        e.preventDefault();
        const file = files.find((f) => f.id === lastSelected);
        if (file) openFile(file);
      } else if ((e.ctrlKey || e.metaKey) && e.key === "a") {
        e.preventDefault();
        selectAll();
      } else if ((e.ctrlKey || e.metaKey) && e.key === "c" && selected.size > 0) {
        e.preventDefault();
        copySelected();
      } else if ((e.ctrlKey || e.metaKey) && e.key === "x" && selected.size > 0) {
        e.preventDefault();
        cutSelected();
      } else if ((e.ctrlKey || e.metaKey) && e.key === "v" && clipboard.length > 0) {
        e.preventDefault();
        void pasteFiles();
      } else if (e.key === "F5") {
        e.preventDefault();
        void load();
        void loadTree();
        void loadStorage();
      } else if (e.key === "Backspace") {
        e.preventDefault();
        goUp();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, lastSelected, files, renaming, deleteSelected, selectAll, copySelected, cutSelected, pasteFiles, load, loadTree, loadStorage, openFile, goUp]);

  // ---- Drag & drop upload ----
  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const onDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current++;
    if (e.dataTransfer.types.includes("Files")) {
      setDragOver(true);
    }
  }, []);

  const onDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current--;
    if (dragCounter.current <= 0) {
      setDragOver(false);
      dragCounter.current = 0;
    }
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current = 0;
    setDragOver(false);
    if (e.dataTransfer.files.length > 0) {
      void onUpload(e.dataTransfer.files);
    }
  }, [onUpload]);

  // ---- Folder tree ----
  const folderTree = useMemo(() => buildFolderTree(allFolders, fileCounts), [allFolders, fileCounts]);

  const toggleExpand = useCallback((id: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // ---- Render ----
  const selectedFiles = sortedFiles.filter((f) => selected.has(f.id));

  return (
    <div className="relative flex h-full"
      onContextMenu={(e) => {
        // Only show empty context menu when clicking on empty space
        if ((e.target as HTMLElement).closest("[data-file-item]") || (e.target as HTMLElement).closest("[data-folder-item]")) return;
        showEmptyContextMenu(e);
      }}
    >
      {/* Sidebar — inline @3xl+, overlay when narrow */}
      <CollapsibleSidebar
        side="left"
        width="w-52"
        showAt="@3xl"
        panelClassName="bg-surface-2"
        toggleIcon={<Folder size={14} />}
        toggleLabel="Folders"
      >
        <div className="flex-1 overflow-y-auto p-2">
          {/* Smart collections */}
          <div className="mb-2">
            <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-ink-muted">Quick Access</div>
            <SidebarItem icon={<Home size={15} />} label="Home" active={activeView === "home"} onClick={() => navigateToSmart("home")} />
            <SidebarItem icon={<Clock size={15} />} label="Recent" active={activeView === "recent"} onClick={() => navigateToSmart("recent")} />
            <SidebarItem icon={<Star size={15} />} label="Starred" active={activeView === "starred"} onClick={() => navigateToSmart("starred")} />
            <SidebarItem icon={<FileIcon size={15} />} label="All Files" active={activeView === "all"} onClick={() => navigateToSmart("all")} />
          </div>

          {/* Folder tree */}
          <div>
            <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-ink-muted">Folders</div>
            {folderTree.length === 0 ? (
              <div className="px-2 py-1 text-xs text-ink-muted">No folders</div>
            ) : (
              folderTree.map((node) => (
                <FolderTreeNodeView
                  key={node.id}
                  node={node}
                  level={0}
                  expanded={expandedFolders}
                  onToggle={toggleExpand}
                  onNavigate={(n) => navigateToFolder({ id: n.id, name: n.name, parentId: n.parentId, createdAt: "", updatedAt: "" })}
                  onDropFile={(fileId, folderId) => moveFile(fileId, folderId)}
                  onDropFolder={(folderId, targetId) => moveFolder(folderId, targetId)}
                  currentFolder={currentFolder}
                />
              ))
            )}
          </div>
        </div>

        {/* Storage bar */}
        {storage && (
          <div className="border-t border-edge p-3">
            <div className="mb-1 flex items-center gap-1.5 text-[11px] text-ink-muted">
              <HardDrive size={12} /> Storage
              {storage.limit ? (
                <span className="ml-auto">{formatBytes(storage.total)} / {formatBytes(storage.limit)}</span>
              ) : null}
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-surface-3">
              <div
                className="h-full rounded-full bg-accent transition-all"
                style={{
                  width: `${
                    storage.limit
                      ? Math.min(100, (storage.total / storage.limit) * 100)
                      : Math.min(100, (storage.total / (500 * 1024 * 1024)) * 100)
                  }%`,
                }}
              />
            </div>
            <div className="mt-1 text-[10px] text-ink-muted">
              {formatBytes(storage.total)} used · {storage.count} files
            </div>
          </div>
        )}
      </CollapsibleSidebar>

      {/* Main panel */}
      <div className="flex flex-1 flex-col">
        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-1.5 border-b border-edge px-3 py-2">
          <button
            onClick={goUp}
            disabled={breadcrumb.length <= 1}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-ink-muted hover:bg-surface-2 active:bg-surface-2 disabled:opacity-30"
            title="Up"
          >
            <ArrowUp size={16} />
          </button>
          <button
            onClick={() => createFolder()}
            className="flex shrink-0 items-center gap-1.5 rounded-lg border border-edge px-2.5 py-1.5 text-xs text-ink hover:bg-surface-2 active:bg-surface-2"
          >
            <FolderPlus size={14} />New Folder
          </button>
          <button
            onClick={() => createTextFile()}
            className="flex shrink-0 items-center gap-1.5 rounded-lg border border-edge px-2.5 py-1.5 text-xs text-ink hover:bg-surface-2 active:bg-surface-2"
          >
            <FilePlus size={14} />New File
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="flex shrink-0 items-center gap-1.5 rounded-lg bg-accent px-2.5 py-1.5 text-xs text-accent-fg hover:opacity-90 active:opacity-90 disabled:opacity-50"
          >
            {uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
            Upload
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            onChange={(e) => e.target.files && onUpload(e.target.files)}
            className="hidden"
          />

          <div className="ml-auto flex items-center gap-1.5">
            {/* Search */}
            <div className="relative shrink-0">
              <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-ink-muted" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search..."
                className="w-36 rounded-lg border border-edge bg-surface-2 py-1.5 pl-7 pr-2 text-xs text-ink placeholder:text-ink-muted transition-all focus:w-48 focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </div>

            {/* Sort */}
            <select
              value={`${sortKey}-${sortDir}`}
              onChange={(e) => {
                const [k, d] = e.target.value.split("-") as [SortKey, SortDir];
                setSortKey(k);
                setSortDir(d);
              }}
              className="shrink-0 rounded-lg border border-edge bg-surface-2 px-2 py-1.5 text-xs text-ink focus:outline-none"
            >
              <option value="name-asc">Name ↑</option>
              <option value="name-desc">Name ↓</option>
              <option value="size-asc">Size ↑</option>
              <option value="size-desc">Size ↓</option>
              <option value="modified-asc">Modified ↑</option>
              <option value="modified-desc">Modified ↓</option>
              <option value="type-asc">Type ↑</option>
              <option value="type-desc">Type ↓</option>
            </select>

            {/* View toggle */}
            <div className="flex shrink-0 items-center rounded-lg border border-edge">
              <button
                onClick={() => setViewMode("grid")}
                className={`flex h-8 w-8 items-center justify-center rounded-l-lg ${viewMode === "grid" ? "bg-surface-3 text-ink" : "text-ink-muted hover:bg-surface-2"}`}
                title="Grid view"
              >
                <Grid3x3 size={14} />
              </button>
              <button
                onClick={() => setViewMode("list")}
                className={`flex h-8 w-8 items-center justify-center rounded-r-lg ${viewMode === "list" ? "bg-surface-3 text-ink" : "text-ink-muted hover:bg-surface-2"}`}
                title="List view"
              >
                <ListIcon size={14} />
              </button>
            </div>
          </div>
        </div>

        {/* Breadcrumb + inline selection actions (merged so selecting files
            doesn't shift the file area down by inserting a new row) */}
        <div className="flex flex-wrap items-center gap-1 border-b border-edge px-3 py-1.5 text-xs text-ink-muted">
          {breadcrumb.map((b, i) => (
            <span key={i} className="flex shrink-0 items-center gap-1">
              {i > 0 && <ChevronRight size={12} />}
              <button
                onClick={() => navigateBreadcrumb(i)}
                className={i === breadcrumb.length - 1 ? "text-ink" : "hover:text-ink"}
              >
                {b.name}
              </button>
            </span>
          ))}

          {selected.size > 0 && (
            <div className="ml-auto flex items-center gap-1">
              <span className="text-ink">{selected.size} selected</span>
              {selected.size > 1 ? (
                <button onClick={() => downloadZip(Array.from(selected))} className="flex items-center gap-1 rounded px-2 py-1 text-ink-muted hover:bg-surface-2 hover:text-ink" title="Download as ZIP">
                  <Archive size={13} /> ZIP
                </button>
              ) : (
                <button onClick={() => selectedFiles[0] && download(selectedFiles[0])} className="flex items-center gap-1 rounded px-2 py-1 text-ink-muted hover:bg-surface-2 hover:text-ink" title="Download">
                  <Download size={13} /> Download
                </button>
              )}
              <button onClick={copySelected} className="flex items-center gap-1 rounded px-2 py-1 text-ink-muted hover:bg-surface-2 hover:text-ink" title="Copy">
                <Copy size={13} />
              </button>
              <button onClick={cutSelected} className="flex items-center gap-1 rounded px-2 py-1 text-ink-muted hover:bg-surface-2 hover:text-ink" title="Cut">
                <Scissors size={13} />
              </button>
              <button onClick={deleteSelected} className="flex items-center gap-1 rounded px-2 py-1 text-red-400 hover:bg-red-500/15" title="Delete">
                <Trash2 size={13} />
              </button>
              <button onClick={clearSelection} className="flex items-center gap-1 rounded px-2 py-1 text-ink-muted hover:bg-surface-2 hover:text-ink" title="Clear selection">
                <X size={13} />
              </button>
            </div>
          )}
        </div>

        {/* File area */}
        <div
          ref={fileAreaRef}
          className={`relative flex-1 overflow-y-auto p-3 ${dragOver ? "bg-accent/5" : ""} ${isRubberBanding.current ? "select-none" : ""}`}
          onDragOver={onDragOver}
          onDragEnter={onDragEnter}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          onMouseDown={onFileAreaMouseDown}
          onMouseMove={onFileAreaMouseMove}
          onMouseUp={onFileAreaMouseUp}
          onClick={() => {
            if (suppressNextClick.current) {
              suppressNextClick.current = false;
              return;
            }
            if (!isRubberBanding.current) { clearSelection(); setPreview(null); }
          }}
        >
          {/* Rubber band selection rectangle */}
          {rubberBand && (
            <div
              className="pointer-events-none absolute z-20 border border-accent/60 bg-accent/15"
              style={{
                left: Math.min(rubberBand.startX, rubberBand.endX),
                top: Math.min(rubberBand.startY, rubberBand.endY),
                width: Math.abs(rubberBand.endX - rubberBand.startX),
                height: Math.abs(rubberBand.endY - rubberBand.startY),
              }}
            />
          )}

          {dragOver && (
            <div className="pointer-events-none absolute inset-3 z-10 flex items-center justify-center rounded-xl border-2 border-dashed border-accent bg-accent/10">
              <div className="flex flex-col items-center gap-2 text-accent">
                <Upload size={32} />
                <p className="text-sm font-medium">Drop files to upload</p>
              </div>
            </div>
          )}

          {loading ? (
            <div className="flex h-full items-center justify-center">
              <Loader2 size={24} className="animate-spin text-ink-muted" />
            </div>
          ) : sortedFolders.length + sortedFiles.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center text-ink-muted">
              <Folder size={40} className="mb-2 opacity-30" />
              <p className="text-sm">{searchQuery ? "No results found" : "This folder is empty"}</p>
              <p className="text-xs">{searchQuery ? "Try a different search" : "Upload files or create a new folder"}</p>
            </div>
          ) : viewMode === "grid" ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(96px,1fr))] gap-2">
              {sortedFolders.map((folder) => (
                <div
                  key={folder.id}
                  data-folder-item
                  data-folder-id={folder.id}
                  onDoubleClick={() => navigateToFolder(folder)}
                  onClick={(e) => { e.stopPropagation(); setSelected(new Set()); }}
                  onContextMenu={(e) => showFolderContextMenu(e, folder)}
                  draggable
                  onDragStart={(e) => e.dataTransfer.setData("text/folder-id", folder.id)}
                  onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const fileId = e.dataTransfer.getData("text/file-id");
                    const folderId = e.dataTransfer.getData("text/folder-id");
                    if (fileId) moveFile(fileId, folder.id);
                    if (folderId && folderId !== folder.id) moveFolder(folderId, folder.id);
                  }}
                  className="group relative flex cursor-pointer flex-col items-center gap-1.5 rounded-lg p-3 hover:bg-surface-2"
                >
                  <Folder size={36} className="text-amber-400" />
                  {renaming?.type === "folder" && renaming.id === folder.id ? (
                    <input
                      autoFocus
                      defaultValue={folder.name}
                      onBlur={(e) => { renameFolder(folder.id, e.target.value); setRenaming(null); }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") { renameFolder(folder.id, (e.target as HTMLInputElement).value); setRenaming(null); }
                        if (e.key === "Escape") setRenaming(null);
                      }}
                      onClick={(e) => e.stopPropagation()}
                      className="w-full rounded border border-accent bg-surface px-1 text-center text-xs text-ink focus:outline-none"
                    />
                  ) : (
                    <span className="line-clamp-2 w-full text-center text-xs text-ink">{folder.name}</span>
                  )}
                  <button
                    onClick={(e) => { e.stopPropagation(); deleteFolder(folder); }}
                    className="absolute right-1 top-1 hidden h-6 w-6 items-center justify-center rounded text-ink-muted hover:bg-red-500 hover:text-white group-hover:flex"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
              {sortedFiles.map((file) => (
                <div
                  key={file.id}
                  data-file-item
                  data-file-id={file.id}
                  onDoubleClick={() => openFile(file)}
                  onClick={(e) => { e.stopPropagation(); selectFile(file.id, e); setPreview(file); }}
                  onContextMenu={(e) => showFileContextMenu(e, file)}
                  draggable
                  onDragStart={(e) => setLinkPayload(e, { type: "file", id: file.id, title: file.name })}
                  className={`group relative flex cursor-pointer flex-col items-center gap-1.5 rounded-lg p-3 hover:bg-surface-2 ${
                    selected.has(file.id) ? "bg-accent/10 ring-1 ring-accent/40" : ""
                  }`}
                >
                  <FilePreviewIcon file={file} size={36} />
                  {file.starred && <Star size={10} className="absolute left-2 top-2 fill-amber-400 text-amber-400" />}
                  {renaming?.type === "file" && renaming.id === file.id ? (
                    <input
                      autoFocus
                      defaultValue={file.name}
                      onBlur={(e) => { renameFile(file.id, e.target.value); setRenaming(null); }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") { renameFile(file.id, (e.target as HTMLInputElement).value); setRenaming(null); }
                        if (e.key === "Escape") setRenaming(null);
                      }}
                      onClick={(e) => e.stopPropagation()}
                      className="w-full rounded border border-accent bg-surface px-1 text-center text-xs text-ink focus:outline-none"
                    />
                  ) : (
                    <span className="line-clamp-2 w-full text-center text-xs text-ink">{file.name}</span>
                  )}
                  <span className="text-[10px] text-ink-muted">
                    {file.source === "moodle" && file.externalUrl ? "Moodle" : formatBytes(file.size)}
                  </span>
                  <div className="absolute right-1 top-1 hidden items-center gap-0.5 group-hover:flex">
                    <button
                      onClick={(e) => { e.stopPropagation(); download(file); }}
                      className="flex h-6 w-6 items-center justify-center rounded text-ink-muted hover:bg-surface-3 hover:text-ink"
                    >
                      <Download size={12} />
                    </button>
                    {!(file.source === "moodle" && file.externalUrl) && (
                      <button
                        onClick={(e) => { e.stopPropagation(); deleteFile(file); }}
                        className="flex h-6 w-6 items-center justify-center rounded text-ink-muted hover:bg-red-500 hover:text-white"
                      >
                        <Trash2 size={12} />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            /* List view */
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-edge text-left text-ink-muted">
                  <th className="px-2 py-1.5 font-medium">Name</th>
                  <th className="px-2 py-1.5 font-medium" style={{ width: 80 }}>Size</th>
                  <th className="px-2 py-1.5 font-medium" style={{ width: 120 }}>Modified</th>
                </tr>
              </thead>
              <tbody>
                {sortedFolders.map((folder) => (
                  <tr
                    key={folder.id}
                    data-folder-item
                    data-folder-id={folder.id}
                    onDoubleClick={() => navigateToFolder(folder)}
                    onClick={(e) => { e.stopPropagation(); setSelected(new Set()); }}
                    onContextMenu={(e) => showFolderContextMenu(e, folder)}
                    draggable
                    onDragStart={(e) => e.dataTransfer.setData("text/folder-id", folder.id)}
                    onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                    onDrop={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      const fileId = e.dataTransfer.getData("text/file-id");
                      const folderId = e.dataTransfer.getData("text/folder-id");
                      if (fileId) moveFile(fileId, folder.id);
                      if (folderId && folderId !== folder.id) moveFolder(folderId, folder.id);
                    }}
                    className="cursor-pointer border-b border-edge/50 hover:bg-surface-2"
                  >
                    <td className="px-2 py-1.5">
                      <div className="flex items-center gap-2">
                        <Folder size={16} className="text-amber-400" />
                        {renaming?.type === "folder" && renaming.id === folder.id ? (
                          <input
                            autoFocus
                            defaultValue={folder.name}
                            onBlur={(e) => { renameFolder(folder.id, e.target.value); setRenaming(null); }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") { renameFolder(folder.id, (e.target as HTMLInputElement).value); setRenaming(null); }
                              if (e.key === "Escape") setRenaming(null);
                            }}
                            onClick={(e) => e.stopPropagation()}
                            className="rounded border border-accent bg-surface px-1 text-xs text-ink focus:outline-none"
                          />
                        ) : (
                          <span className="text-ink">{folder.name}</span>
                        )}
                      </div>
                    </td>
                    <td className="px-2 py-1.5 text-ink-muted">—</td>
                    <td className="px-2 py-1.5 text-ink-muted">{new Date(folder.updatedAt).toLocaleDateString()}</td>
                  </tr>
                ))}
                {sortedFiles.map((file) => (
                  <tr
                    key={file.id}
                    data-file-item
                    data-file-id={file.id}
                    onDoubleClick={() => openFile(file)}
                    onClick={(e) => { e.stopPropagation(); selectFile(file.id, e); setPreview(file); }}
                    onContextMenu={(e) => showFileContextMenu(e, file)}
                    draggable
                    onDragStart={(e) => setLinkPayload(e, { type: "file", id: file.id, title: file.name })}
                    className={`cursor-pointer border-b border-edge/50 hover:bg-surface-2 ${
                      selected.has(file.id) ? "bg-accent/10" : ""
                    }`}
                  >
                    <td className="px-2 py-1.5">
                      <div className="flex items-center gap-2">
                        <FilePreviewIcon file={file} size={16} />
                        {renaming?.type === "file" && renaming.id === file.id ? (
                          <input
                            autoFocus
                            defaultValue={file.name}
                            onBlur={(e) => { renameFile(file.id, e.target.value); setRenaming(null); }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") { renameFile(file.id, (e.target as HTMLInputElement).value); setRenaming(null); }
                              if (e.key === "Escape") setRenaming(null);
                            }}
                            onClick={(e) => e.stopPropagation()}
                            className="rounded border border-accent bg-surface px-1 text-xs text-ink focus:outline-none"
                          />
                        ) : (
                          <span className="text-ink">{file.name}</span>
                        )}
                        {file.starred && <Star size={10} className="fill-amber-400 text-amber-400" />}
                        {file.source === "moodle" && file.externalUrl && (
                          <span className="rounded bg-indigo-500/10 px-1 py-0.5 text-[9px] font-medium text-indigo-400">Moodle</span>
                        )}
                      </div>
                    </td>
                    <td className="px-2 py-1.5 text-ink-muted">
                      {file.source === "moodle" && file.externalUrl ? "—" : formatBytes(file.size)}
                    </td>
                    <td className="px-2 py-1.5 text-ink-muted">{new Date(file.updatedAt).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Preview panel — inline @5xl+, auto-overlay when narrow */}
      {preview && (
        <>
          <div className="@5xl:hidden absolute inset-0 z-10 bg-black/40" onClick={() => setPreview(null)} />
          <div className="absolute inset-y-0 right-0 z-20 shrink-0 flex w-72 flex-col border-l border-edge bg-surface-2 shadow-window @5xl:static @5xl:z-auto @5xl:shadow-none">
            <div className="flex items-center justify-between border-b border-edge px-3 py-2">
              <span className="line-clamp-1 text-xs font-medium text-ink">{preview.name}</span>
              <button onClick={() => setPreview(null)} className="text-ink-muted hover:text-ink">
                <X size={16} />
              </button>
            </div>
          <FilePreview file={preview} />
          <div className="border-t border-edge p-3 text-xs text-ink-muted">
            <div className="flex justify-between py-0.5">
              <span>Type</span>
              <span className="text-ink">{preview.mimeType}</span>
            </div>
            <div className="flex justify-between py-0.5">
              <span>Size</span>
              <span className="text-ink">{formatBytes(preview.size)}</span>
            </div>
            <div className="flex justify-between py-0.5">
              <span>Modified</span>
              <span className="text-ink">{new Date(preview.updatedAt).toLocaleDateString()}</span>
            </div>
            <div className="mt-2 flex gap-1.5">
              <button
                onClick={() => openFile(preview)}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-accent py-2 text-xs text-accent-fg"
              >
                <FileSymlink size={13} /> Open
              </button>
              <button
                onClick={() => download(preview)}
                className="flex items-center justify-center gap-1.5 rounded-lg border border-edge px-3 py-2 text-xs text-ink hover:bg-surface-3"
              >
                <Download size={13} />
              </button>
            </div>
          </div>
        </div>
        </>
      )}

      {/* Context menu */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenu.items}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}

// ---- Sub-components ----

function SidebarItem({
  icon, label, active, onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-xs ${
        active ? "bg-surface-3 text-ink font-medium" : "text-ink-muted hover:bg-surface-3 hover:text-ink"
      }`}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function FolderTreeNodeView({
  node, level, expanded, onToggle, onNavigate, onDropFile, onDropFolder, currentFolder,
}: {
  node: FolderTreeNode;
  level: number;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  onNavigate: (node: FolderTreeNode) => void;
  onDropFile: (fileId: string, folderId: string) => void;
  onDropFolder: (folderId: string, targetId: string) => void;
  currentFolder: string | null;
}) {
  const isExpanded = expanded.has(node.id);
  const hasChildren = node.children.length > 0;
  const isActive = currentFolder === node.id;

  return (
    <div>
      <div
        onClick={() => onNavigate(node)}
        onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          const fileId = e.dataTransfer.getData("text/file-id");
          const folderId = e.dataTransfer.getData("text/folder-id");
          if (fileId) onDropFile(fileId, node.id);
          if (folderId && folderId !== node.id) onDropFolder(folderId, node.id);
        }}
        className={`group flex cursor-pointer items-center gap-1 rounded-lg py-1 pr-2 text-xs hover:bg-surface-3 ${
          isActive ? "bg-surface-3 text-ink font-medium" : "text-ink-muted hover:text-ink"
        }`}
        style={{ paddingLeft: level * 12 + 4 }}
      >
        {hasChildren ? (
          <button
            onClick={(e) => { e.stopPropagation(); onToggle(node.id); }}
            className="flex h-4 w-4 shrink-0 items-center justify-center"
          >
            {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </button>
        ) : (
          <span className="w-4 shrink-0" />
        )}
        <Folder size={14} className="shrink-0 text-amber-400" />
        <span className="line-clamp-1 flex-1">{node.name}</span>
        {node.fileCount > 0 && (
          <span className="text-[10px] text-ink-muted/60">{node.fileCount}</span>
        )}
      </div>
      {isExpanded && hasChildren && (
        <div>
          {node.children.map((child) => (
            <FolderTreeNodeView
              key={child.id}
              node={child}
              level={level + 1}
              expanded={expanded}
              onToggle={onToggle}
              onNavigate={onNavigate}
              onDropFile={onDropFile}
              onDropFolder={onDropFolder}
              currentFolder={currentFolder}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function FilePreviewIcon({ file, size }: { file: VFile; size: number }) {
  if (isImageFile(file)) return <ImageIcon size={size} className="text-green-400" />;
  if (isPdfFile(file)) return <FileText size={size} className="text-red-400" />;
  if (isAudioFile(file)) return <MusicIcon size={size} className="text-purple-400" />;
  if (isVideoFile(file)) return <VideoIcon size={size} className="text-pink-400" />;
  if (isTextFile(file)) return <FileCode size={size} className="text-blue-400" />;
  return <FileIcon size={size} className={fileIconColor(file.mimeType)} />;
}

function FilePreview({ file }: { file: VFile }) {
  const [text, setText] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isTextFile(file)) {
      setLoading(true);
      filesApi
        .getContent(file.id)
        .then((res) => setText(res.content))
        .catch(() => setText("Failed to load text"))
        .finally(() => setLoading(false));
    } else {
      setText(null);
    }
  }, [file]);

  if (isImageFile(file)) {
    return (
      <div className="flex flex-1 items-center justify-center overflow-auto bg-surface-3 p-3">
        <img
          src={filesApi.downloadUrl(file.id)}
          alt={file.name}
          className="max-h-full max-w-full rounded-lg object-contain"
        />
      </div>
    );
  }
  if (isPdfFile(file)) {
    return (
      <iframe
        src={filesApi.downloadUrl(file.id)}
        className="flex-1 border-0"
        title={file.name}
      />
    );
  }
  if (isAudioFile(file)) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-4">
        <MusicIcon size={40} className="text-accent" />
        <audio controls src={filesApi.downloadUrl(file.id)} className="w-full" />
      </div>
    );
  }
  if (isVideoFile(file)) {
    return (
      <div className="flex flex-1 items-center justify-center bg-black">
        <video controls src={filesApi.downloadUrl(file.id)} className="max-h-full max-w-full" />
      </div>
    );
  }
  if (isTextFile(file)) {
    return (
      <div className="selectable flex-1 overflow-auto p-3">
        {loading ? (
          <Loader2 size={16} className="animate-spin text-ink-muted" />
        ) : (
          <pre className="whitespace-pre-wrap font-mono text-xs text-ink">{text}</pre>
        )}
      </div>
    );
  }
  return (
    <div className="flex flex-1 flex-col items-center justify-center text-ink-muted">
      <FileIcon size={48} className="mb-2 opacity-30" />
      <p className="text-xs">No preview available</p>
    </div>
  );
}
