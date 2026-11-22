import * as React from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { BadgeDollarSign, MousePointerClick, QrCode, UserPlus } from "lucide-react";
import { listEvents } from "../api.ts";
import type { AnalyticsEvent, PublicLink } from "../types.ts";
import { errorMessage } from "../types.ts";
import {
  countryName,
  flagEmoji,
  formatDateTime,
  formatMoney,
  prettyValue,
  relativeTime,
} from "../lib/format.ts";
import { Button } from "@xtandard/kit/ui";
import { StatusBadge } from "./bits.tsx";
import { Segmented } from "@xtandard/kit/ui";

type Kind = "all" | AnalyticsEvent["type"];

const PAGE = 25;

/** The most recent clicks / leads / sales (needs `capabilities.events`). */
export function RecentEvents({
  tenant,
  linkIds,
  links,
  showLink = true,
}: {
  tenant: string;
  linkIds?: string[];
  links?: PublicLink[];
  showLink?: boolean;
}) {
  const [kind, setKind] = React.useState<Kind>("all");
  const query = useInfiniteQuery({
    queryKey: ["events", tenant, linkIds, kind],
    queryFn: ({ pageParam }) =>
      listEvents(tenant, {
        linkIds,
        types: kind === "all" ? undefined : [kind],
        limit: PAGE,
        before: pageParam,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => (last.length === PAGE ? last[last.length - 1]?.at : undefined),
    enabled: !!tenant,
    staleTime: 15_000,
  });
  const events = query.data?.pages.flat() ?? [];
  const linkMap = React.useMemo(() => new Map((links ?? []).map((l) => [l.id, l])), [links]);

  return (
    <section className="rounded-xl border border-border bg-card">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
        <h2 className="text-[13px] font-semibold">Recent activity</h2>
        <Segmented
          size="sm"
          value={kind}
          onValueChange={setKind}
          options={[
            { value: "all", label: "All" },
            { value: "click", label: "Clicks" },
            { value: "lead", label: "Leads" },
            { value: "sale", label: "Sales" },
          ]}
        />
      </div>
      {query.isError ? (
        <p className="px-4 py-8 text-center text-[13px] text-muted-foreground">
          {errorMessage(query.error, "Failed to load events")}
        </p>
      ) : query.isLoading ? (
        <p className="px-4 py-8 text-center text-[13px] text-muted-foreground">Loading…</p>
      ) : events.length === 0 ? (
        <p className="px-4 py-8 text-center text-[13px] text-muted-foreground">No events yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[12.5px]">
            <thead>
              <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-2 font-semibold">Event</th>
                {showLink && <th className="px-3 py-2 font-semibold">Link</th>}
                <th className="px-3 py-2 font-semibold">Location</th>
                <th className="px-3 py-2 font-semibold">Device</th>
                <th className="px-3 py-2 font-semibold">Referrer</th>
                <th className="px-4 py-2 text-right font-semibold">When</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {events.map((e) => (
                <EventRow key={e.id} event={e} link={linkMap.get(e.linkId)} showLink={showLink} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      {query.hasNextPage && (
        <div className="flex justify-center border-t border-border py-2">
          <Button
            size="sm"
            variant="ghost"
            loading={query.isFetchingNextPage}
            onClick={() => void query.fetchNextPage()}
          >
            Load older
          </Button>
        </div>
      )}
    </section>
  );
}

function EventRow({
  event,
  link,
  showLink,
}: {
  event: AnalyticsEvent;
  link?: PublicLink;
  showLink: boolean;
}) {
  const linkCell = showLink ? (
    <td className="max-w-[200px] truncate px-3 py-2 font-mono text-[12px]">
      {link ? `${link.domain}/${link.slug}` : `${event.domain}/${event.slug}`}
    </td>
  ) : null;
  const when = (
    <td
      className="whitespace-nowrap px-4 py-2 text-right tabular-nums text-muted-foreground"
      title={formatDateTime(event.at)}
    >
      {relativeTime(event.at)}
    </td>
  );
  if (event.type === "click") {
    const place = [event.city, event.country ? countryName(event.country) : undefined]
      .filter(Boolean)
      .join(", ");
    return (
      <tr className={event.bot ? "opacity-60" : undefined}>
        <td className="whitespace-nowrap px-4 py-2">
          <span className="inline-flex items-center gap-1.5">
            {event.qr ? (
              <QrCode className="size-3.5 text-accent" aria-label="QR scan" />
            ) : (
              <MousePointerClick className="size-3.5 text-muted-foreground" />
            )}
            Click
            {event.variant ? <StatusBadge>variant {event.variant}</StatusBadge> : null}
            {event.bot ? <StatusBadge tone="warning">bot</StatusBadge> : null}
          </span>
        </td>
        {linkCell}
        <td className="whitespace-nowrap px-3 py-2">
          {event.country ? <span className="mr-1.5">{flagEmoji(event.country)}</span> : null}
          {place || <span className="text-muted-foreground">Unknown</span>}
        </td>
        <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
          {prettyValue(event.device)} · {prettyValue(event.os)} · {prettyValue(event.browser)}
        </td>
        <td className="max-w-[180px] truncate px-3 py-2 text-muted-foreground">
          {event.referrerHost === "(direct)" ? "Direct" : event.referrerHost}
        </td>
        {when}
      </tr>
    );
  }
  const isSale = event.type === "sale";
  return (
    <tr>
      <td className="whitespace-nowrap px-4 py-2">
        <span className="inline-flex items-center gap-1.5">
          {isSale ? (
            <BadgeDollarSign className="size-3.5 text-chart-3" />
          ) : (
            <UserPlus className="size-3.5 text-chart-5" />
          )}
          <span className="font-medium">{event.name}</span>
          {isSale ? (
            <StatusBadge tone="success">{formatMoney(event.amount, event.currency)}</StatusBadge>
          ) : null}
        </span>
      </td>
      {linkCell}
      <td className="px-3 py-2 font-mono text-[12px] text-muted-foreground" colSpan={3}>
        customer {event.customerId}
      </td>
      {when}
    </tr>
  );
}
