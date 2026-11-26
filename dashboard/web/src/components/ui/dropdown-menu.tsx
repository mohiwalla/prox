import * as React from "react";
import {
  Menu as BaseMenu,
  MenuCheckboxItem as BaseMenuCheckboxItem,
  MenuContent as BaseMenuContent,
  MenuGroup as BaseMenuGroup,
  MenuGroupLabel as BaseMenuGroupLabel,
  MenuItem as BaseMenuItem,
  MenuItemIcon as BaseMenuItemIcon,
  MenuItemIndicator as BaseMenuItemIndicator,
  MenuRadioGroup as BaseMenuRadioGroup,
  MenuRadioItem as BaseMenuRadioItem,
  MenuSeparator as BaseMenuSeparator,
  MenuShortcut as BaseMenuShortcut,
  MenuSub as BaseMenuSub,
  MenuSubContent as BaseMenuSubContent,
  MenuSubTrigger as BaseMenuSubTrigger,
  MenuTrigger as BaseMenuTrigger,
  createMenuController,
  type MenuProps,
} from "@ui-sdk/react/menu";
import { CheckIcon, ChevronRightIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export { createMenuController, type MenuProps };

export function DropdownMenu(props: MenuProps) {
  return <BaseMenu {...props} />;
}

export function DropdownMenuTrigger({
  className,
  ...props
}: React.ComponentProps<typeof BaseMenuTrigger>) {
  return (
    <BaseMenuTrigger
      className={typeof className === "function" ? className : cn(className)}
      {...props}
    />
  );
}

export function DropdownMenuContent({
  className,
  sideOffset = 6,
  align = "end",
  ...props
}: React.ComponentProps<typeof BaseMenuContent>) {
  return (
    <BaseMenuContent
      sideOffset={sideOffset}
      align={align}
      className={
        typeof className === "function"
          ? className
          : cn(
              "z-50 min-w-[180px] overflow-hidden rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-xl",
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

export function DropdownMenuItem({
  className,
  ...props
}: React.ComponentProps<typeof BaseMenuItem>) {
  return (
    <BaseMenuItem
      className={
        typeof className === "function"
          ? className
          : cn(
              "relative flex cursor-pointer select-none items-center gap-2 rounded-md px-2.5 py-1.5 text-sm leading-5 outline-none",
              "text-foreground transition-colors",
              "data-highlighted:bg-secondary data-highlighted:text-foreground",
              "data-[destructive]:text-destructive data-[destructive]:data-highlighted:bg-destructive/15 data-[destructive]:data-highlighted:text-destructive",
              "data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
              "[&_svg]:size-4 [&_svg]:shrink-0",
              className,
            )
      }
      {...props}
    />
  );
}

export function DropdownMenuItemIcon({
  className,
  ...props
}: React.ComponentProps<typeof BaseMenuItemIcon>) {
  return (
    <BaseMenuItemIcon
      className={
        typeof className === "function"
          ? className
          : cn("inline-flex size-4 shrink-0 items-center justify-center", className)
      }
      {...props}
    />
  );
}

export function DropdownMenuCheckboxItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof BaseMenuCheckboxItem>) {
  return (
    <BaseMenuCheckboxItem
      className={
        typeof className === "function"
          ? className
          : cn(
              "relative flex cursor-pointer select-none items-center gap-2 rounded-md py-1.5 pr-2.5 pl-8 text-sm leading-5 outline-none",
              "data-highlighted:bg-secondary data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
              className,
            )
      }
      {...props}
    >
      {typeof children === "function" ? (
        children
      ) : (
        <>
          <BaseMenuItemIndicator className="absolute left-2 inline-flex size-4 items-center justify-center">
            <CheckIcon className="size-3.5" aria-hidden="true" />
          </BaseMenuItemIndicator>
          {children}
        </>
      )}
    </BaseMenuCheckboxItem>
  );
}

export const DropdownMenuRadioGroup = BaseMenuRadioGroup;

export function DropdownMenuRadioItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof BaseMenuRadioItem>) {
  return (
    <BaseMenuRadioItem
      className={
        typeof className === "function"
          ? className
          : cn(
              "relative flex cursor-pointer select-none items-center gap-2 rounded-md py-1.5 pr-2.5 pl-8 text-sm leading-5 outline-none",
              "data-highlighted:bg-secondary data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
              className,
            )
      }
      {...props}
    >
      {typeof children === "function" ? (
        children
      ) : (
        <>
          <BaseMenuItemIndicator className="absolute left-2 inline-flex size-4 items-center justify-center">
            <span className="size-1.5 rounded-full bg-current" />
          </BaseMenuItemIndicator>
          {children}
        </>
      )}
    </BaseMenuRadioItem>
  );
}

export const DropdownMenuGroup = BaseMenuGroup;

export function DropdownMenuLabel({
  className,
  ...props
}: React.ComponentProps<typeof BaseMenuGroupLabel>) {
  return (
    <BaseMenuGroupLabel
      className={
        typeof className === "function"
          ? className
          : cn("px-2.5 py-1.5 text-xs font-medium text-muted-foreground", className)
      }
      {...props}
    />
  );
}

export function DropdownMenuSeparator({
  className,
  ...props
}: React.ComponentProps<typeof BaseMenuSeparator>) {
  return (
    <BaseMenuSeparator
      className={
        typeof className === "function"
          ? className
          : cn("-mx-1 my-1 h-px bg-border", className)
      }
      {...props}
    />
  );
}

export function DropdownMenuShortcut({
  className,
  ...props
}: React.ComponentProps<typeof BaseMenuShortcut>) {
  return (
    <BaseMenuShortcut
      className={
        typeof className === "function"
          ? className
          : cn("ml-auto text-xs tracking-wider text-muted-foreground", className)
      }
      {...props}
    />
  );
}

export const DropdownMenuSub = BaseMenuSub;

export function DropdownMenuSubTrigger({
  className,
  children,
  ...props
}: React.ComponentProps<typeof BaseMenuSubTrigger>) {
  return (
    <BaseMenuSubTrigger
      className={
        typeof className === "function"
          ? className
          : cn(
              "flex cursor-pointer select-none items-center gap-2 rounded-md px-2.5 py-1.5 text-sm outline-none",
              "data-highlighted:bg-secondary data-[open]:bg-secondary/70",
              className,
            )
      }
      {...props}
    >
      {typeof children === "function" ? (
        children
      ) : (
        <>
          {children}
          <ChevronRightIcon className="ml-auto size-4 text-muted-foreground" aria-hidden="true" />
        </>
      )}
    </BaseMenuSubTrigger>
  );
}

export function DropdownMenuSubContent({
  className,
  ...props
}: React.ComponentProps<typeof BaseMenuSubContent>) {
  return (
    <BaseMenuSubContent
      className={
        typeof className === "function"
          ? className
          : cn(
              "z-50 min-w-[160px] overflow-hidden rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-xl",
              className,
            )
      }
      {...props}
    />
  );
}

export {
  DropdownMenu as Menu,
  DropdownMenuTrigger as MenuTrigger,
  DropdownMenuContent as MenuContent,
  DropdownMenuItem as MenuItem,
  DropdownMenuItemIcon as MenuItemIcon,
  DropdownMenuSeparator as MenuSeparator,
  DropdownMenuGroup as MenuGroup,
  DropdownMenuLabel as MenuGroupLabel,
};
