import type { WorkspaceState } from "./triage";

export { OPENAI_MODEL } from "./ai-config";

export async function analyzeRequestWithOpenAI(
  requestText: string,
): Promise<WorkspaceState> {
  const response = await fetch("/api/analyze", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ requestText }),
  });

  const payload = (await response.json()) as {
    error?: string;
    workspace?: WorkspaceState;
  };

  if (!response.ok || !payload.workspace) {
    throw new Error(payload.error || "Server-side analysis failed.");
  }

  return payload.workspace;
}
