export const runtime = "edge";

/** ISO week number (Monday-based) */
function isoWeek(d: Date): number {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

function formatRibbonDate(d: Date): { full: string; compact: string } {
  const weekday = d.toLocaleDateString("en-GB", { weekday: "long" }).toUpperCase();
  const day = String(d.getDate()).padStart(2, "0");
  const month = d.toLocaleDateString("en-GB", { month: "short" }).toUpperCase();
  const year = d.getFullYear();
  return {
    full: `${weekday} ${day} ${month} ${year}`,
    compact: `${day} ${month}`,
  };
}

export function EditorialRibbon() {
  const now = new Date();
  const week = isoWeek(now);
  const issueNum = String(week).padStart(3, "0");
  const { full: fullDate, compact: compactDate } = formatRibbonDate(now);

  return (
    <div className="editorial-ribbon" role="banner" aria-label="Publication info">
      <span className="editorial-ribbon-full">
        BESTDEAL
        <span className="ribbon-sep">&nbsp;&middot;&nbsp;</span>
        ISSUE&nbsp;&#x2116;{issueNum}
        <span className="ribbon-sep">&nbsp;&middot;&nbsp;</span>
        WEEK&nbsp;{week}&nbsp;/&nbsp;{now.getFullYear()}
        <span className="ribbon-sep">&nbsp;&middot;&nbsp;</span>
        {fullDate}
        <span className="ribbon-sep">&nbsp;&middot;&nbsp;</span>
        EUROPE
      </span>
      <span className="editorial-ribbon-compact">
        BESTDEAL
        <span className="ribbon-sep">&nbsp;&middot;&nbsp;</span>
        ISSUE&nbsp;&#x2116;{issueNum}
        <span className="ribbon-sep">&nbsp;&middot;&nbsp;</span>
        {compactDate}
      </span>
    </div>
  );
}
