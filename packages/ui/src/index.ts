export type ShellZone = "left" | "center" | "right" | "bottom";

export type PanelDescriptor = {
  id: string;
  title: string;
  description: string;
  zone: ShellZone;
};

export type ShellLayout = {
  left: PanelDescriptor[];
  center: PanelDescriptor[];
  right: PanelDescriptor[];
  bottom: PanelDescriptor[];
};

export const brandTheme = {
  background: "#06070a",
  surface: "#0d1018",
  surfaceAlt: "#131720",
  ink: "#b0b8c6",
  muted: "#586474",
  accent: "#5ea5e8",
  accentAlt: "#3d7ec0",
  border: "rgba(255, 255, 255, 0.06)",
};

export const versionOneShellLayout: ShellLayout = {
  left: [
    {
      id: "explorer",
      title: "Explorer",
      description: "Workspace files, folders, and open documents",
      zone: "left",
    },
    {
      id: "git",
      title: "Git",
      description: "Branch, staged changes, and commit history",
      zone: "left",
    },
    {
      id: "agents",
      title: "Agents",
      description: "Active agent roster and role assignments",
      zone: "left",
    },
  ],
  center: [
    {
      id: "editor",
      title: "Editor",
      description: "Source code, diffs, and patch review",
      zone: "center",
    },
  ],
  right: [
    {
      id: "thread",
      title: "Thread",
      description: "Live conversation and agent collaboration timeline",
      zone: "right",
    },
  ],
  bottom: [
    {
      id: "terminal",
      title: "Terminal",
      description: "Shell sessions for user and agent commands",
      zone: "bottom",
    },
    {
      id: "tasks",
      title: "Tasks",
      description: "Assignments, handoffs, and run status",
      zone: "bottom",
    },
    {
      id: "diagnostics",
      title: "Diagnostics",
      description: "Build output, test results, and environment logs",
      zone: "bottom",
    },
  ],
};
