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
  evidence?: RecognitionEvidence;
}

export type RecognitionVariantFamily = "baseline" | "pause" | "corner90" | "corner45" | "merge";

export interface RecognitionEvidence {
  fusedScore: number;
  baselineRank?: number;
  bestRawRank: number;
  familyRanks: Partial<Record<RecognitionVariantFamily, number>>;
  structuralSupport: RecognitionVariantFamily[];
}

export interface SegmentationResult {
  groups: Stroke[][];
  separators: number[];
  weak: boolean;
}

export interface HandwritingRecognizer {
  initialise(): Promise<void>;
  recognise(strokes: Stroke[], maxResults?: number): Promise<CharacterPrediction[]>;
  /** Cancel work that is no longer relevant while keeping the adapter reusable. */
  dispose?(): void;
}
