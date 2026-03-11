import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access, readdir, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { Workspace, WorkspaceCandidate } from "@nateide/protocol";
import type {
  EditorDocumentSnapshot,
  FileTreeNode,
  WorkspaceSnapshot,
} from "@nateide/workspace";

const execFileAsync = promisify(execFile);

const MAX_TREE_DEPTH = 3;
const MAX_TREE_ENTRIES = 18;
const MAX_OPEN_DOCUMENTS = 4;
const MAX_PREVIEW_CHARS = 4_000;
const SKIP_DIRECTORIES = new Set([
  ".git",
  ".next",
  ".turbo",
  ".yarn",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "target",
]);
const PROJECT_MARKERS = [
  ".git",
  "package.json",
  "bunfig.toml",
  "tsconfig.json",
  "Cargo.toml",
  "pyproject.toml",
  "go.mod",
];
const PREVIEWABLE_EXTENSIONS = new Set([
  ".cjs",
  ".css",
  ".go",
  ".html",
  ".java",
  ".js",
  ".json",
  ".jsx",
  ".mjs",
  ".md",
  ".py",
  ".rs",
  ".sh",
  ".sql",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".yaml",
  ".yml",
]);
const ROOT_DOTFILES = new Set([
  ".env.example",
  ".gitignore",
  ".npmrc",
  ".prettierrc",
  ".prettierrc.json",
]);

type GitDetails = {
  branch: string;
  changedFiles: string[];
  dirty: boolean;
  headSha: string;
  rootPath: string;
};

function expandHome(inputPath: string): string {
  const home = process.env.HOME;

  if (!home || inputPath === "") {
    return inputPath;
  }

  if (inputPath === "~") {
    return home;
  }

  if (inputPath.startsWith("~/")) {
    return path.join(home, inputPath.slice(2));
  }

  return inputPath;
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function isDirectory(filePath: string): Promise<boolean> {
  try {
    return (await stat(filePath)).isDirectory();
  } catch {
    return false;
  }
}

function shouldSkipDirectory(name: string): boolean {
  return name.startsWith(".") || SKIP_DIRECTORIES.has(name);
}

function shouldIncludeFile(name: string, depth: number): boolean {
  const extension = path.extname(name).toLowerCase();

  if (PREVIEWABLE_EXTENSIONS.has(extension)) {
    return true;
  }

  if (depth === 0 && ROOT_DOTFILES.has(name)) {
    return true;
  }

  return false;
}

function sortNames(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

function inferLanguage(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();

  switch (extension) {
    case ".css":
      return "css";
    case ".html":
      return "html";
    case ".json":
      return "json";
    case ".jsx":
      return "jsx";
    case ".md":
      return "markdown";
    case ".py":
      return "python";
    case ".rs":
      return "rust";
    case ".sh":
      return "shell";
    case ".toml":
      return "toml";
    case ".tsx":
      return "tsx";
    case ".ts":
      return "ts";
    case ".yaml":
    case ".yml":
      return "yaml";
    default:
      return extension.replace(".", "") || "text";
  }
}

function stableWorkspaceId(rootPath: string): string {
  return `workspace-${createHash("sha1").update(rootPath).digest("hex").slice(0, 12)}`;
}

async function readGitDetails(rootPath: string): Promise<GitDetails | null> {
  try {
    const root = (await execFileAsync("git", ["-C", rootPath, "rev-parse", "--show-toplevel"]))
      .stdout
      .trim();
    const branch = (await execFileAsync("git", ["-C", rootPath, "rev-parse", "--abbrev-ref", "HEAD"]))
      .stdout
      .trim();
    const headSha = (await execFileAsync("git", ["-C", rootPath, "rev-parse", "--short", "HEAD"]))
      .stdout
      .trim();
    const status = (await execFileAsync("git", ["-C", rootPath, "status", "--short"]))
      .stdout
      .trim();

    return {
      branch,
      changedFiles: status
        ? status
            .split(/\r?\n/)
            .map((line) => line.slice(3).trim())
            .filter(Boolean)
            .slice(0, 12)
        : [],
      dirty: Boolean(status),
      headSha,
      rootPath: root,
    };
  } catch {
    return null;
  }
}

async function buildFileTree(directoryPath: string, depth = 0): Promise<FileTreeNode[]> {
  if (depth >= MAX_TREE_DEPTH) {
    return [];
  }

  const entries = await readdir(directoryPath, { withFileTypes: true });
  const directories = entries
    .filter((entry) => entry.isDirectory() && !shouldSkipDirectory(entry.name))
    .sort((left, right) => sortNames(left.name, right.name))
    .slice(0, MAX_TREE_ENTRIES / 2);
  const files = entries
    .filter((entry) => entry.isFile() && shouldIncludeFile(entry.name, depth))
    .sort((left, right) => sortNames(left.name, right.name))
    .slice(0, MAX_TREE_ENTRIES / 2);

  const nodes: FileTreeNode[] = [];

  for (const entry of directories) {
    const entryPath = path.join(directoryPath, entry.name);

    nodes.push({
      name: entry.name,
      path: entryPath,
      kind: "directory",
      children: await buildFileTree(entryPath, depth + 1),
    });
  }

  for (const entry of files) {
    nodes.push({
      name: entry.name,
      path: path.join(directoryPath, entry.name),
      kind: "file",
    });
  }

  return nodes;
}

async function collectPreviewFilePaths(
  rootPath: string,
  maxFiles = MAX_OPEN_DOCUMENTS,
): Promise<string[]> {
  const result: string[] = [];

  async function walk(directoryPath: string, depth: number): Promise<void> {
    if (result.length >= maxFiles || depth >= MAX_TREE_DEPTH) {
      return;
    }

    const entries = await readdir(directoryPath, { withFileTypes: true });
    const sorted = entries.sort((left, right) => {
      if (left.isDirectory() !== right.isDirectory()) {
        return left.isDirectory() ? -1 : 1;
      }

      return sortNames(left.name, right.name);
    });

    for (const entry of sorted) {
      if (result.length >= maxFiles) {
        return;
      }

      const entryPath = path.join(directoryPath, entry.name);

      if (entry.isDirectory()) {
        if (shouldSkipDirectory(entry.name)) {
          continue;
        }

        await walk(entryPath, depth + 1);
        continue;
      }

      if (!entry.isFile() || !shouldIncludeFile(entry.name, depth)) {
        continue;
      }

      result.push(entryPath);
    }
  }

  await walk(rootPath, 0);
  return result;
}

function normalizePreview(content: string): string {
  return content
    .replace(/\t/g, "  ")
    .replace(/\0/g, "")
    .slice(0, MAX_PREVIEW_CHARS);
}

export async function resolveWorkspacePath(inputPath: string): Promise<string> {
  const resolved = path.resolve(expandHome(inputPath));
  const actualPath = await realpath(resolved);

  if (!(await isDirectory(actualPath))) {
    throw new Error(`Workspace path is not a directory: ${actualPath}`);
  }

  return actualPath;
}

export async function resolveWorkspaceDirectory(
  workspaceRoot: string,
  inputPath?: string,
): Promise<string> {
  const resolvedRoot = await resolveWorkspacePath(workspaceRoot);
  const candidatePath = inputPath ? path.resolve(expandHome(inputPath)) : resolvedRoot;
  const actualPath = await realpath(candidatePath).catch(() => candidatePath);
  const relativePath = path.relative(resolvedRoot, actualPath);

  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error(`Path is outside the current workspace: ${actualPath}`);
  }

  if (!(await isDirectory(actualPath))) {
    throw new Error(`Path is not a directory: ${actualPath}`);
  }

  return actualPath;
}

export async function openWorkspaceDocument(
  workspaceRoot: string,
  filePath: string,
): Promise<EditorDocumentSnapshot> {
  const resolvedRoot = await resolveWorkspacePath(workspaceRoot);
  const resolvedPath = path.resolve(expandHome(filePath));
  const relativePath = path.relative(resolvedRoot, resolvedPath);

  if (
    relativePath.startsWith("..") ||
    path.isAbsolute(relativePath) ||
    !(await exists(resolvedPath))
  ) {
    throw new Error(`File is outside the current workspace: ${resolvedPath}`);
  }

  const fileStat = await stat(resolvedPath);

  if (!fileStat.isFile()) {
    throw new Error(`Path is not a file: ${resolvedPath}`);
  }

  const preview = normalizePreview(await readFile(resolvedPath, "utf8"));

  return {
    path: resolvedPath,
    title: path.basename(resolvedPath),
    language: inferLanguage(resolvedPath),
    preview,
  };
}

export async function buildWorkspaceContext(
  workspacePath: string,
): Promise<{ workspace: Workspace; workspaceSnapshot: WorkspaceSnapshot }> {
  const rootPath = await resolveWorkspacePath(workspacePath);
  const git = await readGitDetails(rootPath);
  const documents = await Promise.all(
    (await collectPreviewFilePaths(rootPath)).map((filePath) =>
      openWorkspaceDocument(rootPath, filePath),
    ),
  );

  return {
    workspace: {
      id: stableWorkspaceId(rootPath),
      name: path.basename(rootPath),
      rootPath,
      git: git
        ? {
            rootPath: git.rootPath,
            branch: git.branch,
            headSha: git.headSha,
            dirty: git.dirty,
          }
        : undefined,
      openedAt: new Date().toISOString(),
    },
    workspaceSnapshot: {
      tree: await buildFileTree(rootPath),
      documents,
      activeDocumentPath: documents[0]?.path ?? "",
      openPaths: documents.map((document) => document.path),
      git: {
        branch: git?.branch ?? "no git",
        changedFiles: git?.changedFiles ?? [],
      },
      terminals: [],
    },
  };
}

async function readWorkspaceCandidate(candidatePath: string, source: "direct" | "scan") {
  if (!(await isDirectory(candidatePath))) {
    return null;
  }

  const hasGit = await exists(path.join(candidatePath, ".git"));
  const hasPackageJson = await exists(path.join(candidatePath, "package.json"));
  const hasAnyMarker =
    hasGit ||
    hasPackageJson ||
    (await Promise.any(
      PROJECT_MARKERS.map(async (marker) => {
        if (await exists(path.join(candidatePath, marker))) {
          return true;
        }

        throw new Error("missing marker");
      }),
    ).catch(() => false));

  if (!hasAnyMarker && source === "scan") {
    return null;
  }

  return {
    name: path.basename(candidatePath),
    path: candidatePath,
    source,
    hasGit,
    hasPackageJson,
  } satisfies WorkspaceCandidate;
}

export async function listWorkspaceCandidates(scanRoots: string[]): Promise<WorkspaceCandidate[]> {
  const candidateMap = new Map<string, WorkspaceCandidate>();
  const roots = [...new Set(scanRoots.map((scanRoot) => path.resolve(expandHome(scanRoot))))];

  for (const root of roots) {
    const directCandidate = await readWorkspaceCandidate(root, "direct");

    if (directCandidate) {
      candidateMap.set(directCandidate.path, directCandidate);
    }

    if (!(await isDirectory(root))) {
      continue;
    }

    let entries;

    try {
      entries = await readdir(root, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || shouldSkipDirectory(entry.name)) {
        continue;
      }

      const candidate = await readWorkspaceCandidate(path.join(root, entry.name), "scan");

      if (candidate) {
        candidateMap.set(candidate.path, candidate);
      }
    }
  }

  return [...candidateMap.values()].sort((left, right) => {
    const leftScore = Number(left.hasGit) + Number(left.hasPackageJson);
    const rightScore = Number(right.hasGit) + Number(right.hasPackageJson);

    if (leftScore !== rightScore) {
      return rightScore - leftScore;
    }

    return sortNames(left.name, right.name);
  });
}
