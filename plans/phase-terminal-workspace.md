# Feature: Multi-Terminal Workspace

## Goal

When a user opens a second terminal, the app navigates to a dedicated
full-screen terminal workspace page. Terminals tile side by side and the user
can add more. The page is entirely terminals — no sidebar, no thread panel,
no editor. Just terminals filling the screen.

## Behavior

### Single terminal

When only one terminal is open, it lives in the bottom panel of the normal IDE
layout as it does today. Nothing changes.

### Two or more terminals

When the user opens a second terminal (via button, keyboard shortcut, or agent
action), the app transitions to the terminal workspace page:

- The IDE layout is replaced with a full-screen terminal grid
- All open terminals are shown side by side
- A minimal toolbar at the top provides: [+ New terminal] [Back to IDE] and
  terminal tab labels
- The user can keep adding terminals — the grid reflows automatically

### Returning to the IDE

Clicking "Back to IDE" or a keyboard shortcut returns to the normal layout.
The bottom panel shows whichever terminal the user last interacted with.
All terminals remain alive in the background.

## Layout

### Two terminals
```
┌──────────────────────┬──────────────────────┐
│                      │                      │
│    Terminal 1        │    Terminal 2         │
│                      │                      │
│                      │                      │
│                      │                      │
│                      │                      │
└──────────────────────┴──────────────────────┘
```

### Three terminals
```
┌──────────────────────┬──────────────────────┐
│                      │                      │
│    Terminal 1        │    Terminal 2         │
│                      │                      │
├──────────────────────┴──────────────────────┤
│                                             │
│              Terminal 3                     │
│                                             │
└─────────────────────────────────────────────┘
```

### Four terminals
```
┌──────────────────────┬──────────────────────┐
│                      │                      │
│    Terminal 1        │    Terminal 2         │
│                      │                      │
├──────────────────────┼──────────────────────┤
│                      │                      │
│    Terminal 3        │    Terminal 4         │
│                      │                      │
└──────────────────────┴──────────────────────┘
```

### Five+ terminals
Continue the grid pattern. Always try to fill the screen as evenly as
possible. Use a simple algorithm: `cols = ceil(sqrt(n))`,
`rows = ceil(n / cols)`. Last row may have fewer terminals that stretch to
fill the remaining width.

## Toolbar

Minimal, stays out of the way:

```
┌─────────────────────────────────────────────┐
│ T1 · T2 · T3 · [+]              [Back to IDE] │
└─────────────────────────────────────────────┘
```

- Terminal tabs show a short label (user can rename)
- Active terminal has a highlighted tab
- Click a tab to focus that terminal (for keyboard input)
- [+] adds a new terminal to the grid
- Right-click a tab: Rename, Close, Split (not yet — future)
- [Back to IDE] returns to the normal layout (shortcut: Esc or Cmd+`)

## Terminal Identity

Each terminal tracks:

```ts
type TerminalSession = {
  id: string
  label: string                // user-editable, default "Terminal 1"
  workspaceId: string
  cwd: string
  createdBy: ActorRef          // user or agent
  createdAt: string
  status: "active" | "exited"
  exitCode?: number
}
```

Agent-spawned terminals are labeled with the agent name:
"Codex — npm install", "Gemini — running tests"

## Agent Interaction

- Agents can spawn terminals. If the user is in the IDE view and an agent
  opens a second terminal, the app does NOT auto-navigate to the terminal
  workspace. Instead, a toast notification appears: "Codex opened a new
  terminal. [View terminals]"
- If the user is already in the terminal workspace, agent-spawned terminals
  appear in the grid automatically.
- Terminal output attribution (which agent or user ran which command) is shown
  as a small badge in the terminal tab and in the terminal header area.

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| Ctrl+` (backtick) | Toggle between IDE and terminal workspace |
| Ctrl+Shift+` | Open new terminal (navigates to terminal workspace if needed) |
| Ctrl+Tab | Cycle focus between terminals (when in terminal workspace) |
| Ctrl+W | Close focused terminal |
| Ctrl+1..9 | Focus terminal 1-9 |

## Resize

- Terminals use xterm.js `FitAddon` to fill their grid cell
- On window resize, all terminals refit
- On terminal add/remove, the grid reflows and all terminals refit
- No manual resize handles between terminals (keep it simple for v1)

## Implementation Notes

### Desktop app

- New route/page: `TerminalWorkspace`
- Uses CSS Grid for the layout: `grid-template-columns: repeat(cols, 1fr)`
- Each cell renders an `<XtermTerminal>` component connected to its PTY
- Terminal instances persist across page navigation (not destroyed when going
  back to IDE)
- State: `openTerminals: TerminalSession[]` — when `length >= 2`, show the
  terminal workspace navigation option

### Daemon

The daemon already supports multiple terminal sessions via node-pty. No
daemon changes needed — just ensure the desktop app can manage multiple
concurrent PTY connections.

### Convex

Terminal session metadata (label, who created it, status) is stored in Convex
for multi-user visibility. Terminal I/O stays local (daemon ↔ desktop via
WebSocket) — no need to stream raw terminal bytes through Convex.

```ts
terminalSessions: defineTable({
  workspaceId: v.id("workspaces"),
  label: v.string(),
  createdBy: v.union(
    v.object({ type: v.literal("user"), id: v.id("users") }),
    v.object({ type: v.literal("agent"), id: v.string() }),
  ),
  status: v.union(v.literal("active"), v.literal("exited")),
  exitCode: v.optional(v.number()),
}).index("by_workspace", ["workspaceId"]),
```

## When to Build

This is independent of the phased plan. It can be built:
- After Phase 1 (Convex foundation) for the metadata storage
- Alongside any other phase for the UI work
- The daemon already supports the terminal backend

## Definition of Done

- [ ] Single terminal remains in bottom panel as today
- [ ] Opening a second terminal navigates to terminal workspace page
- [ ] Terminal workspace shows all terminals in a responsive grid
- [ ] [+] button adds new terminals that reflow the grid
- [ ] [Back to IDE] returns to normal layout with terminals alive
- [ ] Terminal tabs with rename support
- [ ] Agent-spawned terminals show attribution badge
- [ ] Toast notification when agent opens terminal while user is in IDE view
- [ ] Keyboard shortcuts working (toggle, new, cycle, close, focus by number)
- [ ] xterm.js FitAddon resizes terminals on grid reflow
- [ ] Terminal session metadata in Convex for multi-user visibility
