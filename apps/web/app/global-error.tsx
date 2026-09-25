"use client";

/**
 * Last line of defence: a crash in the root layout itself.
 *
 * Replaces the whole document, so it cannot rely on the app's providers,
 * fonts or stylesheet having loaded — hence inline styles and a plain page.
 */

import { useEffect } from "react";
import { reportClientError } from "@/lib/report-client-error";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    reportClientError(error, "global");
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          background: "#f3efe8",
          color: "#1a1a1a",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          padding: 16,
        }}
      >
        <div
          style={{ maxWidth: 420, border: "1px solid #d8d2c7", background: "#fff", padding: 24 }}
        >
          <p
            style={{ fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", margin: 0 }}
          >
            FOUNDRY
          </p>
          <h1 style={{ fontSize: 18, margin: "12px 0 4px" }}>The app failed to start.</h1>
          <p style={{ fontSize: 13, color: "#5c5750", margin: 0 }}>
            The error has been recorded. Reloading usually fixes this.
          </p>
          {error.digest ? (
            <p style={{ fontSize: 12, color: "#5c5750", marginTop: 16 }}>ref {error.digest}</p>
          ) : null}
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: 20,
              background: "#ff5a1f",
              color: "#fff",
              border: 0,
              padding: "8px 14px",
              fontFamily: "inherit",
              cursor: "pointer",
            }}
          >
            Reload
          </button>
        </div>
      </body>
    </html>
  );
}
