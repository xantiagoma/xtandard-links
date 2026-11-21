import * as React from "react";
import { Dialog } from "@base-ui-components/react/dialog";
import { Check, Copy, X } from "lucide-react";
import { cn } from "@xtandard/kit/ui";
import { portalContainerRef } from "@xtandard/kit/ui";
import { Button } from "@xtandard/kit/ui";
import { useToast } from "@xtandard/kit/ui";

/* ─── Spinner ───────────────────────────────────────────────────────────────── */

export function Spinner({ className }: { className?: string }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      className={cn("animate-spin", className)}
      aria-hidden
    >
      <circle
        cx="8"
        cy="8"
        r="6"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeDasharray="24"
        strokeDashoffset="12"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function LoadingRow({ label }: { label: string }) {
  return (
    <div className="mt-8 flex items-center justify-center gap-2 text-[13px] text-muted-foreground">
      <Spinner />
      {label}
    </div>
  );
}

/* ─── Mono ──────────────────────────────────────────────────────────────────── */

/** Keys/ids render in the mono face per the design system. */
export function Mono({ className, children }: { className?: string; children: React.ReactNode }) {
  return <span className={cn("font-mono text-[12px] text-foreground", className)}>{children}</span>;
}

/* ─── Page layout ───────────────────────────────────────────────────────────── */

export function Page({ children, wide }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={cn("mx-auto px-4 py-8 sm:px-6", wide ? "max-w-7xl" : "max-w-6xl")}>
      {children}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/* ─── SectionCard ───────────────────────────────────────────────────────────── */

export function SectionCard({
  title,
  description,
  actions,
  children,
  className,
  bodyClassName,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={cn("rounded-xl border border-border bg-card", className)}>
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-[13px] font-semibold text-foreground">{title}</h2>
          {description ? (
            <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {actions}
      </div>
      <div className={cn("px-4 py-4", bodyClassName)}>{children}</div>
    </section>
  );
}

/* ─── Field ─────────────────────────────────────────────────────────────────── */

/** A labelled form row with optional hint and error. */
export function Field({
  label,
  hint,
  error,
  children,
  htmlFor,
  className,
  aside,
}: {
  label: React.ReactNode;
  hint?: React.ReactNode;
  error?: string | null;
  children: React.ReactNode;
  htmlFor?: string;
  className?: string;
  aside?: React.ReactNode;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={htmlFor} className="text-[12px] font-medium text-foreground">
          {label}
        </label>
        {aside}
      </div>
      {children}
      {error ? (
        <p className="text-[11.5px] text-destructive">{error}</p>
      ) : hint ? (
        <p className="text-[11.5px] text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

/* ─── ModalDialog ───────────────────────────────────────────────────────────── */

export function ModalDialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal container={portalContainerRef()}>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm" />
        <Dialog.Popup
          className={cn(
            "fixed left-1/2 top-1/2 z-50 flex max-h-[85vh] w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border border-border bg-card text-card-foreground shadow-2xl outline-none",
            wide ? "max-w-2xl" : "max-w-md",
          )}
        >
          <div className="border-b border-border px-5 py-4">
            <Dialog.Title className="text-[15px] font-semibold text-foreground">
              {title}
            </Dialog.Title>
            {description ? (
              <Dialog.Description className="mt-0.5 text-xs text-muted-foreground">
                {description}
              </Dialog.Description>
            ) : null}
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-5">
            {children}
          </div>
          {footer ? (
            <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
              {footer}
            </div>
          ) : null}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/* ─── Drawer (side sheet) ───────────────────────────────────────────────────── */

/** A right-hand sheet for long forms (the link editor). */
export function Drawer({
  open,
  onClose,
  title,
  description,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal container={portalContainerRef()}>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px] transition-opacity data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
        <Dialog.Popup
          className={cn(
            "fixed inset-y-0 right-0 z-50 flex w-full max-w-3xl flex-col border-l border-border bg-background text-foreground shadow-2xl outline-none",
            "transition-transform duration-200 data-[ending-style]:translate-x-full data-[starting-style]:translate-x-full",
          )}
        >
          <div className="flex items-start justify-between gap-4 border-b border-border bg-card px-6 py-4">
            <div className="min-w-0">
              <Dialog.Title className="truncate text-[15px] font-semibold text-foreground">
                {title}
              </Dialog.Title>
              {description ? (
                <Dialog.Description className="mt-0.5 truncate text-xs text-muted-foreground">
                  {description}
                </Dialog.Description>
              ) : null}
            </div>
            <Dialog.Close
              aria-label="Close"
              className="rounded-md p-1 text-muted-foreground outline-none hover:bg-secondary hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X className="size-4" />
            </Dialog.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
          {footer ? (
            <div className="flex items-center justify-end gap-2 border-t border-border bg-card px-6 py-3">
              {footer}
            </div>
          ) : null}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/* ─── ConfirmDialog ─────────────────────────────────────────────────────────── */

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  confirmLabel,
  danger,
  loading,
  children,
  confirmDisabled,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: React.ReactNode;
  confirmLabel: string;
  danger?: boolean;
  loading?: boolean;
  children: React.ReactNode;
  confirmDisabled?: boolean;
}) {
  return (
    <ModalDialog
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button
            variant={danger ? "danger" : "primary"}
            loading={loading}
            disabled={confirmDisabled}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
    </ModalDialog>
  );
}

/* ─── EmptyCard ─────────────────────────────────────────────────────────────── */

export function EmptyCard({
  children,
  icon,
  action,
  className,
}: {
  children: React.ReactNode;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "mt-4 flex flex-col items-center gap-3 rounded-xl border border-dashed border-border bg-card px-4 py-14 text-center",
        className,
      )}
    >
      {icon ? (
        <div className="flex size-10 items-center justify-center rounded-full bg-accent/10 text-accent">
          {icon}
        </div>
      ) : null}
      <div className="max-w-sm text-[13px] text-muted-foreground">{children}</div>
      {action}
    </div>
  );
}

/* ─── CopyButton ────────────────────────────────────────────────────────────── */

/** Copy `text` to the clipboard with a check-mark confirmation. */
export function CopyButton({
  text,
  label = "Copy",
  className,
  toastMessage,
}: {
  text: string;
  label?: string;
  className?: string;
  toastMessage?: string;
}) {
  const [copied, setCopied] = React.useState(false);
  const toast = useToast();
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={(e) => {
        e.stopPropagation();
        void navigator.clipboard?.writeText(text).then(
          () => {
            setCopied(true);
            if (toastMessage) toast.add("success", toastMessage, text);
            setTimeout(() => setCopied(false), 1400);
          },
          () => toast.add("error", "Could not copy to the clipboard"),
        );
      }}
      className={cn(
        "inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors",
        "hover:bg-secondary hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      {copied ? <Check className="size-3.5 text-accent" /> : <Copy className="size-3.5" />}
    </button>
  );
}

/* ─── Pills ─────────────────────────────────────────────────────────────────── */

export function TagPill({
  tag,
  onClick,
  active,
}: {
  tag: string;
  onClick?: () => void;
  active?: boolean;
}) {
  const Comp = onClick ? "button" : "span";
  return (
    <Comp
      type={onClick ? "button" : undefined}
      onClick={
        onClick
          ? (e: React.MouseEvent) => {
              e.stopPropagation();
              onClick();
            }
          : undefined
      }
      className={cn(
        "inline-flex items-center rounded-md border px-1.5 py-px text-[11px] font-medium",
        active
          ? "border-accent/40 bg-accent/15 text-foreground"
          : "border-border bg-secondary/60 text-muted-foreground",
        onClick && "hover:border-accent/40 hover:text-foreground",
      )}
    >
      {tag}
    </Comp>
  );
}

const TONES = {
  neutral: "border-border bg-secondary/60 text-muted-foreground",
  accent: "border-accent/30 bg-accent/10 text-accent",
  success: "border-success/30 bg-success/10 text-success",
  warning: "border-warning/30 bg-warning/10 text-warning",
  danger: "border-destructive/30 bg-destructive/10 text-destructive",
  info: "border-info/30 bg-info/10 text-info",
} as const;

export type Tone = keyof typeof TONES;

export function StatusBadge({
  tone = "neutral",
  children,
  title,
  className,
}: {
  tone?: Tone;
  children: React.ReactNode;
  title?: string;
  className?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-1.5 py-px text-[11px] font-medium",
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** The tenant-less "pick a tenant first" placeholder. */
export function NoTenant() {
  return (
    <Page>
      <EmptyCard>
        No tenant selected. Pick or create one from the switcher in the top bar.
      </EmptyCard>
    </Page>
  );
}
