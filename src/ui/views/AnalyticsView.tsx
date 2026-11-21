import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { listLinks } from "../api.ts";
import { useShell } from "../lib/shell.tsx";
import { NoTenant, Page, PageHeader } from "../components/bits.tsx";
import { AnalyticsPanel } from "../components/AnalyticsPanel.tsx";
import { RecentEvents } from "../components/RecentEvents.tsx";

/** Tenant-wide analytics (also the landing page of the viewer widget). */
export function AnalyticsView() {
  const { tenant, config, viewer } = useShell();
  // Labels for the top-links breakdown (and the recent-activity table).
  const linksQuery = useQuery({
    queryKey: ["links", tenant, "all-for-labels"],
    queryFn: () => listLinks(tenant, { archived: "all", limit: 500 }),
    enabled: !!tenant && (!viewer || (config.allow ?? ["link:read"]).includes("link:read")),
    staleTime: 60_000,
  });
  const links = linksQuery.data?.links;

  if (!tenant) return <NoTenant />;

  return (
    <Page wide>
      <PageHeader
        title="Analytics"
        description={
          viewer ? (
            config.links?.length ? (
              `Clicks and conversions for ${config.links.length} link${config.links.length === 1 ? "" : "s"}.`
            ) : (
              "Clicks and conversions across your links."
            )
          ) : (
            <>
              Clicks and conversions across <span className="font-mono">{tenant}</span>'s links.
              Click a row to filter.
            </>
          )
        }
      />
      <div className="mt-6">
        <AnalyticsPanel
          tenant={tenant}
          links={links}
          showLinkBreakdown={!(config.links?.length === 1)}
        />
      </div>
      {config.capabilities.events && (
        <div className="mt-4">
          <RecentEvents tenant={tenant} links={links} />
        </div>
      )}
    </Page>
  );
}
