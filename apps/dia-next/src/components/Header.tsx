"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_ITEMS, PAGE_PATHS } from "@/lib/config";

/** Links after the page list in NAV_ITEMS. */
const EXTRA_ITEMS = [
  { href: "/dispatch", label: "Dispatch" },
  { href: "/assumptions", label: "Assumptions" },
];

export function Header() {
  const pathname = usePathname();

  return (
    <header className="global">
      <span className="logo">Vitaran</span>
      <nav className="global-nav" aria-label="Pages">
        {NAV_ITEMS.map((item) => {
          const href = PAGE_PATHS[item.page];
          const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <Link key={item.page} href={href} aria-current={active ? "page" : undefined}>
              {item.label}
            </Link>
          );
        })}
        {EXTRA_ITEMS.map((item) => {
          const active = pathname.startsWith(item.href);
          return (
            <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined}>
              {item.label}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
