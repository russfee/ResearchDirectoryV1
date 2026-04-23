import { useEffect, useMemo, useState } from "react";
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

function readSavedWorkspace(): WorkspaceState | null {
  const raw = window.localStorage.getItem(STORAGE_KEYS.workspace);
  if (!raw) return null;

  try {
    return JSON.parse(raw) as WorkspaceState;
  } catch {
    return null;
  }
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

  function regenerateWorkspace() {
    if (!requestText.trim()) return;
    setApiStatus("");
    setWorkspace(createWorkspaceFromText(requestText));
  }

  function loadSample() {
    const sample = sampleRequestText();
    setRequestText(sample);
    setApiStatus("");
    setWorkspace(createWorkspaceFromText(sample));
  }

  async function runOpenAiAnalysis() {
    if (!requestText.trim()) {
      return;
    }

    setIsAnalyzing(true);
    setApiStatus("");

    try {
      const draft = await analyzeRequestWithOpenAI(requestText);
      setWorkspace(draft);
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
    setWorkspace((current) =>
      current
        ? {
            ...current,
            basicInfo: {
              ...current.basicInfo,
              [key]: value,
            },
          }
        : current,
    );
  }

  function updateKnown(
    key: keyof WorkspaceState["known"],
    value: string,
  ) {
    setWorkspace((current) =>
      current
        ? {
            ...current,
            known: {
              ...current.known,
              [key]: value,
            },
          }
        : current,
    );
  }

  function updateRecommendation(value: Recommendation) {
    setWorkspace((current) =>
      current
        ? {
            ...current,
            finalRecommendation: value,
          }
        : current,
    );
  }

  async function handleCopy(kind: "brief" | "email", value: string) {
    await copyText(value);
    setCopyState(kind);
    window.setTimeout(() => setCopyState(null), 1600);
  }

  return (
    <div className="app-shell">
      <div className="page-glow page-glow-left" />
      <div className="page-glow page-glow-right" />

      <header className="hero">
        <p className="eyebrow">Research website request triage</p>
        <h1>Paste in a request. Turn it into a usable triage brief.</h1>
        <p className="hero-copy">
          This MVP is built for one request at a time. It helps you extract what the
          form already tells you, isolate the real routing gaps, draft the follow-up
          email, and carry the recommendation through to meeting notes.
        </p>
      </header>

      <main className="layout">
        <section className="panel input-panel">
          <div className="panel-header">
            <div>
              <h2>Incoming request</h2>
              <p>Paste the original form text or notes here, then choose rule-based or model-assisted analysis.</p>
            </div>
            <button className="ghost-button" onClick={loadSample} type="button">
              Load sample
            </button>
          </div>

          <div className="settings-block">
            <h2>Server-side model path</h2>
            <p className="helper-copy">
              `Analyze with ${OPENAI_MODEL}` now calls your own `/api/analyze` endpoint. The
              browser never sees the OpenAI key.
            </p>
            <p className="helper-copy">
              Local testing: set `OPENAI_API_KEY` in your shell before `npm run dev:vercel`, or
              put it in an untracked `.env.local` file. Deployment: add the same key in Vercel
              project environment variables.
            </p>
          </div>

          <textarea
            className="big-textarea"
            value={requestText}
            onChange={(event) => setRequestText(event.target.value)}
            placeholder="Paste the full website request text here..."
          />

          <div className="button-row">
            <button
              className="primary-button"
              type="button"
              onClick={regenerateWorkspace}
              disabled={!requestText.trim()}
            >
              Generate rule-based draft
            </button>
            <button
              className="secondary-button"
              type="button"
              onClick={runOpenAiAnalysis}
              disabled={!requestText.trim() || isAnalyzing}
            >
              {isAnalyzing ? `Analyzing with ${OPENAI_MODEL}...` : `Analyze with ${OPENAI_MODEL}`}
            </button>
          </div>
          <div className="button-row button-row-meta">
            <p className="helper-copy">
              Both paths stay editable. The model path is better for messy human input.
            </p>
            {apiStatus ? <p className="helper-copy status-copy">{apiStatus}</p> : null}
          </div>
        </section>

        <section className="workspace">
          {!workspace ? (
            <div className="panel empty-state">
              <h2>No triage draft yet</h2>
              <p>
                Generate a draft to get the working brief, follow-up questions, email,
                and recommendation panel.
              </p>
            </div>
          ) : (
            <>
              <section className="panel snapshot-panel">
                <div className="panel-header">
                  <div>
                    <h2>Routing snapshot</h2>
                    <p>Use this as the first-pass read before you tune the details.</p>
                  </div>
                  <div className="pill-row">
                    <span className="pill">Initial: {workspace.initialHypothesis}</span>
                    <span className="pill accent">
                      Final: {workspace.finalRecommendation}
                    </span>
                  </div>
                </div>
                <ul className="signal-list">
                  {workspace.reasoning.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </section>

              <section className="panel grid-panel">
                <div className="panel-header">
                  <div>
                    <h2>Internal triage brief</h2>
                    <p>Everything here can be tightened before you export it.</p>
                  </div>
                </div>

                <div className="grid two-up">
                  <Field
                    label="Requester"
                    value={workspace.basicInfo.requester}
                    onChange={(value) => updateBasicInfo("requester", value)}
                  />
                  <Field
                    label="Faculty/Unit"
                    value={workspace.basicInfo.facultyUnit}
                    onChange={(value) => updateBasicInfo("facultyUnit", value)}
                  />
                  <Field
                    label="Proposed Site Title"
                    value={workspace.basicInfo.siteTitle}
                    onChange={(value) => updateBasicInfo("siteTitle", value)}
                  />
                  <Field
                    label="Proposed URL"
                    value={workspace.basicInfo.proposedUrl}
                    onChange={(value) => updateBasicInfo("proposedUrl", value)}
                  />
                </div>

                <div className="grid one-up">
                  <LongField
                    label="Purpose"
                    value={workspace.known.purpose}
                    onChange={(value) => updateKnown("purpose", value)}
                  />
                  <LongField
                    label="Audience"
                    value={workspace.known.audience}
                    onChange={(value) => updateKnown("audience", value)}
                  />
                  <LongField
                    label="Content Types"
                    value={workspace.known.contentTypes}
                    onChange={(value) => updateKnown("contentTypes", value)}
                  />
                  <LongField
                    label="Ownership/Maintenance"
                    value={workspace.known.ownership}
                    onChange={(value) => updateKnown("ownership", value)}
                  />
                  <LongField
                    label="Proposed Structure"
                    value={workspace.known.structure}
                    onChange={(value) => updateKnown("structure", value)}
                  />
                  <LongField
                    label="Special Features"
                    value={workspace.known.features}
                    onChange={(value) => updateKnown("features", value)}
                  />
                  <LongField
                    label="Privacy or FOIP Considerations"
                    value={workspace.known.privacy}
                    onChange={(value) => updateKnown("privacy", value)}
                  />
                </div>
              </section>

              <section className="grid two-panels">
                <section className="panel">
                  <h2>What is still unclear</h2>
                  <p className="section-copy">
                    One line per item. These become the open issues in the brief.
                  </p>
                  <textarea
                    className="list-textarea"
                    value={joinLines(workspace.unclear)}
                    onChange={(event) =>
                      setWorkspace((current) =>
                        current
                          ? { ...current, unclear: updateLines(event.target.value) }
                          : current,
                      )
                    }
                  />
                </section>

                <section className="panel">
                  <h2>Questions to clarify</h2>
                  <p className="section-copy">
                    One question per line. Keep them tied to routing, fit, scope, or governance.
                  </p>
                  <textarea
                    className="list-textarea"
                    value={joinLines(workspace.questions)}
                    onChange={(event) =>
                      setWorkspace((current) =>
                        current
                          ? { ...current, questions: updateLines(event.target.value) }
                          : current,
                      )
                    }
                  />
                </section>
              </section>

              <section className="grid two-panels">
                <section className="panel">
                  <h2>Meeting notes</h2>
                  <p className="section-copy">
                    Add notes here after the conversation. These drop straight into the triage brief.
                  </p>
                  <textarea
                    className="list-textarea"
                    value={workspace.meetingNotes}
                    onChange={(event) =>
                      setWorkspace((current) =>
                        current
                          ? { ...current, meetingNotes: event.target.value }
                          : current,
                      )
                    }
                  />
                </section>

                <section className="panel">
                  <h2>Recommendation</h2>
                  <p className="section-copy">
                    Start from the generated hypothesis, then adjust after the meeting.
                  </p>
                  <label className="field">
                    <span>Final recommendation</span>
                    <select
                      value={workspace.finalRecommendation}
                      onChange={(event) =>
                        updateRecommendation(event.target.value as Recommendation)
                      }
                    >
                      {recommendations.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span>Reasoning</span>
                    <textarea
                      className="list-textarea compact"
                      value={joinLines(workspace.reasoning)}
                      onChange={(event) =>
                        setWorkspace((current) =>
                          current
                            ? { ...current, reasoning: updateLines(event.target.value) }
                            : current,
                        )
                      }
                    />
                  </label>
                </section>
              </section>

              <section className="grid two-panels">
                <section className="panel export-panel">
                  <div className="panel-header">
                    <div>
                      <h2>Internal brief export</h2>
                      <p>Markdown ready to paste into your notes or a doc.</p>
                    </div>
                    <button
                      className="ghost-button"
                      type="button"
                      onClick={() => handleCopy("brief", briefMarkdown)}
                    >
                      {copyState === "brief" ? "Copied" : "Copy markdown"}
                    </button>
                  </div>
                  <textarea className="export-textarea" readOnly value={briefMarkdown} />
                </section>

                <section className="panel export-panel">
                  <div className="panel-header">
                    <div>
                      <h2>Follow-up email</h2>
                      <p>Drafted in the routing-first tone from your process doc.</p>
                    </div>
                    <button
                      className="ghost-button"
                      type="button"
                      onClick={() => handleCopy("email", emailMarkdown)}
                    >
                      {copyState === "email" ? "Copied" : "Copy markdown"}
                    </button>
                  </div>
                  <textarea className="export-textarea" readOnly value={emailMarkdown} />
                </section>
              </section>
            </>
          )}
        </section>
      </main>
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
        className="compact"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}
