import { describe, expect, it } from "bun:test";
import { clearUserAiCredential, type ClearCredentialDeps } from "./ai";

function makeMocks(): {
  deps: ClearCredentialDeps;
  deleteCalls: Array<{ userId: string }>;
  resetCalls: string[];
} {
  const deleteCalls: Array<{ userId: string }> = [];
  const resetCalls: string[] = [];

  const deps = {
    prisma: {
      aiCredential: {
        delete: async (args: { where: { userId: string } }) => {
          deleteCalls.push(args.where);
        },
      },
    } satisfies ClearCredentialDeps["prisma"],
    llmRateLimiter: {
      reset: (userId: string) => {
        resetCalls.push(userId);
      },
    } satisfies ClearCredentialDeps["llmRateLimiter"],
  };

  return { deps, deleteCalls, resetCalls };
}

describe("clearUserAiCredential", () => {
  it("deletes the user's AiCredential row and resets rate-limit state", async () => {
    const { deps, deleteCalls, resetCalls } = makeMocks();
    await clearUserAiCredential("user-123", deps);

    expect(deleteCalls).toEqual([{ userId: "user-123" }]);
    expect(resetCalls).toEqual(["user-123"]);
  });

  it("still resets the rate limiter when no credential exists", async () => {
    const { deps, deleteCalls, resetCalls } = makeMocks();
    deps.prisma.aiCredential.delete = async (args: { where: { userId: string } }) => {
      deleteCalls.push(args.where);
      throw new Error("Record not found");
    };

    await clearUserAiCredential("user-456", deps);

    expect(deleteCalls).toEqual([{ userId: "user-456" }]);
    expect(resetCalls).toEqual(["user-456"]);
  });
});
