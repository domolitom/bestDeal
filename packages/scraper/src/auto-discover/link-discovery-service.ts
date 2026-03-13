import { chromium } from "../browser.ts";

export interface ExtractedLink {
  href: string;
  text: string;
  surroundingText: string;
}

export interface LinkDiscoveryResult {
  url: string;
  pageTitle: string;
  links: ExtractedLink[];
}

/**
 * Navigate to a URL and extract all links with their surrounding text context.
 * Standalone Playwright service — no LLM or store config knowledge.
 */
export async function discoverLinks(url: string): Promise<LinkDiscoveryResult> {
  console.log(`[link-discovery] navigating to ${url}`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 800, height: 1200 },
  });
  const page = await context.newPage();

  try {
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(8000);

    const pageTitle = await page.title();

    const rawLinks = await page.evaluate(() => {
      const results: { href: string; text: string; surroundingText: string }[] =
        [];
      const seen = new Set<string>();

      // Extract <a href> links
      for (const anchor of Array.from(document.querySelectorAll("a[href]"))) {
        const el = anchor as HTMLAnchorElement;
        const href = el.href;
        if (!href || href.startsWith("javascript:") || href === "#") continue;
        if (seen.has(href)) continue;
        seen.add(href);

        const text = (el.textContent || "").trim().slice(0, 200);

        let surroundingText = "";
        const card =
          el.closest("[class*='card']") ||
          el.closest("[class*='item']") ||
          el.closest("[class*='tile']") ||
          el.closest("li") ||
          el.closest("article");
        if (card) {
          surroundingText = (card.textContent || "").trim().slice(0, 300);
        } else if (el.parentElement) {
          surroundingText = (el.parentElement.textContent || "")
            .trim()
            .slice(0, 300);
        }

        results.push({ href, text, surroundingText });
      }

      // Extract <iframe src> (embedded catalog viewers)
      for (const iframe of Array.from(
        document.querySelectorAll("iframe[src]")
      )) {
        const src = (iframe as HTMLIFrameElement).src;
        if (!src || seen.has(src)) continue;
        seen.add(src);

        let surroundingText = "";
        if (iframe.parentElement) {
          surroundingText = (iframe.parentElement.textContent || "")
            .trim()
            .slice(0, 300);
        }

        results.push({
          href: src,
          text: "[iframe]",
          surroundingText,
        });
      }

      return results;
    });

    console.log(`[link-discovery] extracted ${rawLinks.length} links`);

    return { url, pageTitle, links: rawLinks };
  } finally {
    await browser.close();
  }
}
