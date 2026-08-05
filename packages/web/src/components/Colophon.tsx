export function Colophon() {
  return (
    <footer className="colophon" role="contentinfo">
      <div className="colophon-inner">
        <p className="colophon-title">BestDeal</p>
        <p className="colophon-body">
          Every deal in Europe, in one place.
          <br />
          Updated every Monday and Thursday.
          <br />
          All prices subject to local availability.
        </p>
        <p className="colophon-legal">
          &copy;&nbsp;{new Date().getFullYear()} &nbsp;&middot;&nbsp; best-deal-shops.com &nbsp;&middot;&nbsp; <a href="/feed.xml" style={{ color: "inherit" }}>RSS</a>
        </p>
      </div>
    </footer>
  );
}
