// ===== Upload security utilities =====
// Shared magic-number validation for file uploads. Used by files, voice,
// and study-lectures routes to detect and block executables regardless of
// the client-provided file extension or MIME type.

/**
 * MIME types detected by `file-type` that are considered dangerous and should
 * be blocked even if the extension isn't in the blocklist. This catches files
 * that have been renamed to a safe extension but are actually executables.
 */
const BLOCKED_MIME_TYPES = new Set([
  "application/x-msdownload", // .exe
  "application/x-msdos-program", // .exe/.com
  "application/x-executable", // Linux ELF
  "application/x-sharedlib", // .so
  "application/x-mach-binary", // macOS Mach-O
  "application/java-archive", // .jar
  "application/vnd.android.package-archive", // .apk
  "application/x-debian-package", // .deb
  "application/x-rpm", // .rpm
  "application/x-7z-compressed", // 7z (can contain executables)
]);

/**
 * Detect the real file type from its magic bytes and check it against the
 * blocklist. Returns the detected MIME type (which should override the
 * client-provided one) or null if the file type couldn't be determined.
 *
 * If the detected MIME is in the blocklist, the upload should be rejected
 * regardless of the extension.
 */
export async function detectAndValidateMime(
  buf: ArrayBuffer | Buffer,
  declaredMime: string
): Promise<{ mime: string; blocked: boolean }> {
  // file-type needs a Uint8Array — only sniff the first 4KB for efficiency.
  const bytes = buf instanceof Buffer ? buf.subarray(0, 4096) : new Uint8Array(buf.slice(0, 4096));
  const header = bytes instanceof Buffer ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength) : bytes;
  const { fileTypeFromBuffer } = await import("file-type");
  const detected = await fileTypeFromBuffer(header);

  if (!detected) {
    // Can't detect — text files, empty files, etc. Trust the client type.
    return { mime: declaredMime || "application/octet-stream", blocked: false };
  }

  const detectedMime = detected.mime;
  const blocked = BLOCKED_MIME_TYPES.has(detectedMime);

  // Use the detected MIME type instead of the client-provided one — the
  // client can lie, but magic bytes can't (for files file-type recognizes).
  return { mime: detectedMime, blocked };
}
