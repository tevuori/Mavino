import { isStudyFunctionEnabled } from "../../study-functions";
import type { ToolDef, ToolContext } from "./plugin";

/** Wrap a Study Hub tool so it checks per-tier function gating before running. */
export function withStudyGate(tool: ToolDef, functionId: string): ToolDef {
  const original = tool.handler;
  return {
    ...tool,
    handler: async (args, ctx: ToolContext) => {
      const allowed = await isStudyFunctionEnabled(ctx.userId, functionId);
      if (!allowed) {
        return { error: `This Study Hub function is disabled for your tier.` };
      }
      return original(args, ctx);
    },
  };
}
