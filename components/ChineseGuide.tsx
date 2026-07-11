import React, { type CSSProperties } from "react";

interface ChineseGuideProps {
  count: number;
  mode: "free" | "boxes";
}

export const GUIDE_SQUARE_VIEWBOX_SIZE = 300;
export const MIN_WRITABLE_SQUARE_PX = 280;

type GuideBoardStyle = CSSProperties & {
  "--character-count": number;
  "--minimum-square-size": string;
};

export function guideBoardStyle(count: number): GuideBoardStyle {
  const safeCount = Math.max(1, Math.floor(count));
  return {
    "--character-count": safeCount,
    "--minimum-square-size": `${MIN_WRITABLE_SQUARE_PX}px`,
    aspectRatio: `${safeCount} / 1`,
  };
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
  const size = GUIDE_SQUARE_VIEWBOX_SIZE;
  const safeCount = Math.max(1, Math.floor(count));
  if (mode === "boxes") {
    return (
      <svg
        className="guide-svg"
        viewBox={`0 0 ${size * safeCount} ${size}`}
        preserveAspectRatio="xMinYMin meet"
        data-guide-mode="boxes"
        aria-hidden="true"
      >
        {Array.from({ length: safeCount }, (_, index) => <Square key={index} x={index * size} size={size} />)}
      </svg>
    );
  }
  return (
    <svg
      className="guide-svg"
      viewBox={`0 0 ${size * safeCount} ${size}`}
      preserveAspectRatio="xMinYMin meet"
      data-guide-mode="free"
      aria-hidden="true"
    >
      <rect width={size * safeCount} height={size} fill="#fffefb" />
    </svg>
  );
}
