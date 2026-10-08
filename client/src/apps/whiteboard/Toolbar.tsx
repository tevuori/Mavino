import {
  MousePointer2, Pen, Minus, Square, Circle, ArrowRight, Type, Eraser,
  Undo2, Redo2, Trash2, Download, Save, PaintBucket,
} from "lucide-react";
import type { Tool } from "./elements";

interface Props {
  tool: Tool;
  setTool: (t: Tool) => void;
  color: string;
  setColor: (c: string) => void;
  strokeWidth: number;
  setStrokeWidth: (w: number) => void;
  fill: string; // "none" | color
  setFill: (f: string) => void;
  fontSize: number;
  setFontSize: (s: number) => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onClear: () => void;
  onExportSvg: () => void;
  onExportPng: () => void;
  onSave: () => void;
  saving: boolean;
}

const TOOLS: { id: Tool; icon: React.ReactNode; label: string }[] = [
  { id: "select", icon: <MousePointer2 size={18} />, label: "Select" },
  { id: "pen", icon: <Pen size={18} />, label: "Pen" },
  { id: "line", icon: <Minus size={18} />, label: "Line" },
  { id: "rect", icon: <Square size={18} />, label: "Rectangle" },
  { id: "ellipse", icon: <Circle size={18} />, label: "Ellipse" },
  { id: "arrow", icon: <ArrowRight size={18} />, label: "Arrow" },
  { id: "text", icon: <Type size={18} />, label: "Text" },
  { id: "eraser", icon: <Eraser size={18} />, label: "Eraser" },
];

const COLORS = [
  "#111827", "#ef4444", "#f59e0b", "#22c55e",
  "#3b82f6", "#8b5cf6", "#ec4899", "#ffffff",
];

const STROKES = [2, 4, 8];
const FONT_SIZES = [16, 24, 36, 56];

function Btn({
  active, onClick, title, disabled, children,
}: {
  active?: boolean;
  onClick: () => void;
  title: string;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`rounded-md p-2 transition-colors ${
        active
          ? "bg-accent text-white"
          : "text-ink-muted dark:text-ink-muted hover:bg-surface-2 dark:hover:bg-surface-3 active:bg-surface-3 dark:active:bg-surface-3 disabled:opacity-40 disabled:hover:bg-transparent"
      }`}
    >
      {children}
    </button>
  );
}

export default function Toolbar(props: Props) {
  const {
    tool, setTool, color, setColor, strokeWidth, setStrokeWidth,
    fill, setFill, fontSize, setFontSize,
    onUndo, onRedo, canUndo, canRedo, onClear, onExportSvg, onExportPng, onSave, saving,
  } = props;

  const filled = fill !== "none";

  return (
    <div className="flex flex-wrap items-center gap-1 border-b border-edge bg-white/80 px-2 py-1.5 backdrop-blur dark:border-edge dark:bg-surface-2">
      {/* Tools */}
      <div className="flex shrink-0 items-center gap-0.5">
        {TOOLS.map((t) => (
          <Btn key={t.id} active={tool === t.id} onClick={() => setTool(t.id)} title={t.label}>
            {t.icon}
          </Btn>
        ))}
      </div>

      <Divider />

      {/* Color */}
      <div className="flex shrink-0 items-center gap-1">
        {COLORS.map((c) => (
          <button
            key={c}
            onClick={() => setColor(c)}
            title={c}
            className={`h-5 w-5 rounded-full border-2 transition-transform ${
              color === c ? "border-accent scale-110" : "border-edge dark:border-edge"
            }`}
            style={{ background: c }}
          />
        ))}
        <input
          type="color"
          value={color}
          onChange={(e) => setColor(e.target.value)}
          title="Custom color"
          className="h-6 w-6 cursor-pointer rounded border-0 bg-transparent p-0"
        />
      </div>

      <Divider />

      {/* Stroke width (hidden for text tool) */}
      {tool !== "text" && (
        <div className="flex shrink-0 items-center gap-0.5">
          {STROKES.map((w) => (
            <Btn
              key={w}
              active={strokeWidth === w}
              onClick={() => setStrokeWidth(w)}
              title={`${w}px`}
            >
              <div
                className="rounded-full bg-current"
                style={{ width: 16, height: w }}
              />
            </Btn>
          ))}
        </div>
      )}

      {/* Font size (text tool only) */}
      {tool === "text" && (
        <div className="flex shrink-0 items-center gap-0.5">
          {FONT_SIZES.map((s) => (
            <Btn
              key={s}
              active={fontSize === s}
              onClick={() => setFontSize(s)}
              title={`${s}px`}
            >
              <span className="text-xs font-semibold">{s}</span>
            </Btn>
          ))}
        </div>
      )}

      {/* Fill toggle (shapes only) */}
      {(tool === "rect" || tool === "ellipse") && (
        <Btn
          active={filled}
          onClick={() => setFill(filled ? "none" : color)}
          title={filled ? "Filled (click to outline)" : "Outline (click to fill)"}
        >
          <PaintBucket size={18} />
        </Btn>
      )}

      <Divider />

      {/* Undo / Redo */}
      <div className="flex shrink-0 items-center gap-0.5">
        <Btn onClick={onUndo} disabled={!canUndo} title="Undo (Ctrl+Z)">
          <Undo2 size={18} />
        </Btn>
        <Btn onClick={onRedo} disabled={!canRedo} title="Redo (Ctrl+Y)">
          <Redo2 size={18} />
        </Btn>
        <Btn onClick={onClear} title="Clear canvas">
          <Trash2 size={18} />
        </Btn>
      </div>

      <Divider />

      {/* Export + Save */}
      <div className="flex shrink-0 items-center gap-0.5">
        <Btn onClick={onExportSvg} title="Export as SVG">
          <Download size={18} />
          <span className="sr-only">SVG</span>
        </Btn>
        <Btn onClick={onExportPng} title="Export as PNG">
          <span className="text-[10px] font-bold px-1">PNG</span>
        </Btn>
        <Btn onClick={onSave} disabled={saving} title="Save (Ctrl+S)">
          <Save size={18} />
        </Btn>
      </div>
    </div>
  );
}

function Divider() {
  return <div className="w-px h-6 shrink-0 bg-surface-2 dark:bg-surface-2 mx-1" />;
}
