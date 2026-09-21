import { useRef, useState, useEffect, useCallback } from "react";
import type {
  WhiteboardElement,
  Tool,
  PathEl,
  LineEl,
  RectEl,
  EllipseEl,
  ArrowEl,
  TextEl,
  ImageEl,
  BBox,
} from "./elements";
import { newId, bboxOf, hitTest, moveEl, scaleElToBbox, downscaleDataUrl } from "./elements";
import { promptDialog } from "../../store/mobileDialog";

const CANVAS_W = 2000;
const CANVAS_H = 1400;

type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
const HANDLES: Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

interface Props {
  elements: WhiteboardElement[];
  tool: Tool;
  color: string;
  strokeWidth: number;
  fill: string; // "none" or color
  fontSize: number;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** Live update during an interaction (no undo push). */
  onChange: (next: WhiteboardElement[]) => void;
  /** Final commit at interaction end. `prev` is pushed to undo, `next` is applied. */
  onCommit: (prev: WhiteboardElement[], next: WhiteboardElement[]) => void;
}

function arrowHead(x1: number, y1: number, x2: number, y2: number, size: number): string {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const a1 = angle - Math.PI / 6;
  const a2 = angle + Math.PI / 6;
  return `M ${x2} ${y2} L ${x2 - size * Math.cos(a1)} ${y2 - size * Math.sin(a1)} M ${x2} ${y2} L ${x2 - size * Math.cos(a2)} ${y2 - size * Math.sin(a2)}`;
}

function renderEl(el: WhiteboardElement): React.ReactNode {
  switch (el.type) {
    case "path": {
      if (el.points.length === 0) return null;
      const d = el.points
        .map(([x, y], i) => `${i === 0 ? "M" : "L"} ${x} ${y}`)
        .join(" ");
      return (
        <path
          key={el.id}
          d={d}
          stroke={el.stroke}
          strokeWidth={el.strokeWidth}
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      );
    }
    case "line":
      return (
        <line
          key={el.id}
          x1={el.x1} y1={el.y1} x2={el.x2} y2={el.y2}
          stroke={el.stroke}
          strokeWidth={el.strokeWidth}
          strokeLinecap="round"
        />
      );
    case "rect":
      return (
        <rect
          key={el.id}
          x={el.x} y={el.y} width={el.w} height={el.h}
          stroke={el.stroke}
          strokeWidth={el.strokeWidth}
          fill={el.fill}
          rx={2}
        />
      );
    case "ellipse":
      return (
        <ellipse
          key={el.id}
          cx={el.x + el.w / 2}
          cy={el.y + el.h / 2}
          rx={el.w / 2}
          ry={el.h / 2}
          stroke={el.stroke}
          strokeWidth={el.strokeWidth}
          fill={el.fill}
        />
      );
    case "arrow":
      return (
        <g key={el.id}>
          <line
            x1={el.x1} y1={el.y1} x2={el.x2} y2={el.y2}
            stroke={el.stroke}
            strokeWidth={el.strokeWidth}
            strokeLinecap="round"
          />
          <path
            d={arrowHead(el.x1, el.y1, el.x2, el.y2, 14 + el.strokeWidth * 1.5)}
            stroke={el.stroke}
            strokeWidth={el.strokeWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        </g>
      );
    case "text":
      return (
        <text
          key={el.id}
          x={el.x}
          y={el.y}
          fill={el.color}
          fontSize={el.fontSize}
          fontFamily="ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
          dominantBaseline="alphabetic"
        >
          {el.text}
        </text>
      );
    case "image":
      return (
        <image
          key={el.id}
          href={el.href}
          x={el.x}
          y={el.y}
          width={el.w}
          height={el.h}
          preserveAspectRatio="none"
        />
      );
  }
}

function handlePos(b: BBox, h: Handle): { x: number; y: number } {
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  switch (h) {
    case "nw": return { x: b.x, y: b.y };
    case "n": return { x: cx, y: b.y };
    case "ne": return { x: b.x + b.w, y: b.y };
    case "e": return { x: b.x + b.w, y: cy };
    case "se": return { x: b.x + b.w, y: b.y + b.h };
    case "s": return { x: cx, y: b.y + b.h };
    case "sw": return { x: b.x, y: b.y + b.h };
    case "w": return { x: b.x, y: cy };
  }
}

function computeResizedBBox(handle: Handle, orig: BBox, x: number, y: number): BBox {
  let { x: nx, y: ny, w, h } = orig;
  const right = orig.x + orig.w;
  const bottom = orig.y + orig.h;
  if (handle.includes("w")) { nx = Math.min(x, right - 2); w = right - nx; }
  if (handle.includes("e")) { w = Math.max(2, x - orig.x); nx = orig.x; }
  if (handle.includes("n")) { ny = Math.min(y, bottom - 2); h = bottom - ny; }
  if (handle.includes("s")) { h = Math.max(2, y - orig.y); ny = orig.y; }
  return { x: nx, y: ny, w, h };
}

export default function Canvas({
  elements,
  tool,
  color,
  strokeWidth,
  fill,
  fontSize,
  selectedId,
  onSelect,
  onChange,
  onCommit,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [draft, setDraft] = useState<WhiteboardElement | null>(null);
  const draftRef = useRef<WhiteboardElement | null>(null);
  draftRef.current = draft;

  const interaction = useRef<
    | { kind: "draw"; startX: number; startY: number }
    | { kind: "move"; id: string; startX: number; startY: number; orig: WhiteboardElement; origElements: WhiteboardElement[] }
    | { kind: "resize"; id: string; handle: Handle; origBBox: BBox; orig: WhiteboardElement; origElements: WhiteboardElement[] }
    | null
  >(null);

  const getPoint = useCallback((e: { clientX: number; clientY: number }) => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const p = pt.matrixTransform(ctm.inverse());
    return { x: p.x, y: p.y };
  }, []);

  const findHit = useCallback(
    (x: number, y: number): WhiteboardElement | null => {
      for (let i = elements.length - 1; i >= 0; i--) {
        if (hitTest(elements[i], x, y)) return elements[i];
      }
      return null;
    },
    [elements]
  );

  const handlePointerDown = async (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const { x, y } = getPoint(e);
    (e.target as Element).setPointerCapture?.(e.pointerId);

    if (tool === "select") {
      // Resize handle hit?
      if (selectedId) {
        const el = elements.find((el) => el.id === selectedId);
        if (el) {
          const b = bboxOf(el);
          const pad = 4;
          const hb = { x: b.x - pad, y: b.y - pad, w: b.w + pad * 2, h: b.h + pad * 2 };
          const r = 16;
          for (const h of HANDLES) {
            const p = handlePos(hb, h);
            if (Math.abs(x - p.x) <= r && Math.abs(y - p.y) <= r) {
              interaction.current = {
                kind: "resize",
                id: selectedId,
                handle: h,
                origBBox: b,
                orig: el,
                origElements: elements,
              };
              return;
            }
          }
        }
      }
      const hit = findHit(x, y);
      if (hit) {
        onSelect(hit.id);
        interaction.current = {
          kind: "move",
          id: hit.id,
          startX: x,
          startY: y,
          orig: hit,
          origElements: elements,
        };
      } else {
        onSelect(null);
      }
      return;
    }

    if (tool === "eraser") {
      const hit = findHit(x, y);
      if (hit) {
        onCommit(elements, elements.filter((el) => el.id !== hit.id));
        onSelect(null);
      }
      return;
    }

    if (tool === "text") {
      const text = await promptDialog("Enter text:");
      if (text && text.trim()) {
        const el: TextEl = {
          id: newId(),
          type: "text",
          x,
          y,
          text,
          color,
          fontSize,
        };
        onCommit(elements, [...elements, el]);
      }
      return;
    }

    // Drawing tools
    interaction.current = { kind: "draw", startX: x, startY: y };
    const id = newId();
    let el: WhiteboardElement;
    switch (tool) {
      case "pen":
        el = { id, type: "path", points: [[x, y]], stroke: color, strokeWidth } as PathEl;
        break;
      case "line":
        el = { id, type: "line", x1: x, y1: y, x2: x, y2: y, stroke: color, strokeWidth } as LineEl;
        break;
      case "rect":
        el = { id, type: "rect", x, y, w: 0, h: 0, stroke: color, strokeWidth, fill } as RectEl;
        break;
      case "ellipse":
        el = { id, type: "ellipse", x, y, w: 0, h: 0, stroke: color, strokeWidth, fill } as EllipseEl;
        break;
      case "arrow":
        el = { id, type: "arrow", x1: x, y1: y, x2: x, y2: y, stroke: color, strokeWidth } as ArrowEl;
        break;
      default:
        interaction.current = null;
        return;
    }
    setDraft(el);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    const it = interaction.current;
    if (!it) return;
    const { x, y } = getPoint(e);

    if (it.kind === "draw") {
      const d = draftRef.current;
      if (!d) return;
      let next: WhiteboardElement;
      switch (d.type) {
        case "path":
          next = { ...d, points: [...d.points, [x, y] as [number, number]] };
          break;
        case "line":
        case "arrow":
          next = { ...d, x2: x, y2: y };
          break;
        case "rect":
        case "ellipse":
          next = {
            ...d,
            x: Math.min(it.startX, x),
            y: Math.min(it.startY, y),
            w: Math.abs(x - it.startX),
            h: Math.abs(y - it.startY),
          } as RectEl | EllipseEl;
          break;
        default:
          next = d;
      }
      setDraft(next);
      return;
    }

    if (it.kind === "move") {
      const dx = x - it.startX;
      const dy = y - it.startY;
      const next = elements.map((el) => (el.id === it.id ? moveEl(it.orig, dx, dy) : el));
      onChange(next);
      return;
    }

    if (it.kind === "resize") {
      const newBBox = computeResizedBBox(it.handle, it.origBBox, x, y);
      const next = elements.map((el) =>
        el.id === it.id ? scaleElToBbox(it.orig, it.origBBox, newBBox) : el
      );
      onChange(next);
      return;
    }
  };

  const handlePointerUp = () => {
    const it = interaction.current;
    interaction.current = null;

    if (it?.kind === "draw") {
      const d = draftRef.current;
      setDraft(null);
      if (!d) return;
      const b = bboxOf(d);
      // Skip negligible non-path drawings (a click without drag). Keep paths
      // so a single tap leaves a visible dot.
      if (d.type !== "path" && b.w < 3 && b.h < 3) return;
      onCommit(elements, [...elements, d]);
      return;
    }

    if (it?.kind === "move" || it?.kind === "resize") {
      onCommit(it.origElements, elements);
      return;
    }
  };

  // Keyboard: delete selected
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!selectedId) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        onCommit(elements, elements.filter((el) => el.id !== selectedId));
        onSelect(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId, elements, onCommit, onSelect]);

  // Drag-drop image onto canvas
  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (!file || !file.type.startsWith("image/")) return;
    const { x, y } = getPoint(e);
    const reader = new FileReader();
    reader.onload = async () => {
      const href = await downscaleDataUrl(reader.result as string);
      const el: ImageEl = {
        id: newId(),
        type: "image",
        x: x - 100,
        y: y - 75,
        w: 200,
        h: 150,
        href,
      };
      onCommit(elements, [...elements, el]);
    };
    reader.readAsDataURL(file);
  };

  const cursor = tool === "select" ? "default" : "crosshair";
  const visible = draft ? [...elements, draft] : elements;
  const selected = selectedId ? elements.find((el) => el.id === selectedId) ?? null : null;

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`}
      preserveAspectRatio="xMidYMid meet"
      className="whiteboard-canvas-svg w-full h-full touch-none select-none"
      style={{ cursor, background: "#ffffff" }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onDrop={handleDrop}
      onDragOver={(e) => e.preventDefault()}
    >
      <rect x={0} y={0} width={CANVAS_W} height={CANVAS_H} fill="#ffffff" />
      {visible.map(renderEl)}
      {selected && tool === "select" && <SelectionOverlay el={selected} />}
    </svg>
  );
}

function SelectionOverlay({ el }: { el: WhiteboardElement }) {
  const b = bboxOf(el);
  const pad = 4;
  const bx = b.x - pad;
  const by = b.y - pad;
  const bw = b.w + pad * 2;
  const bh = b.h + pad * 2;
  return (
    <g pointerEvents="none">
      <rect
        x={bx}
        y={by}
        width={bw}
        height={bh}
        fill="none"
        stroke="#6366f1"
        strokeWidth={1.5}
        strokeDasharray="6 4"
      />
      {HANDLES.map((h) => {
        const p = handlePos({ x: bx, y: by, w: bw, h: bh }, h);
        return (
          <rect
            key={h}
            x={p.x - 5}
            y={p.y - 5}
            width={10}
            height={10}
            fill="#ffffff"
            stroke="#6366f1"
            strokeWidth={1.5}
            rx={1.5}
          />
        );
      })}
    </g>
  );
}
