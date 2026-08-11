import { useCallback, useEffect, useState } from "react";
import { PenTool, Plus, Trash2 } from "lucide-react";
import { whiteboardsApi } from "../services/whiteboards";
import type { Whiteboard, WhiteboardSummary } from "../types";
import { MobileContainer, MobileEmpty, MobileFab, MobileHeader, MobileInput, MobileLoading, MobileTextarea } from "./MobileUi";

type AnyEl = Record<string, unknown> & { type: string };

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
    const res = await whiteboardsApi.create({ name: name.trim() }).catch(() => null);
    if (res?.whiteboard) {
      setCreating(false);
      setName("");
      setWhiteboards((list) => [res.whiteboard, ...list]);
      void open(res.whiteboard);
    }
  };

  const remove = async (id: string) => {
    if (!window.confirm("Delete this whiteboard?")) return;
    await whiteboardsApi.delete(id).catch(() => {});
    setWhiteboards((list) => list.filter((w) => w.id !== id));
    if (selected?.id === id) setSelected(null);
  };

  const updateName = async () => {
    if (!selected || !name.trim()) return;
    await whiteboardsApi.update(selected.id, { name: name.trim() }).catch(() => {});
    setSelected((w) => (w ? { ...w, name: name.trim() } : null));
    setWhiteboards((list) => list.map((w) => (w.id === selected.id ? { ...w, name: name.trim() } : w)));
  };

  if (selected) {
    const elements = parseContent(selected.content);
    return (
      <MobileContainer>
        <MobileHeader
          title={selected.name}
          subtitle="Whiteboard"
          onBack={() => { setSelected(null); setName(""); }}
          right={
            <button type="button" onClick={() => void remove(selected.id)} className="rounded-xl p-2 text-ink-muted active:text-rose-400">
              <Trash2 size={20} />
            </button>
          }
        />
        <MobileInput
          value={name || selected.name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => void updateName()}
          placeholder="Whiteboard name"
          className="mb-4"
        />
        <div className="rounded-2xl border border-edge bg-surface-2 p-4">
          <p className="mb-2 text-sm font-semibold text-ink">Preview ({elements.length} elements)</p>
          {elements.length ? (
            <svg viewBox="0 0 800 600" className="h-auto w-full rounded-xl bg-surface">
              <defs>
                <marker id="arrow" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto" markerUnits="strokeWidth">
                  <path d="M0,0 L0,6 L9,3 z" fill="#a5b4fc" />
                </marker>
              </defs>
              {elements.map((el, i) => renderElement(el, i))}
            </svg>
          ) : (
            <p className="text-sm text-ink-muted">No elements to preview.</p>
          )}
        </div>
      </MobileContainer>
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
