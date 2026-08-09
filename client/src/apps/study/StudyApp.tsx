// ===== AI Study Hub app =====
// Purpose-built AI study workflows on top of the Athena LLM infrastructure.

import { useState, useEffect } from "react";
import {
  Brain,
  FileText,
  HelpCircle,
  Lightbulb,
  BookOpen,
  ListTodo,
  History,
  GraduationCap,
  Home,
  MessageSquare,
  Mic,
  Languages,
  Presentation,
  Video,
  Highlighter,
  Network,
} from "lucide-react";
import type { WindowInstance } from "../../store/windows";
import type { SourceDescriptor, SourceKind, StudyLanguage } from "../../services/study";
import CollapsibleSidebar from "../../wm/CollapsibleSidebar";
import GenerateFlashcards from "./GenerateFlashcards";
import Summarize from "./Summarize";
import Explain from "./Explain";
import StudyGuide from "./StudyGuide";
import SyllabusTasks from "./SyllabusTasks";
import QuizMe from "./QuizMe";
import RecentActivity from "./RecentActivity";
import StudyHome from "./StudyHome";
import SourceChat from "./SourceChat";
import Podcast from "./Podcast";
import TeacherMode from "./TeacherMode";
import LectureNotes from "./LectureNotes";
import Highlights from "./Highlights";
import KnowledgeGraph from "./KnowledgeGraph";

type Mode =
  | "home"
  | "chat"
  | "teach"
  | "podcast"
  | "graph"
  | "lecture"
  | "flashcards"
  | "summarize"
  | "explain"
  | "study_guide"
  | "quiz"
  | "syllabus"
  | "recent"
  | "highlights";

const MODES: { id: Mode; label: string; icon: typeof Brain; desc: string }[] = [
  { id: "home", label: "Home", icon: Home, desc: "Overview & quick actions" },
  { id: "chat", label: "Ask (grounded)", icon: MessageSquare, desc: "Source-grounded Q&A with citations" },
  { id: "teach", label: "Teach Me", icon: Presentation, desc: "Interactive live tutoring with sources" },
  { id: "podcast", label: "Podcast", icon: Mic, desc: "Audio overview from your sources" },
  { id: "graph", label: "Knowledge Graph", icon: Network, desc: "Concepts & relationships extracted once, reused everywhere" },
  { id: "lecture", label: "Lecture → Notes", icon: Video, desc: "Generate notes from a lecture video" },
  { id: "flashcards", label: "Flashcards", icon: Brain, desc: "Generate Q/A cards from a source" },
  { id: "summarize", label: "Summarize", icon: FileText, desc: "TL;DR, outline, or key points" },
  { id: "quiz", label: "Quiz Me", icon: HelpCircle, desc: "Test yourself with AI-graded questions" },
  { id: "explain", label: "Explain", icon: Lightbulb, desc: "Get a concept explained at any depth" },
  { id: "study_guide", label: "Study Guide", icon: BookOpen, desc: "Consolidate notes into a cheat sheet" },
  { id: "syllabus", label: "Syllabus → Tasks", icon: ListTodo, desc: "Extract tasks from a syllabus" },
  { id: "recent", label: "Recent", icon: History, desc: "Your study activity" },
  { id: "highlights", label: "Highlights", icon: Highlighter, desc: "Your saved highlights & annotations" },
];

export default function StudyApp({ win }: { win: WindowInstance }) {
  const [mode, setMode] = useState<Mode>("home");
  const [language, setLanguage] = useState<StudyLanguage>(() => {
    return (localStorage.getItem("study-language") as StudyLanguage) || "en";
  });
  const [initialSource, setInitialSource] = useState<SourceDescriptor | null>(null);
  const [appendDeck, setAppendDeck] = useState<{ id: string; name: string } | null>(null);
  const [preloadedQuizId, setPreloadedQuizId] = useState<string | null>(null);
  const [initialChatId, setInitialChatId] = useState<string | null>(null);
  const [initialPodcastId, setInitialPodcastId] = useState<string | null>(null);
  const [initialWorkspaceId, setInitialWorkspaceId] = useState<string | null>(null);
  const [initialSessionId, setInitialSessionId] = useState<string | null>(null);
  const [initialGraphId, setInitialGraphId] = useState<string | null>(null);

  const toggleLanguage = () => {
    setLanguage((prev) => {
      const next = prev === "en" ? "cs" : "en";
      localStorage.setItem("study-language", next);
      return next;
    });
  };

  // Honor a payload sent when opening (e.g. from Athena's open_study_hub or
  // start_quiz tool).
  useEffect(() => {
    const p = win.payload;
    if (!p) return;
    if (typeof p.mode === "string") {
      const m = MODES.find((x) => x.id === p.mode);
      if (m) setMode(m.id);
    }
    const sk = p.sourceKind as SourceKind | undefined;
    if (sk && p.sourceId && typeof p.sourceId === "string") {
      setInitialSource({ kind: sk, id: p.sourceId });
    } else if (sk === "paste" && typeof p.text === "string") {
      setInitialSource({ kind: "paste", text: p.text });
    } else if ((sk === "moodle" || sk === "url") && typeof p.sourceUrl === "string") {
      setInitialSource({ kind: sk, url: p.sourceUrl, name: typeof p.sourceName === "string" ? p.sourceName : undefined });
    }
    if (typeof p.appendDeckId === "string" && typeof p.appendDeckName === "string") {
      setAppendDeck({ id: p.appendDeckId, name: p.appendDeckName });
    }
    // start_quiz tool pre-generates the quiz on the server and passes the id
    // so QuizMe can jump straight into the answering phase.
    if (typeof p.quizId === "string") {
      setPreloadedQuizId(p.quizId);
    }
    // Deep links to a specific grounded chat / podcast.
    if (typeof p.chatId === "string") {
      setInitialChatId(p.chatId);
      setMode("chat");
    }
    if (typeof p.podcastId === "string") {
      setInitialPodcastId(p.podcastId);
      setMode("podcast");
    }
    if (typeof p.workspaceId === "string") {
      setInitialWorkspaceId(p.workspaceId);
      if (typeof p.mode === "string" && (p.mode === "chat" || p.mode === "podcast")) {
        setMode(p.mode);
      }
    }
    if (typeof p.sessionId === "string") {
      setInitialSessionId(p.sessionId);
      setMode("teach");
    }
    // Deep link to a knowledge graph (from build_concept_graph / the Knowledge
    // Graph app's action bar). If combined with mode, seeds that mode from
    // the graph instead of opening the graph view itself.
    if (typeof p.graphId === "string") {
      setInitialGraphId(p.graphId);
      if (typeof p.mode !== "string" || p.mode === "graph") setMode("graph");
    }
  }, [win.payload]);

  return (
    <div className="relative flex h-full bg-surface">
      {/* Sidebar — inline @4xl+, overlay when narrow */}
      <CollapsibleSidebar
        side="left"
        width="w-52"
        showAt="@4xl"
        panelClassName="bg-surface-2/50"
        toggleIcon={<GraduationCap size={14} />}
        toggleLabel="Menu"
      >
        <div className="flex items-center gap-2 border-b border-edge px-3 py-3">
          <GraduationCap size={16} className="text-accent" />
          <span className="text-sm font-semibold text-ink">Study Hub</span>
          <button
            onClick={toggleLanguage}
            className="ml-auto flex items-center gap-1 rounded-md border border-edge px-1.5 py-0.5 text-[10px] font-medium text-ink-muted transition hover:bg-surface-3 hover:text-ink"
            title="Switch output language"
          >
            <Languages size={11} />
            {language === "en" ? "EN" : "CS"}
          </button>
        </div>
        <div className="flex flex-1 flex-col gap-0.5 p-2">
          {MODES.map((m) => {
            const Icon = m.icon;
            const active = mode === m.id;
            return (
              <button
                key={m.id}
                onClick={() => setMode(m.id)}
                className={`flex items-start gap-2.5 rounded-md px-2.5 py-2 text-left transition ${
                  active ? "bg-accent/10 text-accent" : "text-ink-muted hover:bg-surface-3 hover:text-ink"
                }`}
              >
                <Icon size={15} className="mt-0.5 shrink-0" />
                <div className="flex flex-col">
                  <span className="text-xs font-medium">{m.label}</span>
                  <span className="text-[10px] leading-tight opacity-70">{m.desc}</span>
                </div>
              </button>
            );
          })}
        </div>
      </CollapsibleSidebar>

      {/* Main */}
      <div className="flex-1 overflow-y-auto p-5">
        {mode === "chat" ? (
          <div className="h-full">
            <SourceChat initialChatId={initialChatId} initialWorkspaceId={initialWorkspaceId} language={language} />
          </div>
        ) : mode === "teach" ? (
          <div className="h-full">
            <TeacherMode initialSessionId={initialSessionId} language={language} />
          </div>
        ) : mode === "graph" ? (
          <div className="h-full">
            <KnowledgeGraph
              initialGraphId={initialGraphId}
              language={language}
              onOpenMode={(m, opts) => {
                setMode(m as Mode);
                if (opts?.graphId) setInitialGraphId(opts.graphId);
              }}
            />
          </div>
        ) : (
          <div className="mx-auto max-w-none @5xl:max-w-2xl">
            {mode === "home" && <StudyHome onPickMode={(m, opts) => {
              setMode(m as Mode);
              if (opts?.workspaceId) setInitialWorkspaceId(opts.workspaceId);
            }} />}
            {mode === "podcast" && <Podcast initialPodcastId={initialPodcastId} initialWorkspaceId={initialWorkspaceId} language={language} />}
            {mode === "lecture" && <LectureNotes language={language} />}
            {mode === "flashcards" && <GenerateFlashcards initialSource={initialSource} initialGraphId={initialGraphId} appendDeck={appendDeck} language={language} />}
            {mode === "summarize" && <Summarize initialSource={initialSource} initialGraphId={initialGraphId} language={language} />}
            {mode === "explain" && <Explain initialSource={initialSource} initialGraphId={initialGraphId} language={language} />}
            {mode === "study_guide" && <StudyGuide initialGraphId={initialGraphId} language={language} />}
            {mode === "quiz" && <QuizMe initialSource={initialSource} initialGraphId={initialGraphId} preloadedQuizId={preloadedQuizId} language={language} />}
            {mode === "syllabus" && <SyllabusTasks initialSource={initialSource} language={language} />}
            {mode === "recent" && <RecentActivity />}
            {mode === "highlights" && <Highlights />}
          </div>
        )}
      </div>
    </div>
  );
}
