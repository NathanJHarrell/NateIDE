# NateIDE

> A multi-agent coding environment where AI agents collaborate, hand off work, and build alongside you — inside a real IDE.

NateIDE is an open source, desktop-first agentic IDE. It's not a chat interface with a code pane bolted on. It's a full coding environment — editor, terminal, and multi-agent orchestration — built as one coherent workflow.

Multiple named agents work inside the same workspace and thread. They plan, implement, review, and hand work to each other while you stay in control.

**Free. Open source. No subscriptions.**

---

## What Makes This Different

Most AI coding tools give you one model at a time. You pick from a dropdown, send a message, get a response.

NateIDE gives you a team.

- **Claude** acts as the controller — planning, decomposing work, deciding what goes where
- **Codex** implements
- **Gemini** reviews
- **Composer** rewrites and polishes

Each agent has an identity, a role, and explicit permissions. When one agent finishes, it hands off to the next. Every action — file edit, terminal command, patch proposal — is attributed to a specific agent and visible in the thread.

You always know who did what, why the system made the choices it made, and you can override anything at any time.

---

## Core Features

### Multi-Agent Orchestration
- Multiple named agents in one session
- Explicit task assignment and structured handoffs
- A controller that routes work and prevents agents from talking over each other
- Real-time visibility into what every agent is doing

### IDE As A First-Class Surface
- File explorer and multi-file editor (Monaco)
- Code search
- Patch and diff review built into the workflow
- Diagnostics surface for build and test feedback

### Terminal As A First-Class Surface
- Open terminal tabs per workspace
- Live-streamed terminal output
- Agents can run commands through the same execution model as the user
- Every command is attributed — you always know if it was you or an agent

### Event Log As The Source Of Truth
Everything that happens is stored in an append-only event log per thread. The UI is derived from events. The history is replayable. If you ask "what happened, who did it, and why?" — the log can answer.

---

## How It Works

1. **Open a workspace** — NateIDE indexes your project, initializes the editor, starts terminal support, and creates a thread bound to that workspace

2. **Start a thread** — Describe what you want: "plan the refactor, implement the API change, and have another agent review it." The controller creates tasks and assigns them to agents.

3. **Watch the team work** — Agents collaborate in the shared thread. Claude plans. Codex implements. Gemini reviews. Composer cleans up. Every handoff is explicit and visible.

4. **Stay in control** — Approve or reject patches, redirect tasks, cancel runs, take over the terminal. Human override is always available.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Desktop Shell | Tauri |
| Editor | Monaco |
| Terminal | xterm.js |
| Backend | TypeScript + Bun |
| Local Storage | SQLite |
| Shared Protocol | TypeScript schemas |

---

## Architecture

NateIDE is a modular monolith with three main parts:

- **`apps/desktop`** — Desktop shell, UI, editor, terminal, agent roster
- **`apps/daemon`** — Local backend, workspace access, git, PTY, event storage, provider integrations
- **`packages/`** — Shared protocol schemas, orchestrator logic, agent profiles, workspace services, UI primitives

The daemon runs locally. The desktop app never calls raw internals directly — everything goes through the protocol layer. This keeps the system inspectable and the architecture clean.

Full architecture documentation: [ARCHITECTURE.md](./ARCHITECTURE.md)

---

## Agent Protocol

Agents coordinate through tasks, handoffs, and the shared event stream — not hidden side channels.

Key rules:
- One writer policy: two agents cannot have overlapping write scope on the same files simultaneously
- Read-only review runs can execute in parallel
- Every terminal action and patch is tied back to a specific run
- Human approval gates destructive or high-impact operations

Full protocol documentation: [PROTOCOL.md](./PROTOCOL.md)

---

## Roadmap

### Version 1
- [x] Architecture and protocol design
- [ ] Workspace shell (file explorer, editor, terminal, single thread)
- [ ] Multi-agent core (agent roster, controller, task assignment, handoffs)
- [ ] Patch and command workflow (propose, review, approve, reject)

### Later
- Remote daemon and hosted workspaces
- Pipeline sharing between users
- Web client
- Multi-user collaboration

---

## Getting Started
```bash
# Clone the repo
git clone https://github.com/NathanJHarrell/NateIDE

# Install dependencies
bun install

# Configure the desktop app
cp .env.example .env.local
# or, if you run the desktop app directly:
cp apps/desktop/.env.example apps/desktop/.env.local

# Run the desktop app
bun run dev
```

> Requires [Bun](https://bun.sh/) v1.x+
>
> Set the value in either example file to your Convex deployment URL, for example
> `https://precise-gopher-800.convex.cloud`.

---

## Contributing

NateIDE is open source and welcomes contributions. The architecture is documented, the protocol is explicit, and the event model makes behavior inspectable and debuggable.

If you want to add an agent, improve orchestration logic, or build on the workspace services — the structure is designed to support it.

---

## License

MIT — free to use, modify, and build on.

---

*Built by Nathan Harrell and Claude.*
