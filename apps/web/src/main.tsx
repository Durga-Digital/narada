import React from "react";
import { createRoot } from "react-dom/client";
import { lazy, Suspense } from "react";
const App = lazy(() => import("./app.js").then((m) => ({ default: m.App })));
const PublicForm = lazy(() =>
  import("./features/forms/public-form.js").then((m) => ({
    default: m.PublicForm,
  })),
);
const formPath = /^\/forms\/([^/]+)\/?$/.exec(location.pathname);
import { Toaster } from "./components/ui/sonner.js";
import "./styles.css";
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Suspense
      fallback={
        <p className="p-8" role="status">
          Loading…
        </p>
      }
    >
      {formPath ? <PublicForm id={formPath[1]!} /> : <App />}
    </Suspense>
    <Toaster />
  </React.StrictMode>,
);
