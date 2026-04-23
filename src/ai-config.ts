import type { WorkspaceState } from "./triage";

export const OPENAI_MODEL = "gpt-5.4-mini";

export const TRIAGE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    basicInfo: {
      type: "object",
      additionalProperties: false,
      properties: {
        requester: { type: "string" },
        facultyUnit: { type: "string" },
        siteTitle: { type: "string" },
        proposedUrl: { type: "string" },
      },
      required: ["requester", "facultyUnit", "siteTitle", "proposedUrl"],
    },
    known: {
      type: "object",
      additionalProperties: false,
      properties: {
        purpose: { type: "string" },
        audience: { type: "string" },
        contentTypes: { type: "string" },
        ownership: { type: "string" },
        structure: { type: "string" },
        features: { type: "string" },
        privacy: { type: "string" },
      },
      required: [
        "purpose",
        "audience",
        "contentTypes",
        "ownership",
        "structure",
        "features",
        "privacy",
      ],
    },
    unclear: {
      type: "array",
      items: { type: "string" },
    },
    questions: {
      type: "array",
      items: { type: "string" },
    },
    reasoning: {
      type: "array",
      items: { type: "string" },
    },
    initialHypothesis: {
      type: "string",
      enum: [
        "Research directory fit",
        "Regular site request",
        "Reroute elsewhere",
        "More clarification needed",
      ],
    },
    finalRecommendation: {
      type: "string",
      enum: [
        "Research directory fit",
        "Regular site request",
        "Reroute elsewhere",
        "More clarification needed",
      ],
    },
  },
  required: [
    "basicInfo",
    "known",
    "unclear",
    "questions",
    "reasoning",
    "initialHypothesis",
    "finalRecommendation",
  ],
} as const;

export const SYSTEM_PROMPT = `You are generating a structured triage draft for university research website requests.

Return JSON only. Follow these rules:
- Treat the pasted form as the first round of evidence.
- Do not mark information as unclear if the form already answers it well enough.
- Use "Needs clarification" only when a scalar field is genuinely missing.
- Only include follow-up questions that help with routing, fit, ownership, scope, governance, public vs internal use, lifespan, or overlap with existing sites.
- Avoid duplicated or unnecessary questions.
- Recommendation categories must be exactly:
  - Research directory fit
  - Regular site request
  - Reroute elsewhere
  - More clarification needed
- The request is about routing and fit, not whether someone "deserves" a site.
- Keep reasoning concise and concrete.
- If the form suggests active public-facing research but leaves a few routing questions open, it is acceptable for the recommendation to remain "More clarification needed".

Interpret messy human input generously:
- The form may contain helper text, copied instructions, notes, repeated prompts, and awkward formatting.
- Distinguish prompt text from actual answers.
- Summarize known information in plain language when needed rather than copying every word verbatim.
`;

function ensureStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function extractStructuredData(payload: unknown): unknown {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const record = payload as Record<string, unknown>;

  if (record.output_parsed && typeof record.output_parsed === "object") {
    return record.output_parsed;
  }

  if (Array.isArray(record.output)) {
    for (const item of record.output) {
      if (!item || typeof item !== "object") {
        continue;
      }

      const content = (item as { content?: unknown }).content;
      if (!Array.isArray(content)) {
        continue;
      }

      for (const part of content) {
        if (!part || typeof part !== "object") {
          continue;
        }

        const maybeParsed = (part as { parsed?: unknown }).parsed;
        if (maybeParsed && typeof maybeParsed === "object") {
          return maybeParsed;
        }

        const maybeText = (part as { text?: unknown }).text;
        if (typeof maybeText === "string" && maybeText.trim()) {
          try {
            return JSON.parse(maybeText);
          } catch {
            continue;
          }
        }
      }
    }
  }

  if (typeof record.output_text === "string" && record.output_text.trim()) {
    return JSON.parse(record.output_text);
  }

  return null;
}

export function normalizeWorkspaceDraft(value: unknown): WorkspaceState {
  if (!value || typeof value !== "object") {
    throw new Error("The model response did not contain a valid triage draft.");
  }

  const draft = value as Record<string, unknown>;
  const basicInfo = (draft.basicInfo ?? {}) as Record<string, unknown>;
  const known = (draft.known ?? {}) as Record<string, unknown>;

  return {
    basicInfo: {
      requester:
        typeof basicInfo.requester === "string" ? basicInfo.requester : "Needs clarification",
      facultyUnit:
        typeof basicInfo.facultyUnit === "string"
          ? basicInfo.facultyUnit
          : "Needs clarification",
      siteTitle:
        typeof basicInfo.siteTitle === "string" ? basicInfo.siteTitle : "Needs clarification",
      proposedUrl:
        typeof basicInfo.proposedUrl === "string"
          ? basicInfo.proposedUrl
          : "Needs clarification",
    },
    known: {
      purpose: typeof known.purpose === "string" ? known.purpose : "Needs clarification",
      audience: typeof known.audience === "string" ? known.audience : "Needs clarification",
      contentTypes:
        typeof known.contentTypes === "string" ? known.contentTypes : "Needs clarification",
      ownership:
        typeof known.ownership === "string" ? known.ownership : "Needs clarification",
      structure:
        typeof known.structure === "string" ? known.structure : "Needs clarification",
      features: typeof known.features === "string" ? known.features : "Needs clarification",
      privacy:
        typeof known.privacy === "string"
          ? known.privacy
          : "No clear privacy or FOIP notes yet.",
    },
    unclear: ensureStringArray(draft.unclear),
    questions: ensureStringArray(draft.questions),
    reasoning: ensureStringArray(draft.reasoning),
    initialHypothesis:
      typeof draft.initialHypothesis === "string"
        ? (draft.initialHypothesis as WorkspaceState["initialHypothesis"])
        : "More clarification needed",
    finalRecommendation:
      typeof draft.finalRecommendation === "string"
        ? (draft.finalRecommendation as WorkspaceState["finalRecommendation"])
        : "More clarification needed",
    meetingNotes: "",
  };
}
