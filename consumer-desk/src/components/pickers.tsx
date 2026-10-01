"use client";

import { useMemo, useState } from "react";

export interface PickerClient {
  id: string;
  name: string;
}
export interface PickerCase {
  id: string;
  clientId: string;
  title: string;
}
export interface PickerMailing {
  id: string;
  clientId: string;
  caseId: string;
  label: string;
}

/**
 * Client → case (→ outgoing mailing) selectors. Options are always filtered to the selected
 * client so a record cannot be linked across clients from the UI; the server re-checks.
 */
export function ClientCasePicker({
  clients,
  cases,
  mailings,
  defaultClientId,
  defaultCaseId,
  defaultMailingId,
  caseRequired = true,
  showMailing = false,
}: {
  clients: PickerClient[];
  cases: PickerCase[];
  mailings?: PickerMailing[];
  defaultClientId?: string;
  defaultCaseId?: string;
  defaultMailingId?: string;
  caseRequired?: boolean;
  showMailing?: boolean;
}) {
  const [clientId, setClientId] = useState(defaultClientId ?? "");
  const [caseId, setCaseId] = useState(defaultCaseId ?? "");
  const clientCases = useMemo(() => cases.filter((c) => c.clientId === clientId), [cases, clientId]);
  const caseMailings = useMemo(
    () => (mailings ?? []).filter((m) => m.clientId === clientId && (!caseId || m.caseId === caseId)),
    [mailings, clientId, caseId],
  );

  return (
    <div className={`grid grid-cols-1 gap-3 ${showMailing ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
      <label className="block">
        <span className="label">Client *</span>
        <select
          className="select"
          name="client_id"
          required
          value={clientId}
          onChange={(e) => {
            setClientId(e.target.value);
            setCaseId("");
          }}
          data-testid="picker-client"
        >
          <option value="">Select a client…</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="label">Case{caseRequired ? " *" : ""}</span>
        <select
          className="select"
          name="case_id"
          required={caseRequired}
          value={caseId}
          onChange={(e) => setCaseId(e.target.value)}
          disabled={!clientId}
          data-testid="picker-case"
        >
          <option value="">{clientId ? (clientCases.length ? "Select a case…" : "This client has no cases") : "Select a client first"}</option>
          {clientCases.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title}
            </option>
          ))}
        </select>
      </label>
      {showMailing && (
        <label className="block">
          <span className="label">Related outgoing letter / mailing</span>
          <select className="select" name="mailing_id" defaultValue={defaultMailingId ?? ""} disabled={!clientId} data-testid="picker-mailing">
            <option value="">Not linked to a specific mailing</option>
            {caseMailings.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}
