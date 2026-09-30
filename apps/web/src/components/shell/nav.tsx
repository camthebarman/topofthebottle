"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "@/components/ui";

export interface NavItem {
  href: string;
  label: string;
  icon: string;
}

export const PRIMARY: NavItem[] = [
  { href: "/today", label: "Today", icon: "M3 12h18M12 3v18" },
  { href: "/recipes", label: "Recipes", icon: "M6 3h12l-5 8v7h3v3H8v-3h3v-7z" },
  { href: "/inventory", label: "Inventory", icon: "M4 7h16v13H4zM8 7V4h8v3" },
  { href: "/barbook", label: "Bar Book", icon: "M5 4h11l3 3v13H5zM8 10h8M8 14h8" },
  { href: "/more", label: "More", icon: "M5 12h.01M12 12h.01M19 12h.01" },
];

export const SECONDARY: NavItem[] = [
  { href: "/schedule", label: "Schedule", icon: "" },
  { href: "/events", label: "Events", icon: "" },
  { href: "/imports", label: "Imports", icon: "" },
  { href: "/insights", label: "Insights", icon: "" },
  { href: "/settings", label: "Settings", icon: "" },
];

function active(path: string, href: string) {
  return path === href || path.startsWith(`${href}/`);
}

export function BottomNav() {
  const path = usePathname();
  const moreActive = SECONDARY.some((i) => active(path, i.href));
  return (
    <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden">
      <ul className="grid grid-cols-5">
        {PRIMARY.map((item) => {
          const on = active(path, item.href) || (item.href === "/more" && moreActive);
          return (
            <li key={item.href}>
              <Link href={item.href} aria-current={on ? "page" : undefined} className={cx("flex min-h-14 flex-col items-center justify-center gap-0.5 text-xs font-medium", on ? "text-accent" : "text-muted")}>
                <svg aria-hidden="true" viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth={on ? 2.4 : 1.8} strokeLinecap="round" strokeLinejoin="round">
                  <path d={item.icon} />
                </svg>
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function SideNav() {
  const path = usePathname();
  const items = [...PRIMARY.filter((i) => i.href !== "/more"), ...SECONDARY];
  return (
    <nav aria-label="Main" className="hidden lg:block">
      <ul className="space-y-1">
        {items.map((item) => {
          const on = active(path, item.href);
          return (
            <li key={item.href}>
              <Link href={item.href} aria-current={on ? "page" : undefined} className={cx("flex min-h-11 items-center rounded-lg px-3 font-medium", on ? "bg-surface-2 text-accent" : "text-fg hover:bg-surface-2")}>
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
