import {
  extractStructuredData,
  normalizeWorkspaceDraft,
  OPENAI_MODEL,
  SYSTEM_PROMPT,
  TRIAGE_SCHEMA,
} from "../src/ai-config";

export const config = { runtime: "edge" };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed." }, 405);
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return jsonResponse(
      {
        error:
          "OPENAI_API_KEY is not set on the server. Add it to your local environment or Vercel project settings.",
      },
      500,
    );
  }

  const body = (await request.json()) as { requestText?: unknown };
  if (typeof body.requestText !== "string" || !body.requestText.trim()) {
    return jsonResponse({ error: "requestText is required." }, 400);
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      reasoning: {
        effort: "low",
      },
      input: [
        {
          role: "system",
          content: [{ type: "input_text", text: SYSTEM_PROMPT }],
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: `Create a triage draft from this pasted intake form:\n\n${body.requestText}`,
            },
          ],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "triage_draft",
          strict: true,
          schema: TRIAGE_SCHEMA,
        },
      },
    }),
  });

  const payload = (await response.json()) as Record<string, unknown>;

  if (!response.ok) {
    const message =
      typeof (payload.error as { message?: unknown } | undefined)?.message === "string"
        ? (payload.error as { message: string }).message
        : "OpenAI request failed.";
    return jsonResponse({ error: message }, response.status);
  }

  try {
    const workspace = normalizeWorkspaceDraft(extractStructuredData(payload));
    return jsonResponse({ workspace });
  } catch (error) {
    return jsonResponse(
      {
        error:
          error instanceof Error
            ? error.message
            : "The model response could not be normalized.",
      },
      502,
    );
  }
}
