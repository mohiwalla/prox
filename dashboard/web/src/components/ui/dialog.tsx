import * as React from "react";
import {
  Dialog as BaseDialog,
  DialogBackdrop as BaseDialogBackdrop,
  DialogClose as BaseDialogClose,
  DialogContent as BaseDialogContent,
  DialogDescription as BaseDialogDescription,
  DialogTitle as BaseDialogTitle,
  DialogTrigger as BaseDialogTrigger,
  createDialogController,
  type DialogProps,
} from "@ui-sdk/react/dialog";
import { XIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export { createDialogController, type DialogProps };

export function Dialog(props: DialogProps) {
  return <BaseDialog {...props} />;
}

export function DialogTrigger({
  className,
  ...props
}: React.ComponentProps<typeof BaseDialogTrigger>) {
  return (
    <BaseDialogTrigger
      className={
        typeof className === "function" ? className : cn(className)
      }
      {...props}
    />
  );
}

export function DialogBackdrop({
  className,
  ...props
}: React.ComponentProps<typeof BaseDialogBackdrop>) {
  return (
    <BaseDialogBackdrop
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

export interface DialogContentProps
  extends React.ComponentProps<typeof BaseDialogContent> {
  showCloseButton?: boolean;
}

export function DialogContent({
  className,
  children,
  showCloseButton = true,
  ...props
}: DialogContentProps) {
  return (
    <BaseDialogContent
      className={
        typeof className === "function"
          ? className
          : cn(
              "fixed inset-0 m-auto z-50 flex flex-col gap-4",
              "w-[min(460px,calc(100vw-32px))] h-fit max-h-[calc(100dvh-32px)] overflow-y-auto",
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
    >
      {typeof children === "function" ? (
        children
      ) : (
        <>
          {showCloseButton && (
            <BaseDialogClose
              aria-label="Close"
              className={cn(
                "absolute top-4 right-4 inline-flex size-8 cursor-pointer items-center justify-center rounded-md",
                "border border-transparent bg-transparent text-muted-foreground",
                "transition-colors hover:bg-secondary/60 hover:text-foreground",
                "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
              )}
            >
              <XIcon className="size-4" aria-hidden="true" />
            </BaseDialogClose>
          )}
          {children}
        </>
      )}
    </BaseDialogContent>
  );
}

export function DialogHeader({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("flex flex-col gap-1.5 pr-8 text-left", className)}
      {...props}
    />
  );
}

export function DialogFooter({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end",
        className,
      )}
      {...props}
    />
  );
}

export function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof BaseDialogTitle>) {
  return (
    <BaseDialogTitle
      className={
        typeof className === "function"
          ? className
          : cn("text-base font-semibold leading-6 tracking-tight text-foreground", className)
      }
      {...props}
    />
  );
}

export function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof BaseDialogDescription>) {
  return (
    <BaseDialogDescription
      className={
        typeof className === "function"
          ? className
          : cn("text-sm leading-5 text-muted-foreground", className)
      }
      {...props}
    />
  );
}

export function DialogClose({
  className,
  ...props
}: React.ComponentProps<typeof BaseDialogClose>) {
  return (
    <BaseDialogClose
      className={typeof className === "function" ? className : cn(className)}
      {...props}
    />
  );
}
