import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  GraduationCap, Plus, Trash2, ChevronDown, ChevronRight, Award, TrendingUp,
} from "lucide-react";
import { gradesApi, coursePercentage, percentageToLetter, letterToGpa, computeGPA, scoreColor } from "../../services/grades";
import type { Course, Assignment } from "../../types";

const COURSE_COLORS = ["#6366f1", "#ec4899", "#22c55e", "#f59e0b", "#06b6d4", "#8b5cf6", "#ef4444"];

export default function GradesApp() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [semesters, setSemesters] = useState<string[]>([]);
  const [selectedSemester, setSelectedSemester] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedCourse, setExpandedCourse] = useState<string | null>(null);

  // Course form
  const [showCourseForm, setShowCourseForm] = useState(false);
  const [courseName, setCourseName] = useState("");
  const [courseCode, setCourseCode] = useState("");
  const [courseSemester, setCourseSemester] = useState("");
  const [courseCredits, setCourseCredits] = useState(3);
  const [courseColor, setCourseColor] = useState(COURSE_COLORS[0]);

  // Assignment form
  const [showAssignmentForm, setShowAssignmentForm] = useState<string | null>(null);
  const [aName, setAName] = useState("");
  const [aScore, setAScore] = useState("");
  const [aMax, setAMax] = useState("100");
  const [aWeight, setAWeight] = useState("1");
  const [aCategory, setACategory] = useState("General");

  const loadSemesters = useCallback(async () => {
    try {
      const { semesters } = await gradesApi.listSemesters();
      setSemesters(semesters);
      if (semesters.length > 0 && !selectedSemester) {
        setSelectedSemester(semesters[semesters.length - 1]);
      }
    } catch { /* ignore */ }
  }, [selectedSemester]);

  const loadCourses = useCallback(async () => {
    setLoading(true);
    try {
      const { courses } = await gradesApi.listCourses(selectedSemester || undefined);
      setCourses(courses);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [selectedSemester]);

  useEffect(() => { loadSemesters(); }, [loadSemesters]);
  useEffect(() => { loadCourses(); }, [loadCourses]);

  const gpa = computeGPA(courses);

  const createCourse = async () => {
    if (!courseName.trim()) return;
    try {
      await gradesApi.createCourse({
        name: courseName, code: courseCode, semester: courseSemester || selectedSemester,
        credits: courseCredits, color: courseColor,
      });
      setShowCourseForm(false);
      setCourseName(""); setCourseCode(""); setCourseSemester(""); setCourseCredits(3); setCourseColor(COURSE_COLORS[0]);
      loadSemesters();
      loadCourses();
    } catch (e) { setError((e as Error).message); }
  };

  const deleteCourse = async (id: string) => {
    try {
      await gradesApi.deleteCourse(id);
      loadCourses();
      loadSemesters();
    } catch (e) { setError((e as Error).message); }
  };

  const createAssignment = async (courseId: string) => {
    if (!aName.trim() || !aScore.trim()) return;
    try {
      await gradesApi.createAssignment(courseId, {
        name: aName, score: parseFloat(aScore), maxScore: parseFloat(aMax) || 100,
        weight: parseFloat(aWeight) || 1, category: aCategory,
      });
      setShowAssignmentForm(null);
      setAName(""); setAScore(""); setAMax("100"); setAWeight("1"); setACategory("General");
      loadCourses();
    } catch (e) { setError((e as Error).message); }
  };

  const deleteAssignment = async (id: string) => {
    try {
      await gradesApi.deleteAssignment(id);
      loadCourses();
    } catch (e) { setError((e as Error).message); }
  };

  return (
    <div className="flex h-full flex-col bg-surface">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-edge px-4 py-3">
        <div className="flex items-center gap-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
            <GraduationCap size={16} className="text-accent" /> Grade Tracker
          </h2>
          {semesters.length > 0 && (
            <select
              value={selectedSemester}
              onChange={(e) => setSelectedSemester(e.target.value)}
              className="rounded-lg border border-edge bg-surface-2 px-2 py-1 text-xs text-ink outline-none"
            >
              <option value="">All semesters</option>
              {semesters.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowCourseForm(true)}
            className="flex items-center gap-1 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white transition hover:bg-accent/90"
          >
            <Plus size={14} /> <span className="@3xl:inline hidden">Add Course</span>
          </button>
        </div>
      </div>

      {error && <p className="px-4 py-2 text-xs text-red-400">{error}</p>}

      {/* GPA summary */}
      {courses.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-edge bg-surface-2 px-4 py-3">
          <div className="flex items-center gap-2">
            <Award size={20} className="text-amber-400" />
            <div>
              <p className="text-2xl font-bold text-ink">{gpa.toFixed(2)}</p>
              <p className="text-[10px] uppercase tracking-wide text-ink-muted">GPA</p>
            </div>
          </div>
          <div className="h-10 w-px bg-edge @3xl:block hidden" />
          <div>
            <p className="text-lg font-semibold text-ink">{courses.length}</p>
            <p className="text-[10px] uppercase tracking-wide text-ink-muted">Courses</p>
          </div>
          <div className="h-10 w-px bg-edge @3xl:block hidden" />
          <div>
            <p className="text-lg font-semibold text-ink">
              {courses.reduce((s, c) => s + c.credits, 0)}
            </p>
            <p className="text-[10px] uppercase tracking-wide text-ink-muted">Credits</p>
          </div>
        </div>
      )}

      {/* Course list */}
      <div className="flex-1 overflow-y-auto p-4">
        {loading ? (
          <p className="py-8 text-center text-sm text-ink-muted">Loading...</p>
        ) : courses.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <GraduationCap size={48} className="mb-3 text-ink-muted opacity-40" />
            <p className="text-sm text-ink-muted">No courses yet. Add one to start tracking grades!</p>
          </div>
        ) : (
          <div className="space-y-3">
            {courses.map((course) => {
              const pct = coursePercentage(course);
              const letter = percentageToLetter(pct);
              const gpaPts = letterToGpa(letter);
              const isExpanded = expandedCourse === course.id;
              return (
                <div key={course.id} className="overflow-hidden rounded-xl border border-edge bg-surface-2">
                  {/* Course header */}
                  <div
                    onClick={() => setExpandedCourse(isExpanded ? null : course.id)}
                    className="flex cursor-pointer items-center gap-3 p-4 transition hover:bg-surface-3"
                  >
                    <div className="h-10 w-1 rounded-full" style={{ backgroundColor: course.color }} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="truncate font-semibold text-ink">{course.name}</h3>
                        {course.code && <span className="shrink-0 text-xs text-ink-muted">{course.code}</span>}
                      </div>
                      <p className="text-xs text-ink-muted">{course.credits} credits · {course.assignments.length} assignments</p>
                    </div>
                    {/* Grade bar */}
                    <div className="hidden items-center gap-3 sm:flex">
                      <div className="h-2 w-24 overflow-hidden rounded-full bg-surface-3">
                        <motion.div
                          className="h-full rounded-full"
                          style={{ backgroundColor: course.color }}
                          initial={{ width: 0 }}
                          animate={{ width: `${pct}%` }}
                          transition={{ duration: 0.5 }}
                        />
                      </div>
                    </div>
                    <div className="text-right">
                      <p className={`text-lg font-bold ${scoreColor(pct)}`}>{letter}</p>
                      <p className="text-xs text-ink-muted">{pct.toFixed(1)}%</p>
                    </div>
                    {isExpanded ? <ChevronDown size={16} className="text-ink-muted" /> : <ChevronRight size={16} className="text-ink-muted" />}
                  </div>

                  {/* Expanded: assignments */}
                  <AnimatePresence>
                    {isExpanded && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="border-t border-edge"
                      >
                        <div className="p-3">
                          {course.assignments.length === 0 ? (
                            <p className="py-4 text-center text-xs text-ink-muted">No assignments yet</p>
                          ) : (
                            <div className="space-y-1">
                              {course.assignments.map((a) => {
                                const aPct = (a.score / a.maxScore) * 100;
                                return (
                                  <div key={a.id} className="group flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-surface-3">
                                    <div className="min-w-0 flex-1">
                                      <p className="truncate text-sm text-ink">{a.name}</p>
                                      <p className="text-xs text-ink-muted">{a.category} · weight {a.weight}</p>
                                    </div>
                                    <div className="text-right">
                                      <p className={`text-sm font-medium ${scoreColor(aPct)}`}>
                                        {a.score}/{a.maxScore}
                                      </p>
                                      <p className="text-xs text-ink-muted">{aPct.toFixed(1)}%</p>
                                    </div>
                                    <button
                                      onClick={() => deleteAssignment(a.id)}
                                      className="text-ink-muted opacity-0 transition hover:text-red-400 group-hover:opacity-100"
                                    >
                                      <Trash2 size={14} />
                                    </button>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                          <button
                            onClick={() => { setShowAssignmentForm(course.id); setACategory("General"); }}
                            className="mt-2 flex w-full items-center justify-center gap-1 rounded-lg border border-dashed border-edge py-2 text-xs text-ink-muted transition hover:border-accent hover:text-accent"
                          >
                            <Plus size={14} /> Add Assignment
                          </button>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* New course modal */}
      <AnimatePresence>
        {showCourseForm && (
          <div className="absolute inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onClick={() => setShowCourseForm(false)}>
            <motion.div
              initial={{ opacity: 0, y: 40 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 40 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-sm rounded-t-2xl border border-edge bg-surface p-5 shadow-window sm:rounded-xl"
            >
              <h3 className="mb-4 text-sm font-semibold text-ink">Add Course</h3>
              <input autoFocus value={courseName} onChange={(e) => setCourseName(e.target.value)} placeholder="Course name" className="mb-3 w-full rounded-lg border border-edge bg-surface-2 px-3 py-2 text-sm text-ink outline-none focus:border-accent" />
              <div className="mb-3 flex gap-2">
                <input value={courseCode} onChange={(e) => setCourseCode(e.target.value)} placeholder="Code (CS 101)" className="flex-1 rounded-lg border border-edge bg-surface-2 px-3 py-2 text-sm text-ink outline-none focus:border-accent" />
                <input type="number" value={courseCredits} onChange={(e) => setCourseCredits(parseInt(e.target.value) || 3)} min={1} max={12} className="w-20 rounded-lg border border-edge bg-surface-2 px-3 py-2 text-sm text-ink outline-none focus:border-accent" />
              </div>
              <input value={courseSemester} onChange={(e) => setCourseSemester(e.target.value)} placeholder="Semester (Fall 2025)" className="mb-3 w-full rounded-lg border border-edge bg-surface-2 px-3 py-2 text-sm text-ink outline-none focus:border-accent" />
              <div className="mb-4 flex gap-2">
                {COURSE_COLORS.map((c) => (
                  <button key={c} onClick={() => setCourseColor(c)} className={`h-7 w-7 rounded-full transition ${courseColor === c ? "ring-2 ring-offset-2 ring-offset-surface ring-accent" : ""}`} style={{ backgroundColor: c }} />
                ))}
              </div>
              <div className="flex justify-end gap-2">
                <button onClick={() => setShowCourseForm(false)} className="rounded-lg px-3 py-1.5 text-xs text-ink-muted hover:text-ink">Cancel</button>
                <button onClick={createCourse} className="rounded-lg bg-accent px-4 py-1.5 text-xs font-medium text-white hover:bg-accent/90">Add</button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Add assignment modal */}
      <AnimatePresence>
        {showAssignmentForm && (
          <div className="absolute inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onClick={() => setShowAssignmentForm(null)}>
            <motion.div
              initial={{ opacity: 0, y: 40 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 40 }}
              onClick={(e) => e.stopPropagation()}
              className="max-h-[90vh] w-full max-w-sm overflow-y-auto rounded-t-2xl border border-edge bg-surface p-5 shadow-window sm:rounded-xl"
            >
              <h3 className="mb-4 text-sm font-semibold text-ink">Add Assignment</h3>
              <input autoFocus value={aName} onChange={(e) => setAName(e.target.value)} placeholder="Assignment name" className="mb-3 w-full rounded-lg border border-edge bg-surface-2 px-3 py-2 text-sm text-ink outline-none focus:border-accent" />
              <div className="mb-3 flex gap-2">
                <input value={aScore} onChange={(e) => setAScore(e.target.value)} placeholder="Score" type="number" className="flex-1 rounded-lg border border-edge bg-surface-2 px-3 py-2 text-sm text-ink outline-none focus:border-accent" />
                <input value={aMax} onChange={(e) => setAMax(e.target.value)} placeholder="Max" type="number" className="w-20 rounded-lg border border-edge bg-surface-2 px-3 py-2 text-sm text-ink outline-none focus:border-accent" />
              </div>
              <div className="mb-3 flex gap-2">
                <input value={aWeight} onChange={(e) => setAWeight(e.target.value)} placeholder="Weight" type="number" step="0.5" className="w-20 rounded-lg border border-edge bg-surface-2 px-3 py-2 text-sm text-ink outline-none focus:border-accent" />
                <select value={aCategory} onChange={(e) => setACategory(e.target.value)} className="flex-1 rounded-lg border border-edge bg-surface-2 px-3 py-2 text-sm text-ink outline-none">
                  {["General", "Homework", "Quiz", "Exam", "Lab", "Participation", "Project", "Extra Credit"].map((c) => <option key={c}>{c}</option>)}
                </select>
              </div>
              <div className="flex justify-end gap-2">
                <button onClick={() => setShowAssignmentForm(null)} className="rounded-lg px-3 py-1.5 text-xs text-ink-muted hover:text-ink">Cancel</button>
                <button onClick={() => createAssignment(showAssignmentForm)} className="rounded-lg bg-accent px-4 py-1.5 text-xs font-medium text-white hover:bg-accent/90">Add</button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
