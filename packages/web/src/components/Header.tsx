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
          <svg viewBox="0 0 24 28" width="24" height="28" aria-hidden="true">
            <path d="M11 7c-1.5-3-5-5-5-5s1.5 3 3 5" fill="#4CAF50" />
            <path d="M12 6c0-4-1.5-6-1.5-6s-1 3 0 5.5" fill="#66BB6A" />
            <path d="M13 7c1.5-3 5-5 5-5s-1.5 3-3 5" fill="#4CAF50" />
            <path d="M8.5 8c0 0-.5 5 .5 10s3 9 3 9 1.5-4 3-9 .5-10 .5-10-2.5-1.2-3.5-1.2S8.5 8 8.5 8z" fill="#FF9800" />
            <line x1="10.5" y1="13" x2="13.5" y2="13" stroke="#F57C00" strokeWidth="0.6" strokeLinecap="round" />
            <line x1="10" y1="17" x2="13" y2="17" stroke="#F57C00" strokeWidth="0.6" strokeLinecap="round" />
          </svg>
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
