"use client";

import { isCatalogActive, getFreshnessLabel } from "@bestdeal/shared";

export function FreshnessIndicator({ dateTo }: { dateTo: string }) {
  const active = isCatalogActive(dateTo);
  const label = getFreshnessLabel(dateTo);
  if (!label) return null;

  let className = "freshness ";
  if (!active) {
    className += "freshness-expired";
  } else if (label.includes("today") || label.includes("tomorrow")) {
    className += "freshness-soon";
  } else {
    className += "freshness-active";
  }

  return (
    <span className={className} title={active ? "Currently valid" : "Expired"}>
      {active ? `▲ ${label}` : label}
    </span>
  );
}

export function StatusBadge({ dateTo }: { dateTo: string }) {
  const active = isCatalogActive(dateTo);
  return (
    <span className={`badge ${active ? "badge-active" : "badge-expired"}`}>
      {active ? "Active" : "Expired"}
    </span>
  );
}
