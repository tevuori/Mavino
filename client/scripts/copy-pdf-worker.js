import fs from "node:fs";
import path from "node:path";

const src = path.resolve("node_modules/pdfjs-dist/build/pdf.worker.min.mjs");
const dst = path.resolve("public/pdf.worker.min.mjs");

if (!fs.existsSync(src)) {
  console.warn("pdfjs-dist worker not found; skipping copy");
  process.exit(0);
}

fs.mkdirSync(path.dirname(dst), { recursive: true });
const srcStat = fs.statSync(src);
const dstStat = fs.existsSync(dst) ? fs.statSync(dst) : null;
if (!dstStat || srcStat.mtimeMs > dstStat.mtimeMs) {
  fs.copyFileSync(src, dst);
  console.log("Copied pdf.worker.min.mjs to public/");
}
