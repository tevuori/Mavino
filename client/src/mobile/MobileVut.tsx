import { useCallback, useEffect, useState } from "react";
import { GraduationCap, Lock, LogOut, RefreshCw } from "lucide-react";
import { vutApi } from "../services/vut";
import type { VutGrade, VutSubjectUpdate, VutTimetableSlot } from "../types";
import { MobileContainer, MobileEmpty, MobileHeader, MobileInput, MobileLoading } from "./MobileUi";

type Tab = "grades" | "timetable" | "updates";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];

export default function MobileVut({ onClose }: { onClose?: () => void }) {
  const [status, setStatus] = useState<{ configured: boolean; authenticated: boolean; username?: string } | null>(null);
  const [tab, setTab] = useState<Tab>("grades");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loggingIn, setLoggingIn] = useState(false);

  const loadStatus = useCallback(async () => {
    const res = await vutApi.status().catch(() => null);
    setStatus(res ?? { configured: false, authenticated: false });
  }, []);

  useEffect(() => { void loadStatus(); }, [loadStatus]);

  const login = async () => {
    setLoggingIn(true);
    await vutApi.login(username, password).catch(() => {});
    setPassword("");
    setLoggingIn(false);
    void loadStatus();
  };

  const logout = async () => {
    await vutApi.logout().catch(() => {});
    void loadStatus();
  };

  if (!status) return <MobileContainer><MobileLoading /></MobileContainer>;

  if (!status.authenticated) {
    return (
      <MobileContainer>
        <MobileHeader title="VUT" subtitle="Sign in to Studis" onClose={onClose} />
        <div className="rounded-2xl border border-edge bg-surface-2 p-5">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-accent/15 text-accent">
            <Lock size={24} />
          </div>
          <p className="mb-4 text-sm text-ink-muted">Log in with your VUT credentials to load grades, timetable and updates.</p>
          <MobileInput
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Username"
            className="mb-3"
            autoComplete="username"
          />
          <MobileInput
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            className="mb-4"
            autoComplete="current-password"
          />
          <button
            type="button"
            onClick={() => void login()}
            disabled={loggingIn || !username.trim() || !password.trim()}
            className="w-full rounded-2xl bg-accent py-3 text-sm font-semibold text-ink disabled:opacity-50"
          >
            {loggingIn ? "Signing in…" : "Sign in"}
          </button>
        </div>
      </MobileContainer>
    );
  }

  return (
    <MobileContainer>
      <MobileHeader
        title="VUT"
        subtitle={status.username || "Studis"}
        onClose={onClose}
        right={
          <div className="flex gap-2">
            <button type="button" onClick={() => void logout()} className="flex h-11 w-11 items-center justify-center rounded-2xl bg-surface-2 text-ink">
              <LogOut size={20} />
            </button>
          </div>
        }
      />

      <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
        {(["grades", "timetable", "updates"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`shrink-0 rounded-full px-4 py-2 text-sm font-medium capitalize ${
              tab === t ? "bg-accent text-ink" : "bg-surface-2 text-ink-muted"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "grades" && <VutGradesView />}
      {tab === "timetable" && <VutTimetableView />}
      {tab === "updates" && <VutUpdatesView />}
    </MobileContainer>
  );
}

function VutGradesView() {
  const [grades, setGrades] = useState<VutGrade[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await vutApi.grades().catch(() => null);
    setGrades(res?.grades ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="space-y-2">
      <div className="flex justify-end">
        <button type="button" onClick={() => void load()} className="rounded-xl p-2 text-ink-muted">
          <RefreshCw size={18} />
        </button>
      </div>
      {loading ? <MobileLoading /> : grades.length ? grades.map((g) => (
        <article key={`${g.courseCode}-${g.semester}`} className="rounded-2xl border border-edge bg-surface-2 p-4">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <p className="font-medium text-ink">{g.courseName}</p>
              <p className="text-xs text-ink-muted">{g.courseCode} · {g.semester}</p>
            </div>
            <div className="text-right">
              <p className="text-2xl font-bold text-ink">{g.grade}</p>
              <p className="text-xs text-ink-muted">{g.ectsGrade}</p>
            </div>
          </div>
          <p className="mt-2 text-xs text-ink-muted">{g.credits} credits · attempt {g.attempt}</p>
        </article>
      )) : <MobileEmpty text="No grades loaded yet." />}
    </div>
  );
}

function VutTimetableView() {
  const [slots, setSlots] = useState<VutTimetableSlot[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await vutApi.timetable().catch(() => null);
    setSlots(res?.slots ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const grouped = slots.reduce<Record<string, VutTimetableSlot[]>>((acc, s) => {
    if (!acc[s.day]) acc[s.day] = [];
    acc[s.day].push(s);
    return acc;
  }, {});

  return (
    <div className="space-y-2">
      <div className="flex justify-end">
        <button type="button" onClick={() => void load()} className="rounded-xl p-2 text-ink-muted">
          <RefreshCw size={18} />
        </button>
      </div>
      {loading ? <MobileLoading /> : slots.length ? DAYS.map((day) => (
        grouped[day] && (
          <div key={day}>
            <p className="mb-2 text-sm font-semibold text-accent">{day}</p>
            <div className="space-y-2">
              {grouped[day].map((s, i) => (
                <article key={`${day}-${i}`} className="rounded-2xl border border-edge bg-surface-2 p-4">
                  <p className="font-medium text-ink">{s.courseName}</p>
                  <p className="text-xs text-ink-muted">{s.courseCode} · {s.type}</p>
                  <p className="mt-1 text-xs text-ink-muted">{s.startTime} – {s.endTime} · {s.room}</p>
                  {s.teacher && <p className="text-xs text-ink-muted">{s.teacher}</p>}
                </article>
              ))}
            </div>
          </div>
        )
      )) : <MobileEmpty text="No timetable loaded yet." />}
    </div>
  );
}

function VutUpdatesView() {
  const [updates, setUpdates] = useState<VutSubjectUpdate[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await vutApi.updates().catch(() => null);
    setUpdates(res?.updates ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="space-y-2">
      <div className="flex justify-end">
        <button type="button" onClick={() => void load()} className="rounded-xl p-2 text-ink-muted">
          <RefreshCw size={18} />
        </button>
      </div>
      {loading ? <MobileLoading /> : updates.length ? updates.map((u, i) => (
        <article key={`${u.subjectCode}-${i}`} className="rounded-2xl border border-edge bg-surface-2 p-4">
          <p className="font-medium text-ink">{u.title}</p>
          <p className="text-xs text-ink-muted">{u.subjectName} · {u.subjectCode}</p>
          <p className="mt-2 text-sm text-ink-muted">{u.content}</p>
          <p className="mt-2 text-[11px] text-ink-muted">{u.author} · {u.date}</p>
        </article>
      )) : <MobileEmpty text="No updates loaded yet." />}
    </div>
  );
}
