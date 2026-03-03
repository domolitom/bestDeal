import type { ExtractedLink } from "./link-discovery-service.ts";

export function buildSystemPrompt(): string {
  return `You are a configuration generator for a web scraper that extracts store catalog/flyer information.

Your task: given a list of links extracted from a store's catalog landing page, produce a JSON config object that defines how to discover and parse catalogs from that page.

## Output Schema (TypeScript)

interface UrlReplace {
  type: "replace";
  match: string;       // regex pattern to match in URL
  replacement: string; // replacement string
}

interface UrlAppend {
  type: "append";
  suffix: string;      // string to append to URL
}

interface UrlElse {
  type: "else";
  condition: string;   // substring to check for in URL
  ifTrue: UrlReplace;
  ifFalse: UrlReplace;
}

type UrlTransform = UrlReplace | UrlAppend | UrlElse;

interface LinkPattern {
  match: string;         // regex to match catalog link URLs
  slugGroup: number;     // capture group index for the catalog slug (0 = full URL)
  normalizeUrl: UrlTransform[];  // transforms to get the first-page URL
}

interface DatePattern {
  match: string;         // regex to extract dates
  dateFrom: string;      // back-reference for start date, e.g. "$1-$2"
  dateTo: string;        // back-reference for end date, e.g. "$3-$4-$5"
}

interface CatalogTypePattern {
  match: string;
  caseInsensitive?: boolean;
  transform?: "lowercase" | "uppercase";
}

interface StoreConfig {
  name: string;
  landingUrl: string;
  waitAfterLoad: number;
  linkDomain?: string;           // filter links to this domain only
  linkPatterns: LinkPattern[];   // at least one required
  dateSource: "slug" | "text" | "slug_then_text";
  datePatterns: DatePattern[];   // at least one required
  catalogTypePattern?: CatalogTypePattern;
}

## Rules

1. **linkPatterns.match**: Must be a valid JavaScript regex that matches ONLY catalog/flyer links, not navigation or other links. Use specific path segments or domains to narrow matches.

2. **linkPatterns.slugGroup**: The capture group that uniquely identifies a catalog. Use 0 if the full URL is the slug. Otherwise use a capture group number.

3. **linkPatterns.normalizeUrl**: Transforms to convert the matched URL into the "first page" URL. Common patterns:
   - Replace page numbers: { "type": "replace", "match": "/page/\\\\d+", "replacement": "/page/1" }
   - Remove article IDs: { "type": "replace", "match": "/ar/\\\\d+/?$", "replacement": "" }
   - Append view path: { "type": "append", "suffix": "/view/flyer/page/1" }
   - If the URL already points to a viewable page or image, use an empty array [].

4. **linkDomain**: Set this ONLY if catalog links point to a different domain than the landing page. This filters links to only those containing this domain string.

5. **dateSource**: Where to find date information:
   - "slug" — dates are in the URL/slug itself (e.g. /catalog-09-02-15-02-2026)
   - "text" — dates are in the surrounding text on the page
   - "slug_then_text" — try slug first, fall back to text

6. **datePatterns.match**: Regex that captures date components. Use capture groups for day, month, year parts.

7. **datePatterns.dateFrom / dateTo**: Back-references using $1, $2, etc. Format should produce either:
   - "DD-MM" (day-month, year inferred)
   - "DD-MM-YYYY" (full date)

8. **waitAfterLoad**: Milliseconds to wait after page load. Use 8000 for dynamic/JS-heavy pages, 3000 for static pages.

9. Output ONLY valid JSON. No markdown fences, no comments, no explanation.`;
}

export function buildUserPrompt(
  storeName: string,
  landingUrl: string,
  links: ExtractedLink[]
): string {
  const examples = `## Existing configs for reference

### Lidl Romania (dates in slug AND text, multiple link patterns, URL normalization)
Landing URL: https://www.lidl.ro/c/cataloage-online/s10019911
Config:
{
    "name": "lidl",
    "landingUrl": "https://www.lidl.ro/c/cataloage-online/s10019911",
    "waitAfterLoad": 8000,
    "linkPatterns": [
        {
            "match": "/cataloage/([^/]+)/view/flyer/page/\\\\d+",
            "slugGroup": 1,
            "normalizeUrl": [
                { "type": "replace", "match": "/page/\\\\d+", "replacement": "/page/1" }
            ]
        },
        {
            "match": "/cataloage/(catalogul[^/]+)/ar/\\\\d+",
            "slugGroup": 1,
            "normalizeUrl": [
                { "type": "replace", "match": "/ar/\\\\d+", "replacement": "/view/flyer/page/1" }
            ]
        },
        {
            "match": "/cataloage/(catalogul[^/]*\\\\d{2}-\\\\d{2}-\\\\d{2}-\\\\d{2}-\\\\d{4})/?$",
            "slugGroup": 1,
            "normalizeUrl": [
                { "type": "replace", "match": "/$", "replacement": "" },
                { "type": "append", "suffix": "/view/flyer/page/1" }
            ]
        }
    ],
    "dateSource": "slug_then_text",
    "datePatterns": [
        {
            "match": "(\\\\d{2}-\\\\d{2})-(\\\\d{2}-\\\\d{2}-\\\\d{4})$",
            "dateFrom": "$1",
            "dateTo": "$2"
        },
        {
            "match": "(\\\\d{2})\\\\.(\\\\d{2})\\\\s*-\\\\s*(\\\\d{2})\\\\.(\\\\d{2})\\\\.(\\\\d{4})",
            "dateFrom": "$1-$2",
            "dateTo": "$3-$4-$5"
        }
    ]
}

### Kaufland Romania (dates in text only, links on different domain, catalog type extraction)
Landing URL: https://www.kaufland.ro/cataloage-cu-reduceri.html
Config:
{
    "name": "kaufland",
    "landingUrl": "https://www.kaufland.ro/cataloage-cu-reduceri.html",
    "waitAfterLoad": 3000,
    "linkDomain": "leaflets.kaufland.com",
    "linkPatterns": [
        {
            "match": "leaflets\\\\.kaufland\\\\.com",
            "slugGroup": 0,
            "normalizeUrl": [
                { "type": "replace", "match": "/ar/\\\\d+/?$", "replacement": "" },
                {
                    "type": "else",
                    "condition": "/page/",
                    "ifTrue": { "type": "replace", "match": "/page/\\\\d+", "replacement": "/page/1" },
                    "ifFalse": { "type": "replace", "match": "/?$", "replacement": "/view/flyer/page/1" }
                }
            ]
        }
    ],
    "dateSource": "text",
    "datePatterns": [
        {
            "match": "(\\\\d{2})\\\\.(\\\\d{2})\\\\.(\\\\d{4})\\\\s*-\\\\s*(\\\\d{2})\\\\.(\\\\d{2})\\\\.(\\\\d{4})",
            "dateFrom": "$1-$2",
            "dateTo": "$4-$5-$6"
        }
    ],
    "catalogTypePattern": {
        "match": "RO_ro_(\\\\w+?)[\\\\d_]",
        "caseInsensitive": true,
        "transform": "lowercase"
    }
}

### Penny Romania (dates in text, links on different domain, simple config)
Landing URL: https://www.penny.ro/vezi-pliantele-saptamanii
Config:
{
    "name": "penny",
    "landingUrl": "https://www.penny.ro/vezi-pliantele-saptamanii",
    "waitAfterLoad": 8000,
    "linkDomain": "files.rewe.co.at",
    "linkPatterns": [
        {
            "match": "files\\\\.rewe\\\\.co\\\\.at/PennyIntLeaflet/RO/([^/]+)",
            "slugGroup": 1,
            "normalizeUrl": []
        }
    ],
    "dateSource": "text",
    "datePatterns": [
        {
            "match": "(\\\\d{2})\\\\.(\\\\d{2})\\\\s*-\\\\s*(\\\\d{2})\\\\.(\\\\d{2})\\\\.(\\\\d{4})",
            "dateFrom": "$1-$2",
            "dateTo": "$3-$4-$5"
        }
    ]
}`;

  const linkList = links
    .map(
      (l, i) =>
        `${i + 1}. href: ${l.href}\n   text: ${l.text}\n   context: ${l.surroundingText}`
    )
    .join("\n\n");

  return `${examples}

## Task

Generate a store config for **${storeName}**.
Landing URL: ${landingUrl}

Below are all links extracted from the landing page. Identify which links point to catalogs/flyers, then write regex patterns to match them and extract dates.

## Extracted links (${links.length} total)

${linkList}

Return ONLY the JSON config object. No markdown fences, no explanation.`;
}
