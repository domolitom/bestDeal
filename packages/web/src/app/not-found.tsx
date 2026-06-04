import Link from "next/link";
import { Header } from "@/components/Header";

export const runtime = "edge";

export default function NotFound() {
  return (
    <>
      <Header />
      <main className="container">
        <div className="not-found-masthead">
          <p className="home-masthead-kicker">404</p>
          <h1 className="not-found-title">Page not found.</h1>
          <p className="not-found-body">
            That page doesn&rsquo;t exist &mdash; but this week&rsquo;s catalogs are right where you left them.
          </p>
          <Link href="/" className="not-found-link">
            &larr; Browse all catalogs
          </Link>
        </div>
      </main>
    </>
  );
}
