import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, Users } from "lucide-react";
import { getAnalytics, listCustomers, listEvents, listLinks } from "../api.ts";
import type { AnalyticsEvent, Customer, SaleEvent } from "../types.ts";
import { errorMessage } from "../types.ts";
import { useShell } from "../lib/shell.tsx";
import { rangeFor } from "../lib/analytics.ts";
import { conversionRate } from "../lib/analytics.ts";
import { formatCount, formatDateTime, formatMoney, initials, relativeTime } from "../lib/format.ts";
import { TextInput } from "@xtandard/kit/ui";
import { Avatar } from "@xtandard/kit/ui";
import { EmptyCard, LoadingRow, Mono, NoTenant, Page, PageHeader } from "../components/bits.tsx";

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3.5">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight">{value}</p>
      {hint ? <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/** Customers attributed to clicks (first lead wins) and their sales (ADR 0010). */
export function CustomersView() {
  const { tenant, config, go } = useShell();
  const [search, setSearch] = React.useState("");
  const range = React.useMemo(() => rangeFor("90d", "day"), []);

  const customersQuery = useQuery({
    queryKey: ["customers", tenant],
    queryFn: () => listCustomers(tenant),
    enabled: !!tenant,
  });
  const totalsQuery = useQuery({
    queryKey: ["analytics", tenant, "conversions-90d", range],
    queryFn: () => getAnalytics(tenant, { ...range, interval: "none" }),
    enabled: !!tenant,
    staleTime: 60_000,
  });
  // Sales per customer from recent events (when the sink keeps raw events).
  const salesQuery = useQuery({
    queryKey: ["events", tenant, "sales-for-customers"],
    queryFn: () => listEvents(tenant, { types: ["sale"], limit: 1000 }),
    enabled: !!tenant && config.capabilities.events,
    staleTime: 60_000,
  });
  const linksQuery = useQuery({
    queryKey: ["links", tenant, "all-for-labels"],
    queryFn: () => listLinks(tenant, { archived: "all", limit: 500 }),
    enabled: !!tenant,
    staleTime: 60_000,
  });

  const revenueBy = React.useMemo(() => {
    const map = new Map<string, { amount: number; count: number; currency: string }>();
    for (const e of (salesQuery.data ?? []) as AnalyticsEvent[]) {
      if (e.type !== "sale") continue;
      const s = e as SaleEvent;
      const cur = map.get(s.customerId) ?? { amount: 0, count: 0, currency: s.currency };
      cur.amount += s.amount;
      cur.count += 1;
      map.set(s.customerId, cur);
    }
    return map;
  }, [salesQuery.data]);
  const linkMap = React.useMemo(
    () => new Map((linksQuery.data?.links ?? []).map((l) => [l.id, l])),
    [linksQuery.data],
  );

  if (!tenant) return <NoTenant />;
  const q = search.trim().toLowerCase();
  const customers = (customersQuery.data ?? []).filter(
    (c: Customer) =>
      !q ||
      c.id.toLowerCase().includes(q) ||
      c.name?.toLowerCase().includes(q) ||
      c.email?.toLowerCase().includes(q),
  );
  const totals = totalsQuery.data?.totals;
  const rate = totals ? conversionRate(totals) : null;

  return (
    <Page>
      <PageHeader
        title="Conversions"
        description="Customers attributed to the click that brought them, and the sales that followed."
      />
      <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat
          label="Customers"
          value={formatCount(customersQuery.data?.length ?? 0)}
          hint="All time"
        />
        <Stat
          label="Leads (90d)"
          value={formatCount(totals?.leads ?? 0)}
          hint={rate === null ? undefined : `${rate.toFixed(1)}% of clicks`}
        />
        <Stat label="Sales (90d)" value={formatCount(totals?.sales ?? 0)} />
        <Stat label="Revenue (90d)" value={formatMoney(totals?.saleAmount ?? 0, "USD")} />
      </div>

      <div className="mt-6 flex items-center gap-2">
        <div className="relative max-w-sm flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <TextInput
            aria-label="Search customers"
            placeholder="Search id, name or email…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>
      </div>

      {customersQuery.isLoading ? (
        <LoadingRow label="Loading customers…" />
      ) : customersQuery.isError ? (
        <EmptyCard>{errorMessage(customersQuery.error)}</EmptyCard>
      ) : customers.length === 0 ? (
        <EmptyCard icon={<Users className="size-4" />}>
          {q ? (
            "No customers match."
          ) : (
            <>
              No conversions yet. Turn on <span className="font-medium">Track conversions</span> on
              a link, then call <span className="font-mono">trackLead</span> /{" "}
              <span className="font-mono">trackSale</span> from your app.
            </>
          )}
        </EmptyCard>
      ) : (
        <div className="mt-4 overflow-hidden rounded-xl border border-border bg-card">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-2.5 font-semibold">Customer</th>
                  <th className="px-3 py-2.5 font-semibold">Came from</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Sales</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Revenue</th>
                  <th className="px-4 py-2.5 text-right font-semibold">First seen</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {customers.map((c) => {
                  const link = linkMap.get(c.linkId);
                  const rev = revenueBy.get(c.id);
                  return (
                    <tr key={c.id}>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2.5">
                          <Avatar initials={initials(c.name ?? c.email ?? c.id)} />
                          <div className="min-w-0">
                            <p className="truncate font-medium">{c.name ?? c.email ?? c.id}</p>
                            <p className="truncate text-[11.5px] text-muted-foreground">
                              {c.email && c.name ? `${c.email} · ` : ""}
                              <span className="font-mono">{c.id}</span>
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2.5">
                        {link ? (
                          <button
                            type="button"
                            onClick={() => go(`/links/${encodeURIComponent(link.id)}`)}
                            className="font-mono text-[12px] text-foreground hover:text-accent hover:underline"
                          >
                            {link.domain}/{link.slug}
                          </button>
                        ) : (
                          <Mono className="text-muted-foreground">{c.linkId}</Mono>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums">
                        {rev ? rev.count : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="px-3 py-2.5 text-right font-medium tabular-nums">
                        {rev ? (
                          formatMoney(rev.amount, rev.currency)
                        ) : (
                          <span className="font-normal text-muted-foreground">—</span>
                        )}
                      </td>
                      <td
                        className="whitespace-nowrap px-4 py-2.5 text-right text-[12px] text-muted-foreground"
                        title={formatDateTime(c.firstSeenAt)}
                      >
                        {relativeTime(c.firstSeenAt)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Page>
  );
}
