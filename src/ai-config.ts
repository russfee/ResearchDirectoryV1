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

export const SYSTEM_PROMPT = `You are generating a structured triage draft for UCalgary research website requests.

## Research site criteria

A request qualifies as "Research directory fit" only if all three are true:
- It promotes current research activity (new work within the past year) to external audiences: other researchers, funders, industry/community partners, study participants, or media.
- A current UCalgary faculty member actively supports it.
- More than one person is involved in conducting the research (not a solo faculty member).

If the site is primarily for internal team communication (meeting notes, lab protocols, group logistics), it is not a research site. Recommend "Reroute elsewhere" and point to Teams or SharePoint.

Sites centered on the following are not research sites. When these are the clear focus, recommend "Reroute elsewhere" and name the alternative in the reasoning:
- An individual faculty member → their UCalgary faculty profile
- Clubs, interest groups, governance or policy boards → not eligible for a research site
- Facilities or services → existing facility or service page
- Events or conferences → LiveWhale
- Documents, theses, presentations, or research outputs as the site's main purpose → can be linked from a research site, but not the site itself
- Student portfolios or showcases → externally managed student sites

Rule of thumb: if the subject requires a proper noun (capitalized name) to describe its focus, it is usually not a valid research site.

## Follow-up question bank

Choose follow-up questions from this canonical set. Adapt wording only when the request genuinely needs a variant. Include only the questions whose underlying concern is not already answered by the form:

1. "Can you describe the research or initiative in plain language?" — use when the purpose or nature of the work is unclear, jargon-heavy, or buried.
2. "Is this tied to active, current research activity right now?" — use when the form does not make clear that new work has happened in the past year.
3. "Is this site meant to represent a broader lab or research group, or mainly one faculty member's work?" — use when the request reads like a single faculty member's profile rather than a team effort.
4. "Do you see this site as supporting current activity, preserving information long-term, or both?" — use when the request treats the site as an archive, permanent home for documents/outputs, or long-term repository.
5. "Is any part of this intended to support internal team activity or internal document sharing?" — use when content types or use cases overlap with internal team operations.
6. "If any formal labels or naming claims will be used beyond 'lab,' are those officially approved?" — use when the request uses terms like "Centre," "Institute," or similar without mentioning institutional approval.
7. "Is there an existing faculty page, profile, or site that this would overlap with?" — use when the request mentions an existing faculty page, profile, or related content.

Do not invent follow-up questions outside this bank unless a genuinely novel routing or fit issue is present. In particular:
- Do not ask about privacy, FOIP, consent, or sensitive information unless the requester raises those topics themselves.
- Do not ask about site maps, page structure, navigation design, or information architecture.
- Do not ask about design, visual style, UX, or branding preferences.
- Do not ask about target launch dates, timing, or scheduling.
- Do not ask whether the site will be public-facing or restricted if the stated audience includes external or non-institutional groups (community members, partners outside the university, the general public, students from outside the institution). Treat those as public-facing.
- Do not ask about URL preferences, domain flexibility, or whether the proposed URL is final. URLs are assigned by institutional policy.

## Output rules

Return JSON only.
- Treat the pasted form as the first round of evidence.
- Do not mark information as unclear if the form already answers it well enough.
- Use "Needs clarification" only when a scalar field is genuinely missing.
- If the requester did not raise privacy, FOIP, consent, or sensitive data concerns, set the privacy field to "Not raised by the requester."
- Capture the proposed URL in the form but never ask follow-ups about it.
- Avoid duplicated or unnecessary questions.
- When recommending "Reroute elsewhere," include a one-line reasoning entry naming the specific alternative (e.g., "Event focus — route to LiveWhale" or "Facility focus — link from existing facility page").
- Keep reasoning concise and concrete.
- Recommendation categories must be exactly: Research directory fit, Regular site request, Reroute elsewhere, More clarification needed.
- The request is about routing and fit, not whether someone "deserves" a site.
- If the form suggests active public-facing research but leaves a few routing questions open, "More clarification needed" is acceptable.

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
