export interface StrokePoint {
  x: number;
  y: number;
  timestamp: number;
  pressure?: number;
}

export interface Stroke {
  id: string;
  points: StrokePoint[];
  width: number;
}

export interface CharacterPrediction {
  character: string;
  score?: number;
  rank: number;
}

export interface SegmentationResult {
  groups: Stroke[][];
  separators: number[];
  weak: boolean;
}

export interface HandwritingRecognizer {
  initialise(): Promise<void>;
  recognise(strokes: Stroke[], maxResults?: number): Promise<CharacterPrediction[]>;
  dispose?(): void;
}
