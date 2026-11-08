"use client";

export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      style={{
        padding: "6px 12px",
        borderRadius: 8,
        border: "1px solid #99a",
        background: "#fff",
        cursor: "pointer",
      }}
    >
      Print or save as PDF
    </button>
  );
}
