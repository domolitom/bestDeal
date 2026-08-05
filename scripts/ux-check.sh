#!/usr/bin/env bash
# ux-check.sh — Post-deploy structural UX checker for best-deal-shops.com
#
# Usage:
#   bash scripts/ux-check.sh [BASE_URL] [CDN_URL]
#
# Defaults:
#   BASE_URL=https://best-deal-shops.com
#   CDN_URL=https://cdn.best-deal-shops.com
#
# Each check writes its failure details to $FAILURES_FILE (one line per check).
# Exit code is 0 if all checks pass, 1 if any fail.

set -uo pipefail

BASE_URL="${1:-https://best-deal-shops.com}"
CDN_URL="${2:-https://cdn.best-deal-shops.com}"
TODAY=$(date -u +%Y-%m-%d)

# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

FAILURES=()
PASS_COUNT=0
FAIL_COUNT=0

pass() {
  local name="$1"
  echo -e "${GREEN}PASS${NC} $name"
  PASS_COUNT=$((PASS_COUNT + 1))
}

fail() {
  local name="$1"
  local detail="$2"
  echo -e "${RED}FAIL${NC} $name"
  echo -e "     ${YELLOW}$detail${NC}"
  FAILURES+=("$name: $detail")
  FAIL_COUNT=$((FAIL_COUNT + 1))
}

http_get() {
  curl -s -L --max-time 20 "$1"
}

http_status() {
  curl -s -o /dev/null -L --max-time 20 -w "%{http_code}" "$1"
}

# --------------------------------------------------------------------------
# CHECK 1: Key URLs return expected HTTP status
# --------------------------------------------------------------------------
echo ""
echo "=== Check 1: Key URL status codes ==="

declare -A EXPECTED_STATUS=(
  ["/"]="200"
  ["/romania"]="200"
  ["/germany"]="200"
  ["/austria"]="200"
  ["/finland"]="200"
  ["/germany/lidl"]="200"
  ["/austria/penny"]="200"
  ["/germany/totally-fake-store"]="404"
  ["/feed.xml"]="200"
  ["/sitemap.xml"]="200"
  ["/robots.txt"]="200"
  ["/manifest.webmanifest"]="200"
)

for path in "/" "/romania" "/germany" "/austria" "/finland" "/germany/lidl" "/austria/penny" "/germany/totally-fake-store" "/feed.xml" "/sitemap.xml" "/robots.txt" "/manifest.webmanifest"; do
  expected="${EXPECTED_STATUS[$path]}"
  actual=$(http_status "${BASE_URL}${path}")
  if [ "$actual" = "$expected" ]; then
    pass "URL ${path} → ${actual}"
  else
    fail "URL ${path} → expected ${expected}, got ${actual}" "curl returned HTTP $actual for ${BASE_URL}${path}"
  fi
done

# --------------------------------------------------------------------------
# CHECK 2: JSON-LD schema types present per page
# --------------------------------------------------------------------------
echo ""
echo "=== Check 2: JSON-LD schema types ==="

# Homepage: WebSite + ItemList
HOME_HTML=$(http_get "${BASE_URL}/")
if echo "$HOME_HTML" | grep -q '"@type":"WebSite"\|"@type": "WebSite"'; then
  pass "/ contains @type:WebSite"
else
  fail "/ missing @type:WebSite" "Could not find WebSite JSON-LD block on homepage"
fi
if echo "$HOME_HTML" | grep -q '"@type":"ItemList"\|"@type": "ItemList"'; then
  pass "/ contains @type:ItemList"
else
  fail "/ missing @type:ItemList" "Could not find ItemList JSON-LD block on homepage"
fi

# Country page: BreadcrumbList
ROMANIA_HTML=$(http_get "${BASE_URL}/romania")
if echo "$ROMANIA_HTML" | grep -q '"@type":"BreadcrumbList"\|"@type": "BreadcrumbList"'; then
  pass "/romania contains @type:BreadcrumbList"
else
  fail "/romania missing @type:BreadcrumbList" "Could not find BreadcrumbList JSON-LD on /romania"
fi

# Store page: BreadcrumbList
LIDL_HTML=$(http_get "${BASE_URL}/romania/lidl")
if echo "$LIDL_HTML" | grep -q '"@type":"BreadcrumbList"\|"@type": "BreadcrumbList"'; then
  pass "/romania/lidl contains @type:BreadcrumbList"
else
  fail "/romania/lidl missing @type:BreadcrumbList" "Could not find BreadcrumbList JSON-LD on /romania/lidl"
fi

# Catalog detail: Article + Offer — find a real current catalog from manifest
CATALOG_ID=""
CATALOG_URL=""

MANIFEST_JSON=$(curl -s --max-time 20 "${CDN_URL}/manifest.json" 2>/dev/null)
if [ -n "$MANIFEST_JSON" ]; then
  CATALOG_ID=$(echo "$MANIFEST_JSON" | TODAY="$TODAY" python3 -c "
import json, sys, os
data = json.load(sys.stdin)
catalogs = data if isinstance(data, list) else data.get('catalogs', [])
today = os.environ.get('TODAY', '')
for c in catalogs:
    if (c.get('status') == 'ready'
            and c.get('dateFrom', '') <= today
            and c.get('dateTo', '') >= today):
        print(f\"{c['country']}/{c['store']}/{c['id']}\")
        break
")
fi

CATALOG_HTML=""
if [ -n "$CATALOG_ID" ]; then
  CATALOG_URL="${BASE_URL}/${CATALOG_ID}"
  CATALOG_HTML=$(http_get "$CATALOG_URL")

  if echo "$CATALOG_HTML" | grep -q '"@type":"Article"\|"@type": "Article"'; then
    pass "catalog detail contains @type:Article  (${CATALOG_ID})"
  else
    fail "catalog detail missing @type:Article" "No Article JSON-LD on ${CATALOG_URL}"
  fi

  if echo "$CATALOG_HTML" | grep -q '"@type":"Offer"\|"@type": "Offer"'; then
    pass "catalog detail contains @type:Offer  (${CATALOG_ID})"
  else
    fail "catalog detail missing @type:Offer" "No Offer JSON-LD on ${CATALOG_URL}"
  fi
else
  fail "catalog detail JSON-LD (Article+Offer)" "Could not find a current ready catalog in manifest to test"
fi

# --------------------------------------------------------------------------
# CHECK 3: OpenGraph + Twitter metadata
# --------------------------------------------------------------------------
echo ""
echo "=== Check 3: OpenGraph + Twitter metadata ==="

if echo "$HOME_HTML" | grep -q '<meta property="og:title"'; then
  pass "/ has og:title"
else
  fail "/ missing og:title" "No <meta property=\"og:title\"> found on homepage"
fi
if echo "$HOME_HTML" | grep -q '<meta name="twitter:card"'; then
  pass "/ has twitter:card"
else
  fail "/ missing twitter:card" "No <meta name=\"twitter:card\"> found on homepage"
fi

# Country page og:image pointing to CDN
OG_IMAGE=$(echo "$ROMANIA_HTML" | python3 -c "
import sys, re
html = sys.stdin.read()
m = re.search(r'<meta property=\"og:image\" content=\"([^\"]+)\"', html)
print(m.group(1) if m else '')
")
if [ -n "$OG_IMAGE" ] && echo "$OG_IMAGE" | grep -q "cdn.best-deal-shops.com"; then
  pass "/romania og:image points to CDN  ($OG_IMAGE)"
else
  fail "/romania og:image CDN check" "og:image is '${OG_IMAGE}' — expected cdn.best-deal-shops.com"
fi

# Catalog detail: twitter:image
if [ -n "$CATALOG_HTML" ] && [ -n "$CATALOG_ID" ]; then
  if echo "$CATALOG_HTML" | grep -q '<meta name="twitter:image"'; then
    pass "catalog detail has twitter:image"
  else
    fail "catalog detail missing twitter:image" "No <meta name=\"twitter:image\"> on ${CATALOG_URL}"
  fi
else
  fail "catalog detail twitter:image" "No catalog HTML available — skipped"
fi

# --------------------------------------------------------------------------
# CHECK 4: Feed sanity
# --------------------------------------------------------------------------
echo ""
echo "=== Check 4: Feed sanity ==="

FEED_RESPONSE=$(curl -sI --max-time 20 "${BASE_URL}/feed.xml" 2>/dev/null)
FEED_BODY=$(http_get "${BASE_URL}/feed.xml")

# Valid XML
XML_CHECK=$(echo "$FEED_BODY" | python3 -c "
import sys, xml.etree.ElementTree as ET
try:
    ET.fromstring(sys.stdin.read())
    print('ok')
except Exception as e:
    print(f'error: {e}')
")
if [ "$XML_CHECK" = "ok" ]; then
  pass "/feed.xml is valid XML"
else
  fail "/feed.xml invalid XML" "$XML_CHECK"
fi

# Last-Modified not in the future
LAST_MOD=$(echo "$FEED_RESPONSE" | grep -i "^last-modified:" | sed 's/[Ll]ast-[Mm]odified: //' | tr -d '\r')
if [ -n "$LAST_MOD" ]; then
  LAST_MOD_EPOCH=$(python3 -c "
from email.utils import parsedate_to_datetime
import sys
try:
    dt = parsedate_to_datetime('${LAST_MOD}')
    print(int(dt.timestamp()))
except:
    print(0)
")
  NOW_EPOCH=$(date -u +%s)
  if [ "$LAST_MOD_EPOCH" -gt "$NOW_EPOCH" ] 2>/dev/null; then
    fail "/feed.xml Last-Modified is in the future" "Last-Modified: ${LAST_MOD} (epoch ${LAST_MOD_EPOCH} > now ${NOW_EPOCH})"
  else
    pass "/feed.xml Last-Modified is not in the future  (${LAST_MOD})"
  fi
else
  fail "/feed.xml missing Last-Modified header" "No Last-Modified header in response"
fi

# At least 1 <item>
ITEM_COUNT=$(echo "$FEED_BODY" | python3 -c "
import sys, xml.etree.ElementTree as ET
try:
    root = ET.fromstring(sys.stdin.read())
    print(len(root.findall('.//item')))
except:
    print(0)
")
if [ "$ITEM_COUNT" -ge 1 ] 2>/dev/null; then
  pass "/feed.xml has ${ITEM_COUNT} <item> elements"
else
  fail "/feed.xml has no <item> elements" "Expected at least 1 item, found ${ITEM_COUNT}"
fi

# --------------------------------------------------------------------------
# CHECK 5: Country page masthead renders (has .masthead-title element)
# --------------------------------------------------------------------------
echo ""
echo "=== Check 5: Country page masthead renders ==="

for check_country in "romania" "germany"; do
  CHECK_HTML=""
  if [ "$check_country" = "romania" ]; then
    CHECK_HTML="$ROMANIA_HTML"
  else
    CHECK_HTML=$(http_get "${BASE_URL}/germany")
  fi

  HAS_MASTHEAD=$(echo "$CHECK_HTML" | grep -c 'class="masthead-title"' 2>/dev/null || true)

  if [ "$HAS_MASTHEAD" -gt 0 ]; then
    pass "/${check_country} masthead-title is present"
  else
    # OK if page is in empty state
    EMPTY_STATE=$(echo "$CHECK_HTML" | grep -c "empty-state" 2>/dev/null || true)
    if [ "$EMPTY_STATE" -gt 0 ]; then
      pass "/${check_country} masthead absent (page is in empty-state — expected)"
    else
      fail "/${check_country} masthead-title not found" "No .masthead-title element in non-empty country page"
    fi
  fi
done

# --------------------------------------------------------------------------
# CHECK 6: Dedup — byline count matches rendered card count
# --------------------------------------------------------------------------
echo ""
echo "=== Check 6: Dedup sanity (Germany) ==="

GERMANY_HTML=$(http_get "${BASE_URL}/germany")

DEDUP_TMP=$(mktemp)
echo "$GERMANY_HTML" > "$DEDUP_TMP"
DEDUP_RESULT=$(python3 - "$DEDUP_TMP" <<'PYEOF'
import sys, re

html = open(sys.argv[1]).read()

byline_m = re.search(r'class="masthead-byline"[^>]*>\s*(\d+)\s+stores?[^·]*·[^·]*\s(\d+)\s+catalog', html)
byline_count = int(byline_m.group(2)) if byline_m else None

store_rows_m = re.search(r'class="store-rows"(.*?)(?=class="expired-section|</main)', html, re.DOTALL)
if store_rows_m:
    card_count = len(re.findall(r'store-row-card-wrapper', store_rows_m.group(1)))
else:
    card_count = None

if byline_count is None:
    print("SKIP:no-byline")
elif card_count is None:
    print("SKIP:no-store-rows")
elif byline_count != card_count:
    print(f"FAIL:byline={byline_count},cards={card_count}")
else:
    print(f"PASS:{byline_count}")
PYEOF
)
rm -f "$DEDUP_TMP"

case "$DEDUP_RESULT" in
  PASS:*)
    COUNT="${DEDUP_RESULT#PASS:}"
    pass "/germany dedup OK — byline and card count both ${COUNT}"
    ;;
  FAIL:*)
    DETAIL="${DEDUP_RESULT#FAIL:}"
    fail "/germany dedup mismatch" "Byline count != rendered card count: ${DETAIL}"
    ;;
  SKIP:no-byline)
    # Germany might be in empty state
    EMPTY_STATE=$(echo "$GERMANY_HTML" | grep -c "empty-state" 2>/dev/null || true)
    if [ "$EMPTY_STATE" -gt 0 ]; then
      pass "/germany dedup check skipped (page is in empty-state)"
    else
      fail "/germany dedup — byline not found" "Could not parse byline catalog count on /germany"
    fi
    ;;
  SKIP:no-store-rows)
    pass "/germany dedup check skipped (no store-rows found — likely empty state)"
    ;;
  *)
    fail "/germany dedup check" "Unexpected result: ${DEDUP_RESULT}"
    ;;
esac

# --------------------------------------------------------------------------
# CHECK 7: No wildly future-dated validFrom in Offer JSON-LD
# --------------------------------------------------------------------------
echo ""
echo "=== Check 7: No future-dated validFrom on catalog detail ==="

if [ -n "$CATALOG_ID" ] && [ -n "$CATALOG_HTML" ]; then
  DATES_TMP=$(mktemp)
  echo "$CATALOG_HTML" > "$DATES_TMP"
  DATE_CHECK=$(python3 - "$DATES_TMP" <<'PYEOF'
import sys, re, json
from datetime import datetime, timedelta, timezone

html = open(sys.argv[1]).read()

blocks = re.findall(r'<script type="application/ld\+json">(.*?)</script>', html, re.DOTALL)
today = datetime.now(timezone.utc).date()
threshold = today + timedelta(days=90)

for block in blocks:
    try:
        data = json.loads(block)
    except Exception:
        continue
    if data.get('@type') != 'Offer':
        continue
    valid_from_str = data.get('validFrom', '')
    valid_through_str = data.get('validThrough', '')
    if not valid_from_str:
        print('FAIL:no-validFrom')
        break
    try:
        valid_from = datetime.strptime(valid_from_str, '%Y-%m-%d').date()
    except Exception as e:
        print(f'FAIL:parse-error:{e}')
        break
    if valid_from > threshold:
        print(f'FAIL:future-validFrom:{valid_from_str}:{today}')
        break
    print(f'PASS:{valid_from_str}:{valid_through_str}')
    break
else:
    print('SKIP:no-offer-block')
PYEOF
  )
  rm -f "$DATES_TMP"

  case "$DATE_CHECK" in
    PASS:*)
      DATES="${DATE_CHECK#PASS:}"
      pass "catalog validFrom is sane  (${DATES})"
      ;;
    FAIL:future-validFrom:*)
      REST="${DATE_CHECK#FAIL:future-validFrom:}"
      VF="${REST%%:*}"
      TODAY_="${REST##*:}"
      fail "catalog validFrom is far in the future" "${VF} is more than 90 days ahead of today (${TODAY_})"
      ;;
    FAIL:no-validFrom)
      fail "catalog Offer missing validFrom field" "Offer JSON-LD has no validFrom on ${CATALOG_URL}"
      ;;
    FAIL:parse-error:*)
      fail "catalog validFrom parse error" "${DATE_CHECK#FAIL:parse-error:}"
      ;;
    SKIP:no-offer-block)
      pass "catalog validFrom check skipped (no Offer JSON-LD block found)"
      ;;
    *)
      fail "catalog validFrom check" "Unexpected result: ${DATE_CHECK}"
      ;;
  esac
else
  fail "catalog validFrom check" "No catalog URL available — skipped"
fi

# --------------------------------------------------------------------------
# Summary
# --------------------------------------------------------------------------
echo ""
echo "========================================"
echo "Results: ${PASS_COUNT} passed, ${FAIL_COUNT} failed"
echo "========================================"

if [ "${#FAILURES[@]}" -gt 0 ]; then
  echo ""
  echo "FAILURES:"
  for f in "${FAILURES[@]}"; do
    echo "  - $f"
  done
  exit 1
else
  echo "All checks passed."
  exit 0
fi
