"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { useSession } from "@/components/use-session";
import {
  api,
  errorMessage,
  METALS,
  type Balance,
  type LedgerEntry,
  type Metal,
  type MetalRequest,
  type RequestType,
} from "@/lib/api";
import {
  Card,
  Delta,
  ErrorNote,
  KIND_LABEL,
  METAL_LABEL,
  MetalName,
  StatusBadge,
  TYPE_LABEL,
  buttonClass,
  formatDate,
  inputClass,
} from "@/components/ui";

export default function HoldingsPage() {
  const session = useSession();
  const [balances, setBalances] = useState<Balance[] | null>(null);
  const [requests, setRequests] = useState<MetalRequest[]>([]);
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [nextBalances, nextRequests, nextLedger] = await Promise.all([
        api.holdings(),
        api.requests(),
        api.ledger(),
      ]);
      setBalances(nextBalances);
      setRequests(nextRequests);
      setLedger(nextLedger);
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
        <h1 className="text-xl font-semibold">Holdings</h1>
        <p className="mt-1 text-sm text-muted">
          Metal allocated in your name. Held grams are reserved by your requests that are waiting for approval.
        </p>
      </div>

      <ErrorNote message={error} />

      <div className="grid gap-4 md:grid-cols-3">
        {METALS.map((metal) => (
          <BalanceCard key={metal} metal={metal} balance={balances?.find((b) => b.metal === metal)} />
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <RequestForm balances={balances} onCreated={load} />
        <History requests={requests} />
      </div>

      <LedgerTable entries={ledger} />
    </AppShell>
  );
}

function BalanceCard({ metal, balance }: { metal: Metal; balance?: Balance }) {
  const heldShare = balance && balance.totalMg > 0 ? (balance.heldMg / balance.totalMg) * 100 : 0;

  return (
    <Card>
      <div className="flex items-center justify-between text-sm text-muted">
        <MetalName metal={metal} />
        <span>grams</span>
      </div>
      <p className="num mt-3 text-3xl font-semibold">{balance?.total ?? "-"}</p>
      <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-raised" title={`${heldShare.toFixed(1)}% held`}>
        <div className="h-full rounded-full bg-warn/70" style={{ width: `${heldShare}%` }} />
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
        <div>
          <dt className="text-muted">Available</dt>
          <dd className="num">{balance?.available ?? "-"}</dd>
        </div>
        <div>
          <dt className="text-muted">Held</dt>
          <dd className="num text-warn">{balance?.held ?? "-"}</dd>
        </div>
      </dl>
    </Card>
  );
}

const TYPE_OPTIONS: { value: RequestType; label: string }[] = [
  { value: "deposit", label: "Deposit" },
  { value: "withdrawal", label: "Withdraw" },
  { value: "redemption", label: "Redeem" },
];

function RequestForm({ balances, onCreated }: { balances: Balance[] | null; onCreated: () => Promise<void> }) {
  const [type, setType] = useState<RequestType>("deposit");
  const [metal, setMetal] = useState<Metal>("gold");
  const [grams, setGrams] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // One idempotency key per distinct request. Pressing submit again after a
  // timeout reuses it, so the server answers with the request it already has
  // instead of creating (and holding) a second one. Any edit is a new request.
  const key = useRef("");
  useEffect(() => {
    key.current = crypto.randomUUID();
  }, [type, metal, grams, note]);

  const takesMetal = type !== "deposit";
  const available = balances?.find((b) => b.metal === metal)?.available;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const created = await api.createRequest(
        { type, metal, grams: grams.trim(), note: type === "redemption" && note.trim() ? note.trim() : undefined },
        key.current
      );
      const what = METAL_LABEL[metal].toLowerCase();
      setNotice(
        takesMetal
          ? `${created.grams} g of ${what} is now held until an admin approves the ${type}.`
          : `Deposit of ${created.grams} g of ${what} sent for approval.`
      );
      setGrams("");
      setNote("");
      await onCreated();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="New request">
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-3 gap-1 rounded-lg bg-raised p-1">
          {TYPE_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setType(option.value)}
              className={`rounded-md py-1.5 text-sm ${
                type === option.value ? "bg-panel text-gold" : "text-muted hover:text-text"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>

        <label className="block space-y-1.5">
          <span className="text-xs text-muted">Metal</span>
          <select className={inputClass} value={metal} onChange={(e) => setMetal(e.target.value as Metal)}>
            {METALS.map((m) => (
              <option key={m} value={m}>
                {METAL_LABEL[m]}
              </option>
            ))}
          </select>
        </label>

        <label className="block space-y-1.5">
          <span className="flex justify-between text-xs text-muted">
            <span>Amount (g)</span>
            {takesMetal && available && (
              <button type="button" className="text-gold hover:underline" onClick={() => setGrams(available)}>
                {available} available
              </button>
            )}
          </span>
          <input
            className={`${inputClass} num`}
            inputMode="decimal"
            placeholder="0.000"
            pattern="\d{1,7}(\.\d{1,3})?"
            title="Grams, up to 3 decimals"
            value={grams}
            onChange={(e) => setGrams(e.target.value)}
            required
          />
        </label>

        {type === "redemption" && (
          <label className="block space-y-1.5">
            <span className="text-xs text-muted">Delivery note</span>
            <input
              className={inputClass}
              placeholder="e.g. 1 x 100 g bar, insured shipping"
              maxLength={500}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
        )}

        {takesMetal && (
          <p className="text-xs text-muted">
            The amount is held from your available balance right away and released again if the request is rejected.
          </p>
        )}

        <ErrorNote message={error} />
        {notice && <p className="rounded-md border border-ok/30 bg-ok/10 px-3 py-2 text-sm text-ok">{notice}</p>}

        <button type="submit" disabled={busy} className={`${buttonClass} w-full bg-gold py-2 text-ink hover:bg-gold/90`}>
          {busy ? "Sending..." : `Request ${TYPE_LABEL[type].toLowerCase()}`}
        </button>
      </form>
    </Card>
  );
}

function History({ requests }: { requests: MetalRequest[] }) {
  return (
    <Card title="Requests">
      {requests.length === 0 ? (
        <p className="text-sm text-muted">No requests yet.</p>
      ) : (
        <div className="-mx-4 overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead className="text-left text-xs text-muted">
              <tr>
                <th className="px-4 pb-2 font-normal">Date</th>
                <th className="px-2 pb-2 font-normal">Type</th>
                <th className="px-2 pb-2 font-normal">Metal</th>
                <th className="px-2 pb-2 text-right font-normal">Grams</th>
                <th className="px-4 pb-2 font-normal">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {requests.map((r) => (
                <tr key={r.id} className="align-top">
                  <td className="px-4 py-2 text-muted">{formatDate(r.createdAt)}</td>
                  <td className="px-2 py-2">
                    {TYPE_LABEL[r.type]}
                    {r.note && <span className="block text-xs text-muted">{r.note}</span>}
                  </td>
                  <td className="px-2 py-2">
                    <MetalName metal={r.metal} />
                  </td>
                  <td className="num px-2 py-2 text-right">{r.grams}</td>
                  <td className="px-4 py-2">
                    <StatusBadge status={r.status} />
                    {r.reason && <span className="mt-1 block text-xs text-muted">{r.reason}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function LedgerTable({ entries }: { entries: LedgerEntry[] }) {
  return (
    <Card title="Ledger" action={<span className="text-xs text-muted">every change to your balance, newest first</span>}>
      {entries.length === 0 ? (
        <p className="text-sm text-muted">Nothing booked yet.</p>
      ) : (
        <div className="-mx-4 overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="text-left text-xs text-muted">
              <tr>
                <th className="px-4 pb-2 font-normal">Date</th>
                <th className="px-2 pb-2 font-normal">Entry</th>
                <th className="px-2 pb-2 font-normal">Metal</th>
                <th className="px-2 pb-2 text-right font-normal">Available</th>
                <th className="px-2 pb-2 text-right font-normal">Held</th>
                <th className="px-4 pb-2 text-right font-normal">Balance after</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {entries.map((e) => (
                <tr key={e.id}>
                  <td className="px-4 py-2 text-muted">{formatDate(e.createdAt)}</td>
                  <td className="px-2 py-2">{KIND_LABEL[e.kind]}</td>
                  <td className="px-2 py-2">
                    <MetalName metal={e.metal} />
                  </td>
                  <td className="px-2 py-2 text-right">
                    <Delta grams={e.available} />
                  </td>
                  <td className="px-2 py-2 text-right">
                    <Delta grams={e.held} />
                  </td>
                  <td className="num px-4 py-2 text-right text-muted">
                    {e.availableAfter} / {e.heldAfter}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
