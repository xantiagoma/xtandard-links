import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { getQrSvg } from "../api.ts";
import type { PublicLink } from "../types.ts";
import { errorMessage } from "../types.ts";
import { cn } from "../lib/utils.ts";
import { Button } from "./ui-bits.tsx";
import { Spinner } from "./bits.tsx";

const COLORS = [
  { fg: "#0f1215", bg: "#ffffff", label: "Ink" },
  { fg: "#4c8a06", bg: "#ffffff", label: "Lime" },
  { fg: "#1d4ed8", bg: "#ffffff", label: "Blue" },
  { fg: "#ffffff", bg: "#0f1215", label: "Inverted" },
];

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Rasterize SVG markup to a PNG blob at `size` px (canvas, no dependencies). */
async function svgToPng(svg: string, size: number): Promise<Blob> {
  const img = new Image();
  img.decoding = "async";
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await img.decode();
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is not available");
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, 0, 0, size, size);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("PNG export failed"))), "image/png"),
  );
}

/** QR preview with colour presets and SVG / PNG download. Scans are tagged `?qr=1`. */
export function QrPanel({
  tenant,
  link,
  compact,
}: {
  tenant: string;
  link: PublicLink;
  compact?: boolean;
}) {
  const [preset, setPreset] = React.useState(0);
  const colors = COLORS[preset]!;
  const query = useQuery({
    queryKey: ["qr", tenant, link.id, colors.fg, colors.bg],
    queryFn: () =>
      getQrSvg(tenant, link.id, { size: 512, margin: 2, fg: colors.fg, bg: colors.bg, ecc: "M" }),
    staleTime: 5 * 60_000,
  });
  const svg = query.data;
  const filename = link.slug.replace(/[^\w.-]/g, "_") || "qr";

  return (
    <div className="flex flex-col items-center gap-3">
      <div
        className={cn(
          "flex items-center justify-center overflow-hidden rounded-xl border border-border bg-white p-2",
          compact ? "size-40" : "size-52",
        )}
      >
        {svg ? (
          <img
            src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`}
            alt={`QR code for ${link.domain}/${link.slug}`}
            className="size-full [image-rendering:pixelated]"
            data-testid="qr-image"
          />
        ) : query.isError ? (
          <p className="px-3 text-center text-xs text-destructive">{errorMessage(query.error)}</p>
        ) : (
          <Spinner className="text-muted-foreground" />
        )}
      </div>
      <div className="flex items-center gap-1.5" role="radiogroup" aria-label="QR colours">
        {COLORS.map((c, i) => (
          <button
            key={c.label}
            type="button"
            role="radio"
            aria-checked={i === preset}
            aria-label={`${c.label} QR`}
            title={c.label}
            onClick={() => setPreset(i)}
            className={cn(
              "size-6 rounded-full border-2 outline-none transition-transform focus-visible:ring-2 focus-visible:ring-ring",
              i === preset ? "scale-110 border-accent" : "border-border hover:scale-105",
            )}
            style={{ background: `linear-gradient(135deg, ${c.fg} 50%, ${c.bg} 50%)` }}
          />
        ))}
      </div>
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={!svg}
          icon={<Download className="size-3.5" />}
          onClick={() =>
            svg && download(new Blob([svg], { type: "image/svg+xml" }), `${filename}.svg`)
          }
        >
          SVG
        </Button>
        <Button
          size="sm"
          disabled={!svg}
          icon={<Download className="size-3.5" />}
          onClick={() =>
            svg && void svgToPng(svg, 1024).then((png) => download(png, `${filename}.png`))
          }
        >
          PNG
        </Button>
      </div>
    </div>
  );
}
