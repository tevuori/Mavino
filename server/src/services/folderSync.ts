// Helpers for keeping Notes folders (NoteFolder) and Files folders (VFolder)
// in sync as parallel folder trees. A row in FolderSync maps one NoteFolder
// to one VFolder for a given user.

import path from "node:path";
import { unlink } from "node:fs/promises";
import prisma from "../db/client";

const UPLOAD_DIR = path.resolve(process.cwd(), "uploads");

export type FolderKind = "note" | "vfile";

interface FolderBase {
  id: string;
  name: string;
  parentId: string | null;
  userId: string;
}

/** Build a path string like "School/Biology" for a folder by walking parents. */
function pathOf(folder: FolderBase, byId: Map<string, FolderBase>): string {
  const parts: string[] = [folder.name];
  let curId = folder.parentId;
  let guard = 0;
  while (curId && guard++ < 100) {
    const cur = byId.get(curId);
    if (!cur) break;
    parts.unshift(cur.name);
    curId = cur.parentId;
  }
  return parts.join("/");
}

async function loadNoteFolders(userId: string): Promise<FolderBase[]> {
  return await prisma.noteFolder.findMany({
    where: { userId },
    select: { id: true, name: true, parentId: true, userId: true },
  });
}

async function loadVFolders(userId: string): Promise<FolderBase[]> {
  return await prisma.vFolder.findMany({
    where: { userId },
    select: { id: true, name: true, parentId: true, userId: true },
  });
}

async function findSyncByNoteFolder(userId: string, noteFolderId: string) {
  return await prisma.folderSync.findFirst({
    where: { userId, noteFolderId },
  });
}

async function findSyncByVFolder(userId: string, vFolderId: string) {
  return await prisma.folderSync.findFirst({
    where: { userId, vFolderId },
  });
}

/** Look up a VFolder that already corresponds to a NoteFolder path. */
async function findVFolderByPath(userId: string, path: string): Promise<FolderBase | null> {
  const vfolders = await loadVFolders(userId);
  const vById = new Map(vfolders.map((f) => [f.id, f]));
  return vfolders.find((f) => pathOf(f, vById) === path) ?? null;
}

/** Look up a NoteFolder that already corresponds to a VFolder path. */
async function findNoteFolderByPath(userId: string, path: string): Promise<FolderBase | null> {
  const nfolders = await loadNoteFolders(userId);
  const nById = new Map(nfolders.map((f) => [f.id, f]));
  return nfolders.find((f) => pathOf(f, nById) === path) ?? null;
}

/**
 * Ensure a VFolder exists that mirrors the given NoteFolder.
 * Recursively mirrors parent folders. Returns the synced VFolder id.
 */
export async function ensureSyncedVFolder(
  userId: string,
  noteFolderId: string
): Promise<string> {
  const existing = await findSyncByNoteFolder(userId, noteFolderId);
  if (existing) return existing.vFolderId;

  const noteFolder = await prisma.noteFolder.findFirst({
    where: { id: noteFolderId, userId },
    select: { id: true, name: true, parentId: true, userId: true },
  });
  if (!noteFolder) throw new Error("NoteFolder not found");

  const noteFolders = await loadNoteFolders(userId);
  const noteById = new Map(noteFolders.map((f) => [f.id, f]));
  const path = pathOf(noteFolder, noteById);

  // If a VFolder at the same path already exists, reuse it.
  const matchingVFolder = await findVFolderByPath(userId, path);
  if (matchingVFolder) {
    await prisma.folderSync.create({
      data: {
        userId,
        noteFolderId,
        vFolderId: matchingVFolder.id,
      },
    });
    return matchingVFolder.id;
  }

  // Recursively ensure parent VFolder exists.
  let vParentId: string | null = null;
  if (noteFolder.parentId) {
    vParentId = await ensureSyncedVFolder(userId, noteFolder.parentId);
  }

  const vFolder = await prisma.vFolder.create({
    data: {
      userId,
      name: noteFolder.name,
      parentId: vParentId,
    },
  });

  await prisma.folderSync.create({
    data: {
      userId,
      noteFolderId,
      vFolderId: vFolder.id,
    },
  });

  return vFolder.id;
}

/**
 * Ensure a NoteFolder exists that mirrors the given VFolder.
 * Recursively mirrors parent folders. Returns the synced NoteFolder id.
 */
export async function ensureSyncedNoteFolder(
  userId: string,
  vFolderId: string
): Promise<string> {
  const existing = await findSyncByVFolder(userId, vFolderId);
  if (existing) return existing.noteFolderId;

  const vFolder = await prisma.vFolder.findFirst({
    where: { id: vFolderId, userId },
    select: { id: true, name: true, parentId: true, userId: true },
  });
  if (!vFolder) throw new Error("VFolder not found");

  const vfolders = await loadVFolders(userId);
  const vById = new Map(vfolders.map((f) => [f.id, f]));
  const path = pathOf(vFolder, vById);

  const matchingNoteFolder = await findNoteFolderByPath(userId, path);
  if (matchingNoteFolder) {
    await prisma.folderSync.create({
      data: {
        userId,
        noteFolderId: matchingNoteFolder.id,
        vFolderId,
      },
    });
    return matchingNoteFolder.id;
  }

  let noteParentId: string | null = null;
  if (vFolder.parentId) {
    noteParentId = await ensureSyncedNoteFolder(userId, vFolder.parentId);
  }

  const noteFolder = await prisma.noteFolder.create({
    data: {
      userId,
      name: vFolder.name,
      parentId: noteParentId,
    },
  });

  await prisma.folderSync.create({
    data: {
      userId,
      noteFolderId: noteFolder.id,
      vFolderId,
    },
  });

  return noteFolder.id;
}

/** Rename the synced counterpart of a folder to match the source folder's new name. */
export async function syncRename(
  userId: string,
  kind: FolderKind,
  folderId: string,
  newName: string
): Promise<void> {
  if (kind === "note") {
    const sync = await findSyncByNoteFolder(userId, folderId);
    if (!sync) return;
    await prisma.vFolder.updateMany({
      where: { id: sync.vFolderId, userId },
      data: { name: newName },
    });
  } else {
    const sync = await findSyncByVFolder(userId, folderId);
    if (!sync) return;
    await prisma.noteFolder.updateMany({
      where: { id: sync.noteFolderId, userId },
      data: { name: newName },
    });
  }
}

/**
 * Re-parent the synced counterpart of a moved folder.
 * newParentId must be the parent in the same app as the source folder;
 * the function resolves the matching parent in the counterpart app.
 */
export async function syncMove(
  userId: string,
  kind: FolderKind,
  folderId: string,
  newParentId: string | null
): Promise<void> {
  if (kind === "note") {
    const sync = await findSyncByNoteFolder(userId, folderId);
    if (!sync) return;
    let vParentId: string | null = null;
    if (newParentId) {
      vParentId = await ensureSyncedVFolder(userId, newParentId);
    }
    await prisma.vFolder.updateMany({
      where: { id: sync.vFolderId, userId },
      data: { parentId: vParentId },
    });
  } else {
    const sync = await findSyncByVFolder(userId, folderId);
    if (!sync) return;
    let noteParentId: string | null = null;
    if (newParentId) {
      noteParentId = await ensureSyncedNoteFolder(userId, newParentId);
    }
    await prisma.noteFolder.updateMany({
      where: { id: sync.noteFolderId, userId },
      data: { parentId: noteParentId },
    });
  }
}

/** Return the synced counterpart id, or null if there is no mapping yet. */
export async function getSyncedCounterpart(
  userId: string,
  kind: FolderKind,
  folderId: string
): Promise<string | null> {
  if (kind === "note") {
    const sync = await findSyncByNoteFolder(userId, folderId);
    return sync?.vFolderId ?? null;
  }
  const sync = await findSyncByVFolder(userId, folderId);
  return sync?.noteFolderId ?? null;
}

interface SyncedFolderStats {
  noteCount: number;
  fileCount: number;
  syncedFolderId: string | null;
}

/** Count how many notes / files live inside the synced counterpart of a folder. */
export async function getSyncedFolderStats(
  userId: string,
  kind: FolderKind,
  folderId: string
): Promise<SyncedFolderStats> {
  const counterpartId = await getSyncedCounterpart(userId, kind, folderId);
  if (!counterpartId) {
    return { noteCount: 0, fileCount: 0, syncedFolderId: null };
  }
  if (kind === "vfile") {
    const [noteCount, fileCount] = await Promise.all([
      prisma.note.count({ where: { userId, folderId: counterpartId } }),
      prisma.vFile.count({ where: { userId, folderId, internal: false } }),
    ]);
    return { noteCount, fileCount, syncedFolderId: counterpartId };
  }
  const [noteCount, fileCount] = await Promise.all([
    prisma.note.count({ where: { userId, folderId } }),
    prisma.vFile.count({ where: { userId, folderId: counterpartId, internal: false } }),
  ]);
  return { noteCount, fileCount, syncedFolderId: counterpartId };
}

/** Delete the synced counterpart of a folder, including its contents (notes/files). */
export async function deleteSyncedCounterpart(
  userId: string,
  kind: FolderKind,
  folderId: string
): Promise<void> {
  const counterpartId = await getSyncedCounterpart(userId, kind, folderId);
  if (!counterpartId) return;

  if (kind === "vfile") {
    // counterpart is a NoteFolder
    await prisma.noteFolder.delete({ where: { id: counterpartId, userId } });
  } else {
    // counterpart is a VFolder; must also wipe files on disk.
    const files = await prisma.vFile.findMany({
      where: { userId, folderId: counterpartId },
      select: { id: true, storageKey: true },
    });
    for (const f of files) {
      await unlink(path.join(UPLOAD_DIR, f.storageKey)).catch(() => {});
      await prisma.vFile.delete({ where: { id: f.id } });
    }
    await prisma.vFolder.delete({ where: { id: counterpartId, userId } });
  }
}
