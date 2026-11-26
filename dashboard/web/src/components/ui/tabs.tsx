import * as React from "react";
import {
  Tabs as BaseTabs,
  TabsIndicator as BaseTabsIndicator,
  TabsList as BaseTabsList,
  TabsPanel as BaseTabsPanel,
  TabsTab as BaseTabsTab,
  TabsTabIcon as BaseTabsTabIcon,
  createTabsController,
} from "@ui-sdk/react/tabs";
import { cn } from "@/lib/utils";

export { createTabsController };

export function Tabs<A extends string = string>({
  className,
  ...props
}: React.ComponentProps<typeof BaseTabs<A>>) {
  return (
    <BaseTabs
      className={
        typeof className === "function"
          ? className
          : cn("flex flex-col gap-3", className)
      }
      {...props}
    />
  );
}

export function TabsList({
  className,
  ...props
}: React.ComponentProps<typeof BaseTabsList>) {
  return (
    <BaseTabsList
      className={
        typeof className === "function"
          ? className
          : cn(
              "relative inline-flex w-fit items-center gap-1 rounded-lg bg-secondary/70 p-1 text-muted-foreground",
              className,
            )
      }
      {...props}
    />
  );
}

export function TabsTab({
  className,
  ...props
}: React.ComponentProps<typeof BaseTabsTab>) {
  return (
    <BaseTabsTab
      className={
        typeof className === "function"
          ? className
          : cn(
              "relative z-1 inline-flex h-8 cursor-pointer items-center justify-center gap-2 rounded-md px-3 text-sm font-medium whitespace-nowrap",
              "text-muted-foreground transition-colors duration-150",
              "hover:text-foreground",
              "data-selected:bg-background data-selected:text-foreground data-selected:shadow-xs",
              "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
              "data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
              "[&_svg]:size-4 [&_svg]:shrink-0",
              className,
            )
      }
      {...props}
    />
  );
}

export const TabsTabIcon = BaseTabsTabIcon;

export function TabsIndicator({
  className,
  ...props
}: React.ComponentProps<typeof BaseTabsIndicator>) {
  return (
    <BaseTabsIndicator
      className={
        typeof className === "function"
          ? className
          : cn(
              "pointer-events-none absolute top-(--active-tab-top) left-(--active-tab-left) h-(--active-tab-height) w-(--active-tab-width)",
              "rounded-md bg-background transition-[left,top,width,height] duration-200 ease-out motion-reduce:transition-none",
              className,
            )
      }
      {...props}
    />
  );
}

export function TabsPanel({
  className,
  ...props
}: React.ComponentProps<typeof BaseTabsPanel>) {
  return (
    <BaseTabsPanel
      className={
        typeof className === "function"
          ? className
          : cn("focus-visible:outline-none", className)
      }
      {...props}
    />
  );
}

export { TabsTab as TabsTrigger, TabsPanel as TabsContent };
