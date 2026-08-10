// ===== Study Hub function settings =====
// Admin-only endpoint for toggling Study Hub AI features per tier, plus a
// per-user endpoint that returns which functions are enabled for the caller.

import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { authMiddleware } from "../middleware/auth";
import { adminMiddleware } from "../middleware/admin";
import {
  STUDY_HUB_FUNCTIONS,
  getStudyFunctionConfig,
  setStudyFunctionConfig,
  getEnabledStudyFunctionIds,
  type StudyFunctionConfig,
} from "../services/study-functions";

const studyFunctions = new Hono();
studyFunctions.use("*", authMiddleware);

/** GET /api/study-functions — functions enabled for the current user. */
studyFunctions.get("/", async (c) => {
  const { userId } = c.get("auth");
  const enabled = await getEnabledStudyFunctionIds(userId);
  return c.json({ enabled });
});

const admin = new Hono();
admin.use("*", adminMiddleware);

/** GET /api/study-functions/admin — full function list + per-tier config. */
admin.get("/", async (c) => {
  const config = await getStudyFunctionConfig();
  return c.json({
    functions: STUDY_HUB_FUNCTIONS,
    config,
  });
});

const updateSchema = z.record(
  z.object({
    free: z.boolean(),
    paid: z.boolean(),
  })
);

/** PUT /api/study-functions/admin — update per-tier config. */
admin.put("/", zValidator("json", updateSchema), async (c) => {
  const body = c.req.valid("json") as StudyFunctionConfig;
  const config = await setStudyFunctionConfig(body);
  return c.json({
    functions: STUDY_HUB_FUNCTIONS,
    config,
  });
});

studyFunctions.route("/admin", admin);

export default studyFunctions;
