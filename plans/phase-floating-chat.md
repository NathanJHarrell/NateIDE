# Feature: Floating Agent Chat

## Goal

A persistent button (bottom-right corner) that opens a floating chat panel
on any page. Users can interact with agents from the terminal workspace,
explore page, settings, profile pages — anywhere in the app.

## Behavior

### The button

A circular floating action button pinned to the bottom-right of the viewport.
Always visible, on every page. Shows the active thread's agent indicator
(e.g., a small avatar stack of active agents) or a generic chat icon if no
thread is active.

If agents are currently working (streaming a response, executing tools), the
button pulses or shows a subtle activity indicator so the user knows something
is happening even when the chat panel is closed.

```
                                          ┌───┐
                                          │ 💬│
                                          └───┘
```

### The panel

Clicking the button opens a floating panel that slides up from the bottom-right:

```
                              ┌─────────────────────┐
                              │ Thread: Build auth   │
                              │ [▾ Switch thread]    │
                              ├─────────────────────┤
                              │                     │
                              │ [Nate]: Add GitHub  │
                              │ OAuth               │
                              │                     │
                              │ [Claude]: I'll plan │
                              │ the implementation. │
                              │ @Codex handle the   │
                              │ OAuth flow.         │
                              │                     │
                              │ [Codex]: On it.     │
                              │ > Writing github.ts │
                              │                     │
                              │ ┌─ Approve? ──────┐ │
                              │ │ write github.ts  │ │
                              │ │ [Allow] [Deny]   │ │
                              │ └─────────────────┘ │
                              │                     │
                              ├─────────────────────┤
                              │ [Type a message...] │
                              │              [Send] │
                              └─────────────────────┘
```

### Panel states

- **Collapsed** — just the button, no panel
- **Open** — floating panel showing the current thread
- **Expanded** — click a maximize button to go full-screen (navigates to the
  IDE thread view)

### Thread selection

The panel header shows the active thread with a dropdown to switch:

- Lists all threads in the current workspace
- "New thread" option at the top
- Threads show status indicators (active, resolved, archived)
- Switching threads loads that thread's messages and agent activity

### What works in the panel

Everything that works in the main thread view works in the floating panel:

- Send messages
- See agent responses streaming in real time
- Approve/deny tool calls
- See typing indicators (multi-user)
- See presence (who else is in this thread)
- @mention agents to bring them into the conversation

### What doesn't go in the panel

- File diffs and patch review (too complex for a small panel — use the IDE)
- Pipeline visualization (use the pipeline editor)
- Terminal output (use the terminal workspace)

For these, the panel shows a link: "Codex proposed changes to 3 files.
[View in IDE →]"

## Page-specific context

The floating chat can be context-aware based on the current page:

| Page | Context hint |
|------|-------------|
| Terminal workspace | "You're viewing 3 terminals. Ask agents about command output." |
| Explore / profile | No workspace context — chat connects to user's last active workspace |
| Settings | No context hint |
| Pipeline editor | "Editing: Feature Builder pipeline" |

When on a page with no workspace context (explore, profiles), the panel
shows a workspace picker before the message input.

## Persistence

- Panel open/closed state persists across page navigation
- Panel size persists (if resizable in future)
- Scroll position within the thread persists
- The panel is not destroyed on navigation — it's a persistent overlay
  component rendered at the app root

## Implementation

### Component

```tsx
// apps/desktop/src/components/floating-chat.tsx

function FloatingChat() {
  const [isOpen, setIsOpen] = useState(false)
  const [threadId, setThreadId] = useState<string | null>(null)

  // Convex subscription for thread events
  const events = useQuery(api.threads.getEvents, threadId ? { threadId } : "skip")

  // Convex subscription for pending approvals
  const approvals = useQuery(api.approvals.getPending, threadId ? { threadId } : "skip")

  return (
    <>
      <FloatingButton
        isOpen={isOpen}
        hasActivity={/* agents streaming */}
        onClick={() => setIsOpen(!isOpen)}
      />
      {isOpen && (
        <FloatingPanel>
          <ThreadSelector threadId={threadId} onSelect={setThreadId} />
          <MessageList events={events} />
          <ApprovalCards approvals={approvals} />
          <MessageInput threadId={threadId} />
        </FloatingPanel>
      )}
    </>
  )
}
```

Rendered at the app root layout level, outside of page routing:

```tsx
// apps/desktop/src/layout.tsx

function AppLayout({ children }) {
  return (
    <>
      {children}
      <FloatingChat />
    </>
  )
}
```

### Styling

- Panel: fixed position, bottom-right, `width: 380px`, `max-height: 70vh`
- Shadow and border to float above page content
- Backdrop blur or slight transparency on the edges
- Smooth slide-up animation on open
- Z-index above everything except modals
- Responsive: on small screens, panel goes full-width

### Keyboard shortcuts

| Shortcut | Action |
|----------|--------|
| Ctrl+J | Toggle floating chat open/closed |
| Esc | Close floating chat (when focused) |
| Ctrl+Enter | Send message (when chat is focused) |

## When to Build

Independent of the phased plan. Requires:
- Convex queries for thread events (Phase 1)
- Thread/message functionality (Phase 1)

Can be built as soon as Phase 1 is complete. Works alongside every other
feature since it's a global overlay.

## Definition of Done

- [ ] Floating button visible on every page in bottom-right corner
- [ ] Button shows activity indicator when agents are working
- [ ] Clicking button opens floating chat panel
- [ ] Panel shows current thread messages with real-time updates
- [ ] Thread switcher dropdown in panel header
- [ ] Can send messages from the panel
- [ ] Approval cards appear in the panel and are actionable
- [ ] Panel persists across page navigation (not destroyed)
- [ ] "View in IDE" links for complex content (diffs, pipelines)
- [ ] Keyboard shortcuts (Ctrl+J toggle, Esc close, Ctrl+Enter send)
- [ ] Panel works on terminal workspace page
- [ ] Panel works on explore/profile pages (with workspace picker)
- [ ] Smooth open/close animation
