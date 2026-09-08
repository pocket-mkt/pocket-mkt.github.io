import { createRoot } from "react-dom/client";
import { App } from "./App.jsx";
import ScreenBoundary from "./ScreenBoundary.jsx";
import "./styles.css";
import "./sidebarWorkspace.css";

// The app already has deterministic request deduplication and contract tests.
// Avoid StrictMode's development-only double mount here: on large task/Gantt
// screens it doubled local render work and made the app feel slower than the
// production Pages build users actually receive.
createRoot(document.getElementById("root"), {
  // React's default caught-error logger can include private render payloads.
  onCaughtError: () => {},
}).render(<ScreenBoundary><App /></ScreenBoundary>);
