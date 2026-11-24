"use client";

import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { useSession } from "@/components/use-session";
import { api, errorMessage, type MetalRequest, type ProofOfReserve, type Reconciliation } from "@/lib/api";
import {
  Card,
  ErrorNote,
  MetalName,
  StatusBadge,
  TYPE_LABEL,
  buttonClass,
  formatDate,
  formatMg,
  inputClass,
} from "@/components/ui";

export default function AdminPage() {
  const session = useSession("admin");
  const [pending, setPending] = useState<MetalRequest[] | null>(null);
  const [recent, setRecent] = useState<MetalRequest[]>([]);
  const [reconciliation, setReconciliation] = useState<Reconciliation | null>(null);
  const [reserve, setReserve] = useState<ProofOfReserve | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [queue, completed, rejected, recon, por] = await Promise.all([
        api.queue("pending"),
        api.queue("completed"),
        api.queue("rejected"),
        api.reconciliation(),
        api.proofOfReserve(),
      ]);
      setPending(queue);
      setRecent(
        [...completed, ...rejected]
          .sort((a, b) => (b.decidedAt ?? "").localeCompare(a.decidedAt ?? ""))
          .slice(0, 8)
      );
      setReconciliation(recon);
      setReserve(por);
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);

  useEffect(() => {
    if (session) void load();
  }, [session, load]);

  if (!session) return null;

  return (
    <AppShell session={session}>
      <div>
        <h1 className="text-xl font-semibold">Operations</h1>
        <p className="mt-1 text-sm text-muted">
          Nothing moves until it is approved here. Withdrawals and redemptions are already held, so approving one can
          never overdraw an account.
        </p>
      </div>

      <ErrorNote message={error} />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card
          title={`Approval queue${pending ? ` (${pending.length})` : ""}`}
          action={<span className="text-xs text-muted">oldest first</span>}
        >
          {pending === null ? (
            <p className="text-sm text-muted">Loading...</p>
          ) : pending.length === 0 ? (
            <p className="text-sm text-muted">Queue is empty.</p>
          ) : (
            <ul className="divide-y divide-line">
              {pending.map((request) => (
                <QueueItem key={request.id} request={request} adminId={session.user.id} onDecided={load} />
              ))}
            </ul>
          )}
        </Card>

        <div className="space-y-6">
          <ReconciliationCard report={reconciliation} onRerun={load} />
          <ReserveCard reserve={reserve} />
        </div>
      </div>

      <Card title="Recently decided">
        {recent.length === 0 ? (
          <p className="text-sm text-muted">No decisions yet.</p>
        ) : (
          <ul className="divide-y divide-line text-sm">
            {recent.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2">
                <span className="w-28 text-muted">{r.decidedAt ? formatDate(r.decidedAt) : ""}</span>
                <span className="w-40 truncate">{r.user?.name ?? "Unknown"}</span>
                <span className="w-24">{TYPE_LABEL[r.type]}</span>
                <MetalName metal={r.metal} />
                <span className="num ml-auto">{r.grams} g</span>
                <StatusBadge status={r.status} />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </AppShell>
  );
}

function QueueItem({
  request,
  adminId,
  onDecided,
}: {
  request: MetalRequest;
  adminId: string;
  onDecided: () => Promise<void>;
}) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ownRequest = request.user?.id === adminId;

  const decide = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      await onDecided();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <li className="py-3">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm">
            <span className="font-medium">{request.user?.name ?? "Unknown holder"}</span>
            <span className="text-muted"> - {request.user?.email}</span>
          </p>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 text-sm">
            <span>{TYPE_LABEL[request.type]}</span>
            <MetalName metal={request.metal} />
            <span className="num text-gold">{request.grams} g</span>
            {request.type !== "deposit" && <span className="text-xs text-warn">held</span>}
          </p>
          {request.note && <p className="mt-1 text-xs text-muted">{request.note}</p>}
          <p className="mt-1 text-xs text-muted">{formatDate(request.createdAt)}</p>
        </div>

        {ownRequest ? (
          <span className="text-xs text-muted">Your own request: another admin has to decide it</span>
        ) : (
          !rejecting && (
            <div className="flex gap-2">
              <button
                disabled={busy}
                onClick={() => void decide(() => api.approve(request.id))}
                className={`${buttonClass} bg-ok/15 text-ok hover:bg-ok/25`}
              >
                Approve
              </button>
              <button
                disabled={busy}
                onClick={() => setRejecting(true)}
                className={`${buttonClass} bg-bad/15 text-bad hover:bg-bad/25`}
              >
                Reject
              </button>
            </div>
          )
        )}
      </div>

      {rejecting && (
        <form
          className="mt-3 flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void decide(() => api.reject(request.id, reason.trim()));
          }}
        >
          <input
            autoFocus
            className={`${inputClass} min-w-0 flex-1`}
            placeholder="Reason (shown to the holder)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={500}
            required
          />
          <button type="submit" disabled={busy || !reason.trim()} className={`${buttonClass} bg-bad/15 text-bad hover:bg-bad/25`}>
            Confirm reject
          </button>
          <button type="button" onClick={() => setRejecting(false)} className={`${buttonClass} text-muted hover:text-text`}>
            Cancel
          </button>
        </form>
      )}

      <div className="mt-2">
        <ErrorNote message={error} />
      </div>
    </li>
  );
}

const CHECK_LABEL: Record<string, string> = {
  ledger_available: "available differs from ledger",
  ledger_held: "held differs from ledger",
  open_requests_held: "held differs from open requests",
  missing_balance: "ledger rows without a balance",
};

function ReconciliationCard({ report, onRerun }: { report: Reconciliation | null; onRerun: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);

  const rerun = async () => {
    setBusy(true);
    await onRerun();
    setBusy(false);
  };

  return (
    <Card
      title="Reconciliation"
      action={
        <button onClick={() => void rerun()} disabled={busy} className={`${buttonClass} border border-line text-muted hover:text-text`}>
          {busy ? "Checking..." : "Run again"}
        </button>
      }
    >
      {!report ? (
        <p className="text-sm text-muted">Loading...</p>
      ) : (
        <div className="space-y-3 text-sm">
          <p className={report.ok ? "text-ok" : "text-bad"}>
            {report.ok
              ? "Balanced: every balance matches its ledger and open requests."
              : `${report.issues.length} issue${report.issues.length === 1 ? "" : "s"} found. Nothing was corrected automatically.`}
          </p>
          {!report.ok && (
            <ul className="space-y-1 text-xs">
              {report.issues.map((issue, i) => (
                <li key={i} className="rounded-md bg-bad/10 px-2 py-1.5 text-bad">
                  user ...{issue.user.slice(-6)}, {issue.metal}: {CHECK_LABEL[issue.check] ?? issue.check} (ledger{" "}
                  <span className="num">{formatMg(issue.expectedMg)}</span>, stored{" "}
                  <span className="num">{formatMg(issue.actualMg)}</span>)
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-muted">
            {report.balancesChecked} balances checked, {formatDate(report.checkedAt)}
          </p>
        </div>
      )}
    </Card>
  );
}

function ReserveCard({ reserve }: { reserve: ProofOfReserve | null }) {
  return (
    <Card title="Proof of reserve" action={<span className="text-xs text-warn">awaiting provider</span>}>
      {!reserve ? (
        <p className="text-sm text-muted">Loading...</p>
      ) : (
        <div className="space-y-3">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted">
              <tr>
                <th className="pb-2 font-normal">Metal</th>
                <th className="pb-2 text-right font-normal">Owed to holders (g)</th>
                <th className="pb-2 text-right font-normal">In vault (g)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {reserve.metals.map((row) => (
                <tr key={row.metal}>
                  <td className="py-2">
                    <MetalName metal={row.metal} />
                  </td>
                  <td className="num py-2 text-right">{row.liabilities}</td>
                  <td className="py-2 text-right text-muted">{row.reserves ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-xs text-muted">
            The owed side comes straight from holder balances. Vault figures and coverage per metal show up once a reserve
            provider is connected; until then nothing here is marked verified.
          </p>
        </div>
      )}
    </Card>
  );
}
