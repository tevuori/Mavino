import { useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import {
  CalendarCheck,
  CheckSquare,
  Folder,
  GraduationCap,
  Sparkles,
  StickyNote,
  Map,
  Music,
  PenTool,
  Play,
  Menu,
  X,
} from "lucide-react";
import AppLogo from "./AppLogo";
import AuthModal from "./AuthModal";

const features = [
  { icon: CalendarCheck, title: "Today", desc: "See what matters right now — classes, tasks, and deadlines in one glance." },
  { icon: CheckSquare, title: "Tasks", desc: "Kanban boards, due dates, and priorities that move with your week." },
  { icon: StickyNote, title: "Notes", desc: "Capture lectures, ideas, and sources in a fast, linked workspace." },
  { icon: GraduationCap, title: "Study Hub", desc: "Summarize, quiz yourself, and generate flashcards from any text." },
  { icon: Sparkles, title: "Mavino", desc: "Your AI assistant acts inside your apps — create tasks, find files, explain topics." },
  { icon: Map, title: "Maps", desc: "Plan hiking trips and routes with elevation, POIs, and GPX export." },
  { icon: Music, title: "Spotify", desc: "Focus sessions, lyrics, and chill mode integrated with your desktop." },
  { icon: Folder, title: "Files", desc: "Upload, organize, and open documents next to your notes and tasks." },
  { icon: PenTool, title: "Whiteboard", desc: "Sketch diagrams and mind maps with vector drawing tools." },
];

const screenshots = [
  { src: "/landing/files-tasks-split.png", alt: "Files and Tasks side by side", caption: "Files & Tasks side by side" },
  { src: "/landing/study-hub.png", alt: "Study Hub", caption: "Study Hub — AI study tools" },
  { src: "/landing/athena-assistant.png", alt: "Mavino assistant", caption: "Mavino assistant inside your workflow" },
];

export default function LandingPage() {
  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState<"login" | "signup">("signup");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const openAuth = useCallback((mode: "login" | "signup") => {
    setAuthMode(mode);
    setAuthOpen(true);
  }, []);

  return (
    <div className="h-full w-full overflow-y-auto overflow-x-hidden bg-canvas text-ink">
      {/* Header */}
      <header
        className={`fixed left-0 right-0 top-0 z-50 transition-all ${
          scrolled ? "border-b border-edge bg-canvas/90 backdrop-blur-md" : "bg-transparent"
        }`}
      >
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
          <a href="/" className="flex items-center gap-2.5">
            <AppLogo size={32} />
            <span className="text-lg font-semibold tracking-tight">Mavino</span>
          </a>

          <nav className="hidden items-center gap-6 md:flex">
            <a href="#features" className="text-sm text-ink-muted hover:text-ink">Features</a>
            <a href="#showcase" className="text-sm text-ink-muted hover:text-ink">Showcase</a>
            <a href="#video" className="text-sm text-ink-muted hover:text-ink">Video</a>
          </nav>

          <div className="hidden items-center gap-3 md:flex">
            <button
              onClick={() => openAuth("login")}
              className="rounded-lg px-3 py-2 text-sm font-medium text-ink hover:bg-surface-2"
            >
              Log in
            </button>
            <button
              onClick={() => openAuth("signup")}
              className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-fg hover:opacity-90"
            >
              Sign up
            </button>
          </div>

          <button
            onClick={() => setMobileMenuOpen((v) => !v)}
            className="flex h-10 w-10 items-center justify-center rounded-lg text-ink md:hidden"
            aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
          >
            {mobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>

        {mobileMenuOpen && (
          <div className="border-b border-edge bg-canvas px-5 pb-4 md:hidden">
            <nav className="flex flex-col gap-3 pt-2">
              <a href="#features" onClick={() => setMobileMenuOpen(false)} className="text-sm text-ink-muted">Features</a>
              <a href="#showcase" onClick={() => setMobileMenuOpen(false)} className="text-sm text-ink-muted">Showcase</a>
              <a href="#video" onClick={() => setMobileMenuOpen(false)} className="text-sm text-ink-muted">Video</a>
              <hr className="border-edge" />
              <button onClick={() => { setMobileMenuOpen(false); openAuth("login"); }} className="text-left text-sm text-ink">Log in</button>
              <button onClick={() => { setMobileMenuOpen(false); openAuth("signup"); }} className="text-left text-sm text-accent">Sign up</button>
            </nav>
          </div>
        )}
      </header>

      {/* Hero */}
      <section className="relative flex flex-col items-center justify-center px-5 pb-20 pt-32 md:min-h-[90vh] md:pb-32 md:pt-40">
        <div className="mx-auto max-w-4xl text-center">
          <motion.div
            initial={{ y: 16, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ duration: 0.45 }}
          >
            <span className="mb-4 inline-flex items-center gap-2 rounded-full border border-edge bg-surface px-3 py-1 text-xs font-medium text-ink-muted">
              <Sparkles size={12} className="text-accent" />
              Mavino is now in open testing
            </span>
            <h1 className="text-balance text-4xl font-semibold tracking-tight text-ink md:text-6xl md:leading-[1.1]">
              Your calm student workspace
            </h1>
            <p className="mx-auto mt-5 max-w-2xl text-balance text-base leading-relaxed text-ink-muted md:text-lg">
              Notes, tasks, calendar, files, AI study tools, maps, and Spotify — all in one
              desktop-style workspace built for students.
            </p>
          </motion.div>

          <motion.div
            initial={{ y: 16, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ duration: 0.45, delay: 0.1 }}
            className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row"
          >
            <button
              onClick={() => openAuth("signup")}
              className="flex h-11 items-center gap-2 rounded-xl bg-accent px-6 text-sm font-medium text-accent-fg hover:opacity-90"
            >
              Join open testing
            </button>
            <button
              onClick={() => openAuth("login")}
              className="flex h-11 items-center gap-2 rounded-xl border border-edge bg-surface px-6 text-sm font-medium text-ink hover:bg-surface-2"
            >
              Log in
            </button>
          </motion.div>
        </div>

        <motion.div
          initial={{ y: 24, opacity: 0, scale: 0.98 }}
          animate={{ y: 0, opacity: 1, scale: 1 }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="mx-auto mt-14 w-full max-w-5xl"
        >
          <div className="relative overflow-hidden rounded-2xl border border-edge bg-surface shadow-panel">
            <img
              src="/landing/desktop-aurora-spotify.png"
              alt="Mavino desktop with app dock and Spotify player"
              className="w-full"
              loading="eager"
            />
          </div>
        </motion.div>
      </section>

      {/* Features */}
      <section id="features" className="px-5 py-20 md:py-28">
        <div className="mx-auto max-w-6xl">
          <div className="mb-12 text-center md:mb-16">
            <h2 className="text-2xl font-semibold tracking-tight md:text-3xl">Everything you need for school</h2>
            <p className="mt-3 text-ink-muted">Built to keep you organized, focused, and one step ahead.</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((f, i) => (
              <motion.div
                key={f.title}
                initial={{ opacity: 0, y: 12 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-50px" }}
                transition={{ duration: 0.3, delay: i * 0.05 }}
                className="group rounded-xl border border-edge bg-surface p-5 transition hover:border-edge-strong hover:bg-surface-2"
              >
                <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-accent/10 text-accent">
                  <f.icon size={20} />
                </div>
                <h3 className="text-base font-semibold">{f.title}</h3>
                <p className="mt-1 text-sm leading-relaxed text-ink-muted">{f.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Showcase */}
      <section id="showcase" className="bg-surface-sunken/35 px-5 py-20 md:py-28">
        <div className="mx-auto max-w-6xl">
          <div className="mb-12 text-center md:mb-16">
            <h2 className="text-2xl font-semibold tracking-tight md:text-3xl">See Mavino in action</h2>
            <p className="mt-3 text-ink-muted">A workspace that adapts to how you actually study.</p>
          </div>
          <div className="grid gap-6 md:grid-cols-3">
            {screenshots.map((s, i) => (
              <motion.div
                key={s.src}
                initial={{ opacity: 0, y: 16 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-50px" }}
                transition={{ duration: 0.35, delay: i * 0.1 }}
                className="overflow-hidden rounded-xl border border-edge bg-surface shadow-panel"
              >
                <img src={s.src} alt={s.alt} className="w-full" loading="lazy" />
                <p className="border-t border-edge px-4 py-3 text-sm font-medium text-ink">{s.caption}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Video placeholder */}
      <section id="video" className="px-5 py-20 md:py-28">
        <div className="mx-auto max-w-4xl text-center">
          <h2 className="text-2xl font-semibold tracking-tight md:text-3xl">Watch the story</h2>
          <p className="mt-3 text-ink-muted">A quick look at what makes Mavino different.</p>
          <div className="relative mt-10 aspect-video overflow-hidden rounded-2xl border border-edge bg-surface-2">
            <img
              src="/landing/video-poster.png"
              alt="Promo video poster"
              className="h-full w-full object-cover opacity-70"
            />
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-canvas/30">
              <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-surface shadow-panel">
                <Play size={24} className="ml-1 text-accent" />
              </div>
              <p className="rounded-full bg-surface px-4 py-1.5 text-sm font-medium text-ink shadow-sm">
                Promo video coming soon
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="px-5 py-20 md:py-28">
        <div className="mx-auto max-w-3xl rounded-2xl border border-edge bg-surface p-8 text-center shadow-panel md:p-12">
          <h2 className="text-2xl font-semibold tracking-tight md:text-3xl">Ready to try Mavino?</h2>
          <p className="mx-auto mt-3 max-w-lg text-ink-muted">
            Join the open testing program and help shape the student workspace we all want.
          </p>
          <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <button
              onClick={() => openAuth("signup")}
              className="flex h-11 items-center gap-2 rounded-xl bg-accent px-6 text-sm font-medium text-accent-fg hover:opacity-90"
            >
              Sign up for open testing
            </button>
            <button
              onClick={() => openAuth("login")}
              className="flex h-11 items-center gap-2 rounded-xl border border-edge bg-surface px-6 text-sm font-medium text-ink hover:bg-surface-2"
            >
              Log in
            </button>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-edge px-5 py-10">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 md:flex-row">
          <div className="flex items-center gap-2">
            <AppLogo size={24} />
            <span className="text-sm font-medium">Mavino</span>
          </div>
          <div className="flex items-center gap-6 text-sm text-ink-muted">
            <a href="/terms.html" className="hover:text-ink">Terms</a>
            <a href="/privacy.html" className="hover:text-ink">Privacy</a>
            <a href="https://github.com" className="hover:text-ink">GitHub</a>
          </div>
          <p className="text-xs text-ink-tertiary">© {new Date().getFullYear()} Mavino Student OS</p>
        </div>
      </footer>

      <AuthModal open={authOpen} onClose={() => setAuthOpen(false)} initialMode={authMode} />
    </div>
  );
}
