import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import type { TerminalSessionSnapshot } from "@nateide/workspace";

type ConnectionState = "loading" | "live" | "fallback";

type TerminalPaneProps = {
  connectionState: ConnectionState;
  cwd: string;
  fontSize: number;
  onOpenSession: (input: {
    cols: number;
    cwd: string;
    rows: number;
    shell: string;
  }) => Promise<void>;
  onResizeSession: (terminalSessionId: string, cols: number, rows: number) => Promise<void>;
  onSendInput: (terminalSessionId: string, data: string) => Promise<void>;
  shell: string;
  terminal: TerminalSessionSnapshot | null;
};

const TERMINAL_THEME = {
  background: "#0d1210",
  brightBlack: "#63756c",
  brightBlue: "#7cb4ff",
  brightCyan: "#8de3d6",
  brightGreen: "#8ff2b2",
  brightMagenta: "#d59cff",
  brightRed: "#ff8c7d",
  brightWhite: "#f5fbf7",
  brightYellow: "#ffe57b",
  cursor: "#f2f7f3",
  cursorAccent: "#0d1210",
  cyan: "#57c7b8",
  foreground: "#dff8e7",
  green: "#4dcf7f",
  magenta: "#bb79f0",
  red: "#ef7a6c",
  selectionBackground: "rgba(223, 248, 231, 0.2)",
  white: "#dff8e7",
  yellow: "#f5ca52",
};

export function TerminalPane(props: TerminalPaneProps) {
  const {
    connectionState,
    cwd,
    fontSize,
    onOpenSession,
    onResizeSession,
    onSendInput,
    shell,
    terminal,
  } = props;
  const hostRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const bufferLengthRef = useRef(0);
  const renderedSessionIdRef = useRef<string | null>(null);
  const queuedInputRef = useRef("");
  const isFlushingInputRef = useRef(false);
  const isCreatingSessionRef = useRef(false);
  const [terminalNotice, setTerminalNotice] = useState("");
  const onSendInputRef = useRef(onSendInput);
  onSendInputRef.current = onSendInput;
  const onResizeSessionRef = useRef(onResizeSession);
  onResizeSessionRef.current = onResizeSession;

  const sessionStatus = useMemo(() => {
    if (connectionState !== "live") {
      return "offline";
    }

    if (!terminal) {
      return "starting";
    }

    return terminal.status;
  }, [connectionState, terminal]);

  useEffect(() => {
    if (!hostRef.current || terminalRef.current) {
      return;
    }

    const xterm = new Terminal({
      allowTransparency: true,
      convertEol: false,
      cursorBlink: true,
      fontFamily: '"IBM Plex Mono", "SFMono-Regular", monospace',
      fontSize,
      scrollback: 5000,
      theme: TERMINAL_THEME,
    });
    const fitAddon = new FitAddon();

    xterm.loadAddon(fitAddon);
    xterm.open(hostRef.current);
    fitAddon.fit();
    xterm.focus();

    terminalRef.current = xterm;
    fitAddonRef.current = fitAddon;

    const flushInput = async () => {
      if (!terminal?.id || !queuedInputRef.current || isFlushingInputRef.current) {
        return;
      }

      const payload = queuedInputRef.current;
      queuedInputRef.current = "";
      isFlushingInputRef.current = true;

      try {
        await onSendInputRef.current(terminal.id, payload);
      } catch (error) {
        setTerminalNotice(error instanceof Error ? error.message : "Failed to send terminal input.");
      } finally {
        isFlushingInputRef.current = false;

        if (queuedInputRef.current) {
          window.setTimeout(() => {
            void flushInput();
          }, 0);
        }
      }
    };

    const dataDisposable = xterm.onData((data) => {
      if (!terminal?.id || connectionState !== "live") {
        return;
      }

      queuedInputRef.current += data;
      window.setTimeout(() => {
        void flushInput();
      }, 18);
    });

    resizeObserverRef.current = new ResizeObserver(() => {
      const currentTerminal = terminalRef.current;
      const currentFitAddon = fitAddonRef.current;

      if (!currentTerminal || !currentFitAddon) {
        return;
      }

      currentFitAddon.fit();

      if (terminal?.id && connectionState === "live") {
        void onResizeSessionRef.current(terminal.id, currentTerminal.cols, currentTerminal.rows).catch((error) => {
          setTerminalNotice(
            error instanceof Error ? error.message : "Failed to resize terminal session.",
          );
        });
      }
    });
    resizeObserverRef.current.observe(hostRef.current);

    return () => {
      resizeObserverRef.current?.disconnect();
      resizeObserverRef.current = null;
      dataDisposable.dispose();
      xterm.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, [connectionState, fontSize, terminal?.id]);

  useEffect(() => {
    if (connectionState !== "live" || isCreatingSessionRef.current || terminal?.status === "running") {
      return;
    }

    const xterm = terminalRef.current;

    if (!xterm) {
      return;
    }

    isCreatingSessionRef.current = true;
    setTerminalNotice("");

    void onOpenSession({
      cols: xterm.cols,
      cwd,
      rows: xterm.rows,
      shell,
    })
      .catch((error) => {
        setTerminalNotice(
          error instanceof Error ? error.message : "Failed to open interactive terminal.",
        );
      })
      .finally(() => {
        isCreatingSessionRef.current = false;
      });
  }, [connectionState, cwd, onOpenSession, shell, terminal?.status]);

  useEffect(() => {
    const xterm = terminalRef.current;

    if (!xterm || !terminal) {
      return;
    }

    xterm.options.fontSize = fontSize;

    if (renderedSessionIdRef.current !== terminal.id) {
      renderedSessionIdRef.current = terminal.id;
      bufferLengthRef.current = 0;
      xterm.reset();
    }

    const nextBufferLength = terminal.buffer.length;

    if (nextBufferLength < bufferLengthRef.current) {
      xterm.reset();
      bufferLengthRef.current = 0;
    }

    const nextChunks = terminal.buffer.slice(bufferLengthRef.current);

    if (nextChunks.length > 0) {
      xterm.write(nextChunks.join(""));
      bufferLengthRef.current = nextBufferLength;
    }

    fitAddonRef.current?.fit();
  }, [fontSize, terminal]);

  return (
    <div className="terminal-live-card">
      <div className="terminal-live-toolbar">
        <div className="terminal-live-meta">
          <span className="terminal-live-label">Interactive shell</span>
          <span className="terminal-live-path">{terminal?.cwd ?? cwd}</span>
        </div>
        <div className="terminal-live-actions">
          <span className={`terminal-live-status terminal-live-status-${sessionStatus}`}>
            {sessionStatus}
          </span>
          <button
            className="view-tab"
            type="button"
            onClick={() => {
              const xterm = terminalRef.current;

              if (!xterm) {
                return;
              }

              setTerminalNotice("");
              void onOpenSession({
                cols: xterm.cols,
                cwd,
                rows: xterm.rows,
                shell,
              }).catch((error) => {
                setTerminalNotice(
                  error instanceof Error ? error.message : "Failed to reopen terminal.",
                );
              });
            }}
          >
            Reset shell
          </button>
        </div>
      </div>
      {terminalNotice ? <div className="terminal-live-notice">{terminalNotice}</div> : null}
      <div ref={hostRef} className="terminal-live-surface" />
    </div>
  );
}
