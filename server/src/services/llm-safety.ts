export async function isContentFlagged(apiKey: string, input: string): Promise<boolean> {
  if (!input.trim()) return false;
  const response = await fetch("https://api.openai.com/v1/moderations", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ model: "omni-moderation-latest", input }),
  });
  if (!response.ok) throw new Error("SAFETY_CHECK_UNAVAILABLE");
  const payload = await response.json() as { results?: Array<{ flagged?: boolean }> };
  return payload.results?.some((result) => result.flagged) ?? false;
}
