import * as React from "react";
import {
  Select as BaseSelect,
  SelectContent as BaseSelectContent,
  SelectGroup as BaseSelectGroup,
  SelectGroupLabel as BaseSelectGroupLabel,
  SelectItem as BaseSelectItem,
  SelectItemIndicator as BaseSelectItemIndicator,
  SelectLabel as BaseSelectLabel,
  SelectSeparator as BaseSelectSeparator,
  SelectTrigger as BaseSelectTrigger,
  SelectValue as BaseSelectValue,
  createSelectController,
  type ListData,
  type SelectProps,
} from "@ui-sdk/react/select";
import { CheckIcon, ChevronDownIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export { BaseSelect as Select, createSelectController, type ListData, type SelectProps };

export function SelectLabel({
  className,
  ...props
}: React.ComponentProps<typeof BaseSelectLabel>) {
  return (
    <BaseSelectLabel
      className={
        typeof className === "function"
          ? className
          : cn("text-sm font-medium text-foreground", className)
      }
      {...props}
    />
  );
}

export interface SelectTriggerProps
  extends React.ComponentProps<typeof BaseSelectTrigger> {
  size?: "default" | "sm";
}

export function SelectTrigger({
  className,
  children,
  size = "default",
  ...props
}: SelectTriggerProps) {
  return (
    <BaseSelectTrigger
      className={
        typeof className === "function"
          ? className
          : cn(
              "inline-flex cursor-pointer items-center justify-between gap-2 rounded-md border border-input bg-[var(--input-fill)] text-foreground",
              "transition-[border-color,background-color,box-shadow] duration-150",
              "hover:bg-[var(--input-fill-hover)]",
              "focus-visible:border-ring focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
              "data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
              size === "sm" ? "h-8 px-2.5 text-[13px]" : "h-9 px-3 text-sm",
              className,
            )
      }
      {...props}
    >
      {typeof children === "function" ? (
        children
      ) : (
        <>
          <span className="truncate">{children}</span>
          <ChevronDownIcon
            className="size-4 shrink-0 text-muted-foreground transition-transform duration-150 in-data-open:rotate-180"
            aria-hidden="true"
          />
        </>
      )}
    </BaseSelectTrigger>
  );
}

export function SelectValue({
  className,
  ...props
}: React.ComponentProps<typeof BaseSelectValue>) {
  return (
    <BaseSelectValue
      className={
        typeof className === "function"
          ? className
          : cn("data-[placeholder]:text-muted-foreground", className)
      }
      {...props}
    />
  );
}

export function SelectContent({
  className,
  sideOffset = 6,
  ...props
}: React.ComponentProps<typeof BaseSelectContent>) {
  return (
    <BaseSelectContent
      sideOffset={sideOffset}
      className={
        typeof className === "function"
          ? className
          : cn(
              "z-50 min-w-(--anchor-width) max-h-[min(320px,var(--available-height))] overflow-y-auto",
              "rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-xl",
              "origin-(--transform-origin) transition-[opacity,transform] duration-150 ease-out",
              "data-starting-style:opacity-0 data-starting-style:scale-95",
              "data-ending-style:opacity-0 data-ending-style:scale-95",
              "motion-reduce:transition-none",
              "focus:outline-none",
              className,
            )
      }
      {...props}
    />
  );
}

export function SelectItem<T = string>({
  className,
  children,
  ...props
}: React.ComponentProps<typeof BaseSelectItem<T>>) {
  return (
    <BaseSelectItem
      className={
        typeof className === "function"
          ? className
          : cn(
              "relative flex cursor-pointer select-none items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-sm leading-5 outline-none",
              "data-highlighted:bg-secondary data-highlighted:text-foreground",
              "data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
              className,
            )
      }
      {...props}
    >
      {typeof children === "function" ? (
        children
      ) : (
        <>
          <span className="truncate">{children}</span>
          <BaseSelectItemIndicator className="inline-flex size-4 shrink-0 items-center justify-center text-foreground">
            <CheckIcon className="size-3.5" aria-hidden="true" />
          </BaseSelectItemIndicator>
        </>
      )}
    </BaseSelectItem>
  );
}

export const SelectGroup = BaseSelectGroup;

export function SelectGroupLabel({
  className,
  ...props
}: React.ComponentProps<typeof BaseSelectGroupLabel>) {
  return (
    <BaseSelectGroupLabel
      className={
        typeof className === "function"
          ? className
          : cn("px-2.5 py-1 text-xs font-medium text-muted-foreground", className)
      }
      {...props}
    />
  );
}

export function SelectSeparator({
  className,
  ...props
}: React.ComponentProps<typeof BaseSelectSeparator>) {
  return (
    <BaseSelectSeparator
      className={
        typeof className === "function"
          ? className
          : cn("-mx-1 my-1 h-px bg-border", className)
      }
      {...props}
    />
  );
}
