// ===== Study Hub in-memory quiz store =====
// Holds active quiz sessions (source text + generated questions) so the
// grading endpoint doesn't need the client to resend the source each turn.
// Entries expire after TTL_MS. Lost on server restart — the client handles
// 404 by offering to restart the quiz. Acceptable for single-server dev.

import { randomUUID } from "node:crypto";

const TTL_MS = 30 * 60 * 1000; // 30 minutes

export interface StoredQuizQuestion {
  id: number;
  type: "mcq" | "short";
  prompt: string;
  options?: string[];
  answer: string;
}

export interface StoredQuiz {
  id: string;
  userId: string;
  sourceName: string;
  sourceRef: string;
  sourceText: string;
  questions: StoredQuizQuestion[];
  createdAt: number;
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const store = new Map<string, StoredQuiz>();

// Periodic cleanup of expired entries.
setInterval(() => {
  const now = Date.now();
  for (const [id, q] of store) {
    if (now - q.createdAt > TTL_MS) store.delete(id);
  }
}, 5 * 60 * 1000).unref?.();

export function createQuiz(
  userId: string,
  sourceName: string,
  sourceRef: string,
  sourceText: string,
  questions: StoredQuizQuestion[]
): StoredQuiz {
  const id = randomUUID();
  const quiz: StoredQuiz = {
    id,
    userId,
    sourceName,
    sourceRef,
    sourceText,
    questions: questions.map((q) =>
      q.type === "mcq" && q.options && q.options.length > 1
        ? { ...q, options: shuffle(q.options) }
        : q
    ),
    createdAt: Date.now(),
  };
  store.set(id, quiz);
  return quiz;
}

export function getQuiz(id: string, userId: string): StoredQuiz | null {
  const q = store.get(id);
  if (!q) return null;
  if (q.userId !== userId) return null;
  if (Date.now() - q.createdAt > TTL_MS) {
    store.delete(id);
    return null;
  }
  return q;
}

export function deleteQuiz(id: string): void {
  store.delete(id);
}
