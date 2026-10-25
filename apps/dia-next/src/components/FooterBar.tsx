"use client";

import { usePathname } from "next/navigation";
import type { Plan } from "@dia/types";
import { plural } from "@/lib/format";
import styles from "./FooterBar.module.css";

/**
 * Status line at the bottom of the page. Planning shows the plan version and the order count.
 * Other pages show only the plan version. Nothing shows when no plan is loaded.
 */
export function FooterBar({ plan, orderCount }: { plan: Plan | null; orderCount: number | null }) {
  const pathname = usePathname();
  if (!plan) return null;
  const onPlanning = pathname === "/";

  return (
    <footer className={styles.foot}>
      <span>Plan version {plan.version}</span>
      {onPlanning && orderCount !== null && <span>{plural(orderCount, "order")}</span>}
    </footer>
  );
}
