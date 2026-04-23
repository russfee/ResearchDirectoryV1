export type Recommendation =
  | "Research directory fit"
  | "Regular site request"
  | "Reroute elsewhere"
  | "More clarification needed";

export interface WorkspaceState {
  basicInfo: {
    requester: string;
    facultyUnit: string;
    siteTitle: string;
    proposedUrl: string;
  };
  known: {
    purpose: string;
    audience: string;
    contentTypes: string;
    ownership: string;
    structure: string;
    features: string;
    privacy: string;
  };
  unclear: string[];
  questions: string[];
  reasoning: string[];
  initialHypothesis: Recommendation;
  finalRecommendation: Recommendation;
  meetingNotes: string;
}

const UNKNOWN = "Needs clarification";

interface ParsedFormFields {
  requester?: string;
  facultyUnit?: string;
  siteTitle?: string;
  proposedUrl?: string;
  purpose?: string;
  audience?: string;
  contentTypes?: string;
  ownership?: string;
  structure?: string;
  features?: string;
  privacy?: string;
}

const SAMPLE_REQUEST = `Requester: Dr. Maya Chen
Faculty/Unit: Cumming School of Medicine
Proposed Site Title: Urban Air and Respiratory Health Lab
Proposed URL: research.ucalgary.ca/urban-air-lab
Primary purpose of the website: Create a public-facing website for our lab that explains our current air quality and respiratory health research, introduces team members, shares publications, and highlights opportunities for graduate students and research participants.
Intended audience: Prospective students, collaborators, media, and members of the public interested in environmental health research.
Content types: Research overview, people, publications, news updates, opportunities to participate in studies, contact information.
Who will build and maintain the site: The lab coordinator will manage updates with support from Dr. Chen and one graduate assistant.
Sitemap or structure ideas: Home, About the lab, Research projects, Publications, Team, News, Participate in research, Contact.
Required features/functions: Contact form and a way to post occasional news updates.
Any additional context: We currently have scattered information across faculty profile pages and would like a clearer home for this active lab.`;

const ROUTING_QUESTION_DETAILS: Record<string, string> = {
  "Can you describe the research or initiative in plain language?":
    "If possible, describe it as you would to someone outside the field, without relying too heavily on disciplinary language.",
  "Is this tied to active, current research activity right now?":
    "We are mainly looking to confirm whether the site is intended to support ongoing research work at this time.",
  "Is this site meant to represent a broader lab or research group, or mainly one faculty member's work?":
    "This helps us understand how the site should be positioned and where it fits best.",
  "Do you see this site as supporting current activity, preserving information long-term, or both?":
    "This helps us understand the intended role of the site over time.",
  "Is any part of this intended to support internal team activity or internal document sharing?":
    "Internal working documents or team-only materials may be better supported in a different platform.",
  "If any formal labels or naming claims will be used beyond \"lab,\" are those officially approved?":
    "If so, it helps to know what wording will be used and who approved it.",
  "Is there an existing faculty page, profile, or site that this would overlap with?":
    "That helps us avoid duplicating content that may already live somewhere else.",
};

const LABEL_PATTERNS: Record<string, string[]> = {
  requester: ["Requester", "Requestor", "Submitted by", "Name"],
  facultyUnit: ["Faculty/Unit", "Faculty", "Unit", "Department", "Service area"],
  siteTitle: ["Proposed Site Title", "Site Title", "Title"],
  proposedUrl: ["Proposed URL", "URL", "Requested URL"],
  purpose: ["Primary purpose of the website", "Purpose", "Description", "Site purpose"],
  audience: ["Intended audience", "Audience"],
  contentTypes: ["Content types", "Content", "Types of content"],
  ownership: [
    "Who will build and maintain the site",
    "Ownership/Maintenance",
    "Maintenance",
    "Owner",
  ],
  structure: ["Sitemap or structure ideas", "Proposed structure", "Structure", "Sections"],
  features: ["Required features/functions", "Features", "Functions", "Special features"],
  privacy: ["FOIP/privacy indicators", "Privacy", "FOIP", "Privacy or FOIP considerations"],
};

const QUESTION_PATTERNS: Record<keyof ParsedFormFields, string[]> = {
  requester: ["Who is requesting this website", "Requester", "Requestor", "Submitted by"],
  facultyUnit: ["What faculty, unit or service is this for?"],
  siteTitle: ["What is the website title?"],
  proposedUrl: ["What is the proposed URL of the new website?"],
  purpose: ["What is the primary purpose of this website?"],
  audience: ["Who is your intended audience?"],
  contentTypes: ["What kind of content will you post and manage on this site?"],
  ownership: ["Who will build this site out? Who will maintain it on a daily basis?"],
  structure: [
    "Do you have a site map showing the structure/architecture you think would work well for this site?",
  ],
  features: ["Are there any features or functions you absolutely require on this site?"],
  privacy: ["Are you going to use or collect content that may be subject to FOIP or privacy?"],
};

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function escapePattern(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractLabeledValue(text: string, labels: string[]): string {
  for (const label of labels) {
    const expression = new RegExp(
      `(?:^|\\n)\\s*${escapePattern(label)}\\s*:\\s*(.+)`,
      "i",
    );
    const match = text.match(expression);
    if (match?.[1]) {
      return normalizeWhitespace(match[1]);
    }
  }

  return "";
}

function isHelperLine(line: string): boolean {
  const lower = line.toLowerCase();
  return (
    lower.startsWith("more informationabout ") ||
    lower === "note:" ||
    lower === "> note:" ||
    lower.startsWith("> note") ||
    lower.startsWith(">") ||
    lower.startsWith("please review the kb ") ||
    lower.startsWith("final site name will be determined") ||
    lower.startsWith("the title is what will appear") ||
    lower.startsWith("what do you want people who visit") ||
    lower.startsWith("who are the people you are trying") ||
    lower.startsWith("e.g. ") ||
    lower.startsWith("note that the university has") ||
    lower.startsWith("if so, please attach") ||
    lower.startsWith("if this request is not related")
  );
}

function isQuestionLine(line: string): boolean {
  const lower = normalizeWhitespace(line).toLowerCase();
  if (
    /^(what|who|do|does|is|are|if)\b/i.test(lower) &&
    (lower.endsWith("?") || lower.endsWith(":"))
  ) {
    return true;
  }

  return Object.values(QUESTION_PATTERNS).some((patterns) =>
    patterns.some((pattern) => lower === pattern.toLowerCase()),
  );
}

function collectAnswer(lines: string[], startIndex: number): string {
  const answerLines: string[] = [];
  let skippingNoteBlock = false;

  for (let index = startIndex; index < lines.length; index += 1) {
    const line = normalizeWhitespace(lines[index]);

    if (!line) {
      if (answerLines.length > 0) {
        break;
      }
      skippingNoteBlock = false;
      continue;
    }

    if (line.toLowerCase() === "> note:" || line.toLowerCase() === "note:") {
      skippingNoteBlock = true;
      continue;
    }

    if (skippingNoteBlock) {
      continue;
    }

    if (isHelperLine(line)) {
      continue;
    }

    if (isQuestionLine(line)) {
      break;
    }

    answerLines.push(line);
  }

  return normalizeWhitespace(answerLines.join(" "));
}

function extractAnswerFromQuestions(text: string, patterns: string[]): string {
  const lines = text.split("\n");

  for (let index = 0; index < lines.length; index += 1) {
    const line = normalizeWhitespace(lines[index]);
    if (!line) {
      continue;
    }

    const matched = patterns.some((pattern) => line.toLowerCase() === pattern.toLowerCase());
    if (!matched) {
      continue;
    }

    const answer = collectAnswer(lines, index + 1);
    if (answer) {
      return answer;
    }
  }

  return "";
}

function parseFormFields(text: string): ParsedFormFields {
  const parsed: ParsedFormFields = {};

  (Object.keys(QUESTION_PATTERNS) as Array<keyof ParsedFormFields>).forEach((key) => {
    parsed[key] = extractAnswerFromQuestions(text, QUESTION_PATTERNS[key]) || undefined;
  });

  return parsed;
}

function extractFirstUrl(text: string): string {
  const match = text.match(/https?:\/\/[^\s)]+|[A-Za-z0-9.-]+\.[A-Za-z]{2,}\/[^\s)]+/);
  return match ? match[0] : "";
}

function hasAny(text: string, terms: string[]): boolean {
  return terms.some((term) => new RegExp(`\\b${escapePattern(term)}\\b`, "i").test(text));
}

function splitLines(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.replace(/^\s*[-*]\s*/, ""))
    .map(normalizeWhitespace)
    .filter(Boolean);
}

function buildQuestionSet(text: string, known: WorkspaceState["known"]): string[] {
  const questions: string[] = [];
  const lower = text.toLowerCase();
  const researchTerms = ["research", "lab", "study", "studies", "initiative", "grant"];
  const currentTerms = ["active", "current", "ongoing", "current research"];
  const onePersonTerms = [
    "faculty profile",
    "profile",
    "cv",
    "curriculum vitae",
    "single faculty member",
    "principal investigator",
  ];
  const internalTerms = ["internal", "sharepoint", "teams", "team-only", "operations", "document sharing"];
  const archiveTerms = ["archive", "archival", "legacy", "history", "preserve"];
  const namingTerms = ["centre", "center", "institute"];
  const approvalTerms = ["approved", "approval", "official", "governance"];

  if (!known.purpose || !hasAny(lower, researchTerms)) {
    questions.push("Can you describe the research or initiative in plain language?");
  }

  if (!hasAny(lower, currentTerms) && !hasAny(lower, archiveTerms)) {
    questions.push("Is this tied to active, current research activity right now?");
  }

  if (!hasAny(lower, ["lab", "group", "team", "initiative"]) || hasAny(lower, onePersonTerms)) {
    questions.push(
      "Is this site meant to represent a broader lab or research group, or mainly one faculty member's work?",
    );
  }

  if (!hasAny(lower, currentTerms) || !hasAny(lower, archiveTerms)) {
    questions.push("Do you see this site as supporting current activity, preserving information long-term, or both?");
  }

  if (!hasAny(lower, ["public", "public-facing", "external", "community"]) || hasAny(lower, internalTerms)) {
    questions.push("Is any part of this intended to support internal team activity or internal document sharing?");
  }

  if (hasAny(lower, namingTerms) && !hasAny(lower, approvalTerms)) {
    questions.push("If any formal labels or naming claims will be used beyond \"lab,\" are those officially approved?");
  }

  if (hasAny(lower, ["existing", "currently", "already", "profile page", "faculty page"])) {
    questions.push("Is there an existing faculty page, profile, or site that this would overlap with?");
  }

  return Array.from(new Set(questions));
}

function buildUnclearList(
  known: WorkspaceState["known"],
  questions: string[],
  basicInfo: WorkspaceState["basicInfo"],
): string[] {
  const unclear: string[] = [];

  if (basicInfo.requester === UNKNOWN) unclear.push("Requester details are not clearly stated in the pasted request.");
  if (basicInfo.facultyUnit === UNKNOWN) unclear.push("Faculty or unit ownership is still unclear.");
  if (basicInfo.siteTitle === UNKNOWN) unclear.push("A working site title is not clearly provided.");
  if (basicInfo.proposedUrl === UNKNOWN) unclear.push("The proposed URL is missing or unclear.");
  if (known.purpose === UNKNOWN) unclear.push("The request does not yet explain the site's purpose in plain language.");
  if (known.ownership === UNKNOWN) unclear.push("Ownership and maintenance are not yet clearly defined.");

  questions.forEach((question) => {
    if (question.startsWith("Is this tied")) {
      unclear.push("It is not yet clear whether the request supports active, current research.");
    }
    if (question.startsWith("Is this site meant")) {
      unclear.push("The distinction between a broader research group site and one person's work still needs confirmation.");
    }
    if (question.startsWith("Do you see this site")) {
      unclear.push("The intended lifespan of the site is still uncertain.");
    }
    if (question.startsWith("Is any part of this intended")) {
      unclear.push("It is not yet clear whether any part of the request is really about internal operations or document sharing.");
    }
    if (question.startsWith("If any formal labels")) {
      unclear.push("Any formal naming claims still need governance confirmation.");
    }
  });

  return Array.from(new Set(unclear));
}

function buildReasoning(
  text: string,
  known: WorkspaceState["known"],
  basicInfo: WorkspaceState["basicInfo"],
  recommendation: Recommendation,
): string[] {
  const lower = text.toLowerCase();
  const lines: string[] = [];

  if (hasAny(lower, ["research", "lab", "publications", "research projects", "study", "studies"])) {
    lines.push("The request includes clear research-related signals such as research activity, publications, projects, or study participation.");
  }

  if (hasAny(lower, ["public", "public-facing", "collaborators", "media", "community", "prospective students"])) {
    lines.push("The described audience appears to be public-facing rather than internal-only.");
  }

  if (hasAny(lower, ["internal", "sharepoint", "teams", "document sharing", "operations"])) {
    lines.push("Some language points toward internal workflow needs, which may mean a different platform is a better fit.");
  }

  if (hasAny(lower, ["event", "conference", "clinic", "service", "program", "student group"])) {
    lines.push("The request includes non-research framing that may point away from the research directory path.");
  }

  if (hasAny(lower, ["profile", "faculty profile", "single faculty member", "principal investigator"])) {
    lines.push("There are signs the request may be closer to an expanded individual profile than a broader research group site.");
  }

  if (known.ownership || basicInfo.facultyUnit) {
    lines.push("There is at least some indication of institutional ownership, which is useful for routing.");
  }

  lines.push(`Current working recommendation: ${recommendation}.`);

  return Array.from(new Set(lines));
}

function chooseRecommendation(text: string, known: WorkspaceState["known"]): Recommendation {
  const lower = text.toLowerCase();
  const hasResearch = hasAny(lower, [
    "research",
    "lab",
    "study",
    "studies",
    "publications",
    "research project",
    "initiative",
  ]);
  const publicFacing = hasAny(lower, [
    "public",
    "public-facing",
    "community",
    "collaborators",
    "media",
    "prospective students",
    "participants",
  ]);
  const nonResearch = hasAny(lower, [
    "event",
    "conference",
    "clinic",
    "service",
    "program",
    "student group",
    "internal team",
  ]);
  const internalOnly = hasAny(lower, ["sharepoint", "teams", "internal", "team-only", "operations", "document sharing"]);
  const singlePerson = hasAny(lower, [
    "faculty profile",
    "single faculty member",
    "profile",
    "curriculum vitae",
    "cv",
  ]);
  const broaderGroup = hasAny(lower, ["lab", "group", "team", "initiative", "centre", "center", "institute"]);

  if (nonResearch && !hasResearch) return "Reroute elsewhere";
  if (internalOnly && !publicFacing) return "Reroute elsewhere";
  if (hasResearch && publicFacing && broaderGroup && !singlePerson && !internalOnly) {
    return "Research directory fit";
  }
  if (singlePerson || (!hasResearch && known.purpose)) return "Regular site request";
  return "More clarification needed";
}

function fallbackSummary(text: string): string {
  const firstUsefulLine = text
    .split("\n")
    .map(normalizeWhitespace)
    .find((line) => line && !line.includes(":"));
  return firstUsefulLine ?? "";
}

export function createWorkspaceFromText(text: string): WorkspaceState {
  const parsed = parseFormFields(text);
  const basicInfo = {
    requester:
      extractLabeledValue(text, LABEL_PATTERNS.requester) || parsed.requester || UNKNOWN,
    facultyUnit:
      extractLabeledValue(text, LABEL_PATTERNS.facultyUnit) || parsed.facultyUnit || UNKNOWN,
    siteTitle:
      extractLabeledValue(text, LABEL_PATTERNS.siteTitle) || parsed.siteTitle || UNKNOWN,
    proposedUrl:
      extractLabeledValue(text, LABEL_PATTERNS.proposedUrl) ||
      parsed.proposedUrl ||
      extractFirstUrl(text) ||
      UNKNOWN,
  };

  const known = {
    purpose:
      extractLabeledValue(text, LABEL_PATTERNS.purpose) ||
      parsed.purpose ||
      fallbackSummary(text) ||
      UNKNOWN,
    audience:
      extractLabeledValue(text, LABEL_PATTERNS.audience) || parsed.audience || UNKNOWN,
    contentTypes:
      extractLabeledValue(text, LABEL_PATTERNS.contentTypes) ||
      parsed.contentTypes ||
      UNKNOWN,
    ownership:
      extractLabeledValue(text, LABEL_PATTERNS.ownership) || parsed.ownership || UNKNOWN,
    structure:
      extractLabeledValue(text, LABEL_PATTERNS.structure) || parsed.structure || UNKNOWN,
    features:
      extractLabeledValue(text, LABEL_PATTERNS.features) || parsed.features || UNKNOWN,
    privacy:
      extractLabeledValue(text, LABEL_PATTERNS.privacy) ||
      parsed.privacy ||
      "No clear privacy or FOIP notes yet.",
  };

  const analysisText = [
    basicInfo.facultyUnit,
    basicInfo.siteTitle,
    basicInfo.proposedUrl,
    known.purpose,
    known.audience,
    known.contentTypes,
    known.ownership,
    known.structure,
    known.features,
    known.privacy,
  ]
    .filter((value) => value && value !== UNKNOWN)
    .join("\n");

  const initialHypothesis = chooseRecommendation(analysisText, known);
  const questions = buildQuestionSet(analysisText, known);
  const unclear = buildUnclearList(known, questions, basicInfo);
  const reasoning = buildReasoning(analysisText, known, basicInfo, initialHypothesis);

  return {
    basicInfo,
    known,
    unclear,
    questions,
    reasoning,
    initialHypothesis,
    finalRecommendation: initialHypothesis,
    meetingNotes: "",
  };
}

export function sampleRequestText(): string {
  return SAMPLE_REQUEST;
}

export function joinLines(lines: string[]): string {
  return lines.join("\n");
}

export function updateLines(value: string): string[] {
  return splitLines(value);
}

export function buildBriefMarkdown(workspace: WorkspaceState): string {
  const notes = workspace.meetingNotes.trim() || "- ";

  return `# Website Request Triage Brief

## Basic Information
- Requester: ${workspace.basicInfo.requester}
- Faculty/Unit: ${workspace.basicInfo.facultyUnit}
- Proposed Site Title: ${workspace.basicInfo.siteTitle}
- Proposed URL: ${workspace.basicInfo.proposedUrl}

## What We Know From The Initial Form
- Purpose: ${workspace.known.purpose}
- Audience: ${workspace.known.audience}
- Content types: ${workspace.known.contentTypes}
- Ownership/Maintenance: ${workspace.known.ownership}
- Proposed structure: ${workspace.known.structure}
- Special features: ${workspace.known.features}
- Privacy or FOIP considerations: ${workspace.known.privacy}

## What Is Still Unclear
${workspace.unclear.map((item) => `- ${item}`).join("\n") || "- None noted yet."}

## Routing Questions To Clarify
${workspace.questions.map((item) => `- ${item}`).join("\n") || "- No follow-up questions currently drafted."}

## Initial Routing Hypothesis
- ${workspace.initialHypothesis}

## Notes From Follow-Up Meeting
${notes
  .split("\n")
  .map((line) => (line.trim().startsWith("-") ? line : `- ${line}`))
  .join("\n")}

## Final Recommendation
- ${workspace.finalRecommendation}

## Reasoning
${workspace.reasoning.map((item) => `- ${item}`).join("\n") || "- Reasoning still to be added."}
`;
}

export function buildEmailMarkdown(workspace: WorkspaceState): string {
  const questionBlock = workspace.questions.length
    ? workspace.questions
        .map((question, index) => {
          const detail =
            ROUTING_QUESTION_DETAILS[question] ??
            "This will help us make sure the request lands in the right place.";
          return `${index + 1}. ${question}\n${detail}`;
        })
        .join("\n\n")
    : "1. I have a couple of small routing questions I would like to confirm in our conversation.\nThis is mostly to make sure the request follows the right path.";

  return `Hi ${workspace.basicInfo.requester === UNKNOWN ? "[Name]" : workspace.basicInfo.requester},

Thanks for submitting your website request. I've reviewed the initial form and have a reasonable sense of what you're looking for.

I'd like to set up a time to chat with you and your team, or just with you if that's easier, so we can make sure this request ends up in the right place.

In advance of that conversation, I wanted to send along a few questions I'd love to go over. No need for anything formal, but I thought it might be helpful to share them ahead of time in case you'd like a bit of time to think them over first.

${questionBlock}

Once I have that context, I can help make sure the request is routed appropriately.

Thanks,`;
}
