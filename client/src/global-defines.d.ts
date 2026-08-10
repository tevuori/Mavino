/**
 * Build-time constants injected by Vite `define` (see client/vite.config.ts).
 * These are replaced with literal values at build time, so they have no
 * runtime cost and are safe to reference from any module.
 */
declare const __APP_VERSION__: string;
/** GitHub "owner/repo" slug auto-detected from `git remote get-url origin`, or null. */
declare const __UPDATE_REPO__: string | null;

/** d3-force-3d (used by react-force-graph-2d internally) — no published types. */
declare module "d3-force-3d" {
  export function forceCollide(): any;
  export function forceCollide(radius: (node: any) => number): any;
  export function forceManyBody(): any;
  export function forceLink(): any;
  export function forceCenter(): any;
}
