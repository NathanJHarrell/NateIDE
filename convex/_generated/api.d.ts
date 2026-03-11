/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as approvals from "../approvals.js";
import type * as auth from "../auth.js";
import type * as conflicts from "../conflicts.js";
import type * as customTools from "../customTools.js";
import type * as discovery from "../discovery.js";
import type * as encryption from "../encryption.js";
import type * as events from "../events.js";
import type * as harnesses from "../harnesses.js";
import type * as http from "../http.js";
import type * as mcpServers from "../mcpServers.js";
import type * as members from "../members.js";
import type * as pipelines from "../pipelines.js";
import type * as presence from "../presence.js";
import type * as profiles from "../profiles.js";
import type * as projects from "../projects.js";
import type * as runs from "../runs.js";
import type * as settings from "../settings.js";
import type * as souls from "../souls.js";
import type * as stars from "../stars.js";
import type * as tasks from "../tasks.js";
import type * as threads from "../threads.js";
import type * as workspaces from "../workspaces.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  approvals: typeof approvals;
  auth: typeof auth;
  conflicts: typeof conflicts;
  customTools: typeof customTools;
  discovery: typeof discovery;
  encryption: typeof encryption;
  events: typeof events;
  harnesses: typeof harnesses;
  http: typeof http;
  mcpServers: typeof mcpServers;
  members: typeof members;
  pipelines: typeof pipelines;
  presence: typeof presence;
  profiles: typeof profiles;
  projects: typeof projects;
  runs: typeof runs;
  settings: typeof settings;
  souls: typeof souls;
  stars: typeof stars;
  tasks: typeof tasks;
  threads: typeof threads;
  workspaces: typeof workspaces;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
