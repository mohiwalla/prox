import * as React from "react";
import {
  Switch as BaseSwitch,
  SwitchThumb as BaseSwitchThumb,
  createSwitchController,
} from "@ui-sdk/react/switch";
import { cn } from "@/lib/utils";

export { createSwitchController };

export type SwitchProps = React.ComponentProps<typeof BaseSwitch>;

export function Switch({ className, ...props }: SwitchProps) {
  return (
    <BaseSwitch
      className={
        typeof className === "function"
          ? className
          : cn(
              "inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-transparent p-0.5",
              "bg-input transition-colors duration-150",
              "data-checked:bg-primary",
              "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
              "data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50",
              className,
            )
      }
      {...props}
    >
      <BaseSwitchThumb
        className={cn(
          "pointer-events-none block size-4 rounded-full bg-foreground shadow-sm",
          "transition-transform duration-150 ease-out",
          "data-checked:translate-x-4 data-checked:bg-primary-foreground",
        )}
      />
    </BaseSwitch>
  );
}
