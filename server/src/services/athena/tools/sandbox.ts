// ===== Athena code execution sandbox tool =====
// Runs Python / JavaScript / TypeScript snippets in an isolated Docker
// container (no network, read-only FS, dropped caps). The result is emitted
// as a client_action so the client can render the code + output inline.

import type { ToolDef } from "./plugin";
import { runCode, type SandboxLanguage } from "../../../services/sandbox";

export const sandboxTools: ToolDef[] = [
  {
    name: "run_code",
    description:
      "Execute a Python, JavaScript, or TypeScript code snippet in an isolated sandbox (no network access, 10s timeout, 256MB memory limit). Returns stdout, stderr, exit code, and duration. Use this when the user asks to run, test, or evaluate code. The code and its output are shown inline in the chat.",
    requiresConfirmation: true,
    clientAction: true,
    paidOnly: true,
    parameters: [
      {
        name: "language",
        type: "string",
        description: "Programming language",
        enum: ["python", "javascript", "typescript"],
        required: true,
      },
      { name: "code", type: "string", description: "The source code to execute", required: true },
      { name: "stdin", type: "string", description: "Optional stdin input to pipe to the program" },
    ],
    handler: async (args) => {
      const language = String(args.language ?? "") as SandboxLanguage;
      if (!["python", "javascript", "typescript"].includes(language)) {
        return { error: `Unsupported language: ${language}` };
      }
      const code = String(args.code ?? "");
      if (!code.trim()) return { error: "code is required" };
      const stdin = args.stdin ? String(args.stdin) : undefined;

      const result = await runCode(language, code, stdin);

      // Emit as client_action so the client renders an inline code+output block.
      return {
        action: "show_code_result",
        language,
        code,
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        durationMs: result.durationMs,
        timedOut: result.timedOut,
        unavailable: result.unavailable ?? false,
        error: result.error,
      };
    },
  },
];
