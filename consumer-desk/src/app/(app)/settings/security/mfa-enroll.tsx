"use client";

import { useState, useTransition } from "react";
import { finishMfaEnrollment, startMfaEnrollment, type EnrollState } from "@/app/actions/auth";

export function MfaEnroll() {
  const [state, setState] = useState<EnrollState>({ status: "idle", message: "" });
  const [code, setCode] = useState("");
  const [pending, start] = useTransition();

  if (state.status === "done") return <p className="notice notice-ok">{state.message}</p>;

  return (
    <div className="space-y-3">
      {state.status === "error" && <p className="notice notice-danger" role="alert">{state.message}</p>}
      {!state.factorId ? (
        <button className="btn btn-primary" disabled={pending} onClick={() => start(async () => setState(await startMfaEnrollment()))}>
          {pending ? "Starting…" : "Enroll authenticator app"}
        </button>
      ) : (
        <div className="space-y-3">
          {state.qrCode && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={state.qrCode} alt="Scan this QR code with your authenticator app" className="h-48 w-48 rounded-xl bg-white p-2" />
          )}
          {state.secret && <p className="text-xs text-muted">Or enter this key manually: <code className="break-all">{state.secret}</code></p>}
          <input className="input max-w-xs text-center tracking-[0.4em]" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} aria-label="6-digit code" />
          <button
            className="btn btn-primary"
            disabled={pending}
            onClick={() => start(async () => setState({ ...(await finishMfaEnrollment(state.factorId!, code)), qrCode: state.qrCode, secret: state.secret, factorId: state.factorId }))}
          >
            {pending ? "Verifying…" : "Verify and enable"}
          </button>
        </div>
      )}
    </div>
  );
}
