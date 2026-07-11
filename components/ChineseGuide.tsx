interface ChineseGuideProps {
  count: number;
  mode: "free" | "boxes";
}

function Square({ x, size }: { x: number; size: number }) {
  return (
    <g transform={`translate(${x} 0)`}>
      <rect x="2" y="2" width={size - 4} height={size - 4} fill="#fffefb" stroke="#159f82" strokeWidth="4" />
      <line x1={size / 2} y1="2" x2={size / 2} y2={size - 2} stroke="#a9eadb" strokeWidth="2" strokeDasharray="10 10" />
      <line x1="2" y1={size / 2} x2={size - 2} y2={size / 2} stroke="#a9eadb" strokeWidth="2" strokeDasharray="10 10" />
    </g>
  );
}

export function ChineseGuide({ count, mode }: ChineseGuideProps) {
  const size = 300;
  if (mode === "boxes") {
    return (
      <svg className="guide-svg" viewBox={`0 0 ${size * count} ${size}`} preserveAspectRatio="none" aria-hidden="true">
        {Array.from({ length: count }, (_, index) => <Square key={index} x={index * size} size={size} />)}
      </svg>
    );
  }
  return (
    <svg className="guide-svg" viewBox={`0 0 ${size * count} ${size}`} preserveAspectRatio="none" aria-hidden="true">
      <rect x="2" y="2" width={size * count - 4} height={size - 4} fill="#fffefb" stroke="#159f82" strokeWidth="4" />
      <line x1={size * count / 2} y1="2" x2={size * count / 2} y2={size - 2} stroke="#a9eadb" strokeWidth="2" strokeDasharray="10 10" />
      <line x1="2" y1={size / 2} x2={size * count - 2} y2={size / 2} stroke="#a9eadb" strokeWidth="2" strokeDasharray="10 10" />
    </svg>
  );
}
