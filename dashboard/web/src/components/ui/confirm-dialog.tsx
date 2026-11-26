import * as React from "react";
import {
  AlertDialog as BaseAlertDialog,
  AlertDialogBackdrop as BaseAlertDialogBackdrop,
  AlertDialogClose as BaseAlertDialogClose,
  AlertDialogContent as BaseAlertDialogContent,
  AlertDialogDescription as BaseAlertDialogDescription,
  AlertDialogTitle as BaseAlertDialogTitle,
  AlertDialogTrigger as BaseAlertDialogTrigger,
  type AlertDialogProps,
} from "@ui-sdk/react/alert-dialog";
import { Loader2Icon } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export { type AlertDialogProps };

export function AlertDialog(props: AlertDialogProps) {
  return <BaseAlertDialog {...props} />;
}

export const AlertDialogTrigger = BaseAlertDialogTrigger;

export function AlertDialogBackdrop({
  className,
  ...props
}: React.ComponentProps<typeof BaseAlertDialogBackdrop>) {
  return (
    <BaseAlertDialogBackdrop
      className={
        typeof className === "function"
          ? className
          : cn(
              "fixed inset-0 z-50 bg-black/70 backdrop-blur-[1px]",
              "transition-opacity duration-200 ease-out",
              "data-starting-style:opacity-0 data-ending-style:opacity-0",
              "motion-reduce:transition-none",
              className,
            )
      }
      {...props}
    />
  );
}

export function AlertDialogContent({
  className,
  ...props
}: React.ComponentProps<typeof BaseAlertDialogContent>) {
  return (
    <BaseAlertDialogContent
      className={
        typeof className === "function"
          ? className
          : cn(
              "fixed inset-0 m-auto z-50 flex flex-col gap-4",
              "w-[min(440px,calc(100vw-32px))] h-fit max-h-[calc(100dvh-32px)] overflow-y-auto",
              "rounded-xl border border-border bg-popover p-6 text-popover-foreground shadow-2xl",
              "transition-[opacity,transform] duration-200 ease-out",
              "data-starting-style:opacity-0 data-starting-style:scale-[0.97]",
              "data-ending-style:opacity-0 data-ending-style:scale-[0.97]",
              "motion-reduce:transition-none",
              "focus:outline-none",
              className,
            )
      }
      {...props}
    />
  );
}

export function AlertDialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof BaseAlertDialogTitle>) {
  return (
    <BaseAlertDialogTitle
      className={
        typeof className === "function"
          ? className
          : cn("text-base font-semibold leading-6 text-foreground", className)
      }
      {...props}
    />
  );
}

export function AlertDialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof BaseAlertDialogDescription>) {
  return (
    <BaseAlertDialogDescription
      className={
        typeof className === "function"
          ? className
          : cn("text-sm leading-5 text-muted-foreground", className)
      }
      {...props}
    />
  );
}

export const AlertDialogClose = BaseAlertDialogClose;

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "destructive" | "default";
  busy?: boolean;
  onConfirm: () => void | Promise<void>;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  variant = "destructive",
  busy = false,
  onConfirm,
}: ConfirmDialogProps) {
  const [pending, setPending] = React.useState(false);
  const isBusy = busy || pending;

  async function handleConfirm() {
    if (isBusy) return;
    setPending(true);
    try {
      await onConfirm();
      onOpenChange(false);
    } finally {
      setPending(false);
    }
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && isBusy) return;
        onOpenChange(nextOpen);
      }}
    >
      <AlertDialogBackdrop />
      <AlertDialogContent>
        <div className="flex flex-col gap-1.5">
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description ? (
            <AlertDialogDescription>{description}</AlertDialogDescription>
          ) : null}
        </div>
        <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
          <AlertDialogClose
            disabled={isBusy}
            className={buttonVariants({ variant: "outline" })}
          >
            {cancelLabel}
          </AlertDialogClose>
          <button
            type="button"
            disabled={isBusy}
            onClick={() => void handleConfirm()}
            className={buttonVariants({
              variant: variant === "destructive" ? "destructive" : "default",
            })}
          >
            {isBusy ? <Loader2Icon className="size-4 animate-spin" aria-hidden="true" /> : null}
            {confirmLabel}
          </button>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}
