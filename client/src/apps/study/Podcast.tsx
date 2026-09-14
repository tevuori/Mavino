import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, BookOpen, Cloud, Download, FileText, Headphones, Loader2, Mic2, RefreshCw, Sparkles, Trash2, Users, WandSparkles } from "lucide-react";
import { studyPodcastsApi, type Podcast as PodcastRow, type PodcastEngine, type PollyVoice } from "../../services/study-podcasts";
import { studySourcesApi, type StudySource } from "../../services/study-sources";
import { studyWorkspacesApi } from "../../services/study-workspaces";
import WorkspaceSourceSelector from "./WorkspaceSourceSelector";
import HighlightableMarkdown from "./HighlightableMarkdown";
import { ActionButton, ErrorBanner, Loading, SuccessBanner } from "./ui";
import { useWindows } from "../../store/windows";

interface Props { initialPodcastId?: string | null; initialWorkspaceId?: string | null; language?: "en" | "cs" }
const fieldClass = "w-full rounded-lg border border-edge bg-surface px-3 py-2 text-xs text-ink outline-none focus:border-accent";

function duration(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${Math.round(seconds % 60).toString().padStart(2, "0")}`;
}

function statusStyle(status: PodcastRow["status"]) {
  if (status === "ready") return "bg-emerald-500/15 text-emerald-500";
  if (status === "failed") return "bg-red-500/15 text-red-500";
  return "bg-amber-500/15 text-amber-500";
}

export default function Podcast({ initialPodcastId, initialWorkspaceId, language: initialLanguage = "en" }: Props) {
  const [library, setLibrary] = useState<StudySource[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [podcasts, setPodcasts] = useState<PodcastRow[]>([]);
  const [active, setActive] = useState<PodcastRow | null>(null);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [voices, setVoices] = useState<PollyVoice[]>([]);
  const [language, setLanguage] = useState<"en" | "cs">(initialLanguage);
  const [engine, setEngine] = useState<PodcastEngine>("neural");
  const [voice1, setVoice1] = useState("");
  const [voice2, setVoice2] = useState("");
  const [host1Label, setHost1Label] = useState("Alex");
  const [host2Label, setHost2Label] = useState("Sam");
  const [title, setTitle] = useState("");
  const [length, setLength] = useState<"short" | "medium" | "long">("medium");
  const [tone, setTone] = useState<"engaging" | "academic" | "relaxed" | "debate">("engaging");
  const [focus, setFocus] = useState("");
  const [audioUrl, setAudioUrl] = useState("");
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const openWindow = useWindows((state) => state.open);

  const refresh = useCallback(async () => {
    const [sources, episodes, config] = await Promise.all([
      studySourcesApi.list().then((result) => result.sources).catch(() => []),
      studyPodcastsApi.list().then((result) => result.podcasts).catch(() => []),
      studyPodcastsApi.getConfig().catch(() => ({ configured: false })),
    ]);
    setLibrary(sources); setPodcasts(episodes); setConfigured(config.configured);
    setActive((current) => current ? episodes.find((item) => item.id === current.id) ?? current : current);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    if (!configured) { setVoices([]); return; }
    void studyPodcastsApi.getVoices(language).then(({ voices: next }) => {
      setVoices(next);
      const engines = ["neural", "generative", "long-form", "standard"] as PodcastEngine[];
      const nextEngine = engines.find((candidate) => next.some((voice) => voice.supportedEngines.includes(candidate))) ?? "standard";
      setEngine(nextEngine);
    }).catch((reason) => setError(reason instanceof Error ? reason.message : "Could not load Polly voices"));
  }, [configured, language]);

  const compatibleVoices = useMemo(() => voices.filter((voice) => voice.supportedEngines.includes(engine)), [voices, engine]);
  useEffect(() => {
    if (!compatibleVoices.length) { setVoice1(""); setVoice2(""); return; }
    setVoice1((current) => compatibleVoices.some((voice) => voice.id === current) ? current : compatibleVoices[0].id);
    setVoice2((current) => compatibleVoices.some((voice) => voice.id === current) ? current : (compatibleVoices[1] ?? compatibleVoices[0]).id);
  }, [compatibleVoices]);

  useEffect(() => {
    if (!active || !["queued", "processing"].includes(active.status)) return;
    const timer = window.setInterval(async () => {
      const { podcast } = await studyPodcastsApi.get(active.id);
      setActive(podcast);
      if (podcast.status === "ready" || podcast.status === "failed") void refresh();
    }, 2000);
    return () => window.clearInterval(timer);
  }, [active?.id, active?.status, refresh]);

  useEffect(() => {
    if (!active?.hasAudio) { setAudioUrl(""); return; }
    let url = "";
    void studyPodcastsApi.getAudio(active.id).then((next) => { url = next; setAudioUrl(next); }).catch(() => setAudioUrl(""));
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [active?.id, active?.hasAudio, active?.updatedAt]);

  useEffect(() => {
    if (!initialPodcastId) return;
    void studyPodcastsApi.get(initialPodcastId).then(({ podcast }) => { setActive(podcast); setSelectedIds(new Set(podcast.sourceIds)); });
  }, [initialPodcastId]);

  useEffect(() => {
    if (!initialWorkspaceId) return;
    void studyWorkspacesApi.get(initialWorkspaceId).then(async ({ workspace }) => {
      const missing = workspace.sourceIds.filter((id) => !library.some((source) => source.id === id));
      const fetched = await Promise.all(missing.map((id) => studySourcesApi.get(id).catch(() => null)));
      setLibrary((current) => [...current, ...fetched.filter((item): item is StudySource => Boolean(item))]);
      setSelectedIds(new Set(workspace.sourceIds));
    });
  }, [initialWorkspaceId]);

  const generate = async () => {
    if (!selectedIds.size || !voice1 || !voice2) return;
    setGenerating(true); setError(""); setSuccess("");
    try {
      const { podcast } = await studyPodcastsApi.generate({ sourceIds: [...selectedIds], title: title.trim() || undefined, host1Label, host2Label, language, length, tone, focus: focus.trim() || undefined, engine, voice1, voice2 });
      setActive(podcast); setSuccess("Script created. AWS Polly is now producing your episode."); setTitle(""); void refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Podcast generation failed"); }
    finally { setGenerating(false); }
  };

  const selectPodcast = async (podcast: PodcastRow) => {
    const result = await studyPodcastsApi.get(podcast.id);
    setActive(result.podcast); setSelectedIds(new Set(result.podcast.sourceIds)); setError("");
  };

  const remove = async (id: string) => {
    await studyPodcastsApi.remove(id);
    if (active?.id === id) setActive(null);
    void refresh();
  };

  return (
    <div className="grid min-h-full gap-4 @5xl:grid-cols-[minmax(320px,0.8fr)_minmax(420px,1.2fr)]">
      <div className="space-y-4">
        <div className="overflow-hidden rounded-2xl border border-edge bg-gradient-to-br from-accent/15 via-surface-2 to-surface-2 p-5">
          <div className="mb-1 flex items-center gap-2 text-accent"><WandSparkles size={18} /><span className="text-xs font-semibold uppercase tracking-[0.18em]">Audio overview</span></div>
          <h2 className="text-xl font-semibold text-ink">Turn your sources into a podcast</h2>
          <p className="mt-1 text-xs leading-5 text-ink-muted">Two AI hosts unpack your material in a polished, downloadable AWS Polly episode.</p>
        </div>

        {configured === false && <div className="flex gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-500"><AlertCircle size={15} className="shrink-0" /><span>AWS Polly is not configured. An administrator must add global credentials in Settings → Study Hub.</span></div>}
        <div className="rounded-2xl border border-edge bg-surface-2 p-4">
          <div className="mb-3 flex items-center gap-2"><BookOpen size={15} className="text-accent" /><h3 className="text-sm font-semibold text-ink">1. Choose sources</h3><span className="ml-auto rounded-full bg-accent/10 px-2 py-0.5 text-[10px] text-accent">{selectedIds.size} selected</span></div>
          <WorkspaceSourceSelector selectedIds={selectedIds} onToggle={(id) => setSelectedIds((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; })} disabled={generating} onSourceAdded={(source) => setLibrary((current) => [source, ...current])} />
        </div>

        <div className="rounded-2xl border border-edge bg-surface-2 p-4">
          <div className="mb-3 flex items-center gap-2"><Users size={15} className="text-accent" /><h3 className="text-sm font-semibold text-ink">2. Direct the episode</h3></div>
          <div className="grid gap-3 @2xl:grid-cols-2">
            <label className="text-[11px] text-ink-muted">Episode title<input className={`${fieldClass} mt-1`} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Generated from sources" /></label>
            <label className="text-[11px] text-ink-muted">Language<select className={`${fieldClass} mt-1`} value={language} onChange={(event) => setLanguage(event.target.value as "en" | "cs")}><option value="en">English</option><option value="cs">Čeština</option></select></label>
            <label className="text-[11px] text-ink-muted">Length<select className={`${fieldClass} mt-1`} value={length} onChange={(event) => setLength(event.target.value as typeof length)}><option value="short">Quick · 3–4 min</option><option value="medium">Standard · 5–8 min</option><option value="long">Deep dive · 10–12 min</option></select></label>
            <label className="text-[11px] text-ink-muted">Tone<select className={`${fieldClass} mt-1`} value={tone} onChange={(event) => setTone(event.target.value as typeof tone)}><option value="engaging">Engaging</option><option value="academic">Academic</option><option value="relaxed">Relaxed</option><option value="debate">Friendly debate</option></select></label>
          </div>
          <label className="mt-3 block text-[11px] text-ink-muted">Special focus<textarea className={`${fieldClass} mt-1 min-h-16 resize-y`} value={focus} onChange={(event) => setFocus(event.target.value)} placeholder="What should the hosts emphasize?" /></label>
          <div className="mt-4 grid gap-3 @2xl:grid-cols-2">
            <label className="text-[11px] text-ink-muted">Host 1 name<input className={`${fieldClass} mt-1`} value={host1Label} onChange={(event) => setHost1Label(event.target.value)} /></label>
            <label className="text-[11px] text-ink-muted">Host 2 name<input className={`${fieldClass} mt-1`} value={host2Label} onChange={(event) => setHost2Label(event.target.value)} /></label>
            <label className="text-[11px] text-ink-muted">Polly engine<select className={`${fieldClass} mt-1`} value={engine} onChange={(event) => setEngine(event.target.value as PodcastEngine)}>{(["neural", "generative", "long-form", "standard"] as PodcastEngine[]).filter((item) => voices.some((voice) => voice.supportedEngines.includes(item))).map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
            <div />
            <label className="text-[11px] text-ink-muted">{host1Label || "Host 1"} voice<select className={`${fieldClass} mt-1`} value={voice1} onChange={(event) => setVoice1(event.target.value)}>{compatibleVoices.map((voice) => <option key={voice.id} value={voice.id}>{voice.name} · {voice.gender}</option>)}</select></label>
            <label className="text-[11px] text-ink-muted">{host2Label || "Host 2"} voice<select className={`${fieldClass} mt-1`} value={voice2} onChange={(event) => setVoice2(event.target.value)}>{compatibleVoices.map((voice) => <option key={voice.id} value={voice.id}>{voice.name} · {voice.gender}</option>)}</select></label>
          </div>
          {language === "cs" && compatibleVoices.length < 2 && <p className="mt-2 text-[11px] text-amber-500">Polly currently exposes only one compatible Czech voice for this engine, so both hosts will share it.</p>}
          <div className="mt-4"><ActionButton onClick={generate} disabled={!configured || !selectedIds.size || !voice1 || !voice2 || generating} loading={generating}><Sparkles size={14} /> Create podcast</ActionButton></div>
        </div>
        {generating && <Loading label="Writing your episode script…" />}{error && <ErrorBanner message={error} />}{success && <SuccessBanner message={success} />}
      </div>

      <div className="space-y-4">
        {active ? <div className="overflow-hidden rounded-2xl border border-edge bg-surface-2 shadow-xl shadow-black/5">
          <div className="relative bg-gradient-to-br from-violet-500/25 via-accent/15 to-cyan-500/10 p-6">
            <div className="absolute right-5 top-5 rounded-full border border-white/10 bg-black/10 p-3 text-accent"><Headphones size={24} /></div>
            <span className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide ${statusStyle(active.status)}`}>{active.status === "processing" || active.status === "queued" ? active.stage : active.status}</span>
            <h2 className="mt-4 max-w-[80%] text-2xl font-semibold text-ink">{active.title}</h2>
            <p className="mt-2 text-xs text-ink-muted">{active.host1Label} & {active.host2Label} · ~{duration(active.durationEstimate)} · {active.tone} · {active.engine}</p>
          </div>
          <div className="space-y-4 p-5">
            {(active.status === "queued" || active.status === "processing") && <div className="rounded-xl border border-accent/20 bg-accent/5 p-4"><div className="flex items-center gap-2 text-sm text-ink"><Loader2 size={16} className="animate-spin text-accent" />AWS Polly is producing the episode</div><div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-3"><div className="h-full w-2/3 animate-pulse rounded-full bg-accent" /></div><p className="mt-2 text-[11px] text-ink-muted">{active.stage}</p></div>}
            {active.status === "failed" && <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-500">{active.error}<button className="ml-2 underline" onClick={() => void studyPodcastsApi.regenerateAudio(active.id).then(() => selectPodcast(active))}>Try again</button></div>}
            {active.status === "ready" && audioUrl && <div className="rounded-xl border border-edge bg-surface p-4"><audio className="w-full" controls preload="metadata" src={audioUrl} /><div className="mt-3 flex items-center justify-between text-[11px] text-ink-muted"><span><Cloud size={12} className="mr-1 inline" />Rendered with AWS Polly</span><a href={audioUrl} download={`${active.title}.mp3`} className="flex items-center gap-1 rounded-lg border border-edge px-2.5 py-1.5 hover:text-ink"><Download size={12} />Download MP3</a></div></div>}
            <div className="flex flex-wrap gap-2"><button onClick={() => active.scriptNoteId && openWindow({ appId: "notes", title: "Notes", icon: "StickyNote", payload: { noteId: active.scriptNoteId } })} className="flex items-center gap-1.5 rounded-lg border border-edge px-3 py-2 text-xs text-ink-muted hover:bg-surface-3 hover:text-ink"><FileText size={13} />Open script</button>{active.status === "ready" && <button onClick={() => void studyPodcastsApi.regenerateAudio(active.id).then(() => selectPodcast(active))} className="flex items-center gap-1.5 rounded-lg border border-edge px-3 py-2 text-xs text-ink-muted hover:bg-surface-3 hover:text-ink"><RefreshCw size={13} />Regenerate audio</button>}<button onClick={() => void remove(active.id)} className="ml-auto rounded-lg border border-edge p-2 text-ink-muted hover:text-red-500"><Trash2 size={14} /></button></div>
            {active.script && <details className="rounded-xl border border-edge bg-surface"><summary className="cursor-pointer px-4 py-3 text-xs font-medium text-ink">Episode transcript</summary><div className="border-t border-edge p-4"><HighlightableMarkdown content={active.script} scope="podcast" scopeId={active.id} sourceName={`Podcast: ${active.title}`} /></div></details>}
          </div>
        </div> : <div className="flex min-h-72 flex-col items-center justify-center rounded-2xl border border-dashed border-edge bg-surface-2 p-8 text-center"><Mic2 size={34} className="mb-3 text-accent" /><h3 className="text-sm font-semibold text-ink">Your next study episode starts here</h3><p className="mt-1 max-w-xs text-xs text-ink-muted">Choose sources and tune the hosts, tone, and depth. Your finished audio will appear here.</p></div>}

        {podcasts.length > 0 && <div><h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-muted">Episode library</h3><div className="grid gap-2 @2xl:grid-cols-2">{podcasts.map((podcast) => <button key={podcast.id} onClick={() => void selectPodcast(podcast)} className={`rounded-xl border p-3 text-left transition hover:-translate-y-0.5 hover:bg-surface-3 ${active?.id === podcast.id ? "border-accent bg-accent/5" : "border-edge bg-surface-2"}`}><div className="flex items-start gap-2"><Headphones size={14} className="mt-0.5 shrink-0 text-accent" /><div className="min-w-0"><p className="truncate text-xs font-medium text-ink">{podcast.title}</p><p className="mt-1 text-[10px] text-ink-muted">~{duration(podcast.durationEstimate)} · {podcast.length} · {podcast.status}</p></div></div></button>)}</div></div>}
      </div>
    </div>
  );
}
