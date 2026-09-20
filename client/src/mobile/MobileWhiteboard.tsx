import { useCallback, useEffect, useRef, useState } from "react";
import { PenTool, Pencil, Plus, Redo2, Trash2, Undo2 } from "lucide-react";
import { whiteboardsApi } from "../services/whiteboards";
import type { Whiteboard, WhiteboardSummary } from "../types";
import { MobileContainer, MobileEmpty, MobileFab, MobileHeader, MobileInput, MobileLoading } from "./MobileUi";
import { useMobileDialog } from "../store/mobileDialog";
import { useMobileToast } from "../store/mobileToast";

type AnyEl = Record<string, unknown> & { type: string };

const DRAW_COLORS = ["#a5b4fc", "#f472b6", "#4ade80", "#facc15", "#38bdf8", "#c084fc", "#fb7185", "#ffffff"];
const DRAW_WIDTHS = [2, 4, 6];

function parseContent(raw: string): AnyEl[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((e) => e && typeof e === "object" && "type" in e) : [];
  } catch { return []; }
}

function renderElement(el: AnyEl, i: number): React.ReactNode {
  const { type } = el;
  const stroke = String(el.stroke || el.color || "#a5b4fc");
  const strokeWidth = Number(el.strokeWidth) || 2;
  const fill = String(el.fill || "none");

  if (type === "text" && typeof el.text === "string") {
    return (
      <text
        key={i}
        x={Number(el.x) || 0}
        y={Number(el.y) || 0}
        fill={stroke}
        fontSize={Number(el.fontSize) || 16}
      >
        {el.text}
      </text>
    );
  }
  if (type === "rect") {
    return (
      <rect
        key={i}
        x={Number(el.x) || 0}
        y={Number(el.y) || 0}
        width={Number(el.w) || 10}
        height={Number(el.h) || 10}
        stroke={stroke}
        strokeWidth={strokeWidth}
        fill={fill}
      />
    );
  }
  if (type === "ellipse") {
    const x = Number(el.x) || 0;
    const y = Number(el.y) || 0;
    const w = Number(el.w) || 10;
    const h = Number(el.h) || 10;
    return (
      <ellipse
        key={i}
        cx={x + w / 2}
        cy={y + h / 2}
        rx={w / 2}
        ry={h / 2}
        stroke={stroke}
        strokeWidth={strokeWidth}
        fill={fill}
      />
    );
  }
  if (type === "line" || type === "arrow") {
    const x1 = Number(el.x1) || 0;
    const y1 = Number(el.y1) || 0;
    const x2 = Number(el.x2) || 0;
    const y2 = Number(el.y2) || 0;
    return (
      <line
        key={i}
        x1={x1} y1={y1} x2={x2} y2={y2}
        stroke={stroke}
        strokeWidth={strokeWidth}
        markerEnd={type === "arrow" ? "url(#arrow)" : undefined}
      />
    );
  }
  if (type === "path" && Array.isArray(el.points)) {
    const d = (el.points as unknown[])
      .filter((p) => Array.isArray(p))
      .map((p, idx) => `${idx === 0 ? "M" : "L"} ${(p as number[])[0] ?? 0} ${(p as number[])[1] ?? 0}`)
      .join(" ");
    return <path key={i} d={d} stroke={stroke} strokeWidth={strokeWidth} fill="none" strokeLinecap="round" strokeLinejoin="round" />;
  }
  if (type === "image" && typeof el.href === "string") {
    return (
      <image
        key={i}
        href={el.href}
        x={Number(el.x) || 0}
        y={Number(el.y) || 0}
        width={Number(el.w) || 100}
        height={Number(el.h) || 100}
      />
    );
  }
  return null;
}

export default function MobileWhiteboard({ onClose }: { onClose?: () => void }) {
  const [whiteboards, setWhiteboards] = useState<WhiteboardSummary[]>([]);
  const [selected, setSelected] = useState<Whiteboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const { confirm } = useMobileDialog();
  const toast = useMobileToast((s) => s.show);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await whiteboardsApi.list().catch(() => null);
    setWhiteboards(res?.whiteboards ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const open = async (w: WhiteboardSummary) => {
    const res = await whiteboardsApi.get(w.id).catch(() => null);
    if (res?.whiteboard) setSelected(res.whiteboard);
  };

  const create = async () => {
    if (!name.trim()) return;
    const res = await whiteboardsApi.create({ name: name.trim() }).catch(() => { toast("Failed to create whiteboard", "error"); return null; });
    if (res?.whiteboard) {
      setCreating(false);
      setName("");
      setWhiteboards((list) => [res.whiteboard, ...list]);
      void open(res.whiteboard);
    }
  };

  const remove = async (id: string) => {
    if (!(await confirm("Delete this whiteboard?"))) return;
    await whiteboardsApi.delete(id).catch(() => { toast("Failed to delete whiteboard", "error"); });
    setWhiteboards((list) => list.filter((w) => w.id !== id));
    if (selected?.id === id) setSelected(null);
  };

  const updateName = async () => {
    if (!selected || !name.trim()) return;
    await whiteboardsApi.update(selected.id, { name: name.trim() }).catch(() => { toast("Failed to rename whiteboard", "error"); });
    setSelected((w) => (w ? { ...w, name: name.trim() } : null));
    setWhiteboards((list) => list.map((w) => (w.id === selected.id ? { ...w, name: name.trim() } : w)));
  };

  if (selected) {
    return (
      <WhiteboardEditor
        whiteboard={selected}
        onBack={() => { setSelected(null); setName(""); }}
        onDelete={() => void remove(selected.id)}
        onSave={(updated) => {
          setSelected(updated);
          setWhiteboards((list) => list.map((w) => (w.id === updated.id ? { ...w, name: updated.name } : w)));
        }}
      />
    );
  }

  return (
    <MobileContainer>
      <MobileHeader
        title="Whiteboard"
        subtitle="Sketch your thinking"
        onClose={onClose}
        right={<MobileFab onClick={() => setCreating(true)} icon={<Plus size={22} />} />}
      />

      <div className="space-y-2">
        {loading ? (
          <MobileLoading />
        ) : whiteboards.length ? (
          whiteboards.map((w) => (
            <article
              key={w.id}
              className="flex items-center justify-between gap-3 rounded-2xl border border-edge bg-surface-2 p-4"
            >
              <button type="button" onClick={() => void open(w)} className="min-w-0 flex-1 text-left">
                <div className="flex items-center gap-2">
                  <PenTool size={18} className="shrink-0 text-accent" />
                  <span className="min-w-0 flex-1 truncate font-medium text-ink">{w.name}</span>
                </div>
                <p className="mt-1 text-xs text-ink-muted">{new Date(w.updatedAt).toLocaleDateString()}</p>
              </button>
              <button type="button" onClick={() => void remove(w.id)} className="rounded-xl p-2 text-ink-muted active:text-rose-400">
                <Trash2 size={18} />
              </button>
            </article>
          ))
        ) : (
          <MobileEmpty text="No whiteboards yet. Create one." />
        )}
      </div>

      {creating && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center" onClick={() => setCreating(false)}>
          <div className="w-full max-w-md rounded-2xl border border-edge bg-surface p-4" onClick={(e) => e.stopPropagation()}>
            <h2 className="mb-3 text-lg font-semibold text-ink">New whiteboard</h2>
            <MobileInput value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" className="mb-4" />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setCreating(false)} className="rounded-xl px-4 py-2 text-sm text-ink-muted">Cancel</button>
              <button type="button" onClick={() => void create()} className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-ink">Create</button>
            </div>
          </div>
        </div>
      )}
    </MobileContainer>
  );
}

// ===== Touch drawing editor =====

function WhiteboardEditor({
  whiteboard,
  onBack,
  onDelete,
  onSave,
}: {
  whiteboard: Whiteboard;
  onBack: () => void;
  onDelete: () => void;
  onSave: (wb: Whiteboard) => void;
}) {
  const toast = useMobileToast((s) => s.show);
  const [elements, setElements] = useState<AnyEl[]>(() => parseContent(whiteboard.content));
  const [undoStack, setUndoStack] = useState<AnyEl[][]>([]);
  const [redoStack, setRedoStack] = useState<AnyEl[][]>([]);
  const [drawing, setDrawing] = useState(false);
  const [drawColor, setDrawColor] = useState(DRAW_COLORS[0]);
  const [drawWidth, setDrawWidth] = useState(DRAW_WIDTHS[0]);
  const [showToolbar, setShowToolbar] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const currentPath = useRef<[number, number][]>([]);
  const svgRef = useRef<SVGSVGElement>(null);

  const getPoint = (e: React.PointerEvent): [number, number] => {
    const svg = svgRef.current;
    if (!svg) return [0, 0];
    const rect = svg.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 800;
    const y = ((e.clientY - rect.top) / rect.height) * 600;
    return [Math.round(x * 10) / 10, Math.round(y * 10) / 10];
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    if (!drawing) return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const pt = getPoint(e);
    currentPath.current = [pt];
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!drawing || currentPath.current.length === 0) return;
    const pt = getPoint(e);
    currentPath.current.push(pt);
    // Force re-render to show the in-progress stroke
    setElements((prev) => [...prev]);
  };

  const handlePointerUp = () => {
    if (!drawing || currentPath.current.length === 0) return;
    const points = currentPath.current;
    currentPath.current = [];
    if (points.length < 2) return;
    const newEl: AnyEl = {
      type: "path",
      points,
      stroke: drawColor,
      strokeWidth: drawWidth,
      id: `m-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    };
    setUndoStack((s) => [...s, elements]);
    setRedoStack([]);
    setElements((prev) => [...prev, newEl]);
    setDirty(true);
  };

  const undo = () => {
    if (undoStack.length === 0) return;
    const prev = undoStack[undoStack.length - 1];
    setRedoStack((s) => [...s, elements]);
    setUndoStack((s) => s.slice(0, -1));
    setElements(prev);
    setDirty(true);
  };

  const redo = () => {
    if (redoStack.length === 0) return;
    const next = redoStack[redoStack.length - 1];
    setUndoStack((s) => [...s, elements]);
    setRedoStack((s) => s.slice(0, -1));
    setElements(next);
    setDirty(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      const content = JSON.stringify(elements);
      const res = await whiteboardsApi.update(whiteboard.id, { content });
      if (res?.whiteboard) {
        onSave(res.whiteboard);
        setDirty(false);
        toast("Saved", "success");
      }
    } catch {
      toast("Failed to save whiteboard", "error");
    } finally {
      setSaving(false);
    }
  };

  // Render in-progress stroke
  const inProgressD = currentPath.current.length > 1
    ? currentPath.current.map((p, i) => `${i === 0 ? "M" : "L"} ${p[0]} ${p[1]}`).join(" ")
    : null;

  return (
    <div className="flex h-full flex-col bg-surface">
      <div className="shrink-0 px-5 pt-[max(0.5rem,env(safe-area-inset-top))]">
        <MobileHeader
          title={whiteboard.name}
          subtitle="Whiteboard"
          onBack={onBack}
          right={
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => { setDrawing(!drawing); setShowToolbar(!drawing); }}
                className={`flex h-10 w-10 items-center justify-center rounded-xl ${drawing ? "bg-accent text-white" : "bg-surface-2 text-ink-muted"} active:scale-95`}
                aria-label={drawing ? "Stop drawing" : "Draw"}
              >
                <Pencil size={18} />
              </button>
              <button type="button" onClick={onDelete} className="flex h-10 w-10 items-center justify-center rounded-xl bg-surface-2 text-ink-muted active:text-rose-400">
                <Trash2 size={18} />
              </button>
            </div>
          }
        />

        {/* Drawing toolbar */}
        {showToolbar && (
          <div className="mb-2 flex items-center gap-2 overflow-x-auto rounded-2xl border border-edge bg-surface-2 p-2">
            <button type="button" onClick={undo} disabled={undoStack.length === 0} className="shrink-0 rounded-lg p-1.5 text-ink-muted active:bg-surface-3 disabled:opacity-30">
              <Undo2 size={16} />
            </button>
            <button type="button" onClick={redo} disabled={redoStack.length === 0} className="shrink-0 rounded-lg p-1.5 text-ink-muted active:bg-surface-3 disabled:opacity-30">
              <Redo2 size={16} />
            </button>
            <div className="mx-1 h-5 w-px bg-edge" />
            {DRAW_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setDrawColor(c)}
                className={`h-6 w-6 shrink-0 rounded-full border-2 ${drawColor === c ? "border-ink" : "border-transparent"}`}
                style={{ backgroundColor: c }}
              />
            ))}
            <div className="mx-1 h-5 w-px bg-edge" />
            {DRAW_WIDTHS.map((w) => (
              <button
                key={w}
                type="button"
                onClick={() => setDrawWidth(w)}
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${drawWidth === w ? "bg-surface-3" : ""}`}
              >
                <div className="rounded-full bg-ink" style={{ width: w + 4, height: w + 4 }} />
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Canvas area */}
      <div className="min-h-0 flex-1 px-5 pb-4">
        <svg
          ref={svgRef}
          viewBox="0 0 800 600"
          className={`h-full w-full rounded-2xl border border-edge bg-white ${drawing ? "touch-none" : ""}`}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
        >
          <defs>
            <marker id="arrow" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto" markerUnits="strokeWidth">
              <path d="M0,0 L0,6 L9,3 z" fill="#a5b4fc" />
            </marker>
          </defs>
          {elements.map((el, i) => renderElement(el, i))}
          {inProgressD && (
            <path d={inProgressD} stroke={drawColor} strokeWidth={drawWidth} fill="none" strokeLinecap="round" strokeLinejoin="round" opacity={0.7} />
          )}
        </svg>
      </div>

      {/* Save button */}
      {dirty && (
        <div className="shrink-0 border-t border-edge bg-surface px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving}
            className="brand-gradient flex w-full items-center justify-center rounded-2xl py-3 text-sm font-semibold text-white shadow-md shadow-accent/30 active:scale-[.98] disabled:opacity-60"
          >
            {saving ? "Saving..." : "Save changes"}
          </button>
        </div>
      )}
    </div>
  );
}
