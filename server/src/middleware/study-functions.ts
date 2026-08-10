import type { Context, Next } from "hono";
import { isStudyFunctionEnabled } from "../services/study-functions";

/** Middleware that 403s if the Study Hub function is disabled for the current user. */
export function studyFunctionMiddleware(functionId: string) {
  return async (c: Context, next: Next) => {
    const { userId } = c.get("auth");
    const allowed = await isStudyFunctionEnabled(userId, functionId);
    if (!allowed) {
      return c.json({ error: "This Study Hub function is disabled for your tier." }, 403);
    }
    await next();
  };
}
