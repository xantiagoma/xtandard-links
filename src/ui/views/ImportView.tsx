import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, FileUp, Play, ScanSearch, Upload } from "lucide-react";
import { importCsv, listDomains, type ImportConflict, type ImportFormat } from "../api.ts";
import type { ImportResult } from "../types.ts";
import { errorMessage } from "../types.ts";
import { useShell } from "../lib/shell.tsx";
import { displayUrl, formatCount } from "../lib/format.ts";
import { cn } from "@xtandard/kit/ui";
import { Button } from "@xtandard/kit/ui";
import { Dropdown, Segmented, TextArea, ToggleSwitch } from "@xtandard/kit/ui";
import {
  EmptyCard,
  Field,
  NoTenant,
  Page,
  PageHeader,
  SectionCard,
  StatusBadge,
  type Tone,
} from "../components/bits.tsx";
import { TagInput } from "../components/TagInput.tsx";
import { useToast } from "@xtandard/kit/ui";

const FORMATS: { value: ImportFormat; label: string; description: string }[] = [
  { value: "auto", label: "Detect automatically", description: "From the header row" },
  { value: "native", label: "@xtandard/links", description: "This panel's own export" },
  { value: "bitly", label: "Bitly", description: "Dashboard export (long_url, custom_bitlinks…)" },
  { value: "dub", label: "Dub", description: "Dashboard export (url, key, domain…)" },
  { value: "shlink", label: "Shlink", description: "Short code, Long URL, Title, Tags" },
  { value: "kutt", label: "Kutt", description: "target, address, description" },
];

const SAMPLE = `url,slug,title,tags
https://acme.com/pricing,pricing,Pricing page,"web,pricing"
https://acme.com/blog/launch,launch,Launch post,blog
https://acme.com/careers,,Careers,hiring`;

const STATUS_TONE: Record<string, Tone> = {
  created: "success",
  updated: "info",
  skipped: "neutral",
  error: "danger",
};

const DEFAULT_DOMAIN = "__default";

export function ImportView() {
  const { tenant, can } = useShell();
  const toast = useToast();
  const qc = useQueryClient();
  const [csv, setCsv] = React.useState("");
  const [fileName, setFileName] = React.useState<string | null>(null);
  const [format, setFormat] = React.useState<ImportFormat>("auto");
  const [onConflict, setOnConflict] = React.useState<ImportConflict>("skip");
  const [domain, setDomain] = React.useState(DEFAULT_DOMAIN);
  const [keepDomains, setKeepDomains] = React.useState(false);
  const [tags, setTags] = React.useState<string[]>([]);
  const [result, setResult] = React.useState<{ dryRun: boolean; data: ImportResult } | null>(null);
  const [dragging, setDragging] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement>(null);

  const domainsQuery = useQuery({
    queryKey: ["domains", tenant],
    queryFn: () => listDomains(tenant),
    enabled: !!tenant,
    staleTime: 60_000,
  });

  const run = useMutation({
    mutationFn: (dryRun: boolean) =>
      importCsv(tenant, csv, {
        format,
        dryRun,
        onConflict,
        domain: domain === DEFAULT_DOMAIN ? undefined : domain,
        keepDomains,
        tags,
      }).then((data) => ({ dryRun, data })),
    onSuccess: (r) => {
      setResult(r);
      if (!r.dryRun) {
        void qc.invalidateQueries({ queryKey: ["links", tenant] });
        void qc.invalidateQueries({ queryKey: ["tags", tenant] });
        toast.add(
          r.data.errors ? "warning" : "success",
          `Imported ${formatCount(r.data.created + r.data.updated)} link${r.data.created + r.data.updated === 1 ? "" : "s"}`,
          r.data.errors
            ? `${r.data.errors} row${r.data.errors === 1 ? "" : "s"} failed`
            : undefined,
        );
      }
    },
    onError: (err) => toast.add("error", errorMessage(err, "Import failed")),
  });

  const readFile = async (file: File) => {
    setCsv(await file.text());
    setFileName(file.name);
    setResult(null);
  };

  if (!tenant) return <NoTenant />;
  const rows = csv.trim() ? csv.trim().split(/\r?\n/).length - 1 : 0;
  const canImport = can("link:import");
  const summary = result?.data;

  return (
    <Page>
      <PageHeader
        title="Import"
        description={
          <>
            Bring links from a CSV — your own export or Bitly, Dub, Shlink and Kutt — into{" "}
            <span className="font-mono">{tenant}</span>.
          </>
        }
      />

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <SectionCard
          title="CSV"
          description={
            fileName
              ? `${fileName} · ${formatCount(rows)} rows`
              : rows
                ? `${formatCount(rows)} rows`
                : "Paste it or drop a file"
          }
          actions={
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setCsv(SAMPLE);
                  setFileName(null);
                  setResult(null);
                }}
              >
                Use sample
              </Button>
              <Button
                size="sm"
                icon={<Upload className="size-3.5" />}
                onClick={() => fileRef.current?.click()}
              >
                Upload
              </Button>
              <input
                ref={fileRef}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                aria-label="CSV file"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void readFile(f);
                  e.target.value = "";
                }}
              />
            </div>
          }
        >
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              const f = e.dataTransfer.files[0];
              if (f) void readFile(f);
            }}
            className={cn("relative rounded-lg", dragging && "ring-2 ring-accent")}
          >
            <TextArea
              aria-label="CSV contents"
              rows={17}
              spellCheck={false}
              placeholder={"url,slug,title,tags\nhttps://acme.com/pricing,pricing,Pricing,web"}
              value={csv}
              onChange={(e) => {
                setCsv(e.target.value);
                setResult(null);
              }}
              className="font-mono text-[12px] leading-relaxed"
            />
            {!csv && (
              <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center text-[12px] text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <FileUp className="size-3.5" /> Drop a .csv file here
                </span>
              </div>
            )}
          </div>
        </SectionCard>

        <SectionCard title="Options">
          <div className="flex flex-col gap-4">
            <Field label="Format">
              <Dropdown
                aria-label="Format"
                value={format}
                onValueChange={(v) => setFormat(v as ImportFormat)}
                options={FORMATS}
                className="w-full"
              />
            </Field>
            <Field label="When a slug already exists">
              <Segmented
                value={onConflict}
                onValueChange={setOnConflict}
                options={[
                  { value: "skip", label: "Skip" },
                  { value: "update", label: "Update" },
                  { value: "error", label: "Fail row" },
                ]}
              />
            </Field>
            <Field label="Domain" hint="Rows without a domain (or every row, unless kept) use it.">
              <Dropdown
                aria-label="Import domain"
                value={domain}
                onValueChange={setDomain}
                options={[
                  { value: DEFAULT_DOMAIN, label: "Tenant default" },
                  ...(domainsQuery.data ?? []).map((d) => ({
                    value: d.hostname,
                    label: d.hostname,
                  })),
                ]}
                className="w-full"
              />
            </Field>
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[12px] font-medium">Keep source domains</p>
                <p className="text-[11.5px] text-muted-foreground">
                  Use bit.ly-style domains from the file.
                </p>
              </div>
              <ToggleSwitch
                checked={keepDomains}
                onCheckedChange={setKeepDomains}
                aria-label="Keep source domains"
              />
            </div>
            <Field label="Add tags to every row">
              <TagInput
                aria-label="Import tags"
                values={tags}
                onChange={setTags}
                lowercase
                placeholder="imported"
              />
            </Field>
            <div className="flex flex-col gap-2 border-t border-border pt-4">
              <Button
                icon={<ScanSearch className="size-3.5" />}
                disabled={!csv.trim()}
                loading={run.isPending && run.variables === true}
                onClick={() => run.mutate(true)}
                className="justify-center"
              >
                Preview (dry run)
              </Button>
              <Button
                variant="primary"
                icon={<Play className="size-3.5" />}
                disabled={!csv.trim() || !canImport}
                loading={run.isPending && run.variables === false}
                onClick={() => run.mutate(false)}
                className="justify-center"
              >
                Import {rows ? formatCount(rows) : ""} link{rows === 1 ? "" : "s"}
              </Button>
            </div>
          </div>
        </SectionCard>
      </div>

      {summary && (
        <section
          className="mt-4 rounded-xl border border-border bg-card"
          data-testid="import-result"
        >
          <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
            <h2 className="flex items-center gap-1.5 text-[13px] font-semibold">
              {result.dryRun ? (
                <ScanSearch className="size-3.5 text-muted-foreground" />
              ) : (
                <CheckCircle2 className="size-3.5 text-success" />
              )}
              {result.dryRun ? "Dry run — nothing was written" : "Import finished"}
            </h2>
            <div className="ml-auto flex flex-wrap gap-1.5">
              <StatusBadge tone="success">
                {summary.created} {result.dryRun ? "to create" : "created"}
              </StatusBadge>
              <StatusBadge tone="info">
                {summary.updated} {result.dryRun ? "to update" : "updated"}
              </StatusBadge>
              <StatusBadge>{summary.skipped} skipped</StatusBadge>
              <StatusBadge tone={summary.errors ? "danger" : "neutral"}>
                {summary.errors} errors
              </StatusBadge>
            </div>
          </div>
          {summary.rows.length === 0 ? (
            <EmptyCard className="m-4">The file has no data rows.</EmptyCard>
          ) : (
            <div className="max-h-[28rem] overflow-auto">
              <table className="w-full border-collapse text-[12.5px]">
                <thead className="sticky top-0 bg-card">
                  <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                    <th className="w-14 px-4 py-2 font-semibold">Row</th>
                    <th className="px-3 py-2 font-semibold">Status</th>
                    <th className="px-3 py-2 font-semibold">Short link</th>
                    <th className="px-3 py-2 font-semibold">Destination / error</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {summary.rows.map((r) => (
                    <tr key={r.index}>
                      <td className="px-4 py-2 tabular-nums text-muted-foreground">
                        {r.index + 1}
                      </td>
                      <td className="px-3 py-2">
                        <StatusBadge tone={STATUS_TONE[r.status]}>{r.status}</StatusBadge>
                      </td>
                      <td className="px-3 py-2 font-mono text-[12px]">
                        {r.link ? (
                          `${r.link.domain}/${r.link.slug}`
                        ) : r.input?.slug ? (
                          `${r.input.domain ? `${r.input.domain}/` : ""}${r.input.slug}`
                        ) : r.input ? (
                          <span className="text-muted-foreground">generated</span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td
                        className={cn(
                          "max-w-0 truncate px-3 py-2",
                          r.error ? "text-destructive" : "text-muted-foreground",
                        )}
                      >
                        {r.error ?? displayUrl(r.link?.url ?? r.input?.url ?? "")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </Page>
  );
}
