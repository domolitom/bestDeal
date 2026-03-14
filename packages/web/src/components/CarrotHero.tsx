export function CarrotHero() {
  return (
    <svg
      viewBox="0 0 120 140"
      width="120"
      height="140"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      style={{ display: "block", margin: "0 auto 1rem" }}
    >
      {/* Leaves */}
      <path d="M52 35c-8-16-24-28-24-28s10 18 18 26" fill="#4CAF50" />
      <path d="M60 30c0-20-6-30-6-30s-5 16-1 28" fill="#66BB6A" />
      <path d="M68 35c8-16 24-28 24-28s-10 18-18 26" fill="#4CAF50" />
      <path d="M55 33c-4-14-16-24-16-24s6 14 12 22" fill="#81C784" />
      <path d="M65 33c4-14 16-24 16-24s-6 14-12 22" fill="#81C784" />
      {/* Carrot body */}
      <path
        d="M42 38c0 0-5 24 3 52s15 42 15 42 9-14 15-42 3-52 3-52c0 0-12-6-18-6s-18 6-18 6z"
        fill="#FF9800"
      />
      {/* Carrot highlight */}
      <path
        d="M50 40c0 0-3 20 2 40s8 30 8 30"
        fill="none"
        stroke="#FFB74D"
        strokeWidth="3"
        strokeLinecap="round"
        opacity="0.6"
      />
      {/* Carrot lines */}
      <line x1="50" y1="58" x2="70" y2="58" stroke="#F57C00" strokeWidth="2" strokeLinecap="round" />
      <line x1="48" y1="72" x2="68" y2="72" stroke="#F57C00" strokeWidth="2" strokeLinecap="round" />
      <line x1="50" y1="86" x2="66" y2="86" stroke="#F57C00" strokeWidth="2" strokeLinecap="round" />
      <line x1="53" y1="100" x2="63" y2="100" stroke="#F57C00" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
