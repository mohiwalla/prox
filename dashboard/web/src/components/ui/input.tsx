import * as React from "react";
import {
  Input as BaseInput,
  InputClear as BaseInputClear,
  InputGroup as BaseInputGroup,
  createInputController,
} from "@ui-sdk/react/input";
import { cn } from "@/lib/utils";

export { createInputController };

export type InputProps = React.ComponentProps<typeof BaseInput>;

export function Input({ className, ...props }: InputProps) {
  return (
    <BaseInput
      className={
        typeof className === "function"
          ? className
          : cn(
              "flex h-9 w-full rounded-md border border-input bg-[var(--input-fill)] px-3 py-1 text-sm leading-5 text-foreground",
              "placeholder:text-muted-foreground",
              "transition-[border-color,box-shadow,background-color] duration-150",
              "hover:bg-[var(--input-fill-hover)]",
              "focus-visible:border-ring focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
              "aria-[invalid=true]:border-destructive aria-[invalid=true]:focus-visible:ring-destructive/25",
              "disabled:cursor-not-allowed disabled:opacity-50",
              className,
            )
      }
      {...props}
    />
  );
}

export const InputGroup = BaseInputGroup;
export const InputClear = BaseInputClear;
