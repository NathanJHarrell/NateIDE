import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { AgentDescriptor } from "@nateide/agents";
import type {
  KanbanBoard,
  KanbanCard,
  KanbanCardPriority,
  KanbanFileTag,
} from "@nateide/protocol";

type KanbanViewProps = {
  agents: AgentDescriptor[];
  board: KanbanBoard;
  onCreateCard: (input: {
    assignedAgentId?: string;
    description?: string;
    fileTags?: KanbanFileTag[];
    laneId?: string;
    priority?: KanbanCardPriority;
    title: string;
  }) => Promise<void>;
  onCreateLane: (input: { color?: string; name: string }) => Promise<void>;
  onMoveCard: (cardId: string, laneId: string) => Promise<void>;
  onRenameLane: (laneId: string, input: { color?: string; name?: string }) => Promise<void>;
};

function basename(filePath: string): string {
  return filePath.split(/[\\/]/).filter(Boolean).at(-1) ?? filePath;
}

function inferTagKind(tagPath: string): "file" | "directory" {
  const name = basename(tagPath);
  return name.includes(".") ? "file" : "directory";
}

function priorityTone(priority: KanbanCardPriority): string {
  switch (priority) {
    case "high":
      return "kanban-priority-high";
    case "low":
      return "kanban-priority-low";
    default:
      return "kanban-priority-medium";
  }
}

function CardTile(props: {
  card: KanbanCard;
  dragId: string | null;
  onDragStart: (cardId: string) => void;
  onDragEnd: () => void;
}) {
  const { card, dragId, onDragEnd, onDragStart } = props;

  return (
    <article
      className={`kanban-card ${dragId === card.id ? "kanban-card-dragging" : ""}`}
      draggable
      onDragEnd={onDragEnd}
      onDragStart={() => onDragStart(card.id)}
    >
      <header className="kanban-card-header">
        <span className={`kanban-priority ${priorityTone(card.priority)}`}>{card.priority}</span>
        {card.assignedAgentId ? <span className="kanban-card-agent">{card.assignedAgentId}</span> : null}
      </header>
      <h3>{card.title}</h3>
      {card.description ? <p>{card.description}</p> : null}
      {card.fileTags.length > 0 ? (
        <div className="kanban-tag-row">
          {card.fileTags.map((tag) => (
            <span key={`${card.id}-${tag.path}`} className="kanban-tag">
              {tag.kind === "directory" ? "dir" : "file"} {basename(tag.path)}
            </span>
          ))}
        </div>
      ) : null}
      <footer className="kanban-card-footer">
        <span>{card.createdBy.id}</span>
        <span>{new Date(card.updatedAt).toLocaleDateString()}</span>
      </footer>
    </article>
  );
}

function QuickAddCard(props: {
  laneId: string;
  onCreateCard: KanbanViewProps["onCreateCard"];
}) {
  const { laneId, onCreateCard } = props;
  const [isOpen, setIsOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (isOpen) {
      inputRef.current?.focus();
    }
  }, [isOpen]);

  async function submit() {
    const trimmed = title.trim();

    if (!trimmed) {
      return;
    }

    setIsSubmitting(true);

    try {
      await onCreateCard({ title: trimmed, laneId });
      setTitle("");
      inputRef.current?.focus();
    } finally {
      setIsSubmitting(false);
    }
  }

  if (!isOpen) {
    return (
      <button
        type="button"
        className="kanban-add-trigger"
        onClick={() => setIsOpen(true)}
      >
        + Add a card
      </button>
    );
  }

  return (
    <div className="kanban-quick-add">
      <textarea
        ref={inputRef}
        className="kanban-quick-add-input"
        placeholder="Enter a title for this card..."
        rows={2}
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            void submit();
          }

          if (event.key === "Escape") {
            setIsOpen(false);
            setTitle("");
          }
        }}
      />
      <div className="kanban-quick-add-actions">
        <button
          type="button"
          className="kanban-quick-add-submit"
          disabled={isSubmitting || !title.trim()}
          onClick={() => void submit()}
        >
          {isSubmitting ? "Adding..." : "Add card"}
        </button>
        <button
          type="button"
          className="kanban-quick-add-cancel"
          onClick={() => {
            setIsOpen(false);
            setTitle("");
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

export function KanbanView(props: KanbanViewProps) {
  const {
    agents,
    board,
    onCreateCard,
    onCreateLane,
    onMoveCard,
    onRenameLane,
  } = props;
  const [dragCardId, setDragCardId] = useState<string | null>(null);
  const [laneNames, setLaneNames] = useState<Record<string, string>>({});
  const [addingColumn, setAddingColumn] = useState(false);
  const [newColumnName, setNewColumnName] = useState("");
  const [isSubmittingLane, setIsSubmittingLane] = useState(false);
  const newColumnRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (addingColumn) {
      newColumnRef.current?.focus();
    }
  }, [addingColumn]);

  async function submitNewColumn() {
    const trimmed = newColumnName.trim();

    if (!trimmed) {
      return;
    }

    setIsSubmittingLane(true);

    try {
      await onCreateLane({ name: trimmed });
      setNewColumnName("");
      setAddingColumn(false);
    } finally {
      setIsSubmittingLane(false);
    }
  }

  return (
    <section className="kanban-board" style={{ padding: 12 }}>
      {board.lanes.map((lane) => {
        const cards = board.cards.filter((card) => card.laneId === lane.id);

        return (
          <article
            key={lane.id}
            className="kanban-column"
            onDragOver={(event) => event.preventDefault()}
            onDrop={() => {
              if (dragCardId) {
                void onMoveCard(dragCardId, lane.id);
              }
              setDragCardId(null);
            }}
          >
            <header className="kanban-column-header" style={{ borderColor: lane.color }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <input
                  className="kanban-column-header-name"
                  value={laneNames[lane.id] ?? lane.name}
                  onChange={(event) =>
                    setLaneNames((current) => ({ ...current, [lane.id]: event.target.value }))
                  }
                  onBlur={(event) => {
                    const value = event.target.value.trim();

                    if (value && value !== lane.name) {
                      void onRenameLane(lane.id, { name: value });
                    }
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      (event.target as HTMLInputElement).blur();
                    }
                  }}
                />
                <span style={{ fontSize: "0.8rem", color: "var(--color-muted)", paddingLeft: 4 }}>
                  {cards.length} {cards.length === 1 ? "card" : "cards"}
                </span>
              </div>
              <span className="kanban-column-swatch" style={{ background: lane.color }} />
            </header>
            <div className="kanban-column-body">
              {cards.length > 0 ? (
                cards.map((card) => (
                  <CardTile
                    key={card.id}
                    card={card}
                    dragId={dragCardId}
                    onDragEnd={() => setDragCardId(null)}
                    onDragStart={setDragCardId}
                  />
                ))
              ) : (
                <div className="kanban-column-empty">Drop a card here.</div>
              )}
              <QuickAddCard laneId={lane.id} onCreateCard={onCreateCard} />
            </div>
          </article>
        );
      })}

      {addingColumn ? (
        <div className="kanban-column" style={{ minHeight: "auto", padding: 10 }}>
          <input
            ref={newColumnRef}
            className="text-input"
            placeholder="Column name..."
            value={newColumnName}
            onChange={(event) => setNewColumnName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                void submitNewColumn();
              }

              if (event.key === "Escape") {
                setAddingColumn(false);
                setNewColumnName("");
              }
            }}
          />
          <div className="kanban-quick-add-actions" style={{ marginTop: 8 }}>
            <button
              type="button"
              className="kanban-quick-add-submit"
              disabled={isSubmittingLane || !newColumnName.trim()}
              onClick={() => void submitNewColumn()}
            >
              Add column
            </button>
            <button
              type="button"
              className="kanban-quick-add-cancel"
              onClick={() => {
                setAddingColumn(false);
                setNewColumnName("");
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className="kanban-add-column"
          onClick={() => setAddingColumn(true)}
        >
          + Add a column
        </button>
      )}
    </section>
  );
}
