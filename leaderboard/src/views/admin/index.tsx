import { Fragment, useState, type ReactNode } from "react";
import type { Txn } from "@shared/types";
import { fmtInt, fmtUsd, fmtUsdExact } from "@shared/money";
import { fmtLaDate, fmtLaDateTime, periodRange } from "@shared/time";
import { store, type AdminAffiliateRow, type HierarchyNode } from "@/data/store";
import { useStoreVersion } from "@/data/useStore";
import { notify } from "@/lib/toast";
import {
  Banner,
  Button,
  Chip,
  EmptyState,
  Modal,
  Paginator,
  Segmented,
  Select,
  SkeletonPanel,
  StateChip,
  TextInput,
  cx,
} from "@/components/ui";
import {
  IconCalendar,
  IconCheck,
  IconChevronD,
  IconExport,
  IconFlag,
  IconLedger,
  IconSearch,
  IconSettings,
  IconShield,
  IconSync,
  IconTree,
  IconUsers,
  IconWarning,
  IconX,
} from "@/components/icons";

type AdminTab =
  | "overview"
  | "affiliates"
  | "ledger"
  | "queue"
  | "hierarchy"
  | "integrations"
  | "config"
  | "audit"
  | "export";

const TABS: { id: AdminTab; label: string; icon: ReactNode }[] = [
  { id: "overview", label: "Overview", icon: <IconSettings size={15} /> },
  { id: "affiliates", label: "Affiliates", icon: <IconUsers size={15} /> },
  { id: "ledger", label: "Ledger", icon: <IconLedger size={15} /> },
  { id: "queue", label: "Review queue", icon: <IconFlag size={15} /> },
  { id: "hierarchy", label: "Hierarchy", icon: <IconTree size={15} /> },
  { id: "integrations", label: "Integrations", icon: <IconSync size={15} /> },
  { id: "config", label: "Launch config", icon: <IconCalendar size={15} /> },
  { id: "audit", label: "Audit log", icon: <IconShield size={15} /> },
  { id: "export", label: "Export", icon: <IconExport size={15} /> },
];

/* ————— shared bits ————— */

function Th({ children, right }: { children: ReactNode; right?: boolean }) {
  return (
    <th
      className={cx(
        "whitespace-nowrap px-3 py-2.5 text-[11px] font-semibold uppercase tracking-[0.13em] text-mist-600",
        right ? "text-right" : "text-left",
      )}
    >
      {children}
    </th>
  );
}

function Td({ children, right, className }: { children: ReactNode; right?: boolean; className?: string }) {
  return (
    <td className={cx("px-3 py-2.5 text-[13px] text-mist-300", right && "num text-right", className)}>
      {children}
    </td>
  );
}

function ReasonModal(props: {
  open: boolean;
  title: string;
  cta: string;
  danger?: boolean;
  onClose: () => void;
  onSubmit: (reason: string) => void;
  children?: ReactNode;
}) {
  const [reason, setReason] = useState("");
  const ok = reason.trim().length >= 8;
  return (
    <Modal
      open={props.open}
      onClose={props.onClose}
      title={props.title}
      footer={
        <>
          <Button onClick={props.onClose}>Cancel</Button>
          <Button
            variant={props.danger ? "danger" : "primary"}
            disabled={!ok}
            onClick={() => {
              props.onSubmit(reason.trim());
              setReason("");
            }}
          >
            {props.cta}
          </Button>
        </>
      }
    >
      {props.children}
      <div>
        <label className="mb-1.5 block text-[12.5px] font-semibold text-mist-400">
          Reason (required, audited)
        </label>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          placeholder="Why is this action being taken? Minimum 8 characters."
          className="w-full rounded-lg border border-white/10 bg-ink-900/70 px-3 py-2 text-[13.5px] text-mist-100 placeholder:text-mist-600 focus:border-accent-500/50 focus:outline-none"
        />
      </div>
    </Modal>
  );
}

/* ————— overview ————— */

function Overview() {
  const month = periodRange("monthly", Date.now());
  const rows = store.adminAffiliates("", "all");
  const totalMonth = rows.reduce((s, r) => s + r.monthCents, 0);
  const activeCount = rows.filter((r) => r.affiliate.status === "active").length;
  const integ = store.integrations();
  const queue = store.queue();

  const stat = (label: string, value: ReactNode, foot: string) => (
    <div className="panel flex flex-col gap-1.5 p-4">
      <span className="text-[12px] font-semibold text-mist-500">{label}</span>
      <span className="num font-display text-[26px] font-semibold leading-none text-mist-50">{value}</span>
      <span className="text-[11.5px] text-mist-600">{foot}</span>
    </div>
  );

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {stat("Eligible sales", fmtUsd(totalMonth), `Month-to-date since ${fmtLaDate(month.startMs)}`)}
        {stat("Active affiliates", fmtInt(activeCount), `${fmtInt(rows.length)} total accounts`)}
        {stat("Pool seats", `${store.seatsClaimed()}/${store.data.config.seatCap}`, "Verified members")}
        {stat("Pending reviews", fmtInt(queue.length), "Verification & refund queue")}
        {stat("Failed events", fmtInt(integ.failedEvents.length), "Awaiting replay")}
      </div>

      {integ.failedEvents.length > 0 ? (
        <Banner tone="warn">
          {integ.failedEvents.length} integration event{integ.failedEvents.length > 1 ? "s" : ""} failed —
          see Integrations to replay.
        </Banner>
      ) : null}

      <div className="panel overflow-hidden">
        <div className="border-b border-white/5 px-4 py-3 text-[13px] font-semibold text-mist-300">
          Recent reconciliation & sync runs
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse">
            <thead>
              <tr className="border-b border-white/5">
                <Th>Run</Th><Th>Source</Th><Th>Started</Th><Th right>Scanned</Th><Th right>Updated</Th><Th right>Discrepancies</Th><Th>Result</Th>
              </tr>
            </thead>
            <tbody>
              {integ.syncRuns.slice(0, 6).map((r) => (
                <tr key={r.id} className="border-b border-white/[0.04]">
                  <Td className="font-medium text-mist-200">{r.kind}</Td>
                  <Td>{r.source}</Td>
                  <Td>{fmtLaDateTime(Date.parse(r.startedAt))}</Td>
                  <Td right>{fmtInt(r.scanned)}</Td>
                  <Td right>{fmtInt(r.updated)}</Td>
                  <Td right>{fmtInt(r.discrepancies)}</Td>
                  <Td>
                    {r.ok ? (
                      <Chip tone="ok"><IconCheck size={12} /> ok</Chip>
                    ) : (
                      <Chip tone="err"><IconX size={12} /> failed</Chip>
                    )}
                    <span className="ml-2 text-[12px] text-mist-600">{r.note}</span>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ————— affiliates ————— */

function AffiliateDetail({ row }: { row: AdminAffiliateRow }) {
  const txns = store.txns(row.affiliate.id).slice(0, 5);
  const m = row.membership;
  const dates: [string, string][] = [
    ["Enrolled", fmtLaDateTime(row.enrolledAtMs)],
    ["Window start", row.window ? fmtLaDateTime(row.window.startMs) : "— (launch pending)"],
    ["Window deadline", row.window ? fmtLaDateTime(row.window.endMs) : "—"],
    ["Qualified", m ? fmtLaDateTime(Date.parse(m.qualifiedAt)) : "—"],
    ["Verified (seat basis)", m ? fmtLaDateTime(Date.parse(m.verifiedAt)) : "—"],
    ["Membership ends", m ? fmtLaDateTime(Date.parse(m.membershipExpiresAt)) : "—"],
  ];
  return (
    <div className="grid gap-4 bg-ink-900/40 px-4 py-4 lg:grid-cols-2">
      <div>
        <div className="mb-2 text-[11.5px] font-semibold uppercase tracking-[0.14em] text-mist-600">Key dates (PT)</div>
        <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
          {dates.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-[12.5px] text-mist-600">{k}</dt>
              <dd className="num m-0 text-[12.5px] text-mist-300">{v}</dd>
            </div>
          ))}
        </dl>
        {m ? (
          <div className="mt-2 text-[12px] text-mist-500">
            Seat <span className="num text-mist-300">{m.seatNo}</span> · path{" "}
            <span className="text-mist-300">{m.path.replace("_", " ")}</span>
          </div>
        ) : null}
      </div>
      <div>
        <div className="mb-2 text-[11.5px] font-semibold uppercase tracking-[0.14em] text-mist-600">Latest orders</div>
        <ul className="m-0 list-none space-y-1.5 p-0">
          {txns.length === 0 ? <li className="text-[12.5px] text-mist-600">No transactions</li> : null}
          {txns.map((t) => (
            <li key={t.id} className="flex items-center justify-between gap-3 text-[12.5px]">
              <span className="num text-mist-500">{t.externalId}</span>
              <span className="text-mist-600">{fmtLaDate(Date.parse(t.occurredAt))}</span>
              <span className={cx("num font-medium", t.paymentStatus === "paid" ? "text-mist-200" : "text-warn-400")}>
                {fmtUsdExact(t.grossCents - t.discountCents)}
              </span>
              <span className="text-[11px] uppercase tracking-wide text-mist-600">{t.paymentStatus}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function Affiliates() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"all" | "active" | "suspended" | "pending">("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const rows = store.adminAffiliates(search, status);
  const pageCount = Math.max(1, Math.ceil(rows.length / 12));
  const p = Math.min(page, pageCount);
  const slice = rows.slice((p - 1) * 12, p * 12);

  return (
    <div className="panel overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b border-white/5 px-4 py-3">
        <TextInput value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Search name or id…" icon={<IconSearch size={15} />} className="w-full sm:w-64" />
        <Segmented
          ariaLabel="Account status filter"
          value={status}
          onChange={(v) => { setStatus(v); setPage(1); }}
          options={[
            { value: "all", label: "All" },
            { value: "active", label: "Active" },
            { value: "suspended", label: "Suspended" },
          ]}
        />
        <span className="num ml-auto text-[12.5px] text-mist-600">{fmtInt(rows.length)} accounts</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[860px] border-collapse">
          <thead>
            <tr className="border-b border-white/5">
              <Th>Affiliate</Th><Th>Status</Th><Th>Enrolled</Th><Th right>Month</Th><Th right>All-time</Th><Th right>Team (mo)</Th><Th>Challenge</Th><Th> </Th>
            </tr>
          </thead>
          <tbody>
            {slice.map((r) => (
              <Fragment key={r.affiliate.id}>
                <tr className="border-b border-white/[0.04] hover:bg-white/[0.02]">
                  <Td className="font-medium text-mist-100">{r.affiliate.displayName}
                    <span className="num ml-2 text-[11px] text-mist-600">{r.affiliate.id}</span>
                  </Td>
                  <Td>
                    {r.affiliate.status === "active" ? (
                      <Chip tone="ok">active</Chip>
                    ) : r.affiliate.status === "suspended" ? (
                      <Chip tone="err">suspended</Chip>
                    ) : (
                      <Chip tone="warn">pending</Chip>
                    )}
                  </Td>
                  <Td>{fmtLaDate(r.enrolledAtMs)}</Td>
                  <Td right>{fmtUsd(r.monthCents)}</Td>
                  <Td right>{fmtUsd(r.allTimeCents)}</Td>
                  <Td right>{r.teamMonthCents === null ? <span className="text-mist-600">not connected</span> : fmtUsd(r.teamMonthCents)}</Td>
                  <Td><StateChip state={r.state} /></Td>
                  <Td right>
                    <Button sm aria-label={`Toggle details for ${r.affiliate.displayName}`} onClick={() => setOpenId(openId === r.affiliate.id ? null : r.affiliate.id)}>
                      <IconChevronD size={14} className={cx("transition-transform", openId === r.affiliate.id && "rotate-180")} />
                    </Button>
                  </Td>
                </tr>
                {openId === r.affiliate.id ? (
                  <tr className="border-b border-white/[0.04]">
                    <td colSpan={8} className="p-0"><AffiliateDetail row={r} /></td>
                  </tr>
                ) : null}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      {slice.length === 0 ? (
        <div className="p-4"><EmptyState title="No accounts match" body="Adjust the search or status filter." /></div>
      ) : null}
      <div className="flex items-center justify-end border-t border-white/5 px-4 py-2.5">
        <Paginator page={p} pageCount={pageCount} onPage={setPage} />
      </div>
    </div>
  );
}

/* ————— ledger ————— */

function CorrectionModal({ txn, onClose }: { txn: Txn; onClose: () => void }) {
  const [action, setAction] = useState<"unpaid" | "verify" | "refund">("unpaid");
  const [refund, setRefund] = useState("");
  return (
    <ReasonModal
      open
      title={`Correct ${txn.externalId}`}
      cta="Apply correction"
      onClose={onClose}
      onSubmit={(reason) => {
        const change =
          action === "unpaid"
            ? { paymentStatus: "unpaid" as const, paymentVerified: false }
            : action === "verify"
              ? { paymentStatus: "paid" as const, paymentVerified: true }
              : { refundedCents: Math.round(Number(refund || "0") * 100), paymentStatus: "partially_refunded" as const };
        const r = store.correctTxn(txn.id, change, reason);
        notify(r.message, r.ok ? "ok" : "err");
        onClose();
      }}
    >
      <div className="space-y-2 text-[13px] text-mist-400">
        <div className="panel-inset flex flex-wrap justify-between gap-2 px-3 py-2">
          <span>{txn.orderRef} · {fmtLaDateTime(Date.parse(txn.occurredAt))}</span>
          <span className="num">{fmtUsdExact(txn.grossCents - txn.discountCents)} · {txn.paymentStatus}</span>
        </div>
        <Select
          ariaLabel="Correction type"
          className="w-full"
          value={action}
          onChange={setAction}
          options={[
            { value: "unpaid", label: "Mark unpaid (exclude from eligible sales)" },
            { value: "verify", label: "Mark paid & verified (admin verification)" },
            { value: "refund", label: "Record refund amount…" },
          ]}
        />
        {action === "refund" ? (
          <TextInput value={refund} onChange={setRefund} placeholder="Refund amount in USD, e.g. 149.00" ariaLabel="Refund amount" />
        ) : null}
      </div>
    </ReasonModal>
  );
}

function Ledger() {
  const [payment, setPayment] = useState<"all" | Txn["paymentStatus"]>("all");
  const [eligibility, setEligibility] = useState<"all" | "eligible" | "excluded">("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [correcting, setCorrecting] = useState<Txn | null>(null);
  const res = store.ledger({ payment, eligibility, search }, page, 12);

  return (
    <div className="panel overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b border-white/5 px-4 py-3">
        <TextInput value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Search affiliate, txn id, order…" icon={<IconSearch size={15} />} className="w-full sm:w-72" />
        <Select
          ariaLabel="Payment status filter"
          value={payment}
          onChange={(v) => { setPayment(v); setPage(1); }}
          options={[
            { value: "all", label: "All payment states" },
            { value: "paid", label: "Paid" },
            { value: "pending", label: "Pending" },
            { value: "unpaid", label: "Unpaid" },
            { value: "partially_refunded", label: "Partially refunded" },
            { value: "refunded", label: "Refunded" },
          ]}
        />
        <Segmented
          ariaLabel="Eligibility filter"
          value={eligibility}
          onChange={(v) => { setEligibility(v); setPage(1); }}
          options={[
            { value: "all", label: "All" },
            { value: "eligible", label: "Eligible" },
            { value: "excluded", label: "Excluded" },
          ]}
        />
        <span className="num ml-auto text-[12.5px] text-mist-600">{fmtInt(res.total)} transactions</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[980px] border-collapse">
          <thead>
            <tr className="border-b border-white/5">
              <Th>Txn</Th><Th>Affiliate</Th><Th>Date (PT)</Th><Th right>Gross</Th><Th right>Disc.</Th><Th right>Tax</Th><Th right>Ship</Th><Th right>Refunded</Th><Th>Payment</Th><Th right>Eligible</Th><Th> </Th>
            </tr>
          </thead>
          <tbody>
            {res.rows.map((r) => (
              <tr key={r.txn.id} className="border-b border-white/[0.04] hover:bg-white/[0.02]">
                <Td className="num text-mist-200">
                  {r.txn.externalId}
                  {r.txn.isFoundersPack ? <Chip tone="gold" className="ml-1.5">FP</Chip> : null}
                  {r.txn.correctedBy ? <Chip tone="warn" className="ml-1.5" title="Admin-corrected — see audit log">corrected</Chip> : null}
                </Td>
                <Td>{r.affiliateName}</Td>
                <Td>{fmtLaDate(Date.parse(r.txn.occurredAt))}</Td>
                <Td right>{fmtUsdExact(r.txn.grossCents)}</Td>
                <Td right>{r.txn.discountCents ? `−${fmtUsdExact(r.txn.discountCents)}` : "—"}</Td>
                <Td right className="text-mist-600">{fmtUsdExact(r.txn.taxCents)}</Td>
                <Td right className="text-mist-600">{r.txn.shippingCents ? fmtUsdExact(r.txn.shippingCents) : "—"}</Td>
                <Td right>{r.txn.refundedCents ? <span className="text-neg-400">−{fmtUsdExact(r.txn.refundedCents)}</span> : "—"}</Td>
                <Td>
                  {r.txn.paymentStatus === "paid" ? (
                    <Chip tone="ok">paid{r.txn.paymentVerified ? " ✓" : ""}</Chip>
                  ) : r.txn.paymentStatus === "pending" ? (
                    <Chip tone="warn">pending</Chip>
                  ) : r.txn.paymentStatus === "unpaid" ? (
                    <Chip tone="err">unpaid</Chip>
                  ) : (
                    <Chip tone="neutral">{r.txn.paymentStatus.replace("_", " ")}</Chip>
                  )}
                </Td>
                <Td right>
                  {r.eligible ? (
                    <span className="font-semibold text-mist-100">{fmtUsdExact(r.eligibleCents)}</span>
                  ) : (
                    <span title={r.reason ?? ""} className="text-[12px] text-mist-600">excluded · {r.reason?.replaceAll("_", " ")}</span>
                  )}
                </Td>
                <Td right>
                  <Button sm onClick={() => setCorrecting(r.txn)}>Correct</Button>
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between border-t border-white/5 px-4 py-2.5">
        <span className="text-[12px] text-mist-600">Eligible = verified-paid product revenue − discounts − refunds, excl. tax & shipping (proposed policy)</span>
        <Paginator page={res.page} pageCount={res.pageCount} onPage={setPage} />
      </div>
      {correcting ? <CorrectionModal txn={correcting} onClose={() => setCorrecting(null)} /> : null}
    </div>
  );
}

/* ————— review queue ————— */

function Queue() {
  const items = store.queue();
  const [decide, setDecide] = useState<{ id: string; mode: "approve" | "reject"; title: string } | null>(null);

  return (
    <div className="space-y-3">
      {items.length === 0 ? (
        <EmptyState icon={<IconCheck size={20} />} title="Queue is clear" body="New Founders Pack verifications and flagged refunds will appear here." />
      ) : (
        items.map((it) => (
          <div key={it.id} className="panel flex flex-wrap items-center gap-4 p-4">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                {it.kind === "founders_pack" ? <Chip tone="gold">Founders Pack</Chip> : <Chip tone="warn">Refund review</Chip>}
                <span className="font-medium text-mist-100">{it.affiliateName}</span>
                <span className="num text-[12px] text-mist-600">{it.txn?.externalId ?? ""} · submitted {fmtLaDateTime(Date.parse(it.submittedAt))}</span>
              </div>
              <p className="mb-0 mt-1.5 text-[13px] leading-relaxed text-mist-500">{it.note}</p>
              {it.txn ? (
                <div className="num mt-1.5 text-[12.5px] text-mist-400">
                  {fmtUsdExact(it.txn.grossCents - it.txn.discountCents)} · {it.txn.paymentStatus}
                  {it.txn.paymentVerified ? " · verified" : " · unverified"}
                </div>
              ) : null}
            </div>
            <div className="flex gap-2">
              <Button variant="primary" sm onClick={() => setDecide({ id: it.id, mode: "approve", title: `Approve — ${it.affiliateName}` })}>
                <IconCheck size={14} /> {it.kind === "refund_review" ? "Resolve" : "Verify & approve"}
              </Button>
              {it.kind === "founders_pack" ? (
                <Button variant="danger" sm onClick={() => setDecide({ id: it.id, mode: "reject", title: `Reject — ${it.affiliateName}` })}>
                  <IconX size={14} /> Reject
                </Button>
              ) : null}
            </div>
          </div>
        ))
      )}
      <p className="m-0 text-[12px] text-mist-600">
        Approving a Founders Pack marks the payment admin-verified and claims the next seat if any of
        the {store.data.config.seatCap} remain — post-qualification refunds are flagged here instead of
        auto-revoking membership.
      </p>
      {decide ? (
        <ReasonModal
          open
          title={decide.title}
          cta={decide.mode === "approve" ? "Confirm" : "Reject"}
          danger={decide.mode === "reject"}
          onClose={() => setDecide(null)}
          onSubmit={(reason) => {
            const r = decide.mode === "approve" ? store.approve(decide.id, reason) : store.reject(decide.id, reason);
            notify(r.message, r.ok ? "ok" : "warn");
            setDecide(null);
          }}
        />
      ) : null}
    </div>
  );
}

/* ————— hierarchy ————— */

function TreeNode({ node, depth }: { node: HierarchyNode; depth: number }) {
  return (
    <li className="list-none">
      <div
        className={cx(
          "flex flex-wrap items-center gap-2.5 rounded-lg border px-3 py-2",
          node.verified ? "border-white/[0.06] bg-white/[0.02]" : "border-warn-500/30 bg-warn-500/[0.05]",
        )}
        style={{ marginLeft: depth * 22 }}
      >
        <span className="text-[13.5px] font-medium text-mist-100">{node.affiliate.displayName}</span>
        <span className="num text-[12px] text-mist-600">{fmtUsd(node.monthCents)} mo</span>
        {node.verified ? (
          <Chip tone="ok" className="ml-auto"><IconCheck size={11} /> verified</Chip>
        ) : (
          <Chip tone="warn" className="ml-auto"><IconWarning size={11} /> unverified — excluded from team totals</Chip>
        )}
      </div>
      {node.children.length > 0 ? (
        <ul className="m-0 mt-1.5 space-y-1.5 p-0">
          {node.children.map((c) => (
            <TreeNode key={c.affiliate.id} node={c} depth={depth + 1} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function Hierarchy() {
  const roots = store.hierarchy();
  return (
    <div className="panel space-y-4 p-5">
      <p className="m-0 text-[13px] leading-relaxed text-mist-500">
        Parent → child relationships from Tapfiliate MLM data. Team totals only ever roll up{" "}
        <span className="font-semibold text-mist-300">verified</span> edges (sample policy: self +
        verified descendants, each transaction counted once) — unverified branches show “Team data
        not connected” to the affiliate.
      </p>
      <ul className="m-0 space-y-3 p-0">
        {roots.map((r) => (
          <TreeNode key={r.affiliate.id} node={r} depth={0} />
        ))}
      </ul>
    </div>
  );
}

/* ————— integrations ————— */

function Integrations() {
  const integ = store.integrations();
  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="panel p-5">
          <div className="flex items-center justify-between">
            <span className="font-display text-[15px] font-semibold text-mist-100">Tapfiliate</span>
            <Chip tone="cyan">demo feed</Chip>
          </div>
          <p className="mb-0 mt-2 text-[13px] leading-relaxed text-mist-500">{integ.tapfiliate.note}</p>
          <div className="num mt-3 text-[12.5px] text-mist-400">
            Last successful sync: <span className="text-mist-200">{fmtLaDateTime(integ.tapfiliate.lastSyncMs)}</span>
          </div>
          <ul className="m-0 mt-3 list-none space-y-1 p-0 text-[12.5px] text-mist-500">
            <li>· API key — <span className="text-warn-400">not configured</span></li>
            <li>· Webhook endpoint — <span className="text-mist-300">/api/webhooks/tapfiliate/&lt;secret&gt;</span></li>
            <li>· Initial import — <span className="text-warn-400">not run</span></li>
          </ul>
        </div>
        <div className="panel p-5">
          <div className="flex items-center justify-between">
            <span className="font-display text-[15px] font-semibold text-mist-100">Sellavi payment verification</span>
            <Chip tone="warn">manual mode</Chip>
          </div>
          <p className="mb-0 mt-2 text-[13px] leading-relaxed text-mist-500">{integ.sellavi.note}</p>
          <p className="mb-0 mt-3 text-[12.5px] leading-relaxed text-mist-600">
            Unpaid Zelle/manual orders never count as paid sales. When a Sellavi API/webhook is
            confirmed, the adapter switches from manual review to automatic verification.
          </p>
        </div>
      </div>

      <div className="panel overflow-hidden">
        <div className="border-b border-white/5 px-4 py-3 text-[13px] font-semibold text-mist-300">
          Failed events {integ.failedEvents.length ? `(${integ.failedEvents.length})` : ""}
        </div>
        {integ.failedEvents.length === 0 ? (
          <div className="px-4 py-5 text-[13px] text-mist-600">No failed events — every delivery reconciled.</div>
        ) : (
          integ.failedEvents.map((ev) => (
            <div key={ev.id} className="flex flex-wrap items-center gap-3 border-b border-white/[0.04] px-4 py-3">
              <Chip tone={ev.source === "tapfiliate" ? "cyan" : "warn"}>{ev.source}</Chip>
              <span className="num text-[12.5px] text-mist-500">{ev.id}</span>
              <span className="text-[13px] text-mist-300">{ev.error}</span>
              <span className="text-[12px] text-mist-600">{ev.payloadRef} · {fmtLaDateTime(Date.parse(ev.receivedAt))}</span>
              <Button sm className="ml-auto" onClick={() => { store.retryFailedEvent(ev.id); notify(`Replayed ${ev.id}`); }}>
                <IconSync size={13} /> Replay
              </Button>
            </div>
          ))
        )}
      </div>

      <div className="panel overflow-hidden">
        <div className="border-b border-white/5 px-4 py-3 text-[13px] font-semibold text-mist-300">Sync history</div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse">
            <thead>
              <tr className="border-b border-white/5">
                <Th>Kind</Th><Th>Source</Th><Th>When (PT)</Th><Th right>Scanned</Th><Th right>Updated</Th><Th right>Discrepancies</Th><Th>Note</Th>
              </tr>
            </thead>
            <tbody>
              {integ.syncRuns.map((r) => (
                <tr key={r.id} className="border-b border-white/[0.04]">
                  <Td className={r.ok ? "" : "text-neg-400"}>{r.kind}{r.ok ? "" : " ✗"}</Td>
                  <Td>{r.source}</Td>
                  <Td>{fmtLaDateTime(Date.parse(r.startedAt))}</Td>
                  <Td right>{fmtInt(r.scanned)}</Td>
                  <Td right>{fmtInt(r.updated)}</Td>
                  <Td right>{fmtInt(r.discrepancies)}</Td>
                  <Td className="text-mist-600">{r.note}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ————— launch config ————— */

function LaunchConfig() {
  const cfg = store.data.config;
  const [dt, setDt] = useState("");
  const [confirm, setConfirm] = useState<null | { iso: string | null; label: string }>(null);

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="panel p-5">
          <div className="text-[12.5px] font-semibold text-mist-500">Production launch date</div>
          <div className="font-display mt-2 text-2xl font-semibold text-warn-400">Launch date pending</div>
          <p className="mb-0 mt-2 text-[13px] leading-relaxed text-mist-500">
            No production launch date is configured — affiliates see “Launch date pending” and no
            windows exist until you set it. Enrolled before launch → fresh 30-day window at launch;
            on/after launch → 30 days from enrollment.
          </p>
        </div>
        <div className="panel p-5">
          <div className="flex items-center justify-between">
            <span className="text-[12.5px] font-semibold text-mist-500">Demo sample launch date</span>
            <Chip tone="warn">sample</Chip>
          </div>
          <div className="font-display num mt-2 text-2xl font-semibold text-mist-50">
            {cfg.launchAt ? fmtLaDateTime(Date.parse(cfg.launchAt)) : "— cleared"}
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <input
              type="datetime-local"
              aria-label="New sample launch date"
              value={dt}
              onChange={(e) => setDt(e.target.value)}
              className="rounded-lg border border-white/10 bg-ink-900/70 px-2.5 py-2 text-[13px] text-mist-100 focus:border-accent-500/50 focus:outline-none"
            />
            <Button
              variant="soft"
              sm
              disabled={!dt}
              onClick={() => setConfirm({ iso: new Date(dt).toISOString(), label: "Set sample launch date" })}
            >
              Set sample date
            </Button>
            <Button sm onClick={() => setConfirm({ iso: null, label: "Clear launch date (production behavior)" })}>
              Clear
            </Button>
          </div>
          <p className="mb-0 mt-3 text-[12px] text-mist-600">
            Demo store only — the production value lives in D1 and changes are audited.
          </p>
        </div>
      </div>

      <div className="panel p-5">
        <div className="mb-2 text-[12.5px] font-semibold text-mist-500">Decisions required before production activation</div>
        <ul className="m-0 list-disc space-y-1.5 pl-5 text-[13px] leading-relaxed text-mist-400">
          <li>Confirm the eligible-sales policy (currently proposed: verified-paid product revenue − discounts − refunds, excl. tax & shipping).</li>
          <li>Confirm how verification timing sets <span className="font-semibold text-mist-200">seat priority</span> and the <span className="font-semibold text-mist-200">membership start date</span> (current build: both use verification-completion time).</li>
          <li>Confirm the team rollup policy (sample: self + verified descendants) and the refund-after-qualification policy.</li>
        </ul>
      </div>

      {confirm ? (
        <ReasonModal
          open
          title={confirm.label}
          cta="Save (audited)"
          onClose={() => setConfirm(null)}
          onSubmit={(reason) => {
            const r = store.setLaunchDate(confirm.iso, reason);
            notify(r.message, r.ok ? "ok" : "err");
            setConfirm(null);
            setDt("");
          }}
        />
      ) : null}
    </div>
  );
}

/* ————— audit & export ————— */

function Audit() {
  const rows = store.audit();
  return (
    <div className="panel overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse">
          <thead>
            <tr className="border-b border-white/5">
              <Th>When (PT)</Th><Th>Actor</Th><Th>Action</Th><Th>Entity</Th><Th>Reason</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.id} className="border-b border-white/[0.04] align-top">
                <Td className="whitespace-nowrap">{fmtLaDateTime(Date.parse(a.at))}</Td>
                <Td>{a.actor}</Td>
                <Td className="num text-accent-300">{a.action}</Td>
                <Td className="num text-mist-500">{a.entity}:{a.entityId}</Td>
                <Td className="max-w-[380px] text-mist-400">{a.reason}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Export() {
  const [preview, setPreview] = useState<{ filename: string; content: string } | null>(null);
  const run = (kind: "affiliates" | "ledger") => {
    const file = store.exportCsv(kind);
    setPreview(file);
    try {
      const url = URL.createObjectURL(new Blob([file.content], { type: "text/csv" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = file.filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      /* sandboxed preview blocks downloads — the copy dialog below still works */
    }
  };
  return (
    <div className="panel space-y-4 p-5">
      <p className="m-0 text-[13px] leading-relaxed text-mist-500">
        Exports contain permitted admin fields only — no customer details, credentials or internal
        records. Both files are generated from the demo dataset.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="soft" onClick={() => run("affiliates")}>
          <IconExport size={15} /> Affiliates summary (CSV)
        </Button>
        <Button variant="soft" onClick={() => run("ledger")}>
          <IconExport size={15} /> Transaction ledger (CSV)
        </Button>
      </div>
      {preview ? (
        <Modal open onClose={() => setPreview(null)} title={preview.filename} wide
          footer={
            <Button
              variant="primary"
              onClick={() => {
                void navigator.clipboard.writeText(preview.content).then(() => notify("CSV copied to clipboard"));
              }}
            >
              Copy CSV
            </Button>
          }
        >
          <p className="m-0 text-[12.5px] text-mist-500">
            If the download didn’t start (sandboxed previews block it), copy the CSV below.
          </p>
          <textarea
            readOnly
            value={preview.content}
            rows={12}
            className="num w-full rounded-lg border border-white/10 bg-ink-950/80 p-3 font-mono text-[11.5px] leading-relaxed text-mist-300"
          />
        </Modal>
      ) : null}
    </div>
  );
}

/* ————— admin root ————— */

export function AdminView() {
  useStoreVersion();
  const [tab, setTab] = useState<AdminTab>("overview");
  const queueCount = store.queue().length;
  const failedCount = store.integrations().failedEvents.length;

  let content: ReactNode;
  switch (tab) {
    case "overview": content = <Overview />; break;
    case "affiliates": content = <Affiliates />; break;
    case "ledger": content = <Ledger />; break;
    case "queue": content = <Queue />; break;
    case "hierarchy": content = <Hierarchy />; break;
    case "integrations": content = <Integrations />; break;
    case "config": content = <LaunchConfig />; break;
    case "audit": content = <Audit />; break;
    case "export": content = <Export />; break;
  }

  if (store.loading) {
    return (
      <div className="space-y-4">
        <SkeletonPanel lines={2} />
        <SkeletonPanel lines={6} />
      </div>
    );
  }

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[210px_1fr]">
      <nav
        aria-label="Admin sections"
        className="flex gap-1.5 overflow-x-auto pb-1 lg:sticky lg:top-16 lg:flex-col lg:overflow-visible"
      >
        {TABS.map((t) => {
          const active = t.id === tab;
          const badge = t.id === "queue" ? queueCount : t.id === "integrations" ? failedCount : 0;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cx(
                "flex shrink-0 cursor-pointer items-center gap-2.5 whitespace-nowrap rounded-lg border px-3.5 py-2.5 text-[13.5px] font-semibold transition-colors",
                active
                  ? "border-accent-500/35 bg-accent-500/12 text-accent-200"
                  : "border-transparent bg-transparent text-mist-500 hover:bg-white/[0.04] hover:text-mist-200",
              )}
            >
              {t.icon}
              {t.label}
              {badge > 0 ? (
                <span className="num ml-auto rounded-full bg-warn-500/20 px-1.5 py-0.5 text-[11px] font-bold text-warn-400">
                  {badge}
                </span>
              ) : null}
            </button>
          );
        })}
      </nav>
      <div className="min-w-0">{content}</div>
    </div>
  );
}
