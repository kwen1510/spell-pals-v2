import React from "react";

interface TraceModelProps {
  characters: string;
}

const SQUARE_SIZE = 300;

/**
 * A display-only glyph model. It sits below the drawing canvas, so the glyph
 * is never captured or sent to recognition and disappears when practice ends.
 */
export function TraceModel({ characters }: TraceModelProps) {
  const values = Array.from(characters);
  return (
    <svg
      className="trace-model-svg"
      viewBox={`0 0 ${SQUARE_SIZE * values.length} ${SQUARE_SIZE}`}
      preserveAspectRatio="xMinYMin meet"
      aria-hidden="true"
    >
      {values.map((character, characterIndex) => (
        <text
          key={`${character}-${characterIndex}`}
          x={characterIndex * SQUARE_SIZE + SQUARE_SIZE / 2}
          y={SQUARE_SIZE / 2}
          dominantBaseline="central"
          textAnchor="middle"
        >
          {character}
        </text>
      ))}
    </svg>
  );
}
