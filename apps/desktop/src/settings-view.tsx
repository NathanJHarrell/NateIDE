import { useEffect, useState } from "react";

const THEMES = [
  { id: "default", name: "Default", bg: "#0f1115", accent: "#58a6ff" },
  { id: "midnight", name: "Midnight", bg: "#0c0e1a", accent: "#6b78b0" },
  { id: "slate", name: "Slate", bg: "#151518", accent: "#8888a0" },
  { id: "warm", name: "Warm", bg: "#171210", accent: "#a08868" },
  { id: "aurora", name: "Aurora", bg: "#06060e", accent: "#34d399" },
  { id: "liquid", name: "Liquid", bg: "#080510", accent: "#a855f7" },
  { id: "nebula", name: "Nebula", bg: "#000810", accent: "#c084fc" },
  { id: "particles", name: "Particles", bg: "#06080d", accent: "#38bdf8" },
  { id: "terminal", name: "Terminal", bg: "#020804", accent: "#33ff66" },
  { id: "ember", name: "Ember", bg: "#0f0a08", accent: "#f97316" },
  { id: "glass", name: "Glass", bg: "#0a0a14", accent: "#818cf8" },
  { id: "light-clean", name: "Light", bg: "#f8f8fa", accent: "#5060a0" },
  { id: "light-warm", name: "Light Warm", bg: "#faf7f4", accent: "#8a7050" },
  { id: "light-blue", name: "Light Blue", bg: "#f4f7fa", accent: "#4868b0" },
];

type AiProvider = "anthropic" | "openai" | "google" | "openrouter";

export type AgentRoleConfig = {
  id: string;
  name: string;
  provider: AiProvider;
  model: string;
  systemPrompt: string;
  triggerKeywords: string[];
  isQuickReply?: boolean;
  fallbackProviders?: Array<{ provider: AiProvider; model: string }>;
};

export type SoulDocument = {
  agentId: string;
  identity: string;
  values: string[];
  communicationStyle: string;
  disagreementBehavior: string;
  collaborationGuidelines: string;
  escalationRules: string;
  learnedPreferences: string[];
};

export type IdeSettings = {
  apiKeys: {
    anthropic: string;
    openrouter: string;
    google: string;
    openai: string;
  };
  agentRoles: AgentRoleConfig[];
  soulDocuments: Record<string, SoulDocument>;
  conversationLoop: {
    maxRounds: number;
    enabled: boolean;
  };
  appearance: {
    density: "comfortable" | "compact";
    showBoardHints: boolean;
    theme: string;
  };
  terminal: {
    fontSize: number;
    shell: string;
  };
};

type SettingsViewProps = {
  onThemePreview?: (themeId: string) => void;
  onSave: (settings: IdeSettings) => Promise<void>;
  settings: IdeSettings;
};

function SoulDocumentEditor({
  agentId,
  soul,
  onChange,
}: {
  agentId: string;
  soul: SoulDocument;
  onChange: (soul: SoulDocument) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <fieldset className="agent-role-fieldset soul-fieldset">
      <legend>
        <button type="button" className="soul-toggle" onClick={() => setExpanded(!expanded)}>
          {expanded ? "\u25BC" : "\u25B6"} {agentId}
        </button>
      </legend>
      {expanded && (
        <div className="soul-fields">
          <label>
            <span>Identity</span>
            <textarea
              className="text-input agent-role-prompt"
              rows={4}
              value={soul.identity}
              onChange={(e) => onChange({ ...soul, identity: e.target.value })}
            />
          </label>
          <label>
            <span>Values (one per line)</span>
            <textarea
              className="text-input agent-role-prompt"
              rows={3}
              value={soul.values.join("\n")}
              onChange={(e) =>
                onChange({ ...soul, values: e.target.value.split("\n").filter(Boolean) })
              }
            />
          </label>
          <label>
            <span>Communication Style</span>
            <textarea
              className="text-input agent-role-prompt"
              rows={3}
              value={soul.communicationStyle}
              onChange={(e) => onChange({ ...soul, communicationStyle: e.target.value })}
            />
          </label>
          <label>
            <span>Disagreement Behavior</span>
            <textarea
              className="text-input agent-role-prompt"
              rows={3}
              value={soul.disagreementBehavior}
              onChange={(e) => onChange({ ...soul, disagreementBehavior: e.target.value })}
            />
          </label>
          <label>
            <span>Collaboration Guidelines</span>
            <textarea
              className="text-input agent-role-prompt"
              rows={3}
              value={soul.collaborationGuidelines}
              onChange={(e) => onChange({ ...soul, collaborationGuidelines: e.target.value })}
            />
          </label>
          <label>
            <span>Escalation Rules</span>
            <textarea
              className="text-input agent-role-prompt"
              rows={2}
              value={soul.escalationRules}
              onChange={(e) => onChange({ ...soul, escalationRules: e.target.value })}
            />
          </label>
          {soul.learnedPreferences.length > 0 && (
            <div className="soul-learned">
              <span>Learned Preferences ({soul.learnedPreferences.length})</span>
              <ul>
                {soul.learnedPreferences.map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </fieldset>
  );
}

type SettingsTab = "general" | "agent-roles" | "api-keys";

const SETTINGS_TABS: { id: SettingsTab; label: string }[] = [
  { id: "general", label: "General" },
  { id: "agent-roles", label: "Agent Roles" },
  { id: "api-keys", label: "API Keys" },
];

export function SettingsView(props: SettingsViewProps) {
  const { onSave, onThemePreview, settings } = props;
  const [draft, setDraft] = useState(settings);
  const [isSaving, setIsSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<SettingsTab>("general");

  useEffect(() => {
    setDraft(settings);
  }, [settings]);

  return (
    <div className="settings-page">
      <article className="settings-surface">
        <header className="settings-header">
          <div>
            <span className="eyebrow">workspace and agent configuration</span>
            <h2>Settings</h2>
          </div>
          <button
            className="action-button"
            type="button"
            disabled={isSaving}
            onClick={async () => {
              setIsSaving(true);

              try {
                await onSave(draft);
              } finally {
                setIsSaving(false);
              }
            }}
          >
            {isSaving ? "Saving..." : "Save settings"}
          </button>
        </header>

        <nav className="settings-tabs">
          {SETTINGS_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`settings-tab ${activeTab === tab.id ? "settings-tab-active" : ""}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </nav>

        {activeTab === "api-keys" && (
        <section className="settings-group">
          <h3>Agent API Keys</h3>
          <div className="settings-grid">
            <label>
              <span>Anthropic / Claude</span>
              <input
                className="text-input"
                type="password"
                value={draft.apiKeys.anthropic}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    apiKeys: { ...current.apiKeys, anthropic: event.target.value },
                  }))
                }
              />
            </label>
            <label>
              <span>OpenAI / Codex</span>
              <input
                className="text-input"
                type="password"
                value={draft.apiKeys.openai}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    apiKeys: { ...current.apiKeys, openai: event.target.value },
                  }))
                }
              />
            </label>
            <label>
              <span>Google / Gemini</span>
              <input
                className="text-input"
                type="password"
                value={draft.apiKeys.google}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    apiKeys: { ...current.apiKeys, google: event.target.value },
                  }))
                }
              />
            </label>
            <label>
              <span>OpenRouter / Kimi</span>
              <input
                className="text-input"
                type="password"
                value={draft.apiKeys.openrouter}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    apiKeys: { ...current.apiKeys, openrouter: event.target.value },
                  }))
                }
              />
            </label>
          </div>
        </section>
        )}

        {activeTab === "agent-roles" && (<>
        <section className="settings-group">
          <h3>Agent Roles</h3>
          <p className="settings-hint">Configure agent roles, their providers, models, prompts, and trigger keywords.</p>
          <div className="agent-roles-list">
            {draft.agentRoles.map((role, index) => (
              <fieldset key={role.id} className="agent-role-fieldset">
                <legend>
                  {role.name || role.id}
                  {!role.isQuickReply && (
                    <button
                      type="button"
                      className="agent-role-remove"
                      onClick={() =>
                        setDraft((current) => ({
                          ...current,
                          agentRoles: current.agentRoles.filter((_, i) => i !== index),
                        }))
                      }
                    >
                      &times;
                    </button>
                  )}
                </legend>
                <div className="agent-role-row">
                  <label>
                    <span>Name</span>
                    <input
                      className="text-input"
                      value={role.name}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          agentRoles: current.agentRoles.map((r, i) =>
                            i === index ? { ...r, name: event.target.value } : r,
                          ),
                        }))
                      }
                    />
                  </label>
                  <label>
                    <span>Provider</span>
                    <select
                      className="text-input"
                      value={role.provider}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          agentRoles: current.agentRoles.map((r, i) =>
                            i === index ? { ...r, provider: event.target.value as AiProvider } : r,
                          ),
                        }))
                      }
                    >
                      <option value="anthropic">Anthropic</option>
                      <option value="openai">OpenAI</option>
                      <option value="google">Google</option>
                      <option value="openrouter">OpenRouter</option>
                    </select>
                  </label>
                  <label>
                    <span>Model</span>
                    <input
                      className="text-input"
                      value={role.model}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          agentRoles: current.agentRoles.map((r, i) =>
                            i === index ? { ...r, model: event.target.value } : r,
                          ),
                        }))
                      }
                    />
                  </label>
                </div>
                <label>
                  <span>System Prompt</span>
                  <textarea
                    className="text-input agent-role-prompt"
                    rows={3}
                    value={role.systemPrompt}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        agentRoles: current.agentRoles.map((r, i) =>
                          i === index ? { ...r, systemPrompt: event.target.value } : r,
                        ),
                      }))
                    }
                  />
                </label>
                <label>
                  <span>Trigger Keywords <span className="settings-hint-inline">(comma-separated)</span></span>
                  <input
                    className="text-input"
                    value={role.triggerKeywords.join(", ")}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        agentRoles: current.agentRoles.map((r, i) =>
                          i === index
                            ? { ...r, triggerKeywords: event.target.value.split(",").map((k) => k.trim()).filter(Boolean) }
                            : r,
                        ),
                      }))
                    }
                  />
                </label>
              </fieldset>
            ))}
            <button
              type="button"
              className="agent-role-add"
              onClick={() =>
                setDraft((current) => ({
                  ...current,
                  agentRoles: [
                    ...current.agentRoles,
                    {
                      id: `custom-${Date.now()}`,
                      name: "New Role",
                      provider: "openrouter" as AiProvider,
                      model: "",
                      systemPrompt: "",
                      triggerKeywords: [],
                    },
                  ],
                }))
              }
            >
              + Add Role
            </button>
          </div>
        </section>

        <section className="settings-group">
          <h3>Agent Souls</h3>
          <p className="settings-hint">
            Behavioral guidelines that shape each agent's personality, communication style, and collaboration behavior.
            Per-project overrides can be placed in <code>.nateide/souls/</code> files.
          </p>
          <div className="agent-souls-list">
            {Object.entries(draft.soulDocuments ?? {}).map(([agentId, soul]) => (
              <SoulDocumentEditor
                key={agentId}
                agentId={agentId}
                soul={soul}
                onChange={(updated) =>
                  setDraft((current) => ({
                    ...current,
                    soulDocuments: {
                      ...current.soulDocuments,
                      [agentId]: updated,
                    },
                  }))
                }
              />
            ))}
          </div>
        </section>
        </>)}

        {activeTab === "general" && (<>
        <section className="settings-group">
          <h3>Conversation Loop</h3>
          <div className="settings-grid">
            <label className="settings-checkbox">
              <input
                checked={draft.conversationLoop?.enabled ?? true}
                type="checkbox"
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    conversationLoop: {
                      ...current.conversationLoop,
                      enabled: event.target.checked,
                    },
                  }))
                }
              />
              <span>Enable multi-round agent conversations</span>
            </label>
            <label>
              <span>Max Rounds</span>
              <input
                className="text-input"
                type="number"
                min={1}
                max={20}
                value={draft.conversationLoop?.maxRounds ?? 10}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    conversationLoop: {
                      ...current.conversationLoop,
                      maxRounds: Number(event.target.value || 10),
                    },
                  }))
                }
              />
            </label>
          </div>
        </section>

        <section className="settings-group">
          <h3>Project Memory</h3>
          <p className="settings-hint">
            Per-project persistent knowledge extracted from agent conversations.
          </p>
          <button
            type="button"
            className="action-button"
            style={{ background: "var(--color-error)", color: "#fff" }}
            onClick={() => {
              if (confirm("Clear all project memory? This cannot be undone.")) {
                // Memory clearing is handled via Convex soul mutations
                // when the soul system is fully wired. For now, no-op.
              }
            }}
          >
            Clear Project Memory
          </button>
        </section>

        <section className="settings-group">
          <h3>Appearance</h3>
          <div className="settings-grid">
            <div className="theme-picker">
              {THEMES.map((t) => (
                <button
                  key={t.id}
                  className={`theme-swatch ${draft.appearance.theme === t.id ? "theme-swatch-active" : ""}`}
                  type="button"
                  onClick={() => {
                    setDraft((d) => ({
                      ...d,
                      appearance: { ...d.appearance, theme: t.id },
                    }));
                    onThemePreview?.(t.id);
                  }}
                >
                  <div className="theme-swatch-preview" style={{ background: t.bg }}>
                    <div className="theme-swatch-accent" style={{ background: t.accent }} />
                  </div>
                  <span className="theme-swatch-name">{t.name}</span>
                </button>
              ))}
            </div>
            <label>
              <span>Density</span>
              <select
                className="text-input"
                value={draft.appearance.density}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    appearance: {
                      ...current.appearance,
                      density: event.target.value as "comfortable" | "compact",
                    },
                  }))
                }
              >
                <option value="comfortable">Comfortable</option>
                <option value="compact">Compact</option>
              </select>
            </label>
            <label className="settings-checkbox">
              <input
                checked={draft.appearance.showBoardHints}
                type="checkbox"
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    appearance: {
                      ...current.appearance,
                      showBoardHints: event.target.checked,
                    },
                  }))
                }
              />
              <span>Show kanban helper hints and workspace suggestions</span>
            </label>
          </div>
        </section>

        <section className="settings-group">
          <h3>Terminal Defaults</h3>
          <div className="settings-grid">
            <label>
              <span>Shell</span>
              <input
                className="text-input"
                value={draft.terminal.shell}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    terminal: { ...current.terminal, shell: event.target.value },
                  }))
                }
              />
            </label>
            <label>
              <span>Font size</span>
              <input
                className="text-input"
                max={22}
                min={11}
                type="number"
                value={draft.terminal.fontSize}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    terminal: {
                      ...current.terminal,
                      fontSize: Number(event.target.value || 14),
                    },
                  }))
                }
              />
            </label>
          </div>
        </section>
        </>)}
      </article>
    </div>
  );
}
