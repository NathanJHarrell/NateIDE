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

  if (!open) {
    return null;
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-surface"
        onClick={(event) => {
          event.stopPropagation();
        }}
      >
        <header className="modal-header">
          <div>
            <span className="eyebrow">workspace launcher</span>
            <h2>New Project</h2>
          </div>
          <button type="button" className="view-tab" onClick={onClose}>
            Close
          </button>
        </header>

        <div className="view-tabs">
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
          <div className="modal-body">
            <div className="workspace-candidate-grid">
              {workspaceCandidates.slice(0, 10).map((candidate) => (
                <button
                  key={candidate.path}
                  type="button"
                  className="workspace-candidate"
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
                </button>
              ))}
            </div>
            <form
              className="action-form"
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
              <input
                className="text-input"
                value={existingPath}
                onChange={(event) => setExistingPath(event.target.value)}
                placeholder="Type an existing project path"
              />
              <button className="action-button" type="submit" disabled={isBusy}>
                {isBusy ? "Opening..." : "Open project"}
              </button>
            </form>
          </div>
        ) : (
          <form
            className="modal-body"
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
            <div className="launcher-preview">
              {createParent.trim() && createName.trim() && (
                <span className="launcher-preview-path">
                  {joinPath(createParent.trim(), createName.trim())}
                </span>
              )}
            </div>
            <button className="action-button" type="submit" disabled={isBusy || !createName.trim()}>
              {isBusy ? "Creating..." : "Create and open"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
