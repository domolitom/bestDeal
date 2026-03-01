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
        <Link href="/" className="header-logo">
          BestDeal
        </Link>
        {crumbs.length > 0 && (
          <nav className="breadcrumb">
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
