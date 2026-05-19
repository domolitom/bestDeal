import Link from "next/link";
import { Header } from "@/components/Header";

export const runtime = "edge";

export default function NotFound() {
  return (
    <>
      <Header />
      <main className="container">
        <div className="home-masthead">
          <p className="home-masthead-kicker">404 &nbsp;&middot;&nbsp; Page Not Found</p>
          <h1 className="home-masthead-title">Lost<br />in the stacks.</h1>
          <p className="home-masthead-subtitle">
            That page doesn&rsquo;t exist &mdash; but this week&rsquo;s catalogs are right where you left them.
          </p>
          <Link href="/" className="not-found-link">
            &larr; Back to the front page
          </Link>
        </div>
      </main>
    </>
  );
}
