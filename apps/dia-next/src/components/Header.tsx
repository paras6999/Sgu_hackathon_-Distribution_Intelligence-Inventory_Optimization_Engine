"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_ITEMS, PAGE_PATHS } from "@/lib/config";

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
      </nav>
    </header>
  );
}
