import type { Stroke } from "./types";

export type RecognizerStrokeInput = number[][][];

export function convertStrokesForRecognizer(strokes: Stroke[]): RecognizerStrokeInput {
  const usable = strokes.filter((stroke) => stroke.points.length > 0);
  if (!usable.length) return [];

  const points = usable.flatMap((stroke) => stroke.points);
  const minX = Math.min(...points.map((point) => point.x));
  const maxX = Math.max(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxY = Math.max(...points.map((point) => point.y));
  const span = Math.max(maxX - minX, maxY - minY, 1);
  const offsetX = (256 - ((maxX - minX) / span) * 220) / 2;
  const offsetY = (256 - ((maxY - minY) / span) * 220) / 2;

  return usable.map((stroke) => {
    const converted = stroke.points.map((point) => [
      offsetX + ((point.x - minX) / span) * 220,
      offsetY + ((point.y - minY) / span) * 220,
    ]);
    // hanzi_lookup's pivot analysis assumes at least two distinct points.
    // A stylus tap is still a valid captured stroke, so give it a tiny tail.
    if (converted.length === 1) {
      converted.push([
        Math.min(255, converted[0][0] + 0.75),
        Math.min(255, converted[0][1] + 0.75),
      ]);
    } else if (converted.every((point) => point[0] === converted[0][0] && point[1] === converted[0][1])) {
      converted[converted.length - 1] = [
        Math.min(255, converted[0][0] + 0.75),
        Math.min(255, converted[0][1] + 0.75),
      ];
    }
    return converted;
  });
}
