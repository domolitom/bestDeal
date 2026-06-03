import Link from "next/link";
import { COUNTRY_META } from "@bestdeal/shared";

interface Crumb {
  label: string;
  href?: string;
}

export function Header({ crumbs = [] }: { crumbs?: Crumb[] }) {
  return (
    <header className="header">
      <div className="container header-inner">
        <div className="header-brand">
          <Link href="/" className="header-logo">
            <span className="header-logo-dot" aria-hidden="true" />
            BestDeal
          </Link>
          <span className="header-tagline">Updated every Mon &amp; Thu</span>
        </div>

        {crumbs.length > 0 && (
          <nav className="breadcrumb" aria-label="Breadcrumb">
            {crumbs.map((crumb, i) => (
              <span key={i}>
                {i > 0 && <span className="breadcrumb-sep">/</span>}
                {crumb.href ? (
                  <Link href={crumb.href}>{crumb.label}</Link>
                ) : (
                  <span>{crumb.label}</span>
                )}
              </span>
            ))}
          </nav>
        )}
      </div>
    </header>
  );
}

export function getCountryName(code: string): string {
  return COUNTRY_META[code]?.name ?? code;
}
