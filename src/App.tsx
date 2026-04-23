import { type ReactNode, useEffect, useMemo, useState } from "react";
import { analyzeRequestWithOpenAI, OPENAI_MODEL } from "./openai";
import {
  buildBriefMarkdown,
  buildEmailMarkdown,
  createWorkspaceFromText,
  joinLines,
  Recommendation,
  sampleRequestText,
  updateLines,
  WorkspaceState,
} from "./triage";

const STORAGE_KEYS = {
  request: "research-directory-request-text",
  workspace: "research-directory-workspace",
};

const recommendations: Recommendation[] = [
  "Research directory fit",
  "Regular site request",
  "Reroute elsewhere",
  "More clarification needed",
];

const briefSectionKeys = [
  "purpose",
  "audience",
  "content",
  "ownership",
  "scope",
] as const;

type BriefSectionKey = (typeof briefSectionKeys)[number];

type OpenSections = Record<BriefSectionKey, boolean>;
type RoutingSignalStatus = "complete" | "warning" | "neutral";

interface RoutingSignal {
  label: string;
  status: RoutingSignalStatus;
}

function readSavedWorkspace(): WorkspaceState | null {
  const raw = window.localStorage.getItem(STORAGE_KEYS.workspace);
  if (!raw) return null;

  try {
    return JSON.parse(raw) as WorkspaceState;
  } catch {
    return null;
  }
}

function getDefaultOpenSections(workspace: WorkspaceState | null): OpenSections {
  return {
    purpose: false,
    audience: false,
    content: false,
    ownership: false,
    scope: Boolean(workspace && (workspace.questions.length > 0 || workspace.unclear.length > 0)),
  };
}

function formatLastUpdated(timestamp: number | null): string {
  if (!timestamp) {
    return "Not updated in this session";
  }

  return new Intl.DateTimeFormat("en-CA", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(timestamp);
}

function containsAny(text: string, terms: string[]): boolean {
  return terms.some((term) => text.includes(term));
}

function getOverallStatus(workspace: WorkspaceState | null): string {
  if (!workspace) return "No draft yet";
  return workspace.questions.length > 0 || workspace.unclear.length > 0
    ? "Information needed"
    : "Ready to route";
}

function getRoutingSignals(workspace: WorkspaceState | null): RoutingSignal[] {
  if (!workspace) {
    return [
      { label: "Active research", status: "neutral" },
      { label: "Group / initiative (not individual)", status: "neutral" },
      { label: "Public-facing", status: "neutral" },
      { label: "Clear owner", status: "neutral" },
      { label: "Web-appropriate content", status: "neutral" },
      { label: "Internal content involved", status: "neutral" },
    ];
  }

  const haystack = [
    workspace.known.purpose,
    workspace.known.audience,
    workspace.known.contentTypes,
    workspace.known.ownership,
    workspace.reasoning.join(" "),
    workspace.questions.join(" "),
    workspace.unclear.join(" "),
  ]
    .join(" ")
    .toLowerCase();

  const hasActiveResearch = containsAny(haystack, [
    "research",
    "project",
    "study",
    "studies",
    "grant",
    "active",
    "ongoing",
  ]);
  const hasGroupSignals = containsAny(haystack, ["lab", "group", "initiative", "collective", "team"]);
  const individualQuestionOpen = workspace.questions.some((question) =>
    question.toLowerCase().includes("one faculty member"),
  );
  const publicFacing = containsAny(haystack, [
    "public",
    "public-facing",
    "collaborators",
    "students",
    "community",
    "media",
    "partners",
  ]);
  const clearOwner =
    workspace.basicInfo.facultyUnit !== "Needs clarification" &&
    workspace.known.ownership !== "Needs clarification";
  const internalMention = containsAny(haystack, [
    "internal",
    "sharepoint",
    "teams",
    "document sharing",
    "operations",
  ]);

  return [
    { label: "Active research", status: hasActiveResearch ? "complete" : "warning" },
    {
      label: "Group / initiative (not individual)",
      status: hasGroupSignals && !individualQuestionOpen ? "complete" : "warning",
    },
    { label: "Public-facing", status: publicFacing ? "complete" : "warning" },
    { label: "Clear owner", status: clearOwner ? "complete" : "warning" },
    {
      label: "Web-appropriate content",
      status:
        workspace.known.contentTypes !== "Needs clarification" && !internalMention
          ? "complete"
          : "warning",
    },
    { label: "Internal content involved", status: internalMention ? "warning" : "complete" },
  ];
}

function getSectionState(values: string[]): "Complete" | "Incomplete" {
  return values.every((value) => value && value !== "Needs clarification")
    ? "Complete"
    : "Incomplete";
}

async function copyText(value: string): Promise<void> {
  await navigator.clipboard.writeText(value);
}

export default function App() {
  const [requestText, setRequestText] = useState<string>(
    () => window.localStorage.getItem(STORAGE_KEYS.request) ?? "",
  );
  const [workspace, setWorkspace] = useState<WorkspaceState | null>(() => readSavedWorkspace());
  const [copyState, setCopyState] = useState<"brief" | "email" | null>(null);
  const [apiStatus, setApiStatus] = useState<string>("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);
  const [showHowItWorks, setShowHowItWorks] = useState(false);
  const [openSections, setOpenSections] = useState<OpenSections>(() =>
    getDefaultOpenSections(readSavedWorkspace()),
  );

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEYS.request, requestText);
  }, [requestText]);

  useEffect(() => {
    if (!workspace) return;
    window.localStorage.setItem(STORAGE_KEYS.workspace, JSON.stringify(workspace));
  }, [workspace]);

  const briefMarkdown = useMemo(
    () => (workspace ? buildBriefMarkdown(workspace) : ""),
    [workspace],
  );
  const emailMarkdown = useMemo(
    () => (workspace ? buildEmailMarkdown(workspace) : ""),
    [workspace],
  );

  const routingSignals = useMemo(() => getRoutingSignals(workspace), [workspace]);
  const overallStatus = useMemo(() => getOverallStatus(workspace), [workspace]);

  function touchWorkspace() {
    setLastUpdatedAt(Date.now());
  }

  function setWorkspaceWithTouch(nextWorkspace: WorkspaceState | null) {
    setWorkspace(nextWorkspace);
    setOpenSections(getDefaultOpenSections(nextWorkspace));
    touchWorkspace();
  }
  function updateWorkspace(
    updater: (current: WorkspaceState) => WorkspaceState,
  ) {
    setWorkspace((current) => (current ? updater(current) : current));
    touchWorkspace();
  }

  function regenerateWorkspace() {
    if (!requestText.trim()) return;
    setApiStatus("");
    setWorkspaceWithTouch(createWorkspaceFromText(requestText));
  }

  function loadSample() {
    const sample = sampleRequestText();
    setRequestText(sample);
    setApiStatus("");
    setWorkspaceWithTouch(createWorkspaceFromText(sample));
  }

  async function runOpenAiAnalysis() {
    if (!requestText.trim()) {
      return;
    }

    setIsAnalyzing(true);
    setApiStatus("");

    try {
      const draft = await analyzeRequestWithOpenAI(requestText);
      setWorkspaceWithTouch(draft);
      setApiStatus(`Loaded a structured draft from ${OPENAI_MODEL}.`);
    } catch (error) {
      setApiStatus(error instanceof Error ? error.message : "OpenAI analysis failed.");
    } finally {
      setIsAnalyzing(false);
    }
  }

  function updateBasicInfo(
    key: keyof WorkspaceState["basicInfo"],
    value: string,
  ) {
    updateWorkspace((current) => ({
      ...current,
      basicInfo: {
        ...current.basicInfo,
        [key]: value,
      },
    }));
  }

  function updateKnown(
    key: keyof WorkspaceState["known"],
    value: string,
  ) {
    updateWorkspace((current) => ({
      ...current,
      known: {
        ...current.known,
        [key]: value,
      },
    }));
  }

  function updateRecommendation(value: Recommendation) {
    updateWorkspace((current) => ({
      ...current,
      finalRecommendation: value,
    }));
  }

  function updateListField(
    key: "unclear" | "questions" | "reasoning",
    value: string,
  ) {
    updateWorkspace((current) => ({
      ...current,
      [key]: updateLines(value),
    }));
  }

  function updateMeetingNotes(value: string) {
    updateWorkspace((current) => ({
      ...current,
      meetingNotes: value,
    }));
  }

  function setSectionOpen(key: BriefSectionKey, isOpen: boolean) {
    setOpenSections((current) => ({
      ...current,
      [key]: isOpen,
    }));
  }

  function expandAllSections() {
    setOpenSections({
      purpose: true,
      audience: true,
      content: true,
      ownership: true,
      scope: true,
    });
  }

  function collapseAllSections() {
    setOpenSections({
      purpose: false,
      audience: false,
      content: false,
      ownership: false,
      scope: false,
    });
  }

  function revealScopeSection() {
    setSectionOpen("scope", true);
    document
      .getElementById("triage-brief-card")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function handleCopy(kind: "brief" | "email", value: string) {
    await copyText(value);
    setCopyState(kind);
    window.setTimeout(() => setCopyState(null), 1600);
  }

  const purposeState = workspace
    ? getSectionState([
        workspace.basicInfo.siteTitle,
        workspace.basicInfo.proposedUrl,
        workspace.known.purpose,
      ])
    : "Incomplete";
  const audienceState = workspace
    ? getSectionState([workspace.known.audience])
    : "Incomplete";
  const contentState = workspace
    ? getSectionState([
        workspace.known.contentTypes,
        workspace.known.structure,
        workspace.known.features,
      ])
    : "Incomplete";
  const ownershipState = workspace
    ? getSectionState([
        workspace.basicInfo.requester,
        workspace.basicInfo.facultyUnit,
        workspace.known.ownership,
      ])
    : "Incomplete";
  const scopeState =
    workspace && workspace.unclear.length === 0 && workspace.questions.length === 0
      ? "Complete"
      : "Incomplete";

  return (
    <div className="dashboard-shell">
      <TopHero
        showHowItWorks={showHowItWorks}
        onToggleHowItWorks={() => setShowHowItWorks((current) => !current)}
      />

      <div className="dashboard-grid">
        <PasteRequestCard
          requestText={requestText}
          apiStatus={apiStatus}
          isAnalyzing={isAnalyzing}
          onChangeRequest={setRequestText}
          onLoadSample={loadSample}
          onRuleAnalyze={regenerateWorkspace}
          onLlmAnalyze={runOpenAiAnalysis}
        />

        <RequestOverviewCard
          workspace={workspace}
          lastUpdatedAt={lastUpdatedAt}
          overallStatus={overallStatus}
        />

        <RoutingSnapshotCard
          signals={routingSignals}
          onViewDetails={revealScopeSection}
        />

        <QuickActionsCard
          hasWorkspace={Boolean(workspace)}
          briefCopied={copyState === "brief"}
          emailCopied={copyState === "email"}
          onCopyBrief={() => handleCopy("brief", briefMarkdown)}
          onCopyEmail={() => handleCopy("email", emailMarkdown)}
          onLoadSample={loadSample}
        />

        <TriageBriefCard
          workspace={workspace}
          openSections={openSections}
          onExpandAll={expandAllSections}
          onCollapseAll={collapseAllSections}
          onSetSectionOpen={setSectionOpen}
          onUpdateBasicInfo={updateBasicInfo}
          onUpdateKnown={updateKnown}
          onUpdateListField={updateListField}
          purposeState={purposeState}
          audienceState={audienceState}
          contentState={contentState}
          ownershipState={ownershipState}
          scopeState={scopeState}
        />

        <SummaryMetricCard
          title="What is still unclear"
          description="Key gaps or unknowns that need to be resolved before routing."
          count={workspace?.unclear.length ?? 0}
          unit="Open items"
          actionText="View details"
          onAction={revealScopeSection}
          tone="violet"
        />

        <SummaryMetricCard
          title="Questions to clarify"
          description="Questions to ask the requester to fill in the gaps and confirm direction."
          count={workspace?.questions.length ?? 0}
          unit="Questions prepared"
          actionText="View questions"
          onAction={revealScopeSection}
          tone="indigo"
        />

        <MeetingNotesCard
          meetingNotes={workspace?.meetingNotes ?? ""}
          disabled={!workspace}
          onChange={updateMeetingNotes}
        />

        <RecommendationCard
          workspace={workspace}
          onChangeRecommendation={updateRecommendation}
          onChangeReasoning={(value) => updateListField("reasoning", value)}
          onViewCriteria={revealScopeSection}
        />

        <ExportActionCard
          title="Internal brief export"
          description="Export a clean summary for handoff or records."
          buttonLabel={copyState === "brief" ? "Copied" : "Copy brief"}
          secondaryLabel={`${workspace ? workspace.known.purpose : "Generate a draft to preview the export."}`}
          actionTone="accent"
          onAction={() => handleCopy("brief", briefMarkdown)}
          disabled={!workspace}
        />

        <ExportActionCard
          title="Follow-up email"
          description="Send a pre-filled email to the requester."
          buttonLabel={copyState === "email" ? "Copied" : "Copy email"}
          secondaryLabel={`${workspace ? workspace.questions.length : 0} questions prepared`}
          actionTone="neutral"
          onAction={() => handleCopy("email", emailMarkdown)}
          disabled={!workspace}
        />
      </div>
    </div>
  );
}

function TopHero({
  showHowItWorks,
  onToggleHowItWorks,
}: {
  showHowItWorks: boolean;
  onToggleHowItWorks: () => void;
}) {
  return (
    <header className="hero-shell">
      <div className="hero-brand">
        <div className="hero-brand-badge">
          <BadgeIcon kind="document" />
        </div>
        <div>
          <p className="eyebrow">Research site triage</p>
          <h1>Paste in a request. Turn it into a usable triage brief.</h1>
          <p className="hero-copy">
            Paste the initial request, capture missing details, and get a clear summary
            with recommendation and next steps.
          </p>
        </div>
      </div>

      <div className="hero-tools">
        <button className="ghost-button hero-help-button" type="button" onClick={onToggleHowItWorks}>
          <BadgeIcon kind="help" />
          <span>How this works</span>
        </button>
      </div>

      {showHowItWorks ? (
        <div className="hero-callout">
          <p>
            Start with a pasted intake request, then use either the rule-based parser or
            the server-side model pass. Review the draft, tighten the grouped brief
            sections, and copy the final brief or follow-up email when you are ready.
          </p>
        </div>
      ) : null}
    </header>
  );
}

function PasteRequestCard({
  requestText,
  apiStatus,
  isAnalyzing,
  onChangeRequest,
  onLoadSample,
  onRuleAnalyze,
  onLlmAnalyze,
}: {
  requestText: string;
  apiStatus: string;
  isAnalyzing: boolean;
  onChangeRequest: (value: string) => void;
  onLoadSample: () => void;
  onRuleAnalyze: () => void;
  onLlmAnalyze: () => void;
}) {
  return (
    <section className="surface-card paste-card" data-area="paste">
      <div className="card-header-row">
        <div className="card-title-block">
          <IconBadge tone="neutral" icon="document" />
          <div>
            <h2>Paste initial request</h2>
            <p>Paste the raw request text from the intake form or email.</p>
          </div>
        </div>
        <button className="ghost-button compact-action" type="button" onClick={onLoadSample}>
          Load sample
        </button>
      </div>

      <textarea
        className="request-textarea"
        value={requestText}
        onChange={(event) => onChangeRequest(event.target.value)}
        placeholder="Paste request here..."
      />

      <div className="paste-actions">
        <div className="paste-actions-copy">
          <p>
            The rule-based path is quick. The model path is better when the request is
            messy, copied from email, or full of human phrasing.
          </p>
          {apiStatus ? <p className="status-copy">{apiStatus}</p> : null}
        </div>
        <div className="paste-actions-buttons">
          <button
            className="ghost-button compact-action"
            type="button"
            onClick={onRuleAnalyze}
            disabled={!requestText.trim()}
          >
            Generate rule-based draft
          </button>
          <button
            className="primary-button compact-primary"
            type="button"
            onClick={onLlmAnalyze}
            disabled={!requestText.trim() || isAnalyzing}
          >
            {isAnalyzing ? `Analyzing with ${OPENAI_MODEL}...` : `Analyze with ${OPENAI_MODEL}`}
          </button>
        </div>
      </div>
    </section>
  );
}

function RequestOverviewCard({
  workspace,
  lastUpdatedAt,
  overallStatus,
}: {
  workspace: WorkspaceState | null;
  lastUpdatedAt: number | null;
  overallStatus: string;
}) {
  return (
    <section className="surface-card side-card" data-area="overview">
      <div className="card-title-block">
        <IconBadge tone="accent" icon="clipboard" />
        <div>
          <h2>Request overview</h2>
          <p>High-level request details and current session state.</p>
        </div>
      </div>

      <div className="overview-list">
        <div className="overview-item">
          <span>Last updated</span>
          <strong>{formatLastUpdated(lastUpdatedAt)}</strong>
        </div>
        <div className="overview-item">
          <span>Request type</span>
          <StatusChip tone="neutral">Research Website</StatusChip>
        </div>
        <div className="overview-item">
          <span>Overall status</span>
          <StatusChip tone={overallStatus === "Ready to route" ? "success" : "warning"}>
            {overallStatus}
          </StatusChip>
        </div>
        <div className="overview-item">
          <span>Assignee</span>
          <strong>Russ</strong>
        </div>
      </div>

      <div className="overview-summary">
        <p>{workspace?.basicInfo.siteTitle ?? "No request title captured yet."}</p>
        <small>{workspace?.basicInfo.facultyUnit ?? "Waiting for a generated draft."}</small>
      </div>
    </section>
  );
}

function RoutingSnapshotCard({
  signals,
  onViewDetails,
}: {
  signals: RoutingSignal[];
  onViewDetails: () => void;
}) {
  return (
    <section className="surface-card side-card" data-area="routing">
      <div className="card-title-block">
        <IconBadge tone="sun" icon="routing" />
        <div>
          <h2>Routing snapshot</h2>
          <p>High-level indicators based on current information.</p>
        </div>
      </div>

      <ul className="routing-list">
        {signals.map((signal) => (
          <li key={signal.label}>
            <span>{signal.label}</span>
            <SignalMark status={signal.status} />
          </li>
        ))}
      </ul>

      <button className="text-link-button" type="button" onClick={onViewDetails}>
        View details
      </button>
    </section>
  );
}

function QuickActionsCard({
  hasWorkspace,
  briefCopied,
  emailCopied,
  onCopyBrief,
  onCopyEmail,
  onLoadSample,
}: {
  hasWorkspace: boolean;
  briefCopied: boolean;
  emailCopied: boolean;
  onCopyBrief: () => void;
  onCopyEmail: () => void;
  onLoadSample: () => void;
}) {
  return (
    <section className="surface-card side-card" data-area="actions">
      <div className="card-title-block">
        <IconBadge tone="violet" icon="spark" />
        <div>
          <h2>Quick actions</h2>
          <p>Small shortcuts for the current request draft.</p>
        </div>
      </div>

      <div className="quick-action-list">
        <button className="quick-action-button" type="button" onClick={onCopyBrief} disabled={!hasWorkspace}>
          <span>{briefCopied ? "Copied internal brief" : "Copy internal brief"}</span>
          <ArrowIcon />
        </button>
        <button className="quick-action-button" type="button" onClick={onCopyEmail} disabled={!hasWorkspace}>
          <span>{emailCopied ? "Copied follow-up email" : "Copy follow-up email"}</span>
          <ArrowIcon />
        </button>
        <button className="quick-action-button" type="button" onClick={onLoadSample}>
          <span>Load sample request</span>
          <ArrowIcon />
        </button>
      </div>
    </section>
  );
}

function TriageBriefCard({
  workspace,
  openSections,
  onExpandAll,
  onCollapseAll,
  onSetSectionOpen,
  onUpdateBasicInfo,
  onUpdateKnown,
  onUpdateListField,
  purposeState,
  audienceState,
  contentState,
  ownershipState,
  scopeState,
}: {
  workspace: WorkspaceState | null;
  openSections: OpenSections;
  onExpandAll: () => void;
  onCollapseAll: () => void;
  onSetSectionOpen: (key: BriefSectionKey, isOpen: boolean) => void;
  onUpdateBasicInfo: (key: keyof WorkspaceState["basicInfo"], value: string) => void;
  onUpdateKnown: (key: keyof WorkspaceState["known"], value: string) => void;
  onUpdateListField: (key: "unclear" | "questions" | "reasoning", value: string) => void;
  purposeState: "Complete" | "Incomplete";
  audienceState: "Complete" | "Incomplete";
  contentState: "Complete" | "Incomplete";
  ownershipState: "Complete" | "Incomplete";
  scopeState: "Complete" | "Incomplete";
}) {
  return (
    <section className="surface-card brief-card" data-area="brief" id="triage-brief-card">
      <div className="card-header-row">
        <div className="card-title-block">
          <IconBadge tone="blue" icon="brief" />
          <div>
            <h2>Internal triage brief</h2>
            <p>Captured details and missing information.</p>
          </div>
        </div>
        <div className="card-header-actions">
          <button className="ghost-button compact-action" type="button" onClick={onExpandAll}>
            Edit all
          </button>
          <button className="ghost-button compact-action" type="button" onClick={onCollapseAll}>
            Collapse all
          </button>
        </div>
      </div>

      <div className="brief-sections">
        <BriefSection
          index={1}
          title="Purpose & goals"
          icon="purpose"
          state={purposeState}
          isOpen={openSections.purpose}
          onToggle={() => onSetSectionOpen("purpose", !openSections.purpose)}
        >
          {workspace ? (
            <div className="section-fields">
              <Field
                label="Proposed Site Title"
                value={workspace.basicInfo.siteTitle}
                onChange={(value) => onUpdateBasicInfo("siteTitle", value)}
              />
              <Field
                label="Proposed URL"
                value={workspace.basicInfo.proposedUrl}
                onChange={(value) => onUpdateBasicInfo("proposedUrl", value)}
              />
              <LongField
                label="Purpose"
                value={workspace.known.purpose}
                onChange={(value) => onUpdateKnown("purpose", value)}
              />
            </div>
          ) : (
            <SectionPlaceholder />
          )}
        </BriefSection>

        <BriefSection
          index={2}
          title="Audience"
          icon="audience"
          state={audienceState}
          isOpen={openSections.audience}
          onToggle={() => onSetSectionOpen("audience", !openSections.audience)}
        >
          {workspace ? (
            <LongField
              label="Audience"
              value={workspace.known.audience}
              onChange={(value) => onUpdateKnown("audience", value)}
            />
          ) : (
            <SectionPlaceholder />
          )}
        </BriefSection>

        <BriefSection
          index={3}
          title="Content & features"
          icon="content"
          state={contentState}
          isOpen={openSections.content}
          onToggle={() => onSetSectionOpen("content", !openSections.content)}
        >
          {workspace ? (
            <div className="section-fields">
              <LongField
                label="Content Types"
                value={workspace.known.contentTypes}
                onChange={(value) => onUpdateKnown("contentTypes", value)}
              />
              <LongField
                label="Proposed Structure"
                value={workspace.known.structure}
                onChange={(value) => onUpdateKnown("structure", value)}
              />
              <LongField
                label="Special Features"
                value={workspace.known.features}
                onChange={(value) => onUpdateKnown("features", value)}
              />
              <LongField
                label="Privacy or FOIP Considerations"
                value={workspace.known.privacy}
                onChange={(value) => onUpdateKnown("privacy", value)}
              />
            </div>
          ) : (
            <SectionPlaceholder />
          )}
        </BriefSection>

        <BriefSection
          index={4}
          title="Ownership & maintenance"
          icon="ownership"
          state={ownershipState}
          isOpen={openSections.ownership}
          onToggle={() => onSetSectionOpen("ownership", !openSections.ownership)}
        >
          {workspace ? (
            <div className="section-fields">
              <Field
                label="Requester"
                value={workspace.basicInfo.requester}
                onChange={(value) => onUpdateBasicInfo("requester", value)}
              />
              <Field
                label="Faculty / Unit"
                value={workspace.basicInfo.facultyUnit}
                onChange={(value) => onUpdateBasicInfo("facultyUnit", value)}
              />
              <LongField
                label="Ownership / Maintenance"
                value={workspace.known.ownership}
                onChange={(value) => onUpdateKnown("ownership", value)}
              />
            </div>
          ) : (
            <SectionPlaceholder />
          )}
        </BriefSection>

        <BriefSection
          index={5}
          title="Research fit & scope"
          icon="scope"
          state={scopeState}
          isOpen={openSections.scope}
          onToggle={() => onSetSectionOpen("scope", !openSections.scope)}
        >
          {workspace ? (
            <div className="section-fields">
              <div className="snapshot-row">
                <SnapshotPill label="Initial" value={workspace.initialHypothesis} />
                <SnapshotPill label="Final" value={workspace.finalRecommendation} />
              </div>
              <LongField
                label="What is still unclear"
                value={joinLines(workspace.unclear)}
                onChange={(value) => onUpdateListField("unclear", value)}
              />
              <LongField
                label="Questions to clarify"
                value={joinLines(workspace.questions)}
                onChange={(value) => onUpdateListField("questions", value)}
              />
              <LongField
                label="Reasoning"
                value={joinLines(workspace.reasoning)}
                onChange={(value) => onUpdateListField("reasoning", value)}
              />
            </div>
          ) : (
            <SectionPlaceholder />
          )}
        </BriefSection>
      </div>
    </section>
  );
}

function SummaryMetricCard({
  title,
  description,
  count,
  unit,
  actionText,
  onAction,
  tone,
}: {
  title: string;
  description: string;
  count: number;
  unit: string;
  actionText: string;
  onAction: () => void;
  tone: "violet" | "indigo";
}) {
  return (
    <section className="surface-card metric-card" data-area={title.toLowerCase().includes("unclear") ? "unclear" : "questions"}>
      <div className="card-title-block">
        <IconBadge tone={tone} icon={tone === "violet" ? "question" : "message"} />
        <div>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
      </div>
      <div className="metric-value">{count}</div>
      <div className="metric-unit">{unit}</div>
      <button className="text-link-button" type="button" onClick={onAction}>
        {actionText}
      </button>
    </section>
  );
}

function MeetingNotesCard({
  meetingNotes,
  disabled,
  onChange,
}: {
  meetingNotes: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <section className="surface-card compact-card" data-area="notes">
      <div className="card-title-block">
        <IconBadge tone="green" icon="notes" />
        <div>
          <h2>Meeting notes</h2>
          <p>Capture discussion notes, decisions, and commitments.</p>
        </div>
      </div>
      <textarea
        className="compact-textarea"
        value={meetingNotes}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Add notes from your conversation..."
        disabled={disabled}
      />
    </section>
  );
}

function RecommendationCard({
  workspace,
  onChangeRecommendation,
  onChangeReasoning,
  onViewCriteria,
}: {
  workspace: WorkspaceState | null;
  onChangeRecommendation: (value: Recommendation) => void;
  onChangeReasoning: (value: string) => void;
  onViewCriteria: () => void;
}) {
  return (
    <section className="surface-card compact-card" data-area="recommendation">
      <div className="card-title-block">
        <IconBadge tone="teal" icon="recommend" />
        <div>
          <h2>Recommendation</h2>
          <p>Based on the information gathered, where should this request go?</p>
        </div>
      </div>
      <label className="field subtle-field">
        <span>Select recommendation</span>
        <select
          value={workspace?.finalRecommendation ?? "More clarification needed"}
          onChange={(event) => onChangeRecommendation(event.target.value as Recommendation)}
          disabled={!workspace}
        >
          {recommendations.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>
      <label className="field subtle-field">
        <span>Rationale</span>
        <textarea
          className="compact-textarea compact-rationale"
          value={workspace ? joinLines(workspace.reasoning) : ""}
          onChange={(event) => onChangeReasoning(event.target.value)}
          placeholder="Rationale will appear here once a recommendation is selected."
          disabled={!workspace}
        />
      </label>
      <button className="text-link-button" type="button" onClick={onViewCriteria}>
        View routing criteria
      </button>
    </section>
  );
}

function ExportActionCard({
  title,
  description,
  buttonLabel,
  secondaryLabel,
  actionTone,
  onAction,
  disabled,
}: {
  title: string;
  description: string;
  buttonLabel: string;
  secondaryLabel: string;
  actionTone: "accent" | "neutral";
  onAction: () => void;
  disabled: boolean;
}) {
  return (
    <section className="surface-card export-card" data-area={title.toLowerCase().includes("email") ? "email" : "export"}>
      <div className="card-title-block">
        <IconBadge tone={title.toLowerCase().includes("email") ? "blue" : "accent"} icon={title.toLowerCase().includes("email") ? "mail" : "export"} />
        <div>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
      </div>
      <p className="export-support">{secondaryLabel}</p>
      <div className="export-actions">
        <button
          className={actionTone === "accent" ? "primary-button compact-primary full-button" : "ghost-button compact-action full-button"}
          type="button"
          onClick={onAction}
          disabled={disabled}
        >
          {buttonLabel}
        </button>
      </div>
    </section>
  );
}

function BriefSection({
  index,
  title,
  icon,
  state,
  isOpen,
  onToggle,
  children,
}: {
  index: number;
  title: string;
  icon: IconKind;
  state: "Complete" | "Incomplete";
  isOpen: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <section className={`brief-section ${isOpen ? "brief-section-open" : ""}`}>
      <button className="brief-section-header" type="button" onClick={onToggle}>
        <div className="brief-section-heading">
          <IconBadge tone={state === "Complete" ? "green" : "sun"} icon={icon} compact />
          <span className="brief-index">{index}.</span>
          <span className="brief-title">{title}</span>
        </div>
        <div className="brief-section-meta">
          <StatusChip tone={state === "Complete" ? "success" : "warning"}>{state}</StatusChip>
          <ChevronIcon open={isOpen} />
        </div>
      </button>
      {isOpen ? <div className="brief-section-body">{children}</div> : null}
    </section>
  );
}

function SectionPlaceholder() {
  return <p className="section-placeholder">Generate a draft to populate this section.</p>;
}

function SnapshotPill({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="snapshot-pill">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function LongField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <textarea
        className="section-textarea"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function StatusChip({
  tone,
  children,
}: {
  tone: "neutral" | "warning" | "success";
  children: ReactNode;
}) {
  return <span className={`status-chip status-chip-${tone}`}>{children}</span>;
}

function SignalMark({ status }: { status: RoutingSignalStatus }) {
  if (status === "complete") {
    return (
      <span className="signal-mark signal-complete">
        <CheckMarkIcon />
      </span>
    );
  }

  if (status === "warning") {
    return (
      <span className="signal-mark signal-warning">
        <MinusMarkIcon />
      </span>
    );
  }

  return (
    <span className="signal-mark signal-neutral">
      <CircleMarkIcon />
    </span>
  );
}

type IconKind =
  | "document"
  | "help"
  | "clipboard"
  | "routing"
  | "spark"
  | "brief"
  | "question"
  | "message"
  | "notes"
  | "recommend"
  | "mail"
  | "export"
  | "purpose"
  | "audience"
  | "content"
  | "ownership"
  | "scope";

function IconBadge({
  tone,
  icon,
  compact = false,
}: {
  tone: "accent" | "neutral" | "sun" | "violet" | "indigo" | "green" | "teal" | "blue";
  icon: IconKind;
  compact?: boolean;
}) {
  return (
    <span className={`icon-badge icon-badge-${tone} ${compact ? "icon-badge-compact" : ""}`}>
      <BadgeIcon kind={icon} />
    </span>
  );
}

function BadgeIcon({ kind }: { kind: IconKind }) {
  const common = { width: 18, height: 18, viewBox: "0 0 20 20", fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

  switch (kind) {
    case "document":
    case "brief":
    case "export":
      return (
        <svg {...common}>
          <path d="M6 2.5h5l4 4V17a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1Z" />
          <path d="M11 2.5V7h4.5" />
          <path d="M7.5 10.5h5" />
          <path d="M7.5 13.5h5" />
        </svg>
      );
    case "help":
      return (
        <svg {...common}>
          <circle cx="10" cy="10" r="7.2" />
          <path d="M7.9 7.6A2.3 2.3 0 0 1 10 6.5c1.3 0 2.3.8 2.3 1.9 0 1.6-2.3 1.9-2.3 3.7" />
          <path d="M10 14.7h.01" />
        </svg>
      );
    case "clipboard":
      return (
        <svg {...common}>
          <rect x="5" y="4" width="10" height="13" rx="1.8" />
          <path d="M8 4.5h4a1 1 0 0 0 1-1v-.1A1.4 1.4 0 0 0 11.6 2h-3.2A1.4 1.4 0 0 0 7 3.4v.1a1 1 0 0 0 1 1Z" />
          <path d="M7.5 8.5h5" />
          <path d="M7.5 11.5h5" />
        </svg>
      );
    case "routing":
    case "scope":
      return (
        <svg {...common}>
          <path d="M4 5h5v5H4z" />
          <path d="M11 10h5v5h-5z" />
          <path d="M9 7.5h3a2 2 0 0 1 2 2v.5" />
        </svg>
      );
    case "spark":
      return (
        <svg {...common}>
          <path d="m10 2 1.5 4.3L16 8l-4.5 1.7L10 14l-1.5-4.3L4 8l4.5-1.7Z" />
        </svg>
      );
    case "question":
      return (
        <svg {...common}>
          <circle cx="10" cy="10" r="7.2" />
          <path d="M8.1 8.2a2 2 0 1 1 3.7 1c-.6.8-1.5 1-1.7 2.1" />
          <path d="M10 14.4h.01" />
        </svg>
      );
    case "message":
      return (
        <svg {...common}>
          <path d="M4.5 5.2h11a1.3 1.3 0 0 1 1.3 1.3v6a1.3 1.3 0 0 1-1.3 1.3H9l-3.8 2.5v-2.5H4.5a1.3 1.3 0 0 1-1.3-1.3v-6a1.3 1.3 0 0 1 1.3-1.3Z" />
        </svg>
      );
    case "notes":
      return (
        <svg {...common}>
          <path d="M5.5 3.5h9v13h-9z" />
          <path d="M7.8 7h4.5" />
          <path d="M7.8 10h4.5" />
          <path d="M7.8 13h3.2" />
        </svg>
      );
    case "recommend":
      return (
        <svg {...common}>
          <path d="M6 9.5 9 13l5-6.5" />
          <circle cx="10" cy="10" r="7.2" />
        </svg>
      );
    case "mail":
      return (
        <svg {...common}>
          <rect x="3.5" y="5.5" width="13" height="9" rx="1.4" />
          <path d="m4.5 7 5.5 4 5.5-4" />
        </svg>
      );
    case "purpose":
      return (
        <svg {...common}>
          <circle cx="10" cy="10" r="6.8" />
          <path d="M10 6.5v3.8l2.5 1.4" />
        </svg>
      );
    case "audience":
      return (
        <svg {...common}>
          <circle cx="10" cy="6.4" r="2.3" />
          <path d="M5.2 15.5a4.8 4.8 0 0 1 9.6 0" />
        </svg>
      );
    case "content":
      return (
        <svg {...common}>
          <rect x="4" y="4" width="12" height="10" rx="1.4" />
          <path d="M6.6 11.3 8.8 9l2.2 1.8 2.4-2.5" />
        </svg>
      );
    case "ownership":
      return (
        <svg {...common}>
          <path d="M6.2 17v-4.4A3.8 3.8 0 0 1 10 8.8a3.8 3.8 0 0 1 3.8 3.8V17" />
          <path d="M7.6 8.2V6.9A2.4 2.4 0 0 1 10 4.5a2.4 2.4 0 0 1 2.4 2.4v1.3" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <rect x="4.5" y="4.5" width="11" height="11" rx="2" />
        </svg>
      );
  }
}

function ArrowIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 7h8" />
      <path d="m8.5 3.5 3.5 3.5-3.5 3.5" />
    </svg>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      className={`chevron-icon ${open ? "chevron-open" : ""}`}
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m4 6 4 4 4-4" />
    </svg>
  );
}

function CheckMarkIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="m2.2 6.2 2.1 2.1 5-5" />
    </svg>
  );
}

function MinusMarkIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2.3 6h7.4" />
    </svg>
  );
}

function CircleMarkIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="6" cy="6" r="4.3" />
    </svg>
  );
}
