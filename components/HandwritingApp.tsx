"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChineseGuide, guideBoardStyle } from "./ChineseGuide";
import { TraceModel } from "./TraceModel";
import {
  compactResultTone,
  DETAILED_FEEDBACK_STORAGE_KEY,
  parseDetailedFeedbackPreference,
  resultHeading,
  serializeDetailedFeedbackPreference,
  simpleResultMessage,
} from "./feedback-mode";
import { HanziLookupRecognizer } from "@/lib/handwriting/recognizer";
import { MyScriptRecognizer } from "@/lib/handwriting/myscript-recognizer";
import { gradeRankedCandidates, markingStatus, type MarkingStatus } from "@/lib/handwriting/grading";
import { shouldIgnoreTouchInput } from "@/lib/handwriting/input-policy";
import { characterShapeRegions } from "@/lib/handwriting/shape-regions";
import { assessCharacterShape } from "@/lib/handwriting/shape-validator";
import { assessWholeCharacterShape } from "@/lib/handwriting/whole-shape-validator";
import { cloneStrokes, scaleStrokes } from "@/lib/handwriting/stroke-utils";
import { segmentByBoxes, segmentByWhitespace } from "@/lib/handwriting/segmentation";
import type { CharacterPrediction, HandwritingRecognizer, Stroke, StrokePoint } from "@/lib/handwriting/types";

const WORDS = ["听写", "老师", "飞机场"] as const;
type Tool = "pen" | "eraser";
type GuideMode = "free" | "boxes";
type RecognitionMethod = "local" | "myscript";
type RecognizerState = "loading" | "ready" | "error";
type ResultStatus = MarkingStatus;
type ShapeAssessment = ReturnType<typeof assessWholeCharacterShape>;
type StrokeAssessment = ReturnType<typeof assessCharacterShape>;
type DiagnosticAttempt = ReturnType<typeof diagnosticAttempt>;

const RECOGNITION_METHODS: RecognitionMethod[] = ["local", "myscript"];
const RECOGNITION_LABELS: Record<RecognitionMethod, string> = {
  local: "Local WASM",
  myscript: "MyScript",
};

interface Result {
  expected: string;
  detected: string;
  detectedCharacters: string[];
  expectedRanks: Array<number | null>;
  threshold: number;
  recognitionPassed: boolean;
  shapeAssessments: ShapeAssessment[];
  strokeAssessments: StrokeAssessment[];
  regions: ReturnType<typeof characterShapeRegions>;
  separators: number[];
  markDimensions: { width: number; height: number };
  attempt: DiagnosticAttempt;
  predictions: CharacterPrediction[][];
  status: ResultStatus;
  weakSplit: boolean;
  method: RecognitionMethod;
}

function pointPair(point: unknown): [number, number] | null {
  if (Array.isArray(point) && point.length >= 2 && Number.isFinite(point[0]) && Number.isFinite(point[1])) {
    return [Number(point[0]), Number(point[1])];
  }
  if (point && typeof point === "object" && "x" in point && "y" in point) {
    const { x, y } = point as { x: unknown; y: unknown };
    if (typeof x === "number" && typeof y === "number" && Number.isFinite(x) && Number.isFinite(y)) return [x, y];
  }
  return null;
}

function polylinePoints(path: unknown) {
  if (!Array.isArray(path)) return "";
  return path.map(pointPair).filter((point): point is [number, number] => point !== null).map(([x, y]) => `${x},${y}`).join(" ");
}

function readableStrokeIssue(reason: string) {
  const normalized = reason.toLowerCase().replaceAll("_", " ").replaceAll("-", " ");
  const labels: Array<[RegExp, string]> = [
    [/reference|unsupported|missing data/, "Shape reference data is unavailable."],
    [/missing|too few/, "A stroke may be missing."],
    [/extra|too many|unmatched/, "There may be an extra stroke."],
    [/direction|reverse/, "A stroke was drawn in the wrong direction."],
    [/position|placement|misplac|displac|far/, "A model stroke is placed differently."],
    [/short|length|overlong/, "A stroke is too short, too long, or the wrong length."],
    [/curve|shape|frechet/, "A stroke has the wrong curve or shape."],
    [/invalid|input/, "The captured strokes could not be checked."],
  ];
  return labels.find(([pattern]) => pattern.test(normalized))?.[1] ?? reason;
}

function repairLabel(repair: StrokeAssessment["repairApplied"]) {
  if (!repair || repair === "none") return null;
  const value = String(repair).toLowerCase();
  if (value.includes("merge")) return "One accidental pen lift was repaired.";
  if (value.includes("split")) return "One accidentally joined stroke was repaired.";
  return `Capture repair used: ${String(repair)}.`;
}

function strokePracticeTips(assessment: StrokeAssessment | undefined, wholeShapePassed: boolean) {
  if (!assessment) return [];
  const tips: string[] = [];
  if (assessment.rawStrokeCount !== assessment.expectedStrokeCount) {
    tips.push(
      `You used ${assessment.rawStrokeCount} pen movement${assessment.rawStrokeCount === 1 ? "" : "s"}; `
      + `the model uses ${assessment.expectedStrokeCount} strokes. This does not fail a readable character.`,
    );
  }
  if (assessment.strokeOrderWarning) {
    tips.push("Your stroke order differs from the model. This is a practice tip only.");
  }
  if (assessment.rawStrokeCount === assessment.expectedStrokeCount && !assessment.passed) {
    const issue = assessment.failureReasons.map(readableStrokeIssue)[0];
    if (issue) {
      tips.push(`${issue} ${wholeShapePassed ? "The completed character still looks readable." : "Trace the model once to practise its standard form."}`);
    }
  }
  const repair = repairLabel(assessment.repairApplied);
  if (repair) tips.push(repair);
  return Array.from(new Set(tips));
}

function componentPositionLabel(position: ShapeAssessment["components"][number]["position"]) {
  if (position === "upper") return "top";
  if (position === "lower") return "bottom";
  if (position === "main") return "main outline";
  return position;
}

function ShapePreview({ assessment, expected }: { assessment: ShapeAssessment; expected: string }) {
  const studentPaths = assessment.studentPaths ?? [];
  const failedExpectedIndices = new Set(
    assessment.components
      .filter((component) => !component.passed)
      .flatMap((component) => component.expectedStrokeIndices),
  );
  const referencePaths = assessment.passed
    ? []
    : failedExpectedIndices.size
      ? assessment.referencePaths.filter((_, index) => failedExpectedIndices.has(index))
      : assessment.referencePaths;
  if (!studentPaths.length && !referencePaths.length) return null;

  const problemQuadrants = new Set(
    [
      ...assessment.issues.map((issue) => issue.quadrant),
      ...assessment.quadrants
        .filter((quadrant) => quadrant.major && quadrant.expectedCoverage < 0.55)
        .map((quadrant) => quadrant.region),
    ].filter((value): value is NonNullable<typeof value> => Boolean(value)),
  );
  const quadrantRects = {
    "top-left": { x: 0, y: 0 },
    "top-right": { x: 512, y: 0 },
    "bottom-left": { x: 0, y: 512 },
    "bottom-right": { x: 512, y: 512 },
  } as const;

  return (
    <figure className="shape-preview">
      <svg viewBox="0 0 1024 1024" role="img" aria-label={`Shape comparison for ${expected}`}>
        <g className="problem-quadrants">
          {Array.from(problemQuadrants).map((quadrant) => (
            <rect key={quadrant} {...quadrantRects[quadrant]} width="512" height="512" />
          ))}
        </g>
        <g className="preview-guides">
          <line x1="512" y1="0" x2="512" y2="1024" />
          <line x1="0" y1="512" x2="1024" y2="512" />
        </g>
        <g className="reference-shape">
          {referencePaths.map((path, index) => <polyline key={`reference-${index}`} points={polylinePoints(path)} />)}
        </g>
        <g className="student-shape">
          {studentPaths.map((path, index) => <polyline key={`student-${index}`} points={polylinePoints(path)} />)}
        </g>
      </svg>
      <figcaption>
        <span className="student-key">Your writing</span>
        {!assessment.passed && <span className="reference-key">Expected part</span>}
        {problemQuadrants.size > 0 && <span className="quadrant-key">Area to practise</span>}
      </figcaption>
    </figure>
  );
}

function diagnosticAttempt(strokes: Stroke[]) {
  const timestamps = strokes.flatMap((stroke) => stroke.points.map((point) => point.timestamp)).filter(Number.isFinite);
  const origin = timestamps.length ? Math.min(...timestamps) : 0;
  return strokes.map((stroke) => ({
    width: stroke.width,
    points: stroke.points.map((point) => ({
      x: point.x,
      y: point.y,
      timestamp: Math.max(0, point.timestamp - origin),
      ...(point.pressure === undefined ? {} : { pressure: point.pressure }),
    })),
  }));
}

const localRecognizer = new HanziLookupRecognizer();
const myScriptRecognizer = new MyScriptRecognizer();
const recognizers: Record<RecognitionMethod, HandwritingRecognizer> = {
  local: localRecognizer,
  myscript: myScriptRecognizer,
};
const initialisationPromises = new WeakMap<HandwritingRecognizer, Promise<void>>();

function initialiseRecognizer(recognizer: HandwritingRecognizer) {
  const existing = initialisationPromises.get(recognizer);
  if (existing) return existing;
  const initialisation = recognizer.initialise().catch((error) => {
    initialisationPromises.delete(recognizer);
    throw error;
  });
  initialisationPromises.set(recognizer, initialisation);
  return initialisation;
}

function Icon({ name }: { name: string }) {
  const paths: Record<string, React.ReactNode> = {
    pen: <><path d="M4 20l4.5-1 10-10-3.5-3.5-10 10L4 20z"/><path d="M13.5 6.5L17 10"/></>,
    eraser: <><path d="M7 17l-3-3 8.5-8.5a2 2 0 013 0l3 3a2 2 0 010 3L13 17H7z"/><path d="M10 17h10"/></>,
    undo: <><path d="M9 7L4 12l5 5"/><path d="M5 12h8a6 6 0 016 6"/></>,
    redo: <><path d="M15 7l5 5-5 5"/><path d="M19 12h-8a6 6 0 00-6 6"/></>,
    trash: <><path d="M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13"/></>,
    hand: <><path d="M7 12V7a1.5 1.5 0 013 0v4-6a1.5 1.5 0 013 0v6-5a1.5 1.5 0 013 0v6-3a1.5 1.5 0 013 0v5c0 4-2 7-6 7h-1c-2 0-3.5-1-5-3l-2-3a1.5 1.5 0 012.5-1.7L7 15"/></>,
    check: <path d="M5 12l4 4L19 6"/>,
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>;
}

export function HandwritingApp() {
  const [target, setTarget] = useState<string | null>(null);
  const [tool, setTool] = useState<Tool>("pen");
  const [guideMode, setGuideMode] = useState<GuideMode>("boxes");
  const [stylusOnly, setStylusOnly] = useState(false);
  const [brushSize, setBrushSize] = useState(7);
  const [acceptanceThreshold, setAcceptanceThreshold] = useState(1);
  const [recognitionMethod, setRecognitionMethod] = useState<RecognitionMethod>("myscript");
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [undoStack, setUndoStack] = useState<Stroke[][]>([]);
  const [redoStack, setRedoStack] = useState<Stroke[][]>([]);
  const [recognizerStates, setRecognizerStates] = useState<Record<RecognitionMethod, RecognizerState>>({ local: "loading", myscript: "loading" });
  const [recognizerErrors, setRecognizerErrors] = useState<Record<RecognitionMethod, string>>({ local: "", myscript: "" });
  const [recognizerEvidence, setRecognizerEvidence] = useState<Record<RecognitionMethod, CharacterPrediction[][] | null>>({ local: null, myscript: null });
  const [marking, setMarking] = useState(false);
  const [message, setMessage] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [detailedFeedback, setDetailedFeedback] = useState(true);
  const [feedbackPreferenceReady, setFeedbackPreferenceReady] = useState(false);
  const [traceTarget, setTraceTarget] = useState<string | null>(null);
  const [dimensions, setDimensions] = useState({ width: 600, height: 300 });
  const [debugSeparators, setDebugSeparators] = useState<number[]>([]);
  const diagnosticsEnabled = process.env.NODE_ENV === "development";

  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const messageRef = useRef<HTMLParagraphElement>(null);
  const traceInstructionRef = useRef<HTMLParagraphElement>(null);
  const resultCardRef = useRef<HTMLElement>(null);
  const resultHeadingRef = useRef<HTMLHeadingElement>(null);
  const strokesRef = useRef<Stroke[]>([]);
  const activeStrokeRef = useRef<Stroke | null>(null);
  const activePointerRef = useRef<number | null>(null);
  const activeToolRef = useRef<Tool | null>(null);
  const activeRectRef = useRef<DOMRect | null>(null);
  const gestureBeforeRef = useRef<Stroke[] | null>(null);
  const dimensionsRef = useRef({ width: 0, height: 0 });
  const lastPenEventAtRef = useRef(Number.NEGATIVE_INFINITY);
  const rafRef = useRef<number | null>(null);
  const requestVersionRef = useRef(0);

  const recognizerState = recognizerStates[recognitionMethod];
  const recognizerError = recognizerErrors[recognitionMethod];
  const recognitionLabel = RECOGNITION_LABELS[recognitionMethod];

  useEffect(() => { strokesRef.current = strokes; }, [strokes]);

  useEffect(() => {
    try {
      setDetailedFeedback(parseDetailedFeedbackPreference(window.localStorage.getItem(DETAILED_FEEDBACK_STORAGE_KEY)));
    } catch {
      // Storage can be unavailable in private browsing; keep the default.
    }
    setFeedbackPreferenceReady(true);
  }, []);

  useEffect(() => {
    if (!feedbackPreferenceReady) return;
    try {
      window.localStorage.setItem(
        DETAILED_FEEDBACK_STORAGE_KEY,
        serializeDetailedFeedbackPreference(detailedFeedback),
      );
    } catch {
      // The preference still works for this session when storage is unavailable.
    }
  }, [detailedFeedback, feedbackPreferenceReady]);

  useEffect(() => {
    if (!result) return;

    const frame = window.requestAnimationFrame(() => {
      const card = resultCardRef.current;
      const heading = resultHeadingRef.current;
      if (!card || !heading) return;

      const prefersReducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
      card.scrollIntoView({
        behavior: prefersReducedMotion ? "auto" : "smooth",
        block: "start",
      });

      try {
        heading.focus({ preventScroll: true });
      } catch {
        heading.focus();
      }
    });

    return () => window.cancelAnimationFrame(frame);
  }, [result]);

  useEffect(() => {
    if (!message) return;
    const frame = window.requestAnimationFrame(() => {
      messageRef.current?.scrollIntoView({
        behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
        block: "nearest",
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [message]);

  const commitStrokes = useCallback((next: Stroke[]) => {
    strokesRef.current = next;
    setStrokes(next);
  }, []);

  useEffect(() => {
    if (recognitionMethod !== "myscript") return;
    if (recognizerStates.myscript !== "error" || recognizerStates.local !== "ready") return;
    setRecognitionMethod("local");
    setMessage("MyScript is unavailable, so this attempt will use Local WASM.");
  }, [recognitionMethod, recognizerStates.local, recognizerStates.myscript]);

  useEffect(() => {
    let active = true;
    RECOGNITION_METHODS.forEach((method) => {
      initialiseRecognizer(recognizers[method]).then(() => {
        if (!active) return;
        setRecognizerStates((states) => ({ ...states, [method]: "ready" }));
        setRecognizerErrors((errors) => ({ ...errors, [method]: "" }));
      }).catch((error: Error) => {
        if (!active) return;
        setRecognizerStates((states) => ({ ...states, [method]: "error" }));
        setRecognizerErrors((errors) => ({ ...errors, [method]: error.message }));
      });
    });
    return () => { active = false; };
  }, []);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const ratio = window.devicePixelRatio || 1;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, dimensions.width, dimensions.height);
    context.lineCap = "round";
    context.lineJoin = "round";
    context.strokeStyle = "#163f35";

    const renderStroke = (stroke: Stroke) => {
      if (!stroke.points.length) return;
      context.lineWidth = stroke.width;
      context.beginPath();
      context.moveTo(stroke.points[0].x, stroke.points[0].y);
      if (stroke.points.length === 1) {
        context.lineTo(stroke.points[0].x + 0.01, stroke.points[0].y + 0.01);
      } else {
        for (let index = 1; index < stroke.points.length; index += 1) {
          const previous = stroke.points[index - 1];
          const current = stroke.points[index];
          const midX = (previous.x + current.x) / 2;
          const midY = (previous.y + current.y) / 2;
          context.quadraticCurveTo(previous.x, previous.y, midX, midY);
        }
        const last = stroke.points.at(-1)!;
        context.lineTo(last.x, last.y);
      }
      context.stroke();
    };

    strokesRef.current.forEach(renderStroke);
    if (activeStrokeRef.current) renderStroke(activeStrokeRef.current);

    if (process.env.NODE_ENV === "development" && debugSeparators.length) {
      context.save();
      context.strokeStyle = "#ef7d57";
      context.setLineDash([7, 7]);
      context.lineWidth = 2;
      debugSeparators.forEach((x) => {
        context.beginPath(); context.moveTo(x, 0); context.lineTo(x, dimensions.height); context.stroke();
      });
      context.restore();
    }
  }, [debugSeparators, dimensions]);

  const scheduleDraw = useCallback(() => {
    if (rafRef.current != null) return;
    rafRef.current = requestAnimationFrame(() => { rafRef.current = null; draw(); });
  }, [draw]);

  useEffect(() => { scheduleDraw(); }, [strokes, dimensions, scheduleDraw]);

  useEffect(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (!host || !canvas) return;
    const resize = () => {
      const rect = host.getBoundingClientRect();
      const ratio = window.devicePixelRatio || 1;
      const previous = dimensionsRef.current;
      if (previous.width > 0 && previous.height > 0 && (Math.abs(previous.width - rect.width) > 0.5 || Math.abs(previous.height - rect.height) > 0.5)) {
        const scaleX = rect.width / previous.width;
        const scaleY = rect.height / previous.height;
        if (strokesRef.current.length) commitStrokes(scaleStrokes(strokesRef.current, scaleX, scaleY));
        if (activeStrokeRef.current) activeStrokeRef.current = scaleStrokes([activeStrokeRef.current], scaleX, scaleY)[0];
      }
      canvas.width = Math.round(rect.width * ratio);
      canvas.height = Math.round(rect.height * ratio);
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      if (activePointerRef.current != null) activeRectRef.current = rect;
      dimensionsRef.current = { width: rect.width, height: rect.height };
      setDimensions({ width: rect.width, height: rect.height });
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();
    return () => observer.disconnect();
  }, [commitStrokes, target]);

  useEffect(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (!host || !canvas) return;
    const suppress = (event: Event) => event.preventDefault();
    const nonPassive: AddEventListenerOptions = { passive: false };
    host.addEventListener("selectstart", suppress);
    host.addEventListener("contextmenu", suppress);
    host.addEventListener("dragstart", suppress);
    canvas.addEventListener("touchstart", suppress, nonPassive);
    canvas.addEventListener("touchmove", suppress, nonPassive);
    canvas.addEventListener("gesturestart", suppress, nonPassive);
    return () => {
      host.removeEventListener("selectstart", suppress);
      host.removeEventListener("contextmenu", suppress);
      host.removeEventListener("dragstart", suppress);
      canvas.removeEventListener("touchstart", suppress);
      canvas.removeEventListener("touchmove", suppress);
      canvas.removeEventListener("gesturestart", suppress);
    };
  }, [target]);

  function cancelActiveInput(restoreBefore = false) {
    const canvas = canvasRef.current;
    const pointerId = activePointerRef.current;
    if (canvas && pointerId != null) {
      try { if (canvas.hasPointerCapture(pointerId)) canvas.releasePointerCapture(pointerId); } catch { /* Safari may already have released it. */ }
    }
    if (restoreBefore && gestureBeforeRef.current) commitStrokes(cloneStrokes(gestureBeforeRef.current));
    activePointerRef.current = null;
    activeStrokeRef.current = null;
    activeToolRef.current = null;
    activeRectRef.current = null;
    gestureBeforeRef.current = null;
  }

  function invalidateRecognition() {
    requestVersionRef.current += 1;
    RECOGNITION_METHODS.forEach((method) => recognizers[method].dispose?.());
    setMarking(false);
    setResult(null);
    setMessage("");
    setDebugSeparators([]);
    setRecognizerEvidence({ local: null, myscript: null });
  }

  function resetDrawing() {
    cancelActiveInput();
    invalidateRecognition();
    commitStrokes([]); setUndoStack([]); setRedoStack([]);
  }

  function selectWord(word: string) {
    setGuideMode("boxes");
    setTraceTarget(null);
    setTarget(word);
    resetDrawing();
  }

  function selectRecognitionMethod(method: RecognitionMethod) {
    if (method === recognitionMethod) return;
    cancelActiveInput(true);
    invalidateRecognition();
    setRecognitionMethod(method);
  }

  function selectGuideMode(mode: GuideMode) {
    if (mode === guideMode) return;
    cancelActiveInput(true);
    invalidateRecognition();
    if (mode === "free") setTraceTarget(null);
    setGuideMode(mode);
  }

  function tryAgain() {
    setTraceTarget(null);
    resetDrawing();
  }

  function startTracePractice() {
    if (!target) return;
    setGuideMode("boxes");
    resetDrawing();
    setTraceTarget(target);
    window.requestAnimationFrame(() => {
      hostRef.current?.scrollIntoView({
        behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
        block: "center",
      });
      traceInstructionRef.current?.focus({ preventScroll: true });
    });
  }

  function selectAcceptanceThreshold(threshold: number) {
    if (threshold === acceptanceThreshold) return;
    invalidateRecognition();
    setAcceptanceThreshold(threshold);
  }

  function undo() {
    if (!undoStack.length) return;
    cancelActiveInput(true);
    invalidateRecognition();
    const previous = undoStack.at(-1)!;
    setRedoStack((history) => [...history, cloneStrokes(strokesRef.current)]);
    setUndoStack((history) => history.slice(0, -1));
    commitStrokes(cloneStrokes(previous));
  }

  function redo() {
    if (!redoStack.length) return;
    cancelActiveInput(true);
    invalidateRecognition();
    const next = redoStack.at(-1)!;
    setUndoStack((history) => [...history, cloneStrokes(strokesRef.current)]);
    setRedoStack((history) => history.slice(0, -1));
    commitStrokes(cloneStrokes(next));
  }

  function pointFromPointer(event: PointerEvent | React.PointerEvent<HTMLCanvasElement>, rect: DOMRect): StrokePoint {
    return {
      x: Math.max(0, Math.min(rect.width, event.clientX - rect.left)),
      y: Math.max(0, Math.min(rect.height, event.clientY - rect.top)),
      timestamp: event.timeStamp || performance.now(),
      pressure: event.pressure || undefined,
    };
  }

  function eraseAt(point: StrokePoint) {
    const radius = Math.max(18, brushSize * 2.5);
    const remaining = strokesRef.current.filter((stroke) => !stroke.points.some((item) => Math.hypot(item.x - point.x, item.y - point.y) <= radius));
    if (remaining.length === strokesRef.current.length) return;
    strokesRef.current = remaining;
    scheduleDraw();
  }

  function suppressPointerDefaults(event: React.PointerEvent<HTMLCanvasElement>) {
    event.preventDefault();
    event.stopPropagation();
    window.getSelection()?.removeAllRanges();
  }

  function likelyPalm(event: React.PointerEvent<HTMLCanvasElement>) {
    return shouldIgnoreTouchInput(event, {
      stylusOnly,
      millisecondsSincePen: performance.now() - lastPenEventAtRef.current,
    });
  }

  function pointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
    suppressPointerDefaults(event);
    if (event.pointerType === "pen") lastPenEventAtRef.current = performance.now();
    if (activePointerRef.current != null || likelyPalm(event)) return;
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* Continue without capture on older Safari. */ }
    activePointerRef.current = event.pointerId;
    activeToolRef.current = tool;
    activeRectRef.current = event.currentTarget.getBoundingClientRect();
    gestureBeforeRef.current = cloneStrokes(strokesRef.current);
    invalidateRecognition();
    const point = pointFromPointer(event, activeRectRef.current);
    if (tool === "eraser") {
      eraseAt(point);
    } else {
      activeStrokeRef.current = { id: crypto.randomUUID(), width: brushSize, points: [point] };
      scheduleDraw();
    }
  }

  function pointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
    suppressPointerDefaults(event);
    if (event.pointerType === "pen") lastPenEventAtRef.current = performance.now();
    if (activePointerRef.current !== event.pointerId) return;
    const native = event.nativeEvent;
    const samples = typeof native.getCoalescedEvents === "function" ? native.getCoalescedEvents() : [native];
    const rect = activeRectRef.current ?? event.currentTarget.getBoundingClientRect();
    for (const sample of samples) {
      const point = pointFromPointer(sample, rect);
      if (activeToolRef.current === "eraser") eraseAt(point);
      else if (activeStrokeRef.current) {
        const last = activeStrokeRef.current.points.at(-1);
        if (!last || Math.hypot(last.x - point.x, last.y - point.y) >= 0.35) activeStrokeRef.current.points.push(point);
      }
    }
    scheduleDraw();
  }

  function finishPointer(event: React.PointerEvent<HTMLCanvasElement>) {
    suppressPointerDefaults(event);
    if (activePointerRef.current !== event.pointerId) return;
    const rect = activeRectRef.current ?? event.currentTarget.getBoundingClientRect();
    if (activeToolRef.current === "pen" && activeStrokeRef.current) {
      const finalPoint = pointFromPointer(event, rect);
      const last = activeStrokeRef.current.points.at(-1);
      if (!last || Math.hypot(last.x - finalPoint.x, last.y - finalPoint.y) >= 0.35) activeStrokeRef.current.points.push(finalPoint);
      const completed = activeStrokeRef.current;
      activeStrokeRef.current = null;
      const next = [...strokesRef.current, completed];
      setUndoStack((history) => [...history, cloneStrokes(gestureBeforeRef.current ?? strokesRef.current)]);
      setRedoStack([]);
      commitStrokes(next);
    } else if (activeToolRef.current === "eraser") {
      const before = gestureBeforeRef.current ?? [];
      const changed = before.length !== strokesRef.current.length;
      if (changed) {
        setUndoStack((history) => [...history, cloneStrokes(before)]);
        setRedoStack([]);
      }
      commitStrokes(cloneStrokes(strokesRef.current));
    }
    activePointerRef.current = null;
    activeToolRef.current = null;
    activeRectRef.current = null;
    gestureBeforeRef.current = null;
    try { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* capture may already be lost */ }
    scheduleDraw();
  }

  function cancelPointer(event: React.PointerEvent<HTMLCanvasElement>) {
    suppressPointerDefaults(event);
    if (activePointerRef.current !== event.pointerId) return;
    const before = gestureBeforeRef.current;
    cancelActiveInput(false);
    if (before) commitStrokes(cloneStrokes(before));
    scheduleDraw();
  }

  async function mark() {
    if (!target || marking) return;
    if (!strokesRef.current.length) { setMessage("请先写下答案。 Write your answer first."); return; }
    if (recognizerState !== "ready") {
      const detail = recognizerState === "error" && recognizerError ? `: ${recognizerError}` : " yet";
      setMessage(`${recognitionLabel} is not ready${detail}.`);
      return;
    }
    const method = recognitionMethod;
    const selectedRecognizer = recognizers[method];
    const version = ++requestVersionRef.current;
    setMarking(true); setMessage(""); setResult(null);
    setRecognizerEvidence((evidence) => ({ ...evidence, [method]: null }));
    const characters = Array.from(target);
    const hostRect = hostRef.current?.getBoundingClientRect();
    const currentWidth = hostRect?.width ?? dimensions.width;
    const currentHeight = hostRect?.height ?? dimensions.height;
    const markStrokes = cloneStrokes(strokesRef.current);
    const segmentation = guideMode === "boxes"
      ? segmentByBoxes(markStrokes, characters.length, currentWidth)
      : segmentByWhitespace(markStrokes, characters.length, currentWidth);
    const regions = characterShapeRegions(characters.length, guideMode, currentWidth, currentHeight, segmentation.separators);
    const attempt = diagnosticAttempt(markStrokes);
    setDebugSeparators(segmentation.separators);
    try {
      const predictions = await Promise.all(segmentation.groups.map((group) => selectedRecognizer.recognise(group, 15)));
      if (version !== requestVersionRef.current) return;
      setRecognizerEvidence((evidence) => ({ ...evidence, [method]: predictions }));
      const grade = gradeRankedCandidates(target, predictions, acceptanceThreshold);
      const shapeAssessments = segmentation.groups.map((group, index) => assessWholeCharacterShape(group, characters[index], regions[index]));
      const strokeAssessments = segmentation.groups.map((group, index) => assessCharacterShape(group, characters[index], regions[index]));
      const status: ResultStatus = markingStatus(grade.correct, shapeAssessments, characters.length);
      const detectedCharacters = grade.detectedCharacters;
      const detected = detectedCharacters.map((character) => character || "No match").join(" · ");
      setResult({
        expected: target,
        detected,
        detectedCharacters,
        expectedRanks: grade.expectedRanks,
        threshold: acceptanceThreshold,
        recognitionPassed: grade.correct,
        shapeAssessments,
        strokeAssessments,
        regions,
        separators: [...segmentation.separators],
        markDimensions: { width: currentWidth, height: currentHeight },
        attempt,
        predictions,
        status,
        weakSplit: segmentation.weak,
        method,
      });
    } catch (error) {
      if (version === requestVersionRef.current) {
        setMessage(`I couldn’t check this answer: ${error instanceof Error ? error.message : String(error)} Your writing is still here, so you can try marking it again.`);
      }
    } finally {
      if (version === requestVersionRef.current) setMarking(false);
    }
  }

  function downloadDiagnostics() {
    if (!diagnosticsEnabled || !target) return;
    const payload = {
      schemaVersion: 1,
      createdAt: new Date().toISOString(),
      target,
      recognitionMethod,
      guideMode,
      acceptanceThreshold,
      canvas: result?.markDimensions ?? dimensions,
      rawAttempt: result?.attempt ?? diagnosticAttempt(strokesRef.current),
      segmentation: result ? {
        separators: result.separators,
        weak: result.weakSplit,
        regions: result.regions,
      } : null,
      candidates: result?.predictions ?? recognizerEvidence[recognitionMethod],
      shapeAssessments: result?.shapeAssessments ?? null,
      strokeAssessments: result?.strokeAssessments ?? null,
      result: result ? {
        detectedCharacters: result.detectedCharacters,
        expectedRanks: result.expectedRanks,
        status: result.status,
      } : null,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `handwriting-diagnostics-${Date.now()}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  if (!target) {
    return (
      <main className="home-shell">
        <section className="welcome-card">
          <span className="brand-mark" aria-hidden="true">听</span>
          <p className="eyebrow">Chinese spelling practice</p>
          <h1>听写小助手</h1>
          <p className="welcome-copy">Choose a word, listen to your teacher, then write it clearly.</p>
          <div className="word-grid">
            {WORDS.map((word, index) => (
              <button key={word} className="word-card" onClick={() => selectWord(word)}>
                <span className="word-number">{String(index + 1).padStart(2, "0")}</span>
                <strong>{word}</strong>
                <small>{Array.from(word).length} characters</small>
              </button>
            ))}
          </div>
          <div className="engine-status-list" aria-label="Handwriting recognizer status">
            {RECOGNITION_METHODS.map((method) => (
              <p className={`engine-status ${recognizerStates[method]}`} key={method}>
                <strong>{RECOGNITION_LABELS[method]}</strong>
                {recognizerStates[method] === "loading" && " · Loading…"}
                {recognizerStates[method] === "ready" && (method === "local" ? " · Ready and private in this browser" : " · Ready")}
                {recognizerStates[method] === "error" && ` · Unavailable: ${recognizerErrors[method]}`}
              </p>
            ))}
          </div>
        </section>
      </main>
    );
  }

  const characterCount = Array.from(target).length;
  return (
    <main className="practice-shell">
      <header className="practice-header">
        <button className="back-button" onClick={() => { setTraceTarget(null); setTarget(null); resetDrawing(); }}>← Word list</button>
        <div><p className="eyebrow">Write this word</p><h1>{target}</h1></div>
        <span className={`ready-pill ${recognizerState}`} title={recognizerError || undefined}>{recognitionLabel} · {recognizerState === "ready" ? "Ready" : recognizerState}</span>
      </header>

      <section className="keyboard-card">
        <div className="toolbar" aria-label="Whiteboard tools">
          <div className="tool-group">
            <button className={`tool-button ${tool === "pen" ? "active" : ""}`} onClick={() => setTool("pen")} aria-label="Pen"><Icon name="pen"/><span>Pen</span></button>
            <button className={`tool-button ${tool === "eraser" ? "active" : ""}`} onClick={() => setTool("eraser")} aria-label="Eraser"><Icon name="eraser"/><span>Eraser</span></button>
            <button className={`tool-button ${!stylusOnly ? "active" : ""}`} onClick={() => setStylusOnly((value) => !value)} aria-label={stylusOnly ? "Pen only input" : "Finger and pen input"}><Icon name="hand"/><span>{stylusOnly ? "Pen only" : "Finger"}</span></button>
          </div>
          <label className="size-control"><span>Size</span><input type="range" min="2" max="14" value={brushSize} onChange={(event) => setBrushSize(Number(event.target.value))}/><strong>{brushSize}</strong></label>
          <label className="threshold-control">
            <span>Advanced: rank</span>
            <select value={acceptanceThreshold} onChange={(event) => selectAcceptanceThreshold(Number(event.target.value))} aria-label="Accepted candidate rank">
              {Array.from({ length: 5 }, (_, index) => <option value={index + 1} key={index + 1}>Top {index + 1}</option>)}
            </select>
          </label>
          <div className="recognition-control">
            <span>Recognition</span>
            <div className="recognition-toggle" role="group" aria-label="Recognition method">
              {RECOGNITION_METHODS.map((method) => (
                <button
                  className={recognitionMethod === method ? "active" : ""}
                  key={method}
                  type="button"
                  aria-pressed={recognitionMethod === method}
                  title={recognizerErrors[method] || `${RECOGNITION_LABELS[method]} is ${recognizerStates[method]}`}
                  onClick={() => selectRecognitionMethod(method)}
                >
                  {RECOGNITION_LABELS[method]}
                </button>
              ))}
            </div>
            <small className={recognizerState}>{recognizerState === "ready" ? "Ready" : recognizerState === "loading" ? "Loading…" : "Unavailable"}</small>
          </div>
          <div className="mode-toggle" aria-label="Writing guide mode">
            <button className={guideMode === "free" ? "active" : ""} onClick={() => selectGuideMode("free")}>Free canvas</button>
            <button className={guideMode === "boxes" ? "active" : ""} onClick={() => selectGuideMode("boxes")}>田字格</button>
          </div>
          <div className="feedback-control">
            <span id="feedback-control-label">Feedback</span>
            <button
              type="button"
              role="switch"
              aria-checked={detailedFeedback}
              aria-labelledby="feedback-control-label feedback-control-value"
              onClick={() => setDetailedFeedback((value) => !value)}
            >
              <span className="feedback-switch-track" aria-hidden="true"><span /></span>
              <strong id="feedback-control-value">{detailedFeedback ? "On" : "Off"}</strong>
            </button>
            <small>{detailedFeedback ? "Show guidance" : "Result only"}</small>
          </div>
          <div className="tool-group history-group">
            <button className="tool-button" onClick={undo} disabled={!undoStack.length} aria-label="Undo"><Icon name="undo"/><span>Undo</span></button>
            <button className="tool-button" onClick={redo} disabled={!redoStack.length} aria-label="Redo"><Icon name="redo"/><span>Redo</span></button>
            <button className="tool-button danger" onClick={resetDrawing} disabled={!strokes.length} aria-label="Clear all"><Icon name="trash"/><span>Clear</span></button>
          </div>
        </div>

        <div className="board-scroller">
          <div
            ref={hostRef}
            className={`canvas-host mode-${guideMode}`}
            data-character-count={characterCount}
            style={guideBoardStyle(characterCount)}
          >
            <ChineseGuide count={characterCount} mode={guideMode}/>
            {guideMode === "boxes" && traceTarget && <TraceModel characters={traceTarget}/>}
            <canvas
              ref={canvasRef}
              draggable={false}
              aria-label={traceTarget
                ? `Trace the pale model for ${target}. Use one square per Chinese character.`
                : `Write ${target} here. Use one region per Chinese character.`}
              onPointerDown={pointerDown}
              onPointerMove={pointerMove}
              onPointerUp={finishPointer}
              onPointerCancel={cancelPointer}
              onLostPointerCapture={cancelPointer}
            />
          </div>
          <div className="board-pan-strip" aria-hidden="true">Swipe here to move between squares ↔</div>
        </div>

        <div className="action-row">
          <p ref={traceInstructionRef} tabIndex={traceTarget ? -1 : undefined} aria-live="polite">
            {guideMode === "free" ? "Leave a clear vertical space between characters." : "Write one character inside each square."}
            {traceTarget && <strong className="trace-active-copy"> Trace the pale model, then check your practice.</strong>}
          </p>
          <div className="action-buttons">
            {traceTarget && <button className="hide-trace-button" type="button" onClick={() => setTraceTarget(null)}>Hide model</button>}
            <button className="mark-button" onClick={mark} disabled={marking || recognizerState !== "ready" || !strokes.length} aria-controls="mark-result"><Icon name="check"/>{marking ? "Marking…" : "Mark answer"}</button>
          </div>
        </div>
      </section>

      {message && <p ref={messageRef} id="mark-message" className="notice error" role="alert">{message}</p>}
      {result && (
        <section
          ref={resultCardRef}
          id="mark-result"
          className={`result-card ${result.status} ${detailedFeedback ? "detailed-result" : `compact-result binary-${compactResultTone(result.status)}`}`}
          aria-live="polite"
        >
          <div className="result-heading">
            <span>{result.status === "correct" ? "✓" : result.status === "incomplete" ? "…" : detailedFeedback && result.status === "shape" ? "!" : "×"}</span>
            <div>
              <p className="eyebrow">Your result</p>
              <h2 ref={resultHeadingRef} tabIndex={-1}>{resultHeading(result.status, detailedFeedback)}</h2>
            </div>
          </div>
          {!detailedFeedback && <p className="simple-result-message">{simpleResultMessage(result.status)}</p>}
          {detailedFeedback && <>
            <p className="checked-method">Checked with {RECOGNITION_LABELS[result.method]}</p>
            <p className="detected-copy">What you wrote looks like: <strong>{result.detected}</strong></p>
            <div className="character-comparison">
            {Array.from(result.expected).map((expected, index) => {
              const rank = result.expectedRanks[index];
              const recognitionMatched = rank !== null && rank <= result.threshold;
              const assessment = result.shapeAssessments[index];
              const strokeAssessment = result.strokeAssessments[index];
              const passed = recognitionMatched && assessment?.passed;
              const issues = Array.from(new Set((assessment?.issues ?? []).map((issue) => issue.message)));
              if (assessment && !assessment.passed && !assessment.blank && issues.length === 0) issues.push("A major part of the character does not match closely enough yet.");
              const practiceTips = strokePracticeTips(strokeAssessment, assessment?.passed ?? false);
              return (
                <article className={passed ? "match" : "mismatch"} key={index}>
                  <div className="character-facts">
                    <span>Expected</span><strong>{expected}</strong>
                    <span>Top guess</span><strong>{result.detectedCharacters[index] || "No match"}</strong>
                    <span>Expected rank</span><strong className="rank-value">{rank ?? "Not found"}</strong>
                    <span>Pen movements</span>
                    <strong className="count-value">
                      {assessment ? `${assessment.rawStrokeCount} used · model has ${assessment.expectedStrokeCount} strokes` : "Not checked"}
                    </strong>
                  </div>
                  <p className={`shape-status ${assessment?.passed ? "passed" : "failed"}`}>
                    {assessment?.blank ? "Not written" : assessment?.passed ? "Overall shape matches" : "Shape needs practice"}
                  </p>
                  {issues.length > 0 && <ul className="shape-issues">{issues.map((issue) => <li key={issue}>{issue}</li>)}</ul>}
                  {assessment && assessment.components.length > 0 && (
                    <div className="component-breakdown" aria-label={`Parts of ${expected}`}>
                      <p>Character parts</p>
                      <div>
                        {assessment.components.map((component) => (
                          <span className={component.passed ? "passed" : "failed"} key={component.id}>
                            <b>{component.label}</b> {componentPositionLabel(component.position)} · {component.passed ? "in place" : "practise this part"}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  {practiceTips.length > 0 && (
                    <div className="stroke-tips">
                      <p>Stroke practice tips</p>
                      <ul>{practiceTips.map((tip) => <li key={tip}>{tip}</li>)}</ul>
                    </div>
                  )}
                  {assessment && <ShapePreview assessment={assessment} expected={expected} />}
                </article>
              );
            })}
            </div>
            {result.recognitionPassed && result.expectedRanks.some((rank) => rank !== 1) && (
              <p className="rank-note">Recognition passed because every expected character appeared within the top {result.threshold} candidates. Shape checking was graded separately.</p>
            )}
            {result.detectedCharacters.some((character) => !character) && (
              <p className="spacing-warning">I couldn’t find a clear match for one or more characters. Your writing is still here—use the shape guidance above, then try again.</p>
            )}
            {result.weakSplit && guideMode === "free" && <p className="spacing-warning">Tip: leave a clearer space between each character next time.</p>}
          </>}
          <div className="result-actions">
            <button onClick={tryAgain}>Try again</button>
            {detailedFeedback && (result.status !== "correct" || result.strokeAssessments.some((assessment) => !assessment.passed)) && (
              <button className="trace-practice-button" onClick={startTracePractice}>Practise over the grid model</button>
            )}
            <button onClick={() => { setTraceTarget(null); setTarget(null); resetDrawing(); }}>Choose another word</button>
          </div>
        </section>
      )}

      {diagnosticsEnabled && target && detailedFeedback && (
        <details className="debug-panel">
          <summary>Developer diagnostics</summary>
          <p>Includes the raw stroke attempt, recognition candidates, segmentation, and shape assessment. It never includes service credentials.</p>
          <button type="button" className="diagnostics-download" onClick={downloadDiagnostics}>Download diagnostics JSON</button>
          <pre>{JSON.stringify({
            strokes: strokes.length,
            pointsPerStroke: strokes.map((stroke) => stroke.points.length),
            dimensions,
            separators: debugSeparators,
            mode: guideMode,
            acceptanceThreshold,
            recognitionMethod,
            recognizers: {
              local: { status: recognizerStates.local, evidence: recognizerEvidence.local },
              myscript: { status: recognizerStates.myscript, evidence: recognizerEvidence.myscript },
            },
            result: result ? {
              expected: result.expected,
              detectedCharacters: result.detectedCharacters,
              expectedRanks: result.expectedRanks,
              status: result.status,
              regions: result.regions,
              shapeAssessments: result.shapeAssessments,
              strokeAssessments: result.strokeAssessments,
            } : null,
          }, null, 2)}</pre>
        </details>
      )}
      <footer>Local WASM uses hanzi_lookup (LGPL). Whole-character geometry and optional stroke tips use Hanzi Writer-inspired methods. Character data is Make Me a Hanzi-derived (Arphic Public License). MyScript sends stroke data to the configured MyScript service when selected.</footer>
    </main>
  );
}
