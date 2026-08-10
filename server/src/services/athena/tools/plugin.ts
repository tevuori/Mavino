// ===== Athena tool framework =====
// Tools are plain definitions (name + description + parameters + handler).
// AthenaToolsPlugin aggregates them into a single MultiToolPlugin instance
// attached per-request to the LlmModel, scoped to one user.

import {
  MultiToolPlugin,
  type PluginExecutionContext,
  type PluginParameter,
} from "multi-llm-ts";

export interface ClientWindowInfo {
  id: string;
  appId: string;
  title: string;
  rect: { x: number; y: number; width: number; height: number };
  minimized: boolean;
  focused: boolean;
  /** For Browser windows: the URL currently displayed. */
  browserUrl?: string;
  /** For Maps windows: the current map center + zoom. */
  mapsCenter?: { lat: number; lon: number; zoom: number };
}

export interface ToolContext {
  userId: string;
  /** Current open windows on the client (sent with the chat request).
   *  Mutable — browser tools update this when open_browser/new_tab/navigate
   *  are called, so subsequent server-side tools (get_browser_content) in the
   *  same turn can see the newly opened browser window. */
  windows: ClientWindowInfo[];
}

export interface ToolDef {
  name: string;
  description: string;
  parameters: PluginParameter[];
  /** Whether this tool mutates data (gated by confirmation on the client). */
  destructive?: boolean;
  /** If true, the client asks for confirmation before executing (e.g. run_code). */
  requiresConfirmation?: boolean;
  /** If true, result is forwarded to the client as a `client_action` chunk. */
  clientAction?: boolean;
  /** If true, the tool is only available to PAID / MANAGER / ADMIN users.
   *  Free and Demo users won't see it in the manifest or be able to invoke it. */
  paidOnly?: boolean;
  handler: (args: any, ctx: ToolContext) => Promise<any>;
}

/** OpenAI function-tool format (what multi-llm-ts sends to the provider). */
interface OpenAiTool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, any>;
      required: string[];
    };
  };
}

/** Convert a ToolDef's PluginParameter[] into an OpenAI JSON-schema object. */
function buildParameters(params: PluginParameter[]): {
  type: "object";
  properties: Record<string, any>;
  required: string[];
} {
  const properties: Record<string, any> = {};
  for (const p of params) {
    const prop: any = {
      type: p.type || (p.items ? "array" : "string"),
      description: p.description,
    };
    if (p.enum) prop.enum = p.enum;
    if (p.items) {
      prop.items = p.items.properties
        ? {
            type: p.items.type || "object",
            properties: Object.fromEntries(
              p.items.properties.map((sp) => [
                sp.name,
                { type: sp.type, description: sp.description },
              ])
            ),
          }
        : { type: p.items.type };
    }
    properties[p.name] = prop;
  }
  return {
    type: "object",
    properties,
    required: params.filter((p) => p.required).map((p) => p.name),
  };
}

/**
 * Aggregates many ToolDefs into one MultiToolPlugin bound to a user.
 * One instance is created per /api/athena/chat request.
 */
export class AthenaToolsPlugin extends MultiToolPlugin {
  private readonly tools: ToolDef[];
  private readonly ctx: ToolContext;
  private readonly names: Set<string>;
  private readonly openaiTools: OpenAiTool[];

  constructor(tools: ToolDef[], ctx: ToolContext) {
    super();
    this.tools = tools;
    this.ctx = ctx;
    this.names = new Set(tools.map((t) => t.name));
    this.openaiTools = tools.map((t) => ({
      type: "function",
      function: {
        name: t.name,
        description: t.description,
        parameters: buildParameters(t.parameters),
      },
    }));
  }

  getName(): string {
    return "athena";
  }

  getDescription(): string {
    return "Mavino workspace tools";
  }

  // Status-description overrides (base Plugin throws "Not implemented").
  getPreparationDescription(tool: string): string {
    return `Preparing ${tool}…`;
  }
  getRunningDescription(tool: string, _args?: any): string {
    return `Running ${tool}…`;
  }
  getCompletedDescription(tool: string, _args?: any, result?: any): string | undefined {
    if (result && typeof result === "object" && "error" in result) {
      return `${tool} failed: ${result.error}`;
    }
    return `${tool} completed`;
  }
  getCanceledDescription(tool: string, _args?: any): string | undefined {
    return `${tool} canceled`;
  }

  async getTools(): Promise<OpenAiTool[]> {
    return this.openaiTools;
  }

  handlesTool(name: string): boolean {
    return this.names.has(name);
  }

  async execute(
    _context: PluginExecutionContext,
    payload: { tool: string; parameters: any }
  ): Promise<any> {
    const { tool, parameters } = payload;
    const def = this.tools.find((t) => t.name === tool);
    if (!def) return { error: `Unknown tool: ${tool}` };
    try {
      return await def.handler(parameters ?? {}, this.ctx);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Tool execution failed";
      return { error: msg };
    }
  }
}
