import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ConvexReactClient } from "convex/react";
import { ConvexAuthProvider } from "@convex-dev/auth/react";
import "@xterm/xterm/css/xterm.css";
import { App } from "./app";
import "./styles.css";
import "./themes.css";

const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL as string);

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Missing #root element");
}

createRoot(rootElement).render(
  <StrictMode>
    <ConvexAuthProvider client={convex}>
      <App />
    </ConvexAuthProvider>
  </StrictMode>,
);
