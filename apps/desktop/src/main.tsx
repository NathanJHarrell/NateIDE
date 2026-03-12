import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ConvexReactClient } from "convex/react";
import { ConvexAuthProvider } from "@convex-dev/auth/react";
import "@xterm/xterm/css/xterm.css";
import { App } from "./app";
import "./styles.css";
import "./themes.css";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Missing #root element");
}

const convexUrl = import.meta.env.VITE_CONVEX_URL || import.meta.env.CONVEX_URL;

if (!convexUrl) {
  createRoot(rootElement).render(
    <div
      style={{
        alignItems: "center",
        background: "#0d1018",
        color: "#e6edf3",
        display: "flex",
        fontFamily: "Manrope, sans-serif",
        height: "100vh",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <div style={{ maxWidth: 640 }}>
        <h1 style={{ fontSize: 24, margin: "0 0 12px" }}>Missing Convex URL</h1>
        <p style={{ lineHeight: 1.5, margin: 0 }}>
          Set <code>VITE_CONVEX_URL</code> in <code>apps/desktop/.env.local</code> or{" "}
          <code>CONVEX_URL</code> in the repo root <code>.env.local</code>.
        </p>
      </div>
    </div>,
  );
} else {
  const convex = new ConvexReactClient(convexUrl);

  createRoot(rootElement).render(
    <StrictMode>
      <ConvexAuthProvider client={convex}>
        <App />
      </ConvexAuthProvider>
    </StrictMode>,
  );
}
