"use client";

/** Last-resort boundary (e.g. the database is unreachable while rendering the root layout). */
export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <html lang="en">
      <body
        style={{ background: "#0a0e1c", color: "#e8edf5", fontFamily: "system-ui, sans-serif" }}
      >
        <main style={{ maxWidth: 420, margin: "20vh auto", padding: 24, textAlign: "center" }}>
          <p style={{ letterSpacing: "0.2em", fontWeight: 600, fontSize: 13 }}>
            AACTIVATED AI BRAIN
          </p>
          <h1 style={{ fontSize: 20, marginTop: 16 }}>The portal is temporarily unavailable</h1>
          <p style={{ color: "#9aa6bb", fontSize: 14 }}>
            We are on it. Please try again in a moment.
          </p>
          <p style={{ marginTop: 20, display: "flex", gap: 12, justifyContent: "center" }}>
            <button
              onClick={reset}
              style={{
                background: "#00b4ff",
                color: "#04121f",
                border: 0,
                borderRadius: 12,
                padding: "10px 16px",
                fontWeight: 600,
              }}
            >
              Try again
            </button>
            <a href="/status" style={{ color: "#4cc9ff", alignSelf: "center" }}>
              System status
            </a>
          </p>
        </main>
      </body>
    </html>
  );
}
