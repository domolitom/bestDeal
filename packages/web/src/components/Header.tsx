import Link from "next/link";
import { COUNTRY_META } from "@bestdeal/shared";

interface Crumb {
  label: string;
  href?: string;
}

function formatHeaderDate(): string {
  const d = new Date();
  return d.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export function Header({ crumbs = [] }: { crumbs?: Crumb[] }) {
  const dateStr = formatHeaderDate();

  return (
    <header className="header">
      <div className="container header-inner">
        <div className="header-brand">
          <Link href="/" className="header-logo">
            BestDeal
          </Link>
          <span className="header-tagline">European Catalog Review</span>
        </div>

        {crumbs.length > 0 && (
          <nav className="breadcrumb" aria-label="Breadcrumb">
            {crumbs.map((crumb, i) => (
              <span key={i}>
                {i > 0 && <span className="breadcrumb-sep">&middot;</span>}
                {crumb.href ? (
                  <Link href={crumb.href}>{crumb.label}</Link>
                ) : (
                  <span>{crumb.label}.</span>
                )}
              </span>
            ))}
          </nav>
        )}

        <span className="header-date" aria-hidden="true">
          {dateStr}
        </span>
      </div>
    </header>
  );
}

export function getCountryName(code: string): string {
  return COUNTRY_META[code]?.name ?? code;
}
