import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { listAudit } from "../api.ts";
import type { AuditEntry } from "../types.ts";
import { errorMessage } from "../types.ts";
import { useShell } from "../lib/shell.tsx";
import { formatDateTime, relativeTime } from "../lib/format.ts";
import { cn } from "@xtandard/kit/ui";
import { Segmented } from "@xtandard/kit/ui";
import { EmptyCard, LoadingRow, NoTenant, Page, PageHeader } from "../components/bits.tsx";

function formatActor(actor: AuditEntry["actor"]): string {
  if (!actor) return "system";
  return actor.name ?? actor.email ?? actor.id;
}

function actionTone(action: string): string {
  if (action.includes("delete")) return "bg-destructive/10 text-destructive border-destructive/20";
  if (action.includes("archive") || action.includes("disable"))
    return "bg-warning/10 text-warning border-warning/20";
  if (action.includes("create") || action.includes("import"))
    return "bg-accent/10 text-accent border-accent/25";
  return "bg-secondary/60 text-muted-foreground border-border";
}

function summary(details: AuditEntry["details"]): string {
  if (!details) return "—";
  const parts = Object.entries(details)
    .filter(([, v]) => v !== null && typeof v !== "object")
    .slice(0, 4)
    .map(([k, v]) => `${k}: ${String(v)}`);
  return parts.length ? parts.join(" · ") : "—";
}

/** The operator audit log: every control-plane change (links, domains, tenants, imports). */
export function AuditView() {
  const { tenant } = useShell();
  const [scope, setScope] = React.useState<"tenant" | "global">("tenant");
  const query = useQuery({
    queryKey: ["audit", scope === "tenant" ? tenant : null],
    queryFn: () => listAudit(scope === "tenant" ? tenant : undefined),
    enabled: scope === "global" || !!tenant,
    staleTime: 15_000,
  });
  const entries = query.data ?? [];
  if (!tenant && scope === "tenant") return <NoTenant />;

  return (
    <Page>
      <PageHeader
        title="Audit log"
        description="Every control-plane change. Clicks and conversions are analytics, not audit entries."
        actions={
          <Segmented
            value={scope}
            onValueChange={setScope}
            options={[
              {
                value: "tenant",
                label: (
                  <>
                    Tenant <span className="font-mono">{tenant}</span>
                  </>
                ),
              },
              { value: "global", label: "Shared domains & tenants" },
            ]}
          />
        }
      />
      {query.isLoading ? (
        <LoadingRow label="Loading audit log…" />
      ) : query.isError ? (
        <EmptyCard>{errorMessage(query.error, "Failed to load audit log")}</EmptyCard>
      ) : entries.length === 0 ? (
        <EmptyCard>No audit entries yet.</EmptyCard>
      ) : (
        <div className="mt-4 overflow-hidden rounded-xl border border-border bg-card">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-border">
                  {["Action", "Target", "By", "When", "Details"].map((h) => (
                    <th
                      key={h}
                      className="whitespace-nowrap px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {entries.map((entry, i) => (
                  <tr key={`${entry.at}-${i}`}>
                    <td className="px-4 py-2.5">
                      <span
                        className={cn(
                          "inline-flex rounded-md border px-1.5 py-0.5 text-[11px] font-medium",
                          actionTone(entry.action),
                        )}
                      >
                        {entry.action}
                      </span>
                    </td>
                    <td className="max-w-[260px] truncate px-4 py-2.5 font-mono text-[12px] text-muted-foreground">
                      {entry.target}
                    </td>
                    <td className="px-4 py-2.5 text-[12px] text-muted-foreground">
                      {formatActor(entry.actor)}
                    </td>
                    <td
                      className="whitespace-nowrap px-4 py-2.5 text-[12px] tabular-nums text-muted-foreground"
                      title={formatDateTime(entry.at)}
                    >
                      {relativeTime(entry.at)}
                    </td>
                    <td className="max-w-[280px] truncate px-4 py-2.5 text-[12px] text-muted-foreground">
                      {summary(entry.details)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Page>
  );
}
