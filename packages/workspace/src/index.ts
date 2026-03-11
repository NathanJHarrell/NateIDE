import type { ActorRef } from "@nateide/protocol";

export type FileTreeNode = {
  name: string;
  path: string;
  kind: "directory" | "file";
  children?: FileTreeNode[];
};

export type EditorDocumentSnapshot = {
  path: string;
  title: string;
  language: string;
  preview: string;
};

export type GitSnapshot = {
  branch: string;
  changedFiles: string[];
};

export type TerminalCommandSnapshot = {
  id: string;
  command: string;
  status: "running" | "completed";
  initiatedBy: ActorRef;
  exitCode?: number;
};

export type TerminalSessionStatus = "idle" | "running" | "closed";

export type TerminalSessionSnapshot = {
  id: string;
  title: string;
  cwd: string;
  shell: string;
  status: TerminalSessionStatus;
  cols: number;
  rows: number;
  lastExitCode?: number;
  commands: TerminalCommandSnapshot[];
  buffer: string[];
  recentOutput: string[];
};

export type WorkspaceSnapshot = {
  tree: FileTreeNode[];
  documents: EditorDocumentSnapshot[];
  activeDocumentPath: string;
  openPaths: string[];
  git: GitSnapshot;
  terminals: TerminalSessionSnapshot[];
};

export function createDemoWorkspaceSnapshot(rootPath: string): WorkspaceSnapshot {
  const tree: FileTreeNode[] = [
    {
      name: "apps",
      path: `${rootPath}/apps`,
      kind: "directory",
      children: [
        {
          name: "desktop",
          path: `${rootPath}/apps/desktop`,
          kind: "directory",
          children: [
            {
              name: "src",
              path: `${rootPath}/apps/desktop/src`,
              kind: "directory",
              children: [
                {
                  name: "app.tsx",
                  path: `${rootPath}/apps/desktop/src/app.tsx`,
                  kind: "file",
                },
                {
                  name: "styles.css",
                  path: `${rootPath}/apps/desktop/src/styles.css`,
                  kind: "file",
                },
              ],
            },
          ],
        },
        {
          name: "daemon",
          path: `${rootPath}/apps/daemon`,
          kind: "directory",
          children: [
            {
              name: "src",
              path: `${rootPath}/apps/daemon/src`,
              kind: "directory",
              children: [
                {
                  name: "index.ts",
                  path: `${rootPath}/apps/daemon/src/index.ts`,
                  kind: "file",
                },
              ],
            },
          ],
        },
      ],
    },
    {
      name: "packages",
      path: `${rootPath}/packages`,
      kind: "directory",
      children: [
        {
          name: "protocol",
          path: `${rootPath}/packages/protocol`,
          kind: "directory",
          children: [
            {
              name: "src",
              path: `${rootPath}/packages/protocol/src`,
              kind: "directory",
              children: [
                {
                  name: "events.ts",
                  path: `${rootPath}/packages/protocol/src/events.ts`,
                  kind: "file",
                },
                {
                  name: "entities.ts",
                  path: `${rootPath}/packages/protocol/src/entities.ts`,
                  kind: "file",
                },
              ],
            },
          ],
        },
        {
          name: "orchestrator",
          path: `${rootPath}/packages/orchestrator`,
          kind: "directory",
        },
      ],
    },
  ];

  const documents: EditorDocumentSnapshot[] = [
    {
      path: `${rootPath}/packages/protocol/src/events.ts`,
      title: "events.ts",
      language: "ts",
      preview: [
        "export type RunStartedEvent = EventEnvelope<",
        '  "run.started",',
        "  {",
        "    run: Run;",
        "  }",
        ">;",
      ].join("\n"),
    },
    {
      path: `${rootPath}/packages/orchestrator/src/index.ts`,
      title: "index.ts",
      language: "ts",
      preview: [
        "export function createDemoThreadBootstrap(rootPath: string) {",
        "  return {",
        "    workspace,",
        "    thread,",
        "    agents,",
        "  };",
        "}",
      ].join("\n"),
    },
    {
      path: `${rootPath}/apps/desktop/src/app.tsx`,
      title: "app.tsx",
      language: "tsx",
      preview: [
        "export function App() {",
        "  return <ShellLayout />;",
        "}",
      ].join("\n"),
    },
  ];

  return {
    tree,
    documents,
    activeDocumentPath: documents[0].path,
    openPaths: documents.map((document) => document.path),
    git: {
      branch: "main",
      changedFiles: [
        "PRODUCT.md",
        "ARCHITECTURE.md",
        "PROTOCOL.md",
        "apps/desktop/src/app.tsx",
      ],
    },
    terminals: [
      {
        id: "terminal-main",
        title: "workspace shell",
        cwd: rootPath,
        shell: "bash",
        status: "running",
        cols: 118,
        rows: 28,
        commands: [
          {
            id: "command-typecheck",
            command: "bun run typecheck",
            status: "running",
            initiatedBy: { type: "agent", id: "agent-codex" },
          },
        ],
        buffer: [
          "\u001b[?2004h",
          "nate@nateide:~$ bun run typecheck\r\n",
          "Typechecking protocol, orchestrator, desktop shell...\r\n",
          "Waiting on review task to release the write lock for app shell files.\r\n",
        ],
        recentOutput: [
          "\u001b[?2004h",
          "nate@nateide:~$ bun run typecheck\r\n",
          "Typechecking protocol, orchestrator, desktop shell...\r\n",
          "Waiting on review task to release the write lock for app shell files.\r\n",
        ],
      },
    ],
  };
}
