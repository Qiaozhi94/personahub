import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { cn } from "@/lib/utils";

// Shared tabs primitive (UX-002 / BC-052): aria-selected follows the active
// tab, the group keeps a single tab stop, arrow keys and Home/End switch.
// Radix owns the keyboard model; pages only supply values and labels.

export const AppTabs = TabsPrimitive.Root;

/** Panel bound to its trigger via Radix Content: hidden/shown by the active
 *  value with the aria-controls/aria-labelledby association (R2-014). */
export const AppTabsContent = TabsPrimitive.Content;

export function AppTabsList({ className, ...props }: React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>) {
  return <TabsPrimitive.List className={cn("flex items-stretch gap-1 border-b border-border", className)} {...props} />;
}

export function AppTabsTrigger({ className, ...props }: React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        "-mb-px border-b-2 border-transparent px-3 py-1.5 text-sm text-muted-foreground transition-colors",
        "hover:text-foreground",
        "data-[state=active]:border-primary data-[state=active]:text-foreground",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}
