import { useState } from "react";
import type { WorkspaceCandidate } from "@nateide/protocol";

type ProjectLauncherProps = {
  onClose: () => void;
  onCreateProject: (path: string) => Promise<void>;
  onOpenProject: (path: string) => Promise<void>;
  open: boolean;
  workspaceCandidates: WorkspaceCandidate[];
};

function joinPath(parent: string, name: string): string {
  if (parent.endsWith("/") || parent.endsWith("\\")) {
    return `${parent}${name}`;
  }

  const separator = /^[a-zA-Z]:\\/.test(parent) || parent.includes("\\") ? "\\" : "/";
  return `${parent}${separator}${name}`;
}

export function ProjectLauncher(props: ProjectLauncherProps) {
  const { onClose, onCreateProject, onOpenProject, open, workspaceCandidates } = props;
  const [mode, setMode] = useState<"existing" | "create">("existing");
  const [existingPath, setExistingPath] = useState("");
  const [createParent, setCreateParent] = useState("~/projects");
  const [createName, setCreateName] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const recentCandidates = workspaceCandidates.slice(0, 8);
  const createPreviewPath =
    createParent.trim() && createName.trim()
      ? joinPath(createParent.trim(), createName.trim())
      : "";

  if (!open) {
    return null;
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-surface project-launcher-modal"
        onClick={(event) => {
          event.stopPropagation();
        }}
      >
        <header className="modal-header">
          <div className="project-launcher-header-copy">
            <span className="eyebrow">workspace launcher</span>
            <h2>New Project</h2>
            <p className="project-launcher-subtitle">
              Open an existing workspace or create a clean project directory and jump in.
            </p>
          </div>
          <button
            type="button"
            className="modal-close"
            onClick={onClose}
            aria-label="Close new project modal"
          >
            &times;
          </button>
        </header>

        <div className="view-tabs project-launcher-tabs">
          <button
            type="button"
            className={`view-tab ${mode === "existing" ? "view-tab-active" : ""}`}
            onClick={() => setMode("existing")}
          >
            Open existing
          </button>
          <button
            type="button"
            className={`view-tab ${mode === "create" ? "view-tab-active" : ""}`}
            onClick={() => setMode("create")}
          >
            Create directory
          </button>
        </div>

        {mode === "existing" ? (
          <div className="modal-body project-launcher-body">
            <section className="project-launcher-section">
              <div className="project-launcher-section-header">
                <span className="project-launcher-section-title">Recent directories</span>
                <span className="project-launcher-section-meta">
                  {recentCandidates.length > 0
                    ? `${recentCandidates.length} ready to open`
                    : "Paste a path below to get started"}
                </span>
              </div>
              {recentCandidates.length > 0 ? (
                <div className="workspace-candidate-grid project-launcher-grid">
                  {recentCandidates.map((candidate) => (
                    <button
                      key={candidate.path}
                      type="button"
                      className="workspace-candidate"
                      disabled={isBusy}
                      onClick={async () => {
                        setIsBusy(true);

                        try {
                          await onOpenProject(candidate.path);
                          onClose();
                        } finally {
                          setIsBusy(false);
                        }
                      }}
                    >
                      <span className="workspace-candidate-name">{candidate.name}</span>
                      <span className="workspace-candidate-path">{candidate.path}</span>
                      <div className="workspace-candidate-badges">
                        {candidate.hasGit && <span className="badge badge-git">git</span>}
                        {candidate.hasPackageJson && <span className="badge badge-package">pkg</span>}
                        {!candidate.hasGit && !candidate.hasPackageJson && (
                          <span className="badge badge-source">{candidate.source}</span>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="project-launcher-empty">
                  No recent workspaces found yet. Open one by path, or switch to create mode.
                </div>
              )}
            </section>
            <form
              className="action-form project-launcher-manual-form"
              onSubmit={async (event) => {
                event.preventDefault();

                if (!existingPath.trim()) {
                  return;
                }

                setIsBusy(true);

                try {
                  await onOpenProject(existingPath.trim());
                  onClose();
                } finally {
                  setIsBusy(false);
                }
              }}
            >
              <label className="launcher-field">
                <span className="launcher-field-label">Open by path</span>
                <input
                  className="text-input"
                  value={existingPath}
                  onChange={(event) => setExistingPath(event.target.value)}
                  placeholder="Type an existing project path"
                  autoFocus
                />
              </label>
              <div className="project-launcher-footer">
                <span className="project-launcher-hint">
                  Supports absolute paths and `~` home shortcuts.
                </span>
                <button className="action-button" type="submit" disabled={isBusy || !existingPath.trim()}>
                  {isBusy ? "Opening..." : "Open project"}
                </button>
              </div>
            </form>
          </div>
        ) : (
          <form
            className="modal-body project-launcher-body project-launcher-create-form"
            onSubmit={async (event) => {
              event.preventDefault();
              const parent = createParent.trim();
              const name = createName.trim();

              if (!parent || !name) {
                return;
              }

              const fullPath = joinPath(parent, name);

              setIsBusy(true);

              try {
                await onCreateProject(fullPath);
                onClose();
              } finally {
                setIsBusy(false);
              }
            }}
          >
            <section className="project-launcher-section">
              <div className="project-launcher-section-header">
                <span className="project-launcher-section-title">Create directory</span>
                <span className="project-launcher-section-meta">
                  The new folder opens immediately after creation.
                </span>
              </div>
              <label className="launcher-field">
                <span className="launcher-field-label">Parent directory</span>
                <input
                  className="text-input"
                  value={createParent}
                  onChange={(event) => setCreateParent(event.target.value)}
                  placeholder="~/projects"
                />
              </label>
              <label className="launcher-field">
                <span className="launcher-field-label">Project name</span>
                <input
                  className="text-input"
                  value={createName}
                  onChange={(event) => setCreateName(event.target.value)}
                  placeholder="my-project"
                  autoFocus
                />
              </label>
              <div className={`launcher-preview ${createPreviewPath ? "launcher-preview-active" : ""}`}>
                <span className="launcher-field-label">Resulting path</span>
                {createPreviewPath ? (
                  <span className="launcher-preview-path">{createPreviewPath}</span>
                ) : (
                  <span className="project-launcher-preview-placeholder">
                    Choose a parent folder and project name to preview the new path.
                  </span>
                )}
              </div>
            </section>
            <div className="project-launcher-footer">
              <span className="project-launcher-hint">
                Missing directories are created automatically when possible.
              </span>
              <button
                className="action-button"
                type="submit"
                disabled={isBusy || !createParent.trim() || !createName.trim()}
              >
                {isBusy ? "Creating..." : "Create and open"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
