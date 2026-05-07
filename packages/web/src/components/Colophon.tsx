export function Colophon() {
  return (
    <footer className="colophon" role="contentinfo">
      <div className="colophon-inner">
        <div className="colophon-asterism" aria-hidden="true">&#8258;</div>
        <p className="colophon-title">BestDeal &nbsp;&middot;&nbsp; A Continental Catalog Review</p>
        <p className="colophon-body">
          Typeset in Fraunces, Instrument Sans, and JetBrains Mono.
          <br />
          Compiled weekly. Filed each Monday and Thursday.
          <br />
          All prices subject to local availability.
        </p>
        <p className="colophon-legal">
          &copy;&nbsp;{new Date().getFullYear()} &nbsp;&middot;&nbsp; best-deal-shops.com &nbsp;&middot;&nbsp; RSS
        </p>
      </div>
    </footer>
  );
}
