import * as React from "react";
import {
  Button as BaseButton,
  type ButtonActionDetails,
  type ButtonOptions,
} from "@ui-sdk/react/button";
import type { RenderProp } from "@ui-sdk/react/primitive";
import { cn } from "@/lib/utils";

export type ButtonVariant =
  | "default"
  | "secondary"
  | "outline"
  | "ghost"
  | "destructive";

export type ButtonSize = "default" | "sm" | "icon" | "icon-sm";

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  default:
    "border-transparent bg-primary text-primary-foreground hover:bg-primary/90",
  secondary:
    "border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80",
  outline:
    "border-input bg-[var(--input-fill)] text-foreground hover:bg-[var(--input-fill-hover)]",
  ghost:
    "border-transparent bg-transparent text-foreground hover:bg-secondary/50",
  destructive:
    "border-transparent bg-destructive/65 text-white hover:bg-destructive/80",
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  default: "h-9 px-4 gap-2 text-sm",
  sm: "h-8 px-3 gap-1.5 text-[13px]",
  icon: "size-9 p-0",
  "icon-sm": "size-8 p-0",
};

export function buttonVariants({
  variant = "secondary",
  size = "default",
  className,
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
} = {}): string {
  return cn(
    "inline-flex shrink-0 cursor-pointer items-center justify-center rounded-md border font-medium whitespace-nowrap select-none",
    "transition-[background-color,color,border-color,box-shadow,transform] duration-150",
    "active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50",
    "data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[pending]:opacity-80",
    "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
    "[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
    VARIANT_CLASSES[variant],
    SIZE_CLASSES[size],
    className,
  );
}

export interface ButtonProps
  extends Omit<
      React.ComponentPropsWithoutRef<"button">,
      "type" | "onClick" | "className"
    >,
    ButtonOptions {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  render?: RenderProp;
  onClick?: (
    event: React.MouseEvent<HTMLElement>,
    details: ButtonActionDetails,
  ) => unknown;
}

export function Button({
  variant = "secondary",
  size = "default",
  className,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <BaseButton
      type={type}
      className={buttonVariants({ variant, size, className })}
      {...props}
    />
  );
}
