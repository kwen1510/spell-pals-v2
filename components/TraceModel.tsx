import React from "react";
import { getCharacterShapeReference } from "../lib/handwriting/character-shape-references";

interface TraceModelProps {
  characters: string;
}

const SQUARE_SIZE = 300;
const REFERENCE_SIZE = 1024;

function pointsAttribute(points: Array<{ x: number; y: number }>) {
  return points.map((point) => `${point.x},${point.y}`).join(" ");
}

/**
 * A display-only tracing model. It is a sibling of the drawing canvas, so
 * none of these reference paths can leak into handwriting recognition.
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
      {values.map((character, characterIndex) => {
        const paths = getCharacterShapeReference(character) ?? [];
        return (
          <g
            key={`${character}-${characterIndex}`}
            transform={`translate(${characterIndex * SQUARE_SIZE} 0) scale(${SQUARE_SIZE / REFERENCE_SIZE})`}
          >
            {paths.map((path, strokeIndex) => (
              <polyline
                key={strokeIndex}
                points={pointsAttribute(path)}
                data-stroke-number={strokeIndex + 1}
              />
            ))}
          </g>
        );
      })}
    </svg>
  );
}
