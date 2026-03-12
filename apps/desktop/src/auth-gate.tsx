import { useState, type CSSProperties, type ReactNode } from "react";
import { useConvexAuth } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { useMe } from "./convex-hooks";
import type { Id } from "../../../convex/_generated/dataModel";

// ---------------------------------------------------------------------------
// useCurrentUser – returns the current authenticated user from Convex.
// ---------------------------------------------------------------------------
export function useCurrentUser() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const me = useMe();
  return {
    isAuthenticated,
    isLoading,
    user: me ?? null,
    userId: (me?._id ?? null) as Id<"users"> | null,
  };
}

// ---------------------------------------------------------------------------
// AuthGate
// ---------------------------------------------------------------------------
export function AuthGate({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading } = useConvexAuth();

  if (isLoading) {
    return (
      <div style={styles.wrapper}>
        <div style={styles.card}>
          <p style={styles.loadingText}>Loading&hellip;</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LoginForm />;
  }

  return <>{children}</>;
}

// ---------------------------------------------------------------------------
// LoginForm (internal)
// ---------------------------------------------------------------------------
type Mode = "signIn" | "signUp";

function LoginForm() {
  const { signIn } = useAuthActions();
  const [mode, setMode] = useState<Mode>("signIn");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handlePasswordSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await signIn("password", { email, password, flow: mode });
    } catch (err: any) {
      setError(err?.message ?? "Authentication failed. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleGitHub() {
    setError(null);
    try {
      const result = await signIn("github", { redirectTo: window.location.origin });
      if (result.redirect) {
        window.location.href = result.redirect.toString();
      }
    } catch (err: any) {
      setError(err?.message ?? "GitHub sign-in failed.");
    }
  }

  const label = mode === "signIn" ? "Sign In" : "Sign Up";
  const toggleLabel =
    mode === "signIn"
      ? "Don\u2019t have an account? Sign Up"
      : "Already have an account? Sign In";

  return (
    <div style={styles.wrapper}>
      <div style={styles.card}>
        {/* Branding */}
        <h1 style={styles.title}>OC for Nate</h1>
        <p style={styles.subtitle}>
          Agentic GitHub &mdash; Multi-Agent Orchestration IDE
        </p>

        {/* Email / Password form */}
        <form onSubmit={handlePasswordSubmit} style={styles.form}>
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            style={styles.input}
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            style={styles.input}
          />
          <button
            type="submit"
            disabled={submitting}
            style={{
              ...styles.primaryButton,
              opacity: submitting ? 0.6 : 1,
            }}
          >
            {submitting ? "Please wait\u2026" : label}
          </button>
        </form>

        {/* Divider */}
        <div style={styles.divider}>
          <span style={styles.dividerLine} />
          <span style={styles.dividerText}>or</span>
          <span style={styles.dividerLine} />
        </div>

        {/* GitHub OAuth */}
        <button onClick={handleGitHub} style={styles.githubButton}>
          <GitHubIcon />
          <span style={{ marginLeft: 8 }}>Continue with GitHub</span>
        </button>

        {/* Error */}
        {error && <p style={styles.error}>{error}</p>}

        {/* Toggle mode */}
        <button
          onClick={() => {
            setMode(mode === "signIn" ? "signUp" : "signIn");
            setError(null);
          }}
          style={styles.toggleLink}
        >
          {toggleLabel}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inline SVG for GitHub icon (16x16)
// ---------------------------------------------------------------------------
function GitHubIcon() {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden="true"
    >
      <path
        fillRule="evenodd"
        d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47
           7.59.4.07.55-.17.55-.38
           0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01
           1.08.58 1.23.82.72 1.21 1.87.87
           2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95
           0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12
           0 0 .67-.21 2.2.82a7.63 7.63 0 0 1 2-.27c.68
           0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44
           1.1.16 1.92.08 2.12.51.56.82 1.27.82
           2.15 0 3.07-1.87 3.75-3.65
           3.95.29.25.54.73.54 1.48 0
           1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013
           8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z"
      />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------
const styles: Record<string, CSSProperties> = {
  wrapper: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    height: "100vh",
    width: "100vw",
    background: "var(--color-bg, #0d1117)",
    fontFamily:
      "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  },

  card: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    width: 360,
    padding: "40px 32px",
    borderRadius: 12,
    background: "var(--color-surface, #161b22)",
    border: "1px solid var(--color-border, #30363d)",
    boxShadow: "0 8px 24px rgba(0,0,0,.4)",
  },

  title: {
    margin: 0,
    fontSize: 24,
    fontWeight: 700,
    color: "var(--color-text, #e6edf3)",
    letterSpacing: "-0.02em",
  },

  subtitle: {
    margin: "6px 0 28px",
    fontSize: 13,
    color: "var(--color-text-secondary, #8b949e)",
    textAlign: "center",
  },

  form: {
    display: "flex",
    flexDirection: "column",
    gap: 12,
    width: "100%",
  },

  input: {
    width: "100%",
    padding: "10px 12px",
    fontSize: 14,
    borderRadius: 6,
    border: "1px solid var(--color-border, #30363d)",
    background: "var(--color-bg, #0d1117)",
    color: "var(--color-text, #e6edf3)",
    outline: "none",
    boxSizing: "border-box",
  },

  primaryButton: {
    marginTop: 4,
    padding: "10px 0",
    fontSize: 14,
    fontWeight: 600,
    borderRadius: 6,
    border: "none",
    cursor: "pointer",
    background: "var(--color-accent, #58a6ff)",
    color: "#fff",
  },

  divider: {
    display: "flex",
    alignItems: "center",
    width: "100%",
    margin: "20px 0",
    gap: 12,
  },

  dividerLine: {
    flex: 1,
    height: 1,
    background: "var(--color-border, #30363d)",
  },

  dividerText: {
    fontSize: 12,
    color: "var(--color-text-secondary, #8b949e)",
    textTransform: "uppercase" as const,
    letterSpacing: "0.05em",
  },

  githubButton: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: "100%",
    padding: "10px 0",
    fontSize: 14,
    fontWeight: 600,
    borderRadius: 6,
    border: "1px solid var(--color-border, #30363d)",
    cursor: "pointer",
    background: "transparent",
    color: "var(--color-text, #e6edf3)",
  },

  error: {
    marginTop: 16,
    fontSize: 13,
    color: "var(--color-error, #f85149)",
    textAlign: "center",
  },

  toggleLink: {
    marginTop: 16,
    fontSize: 13,
    color: "var(--color-accent, #58a6ff)",
    background: "none",
    border: "none",
    cursor: "pointer",
    textDecoration: "underline",
    padding: 0,
  },

  loadingText: {
    fontSize: 14,
    color: "var(--color-text-secondary, #8b949e)",
  },
};
