import type { LedgerEntry, Metal, MetalRequest } from "@/lib/api";

export const METAL_LABEL: Record<Metal, string> = { gold: "Gold", silver: "Silver", platinum: "Platinum" };

const METAL_COLOR: Record<Metal, string> = {
  gold: "bg-gold",
  silver: "bg-silver",
  platinum: "bg-platinum",
};

export const TYPE_LABEL: Record<MetalRequest["type"], string> = {
  deposit: "Deposit",
  withdrawal: "Withdrawal",
  redemption: "Redemption",
};

export const KIND_LABEL: Record<LedgerEntry["kind"], string> = {
  deposit_credit: "Deposit credited",
  hold: "Held for request",
  settle: "Withdrawn",
  release: "Hold released",
};

export function Card({
  title,
  action,
  children,
  className = "",
}: {
  title?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-xl border border-line bg-panel ${className}`}>
      {(title || action) && (
        <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <h2 className="text-sm font-medium text-text">{title}</h2>
          {action}
        </div>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function MetalName({ metal }: { metal: Metal }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className={`h-2 w-2 rounded-full ${METAL_COLOR[metal]}`} />
      {METAL_LABEL[metal]}
    </span>
  );
}

const STATUS_STYLE: Record<MetalRequest["status"], string> = {
  pending: "border-warn/30 bg-warn/10 text-warn",
  completed: "border-ok/30 bg-ok/10 text-ok",
  rejected: "border-bad/30 bg-bad/10 text-bad",
};

export function StatusBadge({ status }: { status: MetalRequest["status"] }) {
  return (
    <span className={`inline-block rounded-full border px-2 py-0.5 text-xs capitalize ${STATUS_STYLE[status]}`}>
      {status}
    </span>
  );
}

/** "-40.500" / "+12.000" / "0.000" with the sign coloured. */
export function Delta({ grams }: { grams: string }) {
  if (/^0\.0+$/.test(grams)) return <span className="num text-muted">0.000</span>;
  const negative = grams.startsWith("-");
  return <span className={`num ${negative ? "text-bad" : "text-ok"}`}>{negative ? grams : `+${grams}`}</span>;
}

/** Integer milligrams to "12.345", without going through a float. */
export function formatMg(mg: number) {
  const sign = mg < 0 ? "-" : "";
  const abs = Math.abs(mg);
  return `${sign}${Math.floor(abs / 1000)}.${String(abs % 1000).padStart(3, "0")}`;
}

export function formatDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function ErrorNote({ message }: { message: string | null }) {
  if (!message) return null;
  return <p className="rounded-md border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad">{message}</p>;
}

export const buttonClass =
  "rounded-md px-3 py-1.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50";
export const inputClass =
  "w-full rounded-md border border-line bg-raised px-3 py-2 text-sm text-text outline-none placeholder:text-muted/60 focus:border-gold/60";
