import { useCallback, useEffect, useMemo, useState } from "react";
import { GraduationCap, Plus, Trash2 } from "lucide-react";
import { gradesApi, computeGPA, coursePercentage, percentageToLetter, scoreColor } from "../services/grades";
import type { Assignment, Course } from "../types";
import { MobileContainer, MobileEmpty, MobileFab, MobileHeader, MobileInput, MobileLoading, MobileSelect } from "./MobileUi";

const COLORS = ["#6366f1", "#ec4899", "#22c55e", "#f59e0b", "#06b6d4", "#8b5cf6", "#ef4444", "#14b8a6"];

export default function MobileGrades({ onClose }: { onClose?: () => void }) {
  const [courses, setCourses] = useState<Course[]>([]);
  const [semesters, setSemesters] = useState<string[]>([]);
  const [semester, setSemester] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Course | null>(null);
  const [form, setForm] = useState({ name: "", code: "", credits: 3, color: COLORS[0] });

  const load = useCallback(async () => {
    setLoading(true);
    const [cRes, sRes] = await Promise.all([
      gradesApi.listCourses(semester || undefined).catch(() => null),
      gradesApi.listSemesters().catch(() => null),
    ]);
    if (cRes) setCourses(cRes.courses);
    if (sRes) setSemesters(sRes.semesters);
    setLoading(false);
  }, [semester]);

  useEffect(() => { void load(); }, [load]);

  const gpa = useMemo(() => computeGPA(courses), [courses]);

  const createCourse = async () => {
    if (!form.name.trim()) return;
    await gradesApi.createCourse({
      name: form.name.trim(),
      code: form.code,
      semester: semester || undefined,
      credits: Number(form.credits) || 0,
      color: form.color,
    }).catch(() => {});
    setForm({ name: "", code: "", credits: 3, color: COLORS[0] });
    void load();
  };

  const deleteCourse = async (c: Course) => {
    if (!window.confirm(`Delete ${c.name}?`)) return;
    await gradesApi.deleteCourse(c.id).catch(() => {});
    void load();
  };

  if (selected) {
    return <CourseDetail course={selected} onBack={() => setSelected(null)} onUpdate={() => void load()} />;
  }

  return (
    <MobileContainer>
      <MobileHeader
        title="Grades"
        subtitle="Track progress"
        onClose={onClose}
      />

      <div className="mb-4 rounded-2xl border border-edge bg-surface-2 p-4 text-center">
        <p className="text-xs text-ink-muted">Overall GPA</p>
        <p className="text-3xl font-bold text-ink">{gpa.toFixed(2)}</p>
      </div>

      <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
        <button
          type="button"
          onClick={() => setSemester("")}
          className={`shrink-0 rounded-full px-4 py-2 text-sm font-medium ${semester === "" ? "bg-accent text-ink" : "bg-surface-2 text-ink-muted"}`}
        >
          All
        </button>
        {semesters.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setSemester(s)}
            className={`shrink-0 rounded-full px-4 py-2 text-sm font-medium ${semester === s ? "bg-accent text-ink" : "bg-surface-2 text-ink-muted"}`}
          >
            {s}
          </button>
        ))}
      </div>

      <form
        onSubmit={(e) => { e.preventDefault(); void createCourse(); }}
        className="mb-4 rounded-2xl border border-accent/30 bg-accent/10 p-3"
      >
        <MobileInput
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          placeholder="Course name"
          className="mb-2"
        />
        <div className="grid grid-cols-3 gap-2">
          <MobileInput
            value={form.code}
            onChange={(e) => setForm({ ...form, code: e.target.value })}
            placeholder="Code"
            className="col-span-2"
          />
          <MobileInput
            type="number"
            value={form.credits}
            onChange={(e) => setForm({ ...form, credits: Number(e.target.value) })}
            placeholder="Credits"
          />
        </div>
        <div className="mt-2 flex items-center gap-2">
          {COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setForm({ ...form, color: c })}
              className={`h-6 w-6 rounded-full border-2 ${form.color === c ? "border-ink" : "border-transparent"}`}
              style={{ backgroundColor: c }}
            />
          ))}
          <button className="ml-auto rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-ink">Add</button>
        </div>
      </form>

      <div className="space-y-2">
        {loading ? (
          <MobileLoading />
        ) : courses.length ? (
          courses.map((c) => {
            const pct = coursePercentage(c);
            const letter = percentageToLetter(pct);
            return (
              <article
                key={c.id}
                onClick={() => setSelected(c)}
                className="rounded-2xl border border-edge bg-surface-2 p-4 active:bg-surface-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="h-3 w-3 rounded-full" style={{ backgroundColor: c.color }} />
                      <span className="font-medium text-ink">{c.name}</span>
                    </div>
                    <p className="text-xs text-ink-muted">{c.code} · {c.semester}</p>
                  </div>
                  <div className="text-right">
                    <p className={`text-xl font-bold ${scoreColor(pct)}`}>{pct.toFixed(0)}%</p>
                    <p className="text-xs text-ink-muted">{letter}</p>
                  </div>
                </div>
                <p className="mt-2 text-xs text-ink-muted">{c.assignments.length} assignments</p>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); void deleteCourse(c); }}
                  className="mt-2 text-xs text-ink-muted active:text-rose-400"
                >
                  <Trash2 size={14} className="inline mr-1" /> Delete
                </button>
              </article>
            );
          })
        ) : (
          <MobileEmpty text="No courses yet. Add your first course." />
        )}
      </div>
    </MobileContainer>
  );
}

function CourseDetail({ course, onBack, onUpdate }: { course: Course; onBack: () => void; onUpdate: () => void }) {
  const [assignments, setAssignments] = useState<Assignment[]>(course.assignments);
  const [name, setName] = useState("");
  const [score, setScore] = useState("");
  const [max, setMax] = useState("100");
  const [weight, setWeight] = useState("1");
  const [category, setCategory] = useState("");

  const add = async () => {
    if (!name.trim() || score === "") return;
    const res = await gradesApi.createAssignment(course.id, {
      name: name.trim(),
      score: Number(score),
      maxScore: Number(max) || 100,
      weight: Number(weight) || 1,
      category: category || "General",
    }).catch(() => null);
    if (res?.assignment) setAssignments((list) => [...list, res.assignment]);
    setName(""); setScore(""); setMax("100"); setWeight("1"); setCategory("");
    onUpdate();
  };

  const remove = async (id: string) => {
    if (!window.confirm("Delete this assignment?")) return;
    await gradesApi.deleteAssignment(id).catch(() => {});
    setAssignments((list) => list.filter((a) => a.id !== id));
    onUpdate();
  };

  const pct = coursePercentage({ ...course, assignments });

  return (
    <MobileContainer>
      <MobileHeader title={course.name} subtitle={course.code} onBack={onBack} />

      <div className="mb-4 rounded-2xl border border-edge bg-surface-2 p-4 text-center">
        <p className="text-xs text-ink-muted">Course grade</p>
        <p className={`text-3xl font-bold ${scoreColor(pct)}`}>{pct.toFixed(1)}%</p>
      </div>

      <form
        onSubmit={(e) => { e.preventDefault(); void add(); }}
        className="mb-4 rounded-2xl border border-accent/30 bg-accent/10 p-3"
      >
        <MobileInput value={name} onChange={(e) => setName(e.target.value)} placeholder="Assignment" className="mb-2" />
        <div className="grid grid-cols-4 gap-2">
          <MobileInput type="number" value={score} onChange={(e) => setScore(e.target.value)} placeholder="Score" />
          <MobileInput type="number" value={max} onChange={(e) => setMax(e.target.value)} placeholder="Max" />
          <MobileInput type="number" value={weight} onChange={(e) => setWeight(e.target.value)} placeholder="Wt" />
          <MobileInput value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Cat" />
        </div>
        <button className="mt-2 w-full rounded-xl bg-accent py-2 text-sm font-semibold text-ink">Add assignment</button>
      </form>

      <div className="space-y-2">
        {assignments.length ? (
          assignments.map((a) => (
            <article key={a.id} className="flex items-center justify-between gap-2 rounded-2xl border border-edge bg-surface-2 p-4">
              <div className="min-w-0 flex-1">
                <p className="font-medium text-ink">{a.name}</p>
                <p className="text-xs text-ink-muted">{a.category} · weight {a.weight}</p>
              </div>
              <div className="text-right">
                <p className="text-sm font-semibold text-ink">{a.score}/{a.maxScore}</p>
                <p className={`text-xs ${scoreColor((a.score / a.maxScore) * 100)}`}>
                  {((a.score / a.maxScore) * 100).toFixed(0)}%
                </p>
              </div>
              <button type="button" onClick={() => void remove(a.id)} className="rounded-xl p-2 text-ink-muted active:text-rose-400">
                <Trash2 size={18} />
              </button>
            </article>
          ))
        ) : (
          <MobileEmpty text="No assignments yet. Add one." />
        )}
      </div>
    </MobileContainer>
  );
}
