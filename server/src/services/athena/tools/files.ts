import path from "node:path";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import type { ToolDef } from "./plugin";
import prisma from "../../../db/client";
import { getStorageStatus } from "../../storage-quota";

const UPLOAD_DIR = path.resolve(process.cwd(), "uploads");

const TEXT_EXT = new Set([
  "txt","md","markdown","js","jsx","ts","tsx","mjs","cjs","json","json5","html",
  "htm","css","scss","sass","less","xml","svg","py","rb","php","go","rs","java",
  "c","h","cpp","hpp","cc","cs","kt","swift","sh","bash","zsh","fish","ps1",
  "yml","yaml","toml","ini","cfg","conf","env","gitignore","sql","graphql",
  "gql","vue","svelte","astro","lua","pl","r","dart","scala","clj","ex","exs",
  "erl","hs","ml","nim","v","zig","makefile","dockerfile","tf","hcl","log",
  "csv","tsv","diff","patch",
]);

function isText(name: string, mime: string): boolean {
  if (mime.startsWith("text/")) return true;
  if (["application/json","application/xml","application/javascript","application/x-sh","application/x-yaml"].includes(mime)) return true;
  if (mime.includes("yaml") || mime.includes("csv")) return true;
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (TEXT_EXT.has(ext)) return true;
  const base = path.basename(name).toLowerCase();
  if (base === "makefile" || base === "dockerfile" || base.startsWith(".")) return true;
  return false;
}

/** Build a display path like "Folder/Subfolder/file.txt" for a file. */
async function displayPath(file: { id: string; name: string; folderId: string | null }, userId: string): Promise<string> {
  const parts: string[] = [file.name];
  let curId = file.folderId;
  const allFolders = await prisma.vFolder.findMany({ where: { userId } });
  const byId = new Map(allFolders.map((f) => [f.id, f]));
  let guard = 0;
  while (curId && guard++ < 50) {
    const f = byId.get(curId);
    if (!f) break;
    parts.unshift(f.name);
    curId = f.parentId;
  }
  return parts.join("/");
}

export const fileTools: ToolDef[] = [
  {
    name: "list_files",
    description:
      "List files in the user's virtual file system. Returns id, name, path, mime, size, starred, lastOpenedAt. Optionally filter by folder id or search by name.",
    parameters: [
      { name: "folderId", type: "string", description: "Restrict to a folder id (omit for all files)" },
      { name: "search", type: "string", description: "Substring filter on file name" },
    ],
    handler: async (args, { userId }) => {
      const where: Record<string, unknown> = { userId };
      if (args.folderId) where.folderId = args.folderId;
      if (args.search) where.name = { contains: String(args.search) };
      const files = await prisma.vFile.findMany({
        where: where as never,
        orderBy: { name: "asc" },
        take: 100,
      });
      const out = await Promise.all(
        files.map(async (f) => ({
          id: f.id,
          name: f.name,
          path: await displayPath(f, userId),
          mimeType: f.mimeType,
          size: f.size,
          starred: f.starred,
          lastOpenedAt: f.lastOpenedAt?.toISOString() ?? null,
        }))
      );
      return { count: out.length, files: out };
    },
  },
  {
    name: "search_files",
    description: "Search the user's files by name. Returns id, name, path, mime.",
    parameters: [
      { name: "query", type: "string", description: "Name substring to search for", required: true },
    ],
    handler: async (args, { userId }) => {
      const files = await prisma.vFile.findMany({
        where: { userId, name: { contains: String(args.query) } },
        orderBy: { name: "asc" },
        take: 30,
      });
      const out = await Promise.all(
        files.map(async (f) => ({
          id: f.id,
          name: f.name,
          path: await displayPath(f, userId),
          mimeType: f.mimeType,
        }))
      );
      return { count: out.length, files: out };
    },
  },
  {
    name: "read_file",
    description:
      "Read the text content of a file by id. Only works for text/code files. Use search_files or list_files first to get the id.",
    parameters: [
      { name: "fileId", type: "string", description: "File id", required: true },
    ],
    handler: async (args, { userId }) => {
      const file = await prisma.vFile.findFirst({ where: { id: String(args.fileId), userId } });
      if (!file) return { error: "File not found" };
      if (!isText(file.name, file.mimeType)) {
        return { error: `File '${file.name}' is not a text file (mime: ${file.mimeType}).` };
      }
      const abs = path.join(UPLOAD_DIR, file.storageKey);
      try {
        const content = await readFile(abs, "utf-8");
        // Bump lastOpenedAt so this file shows in recent context.
        await prisma.vFile.update({ where: { id: file.id }, data: { lastOpenedAt: new Date() } });
        return {
          id: file.id,
          name: file.name,
          mimeType: file.mimeType,
          size: file.size,
          content,
        };
      } catch {
        return { error: "File missing on disk" };
      }
    },
  },
  {
    name: "edit_file",
    description:
      "Overwrite the full text content of an existing text file. Destructive — replaces the entire file. Use read_file first to see current content.",
    destructive: true,
    parameters: [
      { name: "fileId", type: "string", description: "File id", required: true },
      { name: "content", type: "string", description: "New full file content", required: true },
    ],
    handler: async (args, { userId }) => {
      const file = await prisma.vFile.findFirst({ where: { id: String(args.fileId), userId } });
      if (!file) return { error: "File not found" };
      if (!isText(file.name, file.mimeType)) {
        return { error: `File '${file.name}' is not a text file.` };
      }
      const abs = path.join(UPLOAD_DIR, file.storageKey);
      const buf = Buffer.from(String(args.content ?? ""), "utf-8");

      // Enforce role-based storage quota. The existing file is overwritten,
      // so the net change is new size minus old size.
      const quota = await getStorageStatus(userId, buf.length - file.size);
      if (!quota.allowed) {
        return { error: quota.message };
      }

      await writeFile(abs, buf);
      const updated = await prisma.vFile.update({
        where: { id: file.id },
        data: { size: buf.length, lastOpenedAt: new Date() },
      });
      return { file: { id: updated.id, name: updated.name, size: updated.size }, updated: true };
    },
  },
  {
    name: "create_file",
    description:
      "Create a new text/code file in the user's virtual file system with the given content. Use this when the user asks to create, generate, or write a new file (one that doesn't exist yet). If the file already exists, use edit_file instead. Returns the new file id.",
    destructive: true,
    parameters: [
      { name: "name", type: "string", description: "File name with extension (e.g. 'HelloWorld.java', 'script.py', 'notes.md')", required: true },
      { name: "content", type: "string", description: "Full file content", required: true },
      { name: "folderId", type: "string", description: "Optional parent folder id (omit for root level)" },
    ],
    handler: async (args, { userId }) => {
      const name = String(args.name ?? "").trim();
      if (!name) return { error: "File name is required" };
      const safeName = path.basename(name).replace(/[^\w.\- ]+/g, "_");
      // Check if a file with the same name already exists at this location.
      const existing = await prisma.vFile.findFirst({
        where: { userId, name, folderId: args.folderId ?? null },
      });
      if (existing) {
        return {
          error: `A file named '${name}' already exists. Use edit_file with fileId='${existing.id}' to modify it.`,
        };
      }
      const storageKey = `${userId}/${Date.now()}-${safeName}`;
      const absPath = path.join(UPLOAD_DIR, storageKey);
      try {
        await mkdir(path.dirname(absPath), { recursive: true });
        const buf = Buffer.from(String(args.content ?? ""), "utf-8");

        // Enforce role-based storage quota before writing to disk.
        const quota = await getStorageStatus(userId, buf.length);
        if (!quota.allowed) {
          return { error: quota.message };
        }

        await writeFile(absPath, buf);
        const ext = path.extname(name).slice(1).toLowerCase();
        const mime = ext === "md" || ext === "markdown"
          ? "text/markdown"
          : ext === "json"
          ? "application/json"
          : ext === "html" || ext === "htm"
          ? "text/html"
          : ext === "css"
          ? "text/css"
          : ext === "svg"
          ? "image/svg+xml"
          : ext === "xml"
          ? "application/xml"
          : "text/plain";
        const record = await prisma.vFile.create({
          data: {
            name,
            mimeType: mime,
            size: buf.length,
            storageKey,
            folderId: args.folderId ?? null,
            userId,
            lastOpenedAt: new Date(),
          },
        });
        return {
          file: { id: record.id, name: record.name, size: record.size, mimeType: record.mimeType },
          created: true,
        };
      } catch (e) {
        return { error: `Failed to create file: ${e instanceof Error ? e.message : "unknown error"}` };
      }
    },
  },
];
