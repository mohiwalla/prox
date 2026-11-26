import * as React from "react";
import {
  Toggle as BaseToggle,
  ToggleGroup as BaseToggleGroup,
  ToggleIcon as BaseToggleIcon,
  createToggleController,
  createToggleGroupController,
} from "@ui-sdk/react/toggle";
import { cn } from "@/lib/utils";

export { createToggleController, createToggleGroupController };

export type ToggleVariant = "default" | "outline" | "segmented";
export type ToggleSize = "default" | "sm";

export interface ToggleProps extends React.ComponentProps<typeof BaseToggle> {
  variant?: ToggleVariant;
  size?: ToggleSize;
}

export function Toggle({
  className,
  variant = "default",
  size = "default",
  ...props
}: ToggleProps) {
  return (
    <BaseToggle
      className={
        typeof className === "function"
          ? className
          : cn(
              "inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-md font-medium whitespace-nowrap select-none",
              "transition-[background-color,color,border-color,transform] duration-150",
              "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
              "data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
              "[&_svg]:size-4 [&_svg]:shrink-0",
              size === "sm" ? "h-8 px-2.5 text-[13px]" : "h-9 px-3 text-sm",
              variant === "outline" &&
                "border border-input bg-transparent text-muted-foreground hover:bg-secondary/50 hover:text-foreground data-pressed:border-foreground/40 data-pressed:bg-secondary data-pressed:text-foreground",
              variant === "segmented" &&
                "h-7 rounded-[5px] border border-transparent bg-transparent px-2.5 text-[13px] text-muted-foreground hover:text-foreground data-pressed:bg-secondary data-pressed:text-foreground",
              variant === "default" &&
                "border border-transparent bg-transparent text-muted-foreground hover:bg-secondary/50 hover:text-foreground data-pressed:bg-secondary data-pressed:text-foreground",
              className,
            )
      }
      {...props}
    />
  );
}

export function ToggleGroup<T extends string = string>({
  className,
  ...props
}: React.ComponentProps<typeof BaseToggleGroup<T>>) {
  return (
    <BaseToggleGroup
      className={
        typeof className === "function"
          ? className
          : cn(
              "inline-flex items-center gap-1 rounded-lg border border-border bg-card/70 p-0.5",
              className,
            )
      }
      {...props}
    />
  );
}

export const ToggleIcon = BaseToggleIcon;
