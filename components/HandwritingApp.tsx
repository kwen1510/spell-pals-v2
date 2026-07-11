"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChineseGuide } from "./ChineseGuide";
import { HanziLookupRecognizer } from "@/lib/handwriting/recognizer";
import { gradeRankedCandidates } from "@/lib/handwriting/grading";
import { cloneStrokes } from "@/lib/handwriting/stroke-utils";
import { segmentByBoxes, segmentByWhitespace } from "@/lib/handwriting/segmentation";
import type { Stroke, StrokePoint } from "@/lib/handwriting/types";

const WORDS = ["听写", "老师", "飞机场"] as const;
type Tool = "pen" | "eraser";
type GuideMode = "free" | "boxes";

interface Result {
  expected: string;
  detected: string;
  detectedCharacters: string[];
  expectedRanks: Array<number | null>;
  threshold: number;
  correct: boolean;
  weakSplit: boolean;
}

const recognizer = new HanziLookupRecognizer();

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
  const [acceptanceThreshold, setAcceptanceThreshold] = useState(5);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [undoStack, setUndoStack] = useState<Stroke[][]>([]);
  const [redoStack, setRedoStack] = useState<Stroke[][]>([]);
  const [recognizerState, setRecognizerState] = useState<"loading" | "ready" | "error">("loading");
  const [recognizerError, setRecognizerError] = useState("");
  const [marking, setMarking] = useState(false);
  const [message, setMessage] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [dimensions, setDimensions] = useState({ width: 600, height: 300 });
  const [debugSeparators, setDebugSeparators] = useState<number[]>([]);

  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const strokesRef = useRef<Stroke[]>([]);
  const activeStrokeRef = useRef<Stroke | null>(null);
  const activePointerRef = useRef<number | null>(null);
  const eraserSnapshotRef = useRef<Stroke[] | null>(null);
  const rafRef = useRef<number | null>(null);
  const requestVersionRef = useRef(0);

  useEffect(() => { strokesRef.current = strokes; }, [strokes]);

  useEffect(() => {
    let active = true;
    recognizer.initialise().then(() => active && setRecognizerState("ready")).catch((error: Error) => {
      if (!active) return;
      setRecognizerState("error");
      setRecognizerError(error.message);
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
      canvas.width = Math.round(rect.width * ratio);
      canvas.height = Math.round(rect.height * ratio);
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      setDimensions({ width: rect.width, height: rect.height });
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();
    return () => observer.disconnect();
  }, [target]);

  function resetDrawing() {
    requestVersionRef.current += 1;
    setStrokes([]); setUndoStack([]); setRedoStack([]); setResult(null); setMessage(""); setDebugSeparators([]);
  }

  function selectWord(word: string) {
    setGuideMode("boxes");
    setTarget(word);
    resetDrawing();
  }

  function snapshot() {
    setUndoStack((history) => [...history, cloneStrokes(strokesRef.current)]);
    setRedoStack([]);
  }

  function undo() {
    if (!undoStack.length) return;
    const previous = undoStack.at(-1)!;
    setRedoStack((history) => [...history, cloneStrokes(strokesRef.current)]);
    setUndoStack((history) => history.slice(0, -1));
    setStrokes(cloneStrokes(previous)); setResult(null); setDebugSeparators([]);
  }

  function redo() {
    if (!redoStack.length) return;
    const next = redoStack.at(-1)!;
    setUndoStack((history) => [...history, cloneStrokes(strokesRef.current)]);
    setRedoStack((history) => history.slice(0, -1));
    setStrokes(cloneStrokes(next)); setResult(null); setDebugSeparators([]);
  }

  function pointFromEvent(event: React.PointerEvent<HTMLCanvasElement>): StrokePoint {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
      timestamp: performance.now(),
      pressure: event.pressure || undefined,
    };
  }

  function eraseAt(point: StrokePoint) {
    const radius = Math.max(18, brushSize * 2.5);
    const remaining = strokesRef.current.filter((stroke) => !stroke.points.some((item) => Math.hypot(item.x - point.x, item.y - point.y) <= radius));
    if (remaining.length === strokesRef.current.length) return;
    if (!eraserSnapshotRef.current) {
      eraserSnapshotRef.current = cloneStrokes(strokesRef.current);
      setUndoStack((history) => [...history, eraserSnapshotRef.current!]);
      setRedoStack([]);
    }
    strokesRef.current = remaining;
    setStrokes(remaining);
  }

  function pointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
    if (activePointerRef.current != null || (stylusOnly && event.pointerType !== "pen")) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    activePointerRef.current = event.pointerId;
    setResult(null); setMessage(""); setDebugSeparators([]);
    const point = pointFromEvent(event);
    if (tool === "eraser") {
      eraserSnapshotRef.current = null;
      eraseAt(point);
    } else {
      snapshot();
      activeStrokeRef.current = { id: crypto.randomUUID(), width: brushSize, points: [point] };
      scheduleDraw();
    }
  }

  function pointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
    if (activePointerRef.current !== event.pointerId) return;
    event.preventDefault();
    const native = event.nativeEvent;
    const samples = typeof native.getCoalescedEvents === "function" ? native.getCoalescedEvents() : [native];
    for (const sample of samples) {
      const rect = event.currentTarget.getBoundingClientRect();
      const point = { x: sample.clientX - rect.left, y: sample.clientY - rect.top, timestamp: performance.now(), pressure: sample.pressure || undefined };
      if (tool === "eraser") eraseAt(point);
      else if (activeStrokeRef.current) {
        const last = activeStrokeRef.current.points.at(-1);
        if (!last || Math.hypot(last.x - point.x, last.y - point.y) >= 0.35) activeStrokeRef.current.points.push(point);
      }
    }
    scheduleDraw();
  }

  function finishPointer(event: React.PointerEvent<HTMLCanvasElement>) {
    if (activePointerRef.current !== event.pointerId) return;
    event.preventDefault();
    if (tool === "pen" && activeStrokeRef.current) {
      const completed = activeStrokeRef.current;
      activeStrokeRef.current = null;
      const next = [...strokesRef.current, completed];
      strokesRef.current = next;
      setStrokes(next);
    }
    activePointerRef.current = null;
    eraserSnapshotRef.current = null;
    try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* capture may already be lost */ }
    scheduleDraw();
  }

  async function mark() {
    if (!target || marking) return;
    if (!strokesRef.current.length) { setMessage("请先写下答案。 Write your answer first."); return; }
    if (recognizerState !== "ready") { setMessage("The handwriting recogniser is not ready yet."); return; }
    const version = ++requestVersionRef.current;
    setMarking(true); setMessage(""); setResult(null);
    const characters = Array.from(target);
    const segmentation = guideMode === "boxes"
      ? segmentByBoxes(strokesRef.current, characters.length, dimensions.width)
      : segmentByWhitespace(strokesRef.current, characters.length, dimensions.width);
    setDebugSeparators(segmentation.separators);
    try {
      const predictions = await Promise.all(segmentation.groups.map((group) => recognizer.recognise(group, 15)));
      if (version !== requestVersionRef.current) return;
      const grade = gradeRankedCandidates(target, predictions, acceptanceThreshold);
      const detectedCharacters = grade.detectedCharacters;
      const detected = detectedCharacters.join("");
      setResult({
        expected: target,
        detected,
        detectedCharacters,
        expectedRanks: grade.expectedRanks,
        threshold: acceptanceThreshold,
        correct: grade.correct,
        weakSplit: segmentation.weak,
      });
    } catch (error) {
      if (version === requestVersionRef.current) setMessage(`Recognition failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      if (version === requestVersionRef.current) setMarking(false);
    }
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
          <p className={`engine-status ${recognizerState}`}>
            {recognizerState === "loading" && "Loading handwriting recogniser…"}
            {recognizerState === "ready" && "Handwriting recogniser ready · Works privately in this browser"}
            {recognizerState === "error" && `Recognizer unavailable: ${recognizerError}`}
          </p>
        </section>
      </main>
    );
  }

  const characterCount = Array.from(target).length;
  return (
    <main className="practice-shell">
      <header className="practice-header">
        <button className="back-button" onClick={() => { setTarget(null); resetDrawing(); }}>← Word list</button>
        <div><p className="eyebrow">Write this word</p><h1>{target}</h1></div>
        <span className={`ready-pill ${recognizerState}`}>{recognizerState === "ready" ? "Ready" : recognizerState}</span>
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
            <span>Accept top</span>
            <select value={acceptanceThreshold} onChange={(event) => setAcceptanceThreshold(Number(event.target.value))} aria-label="Accepted candidate rank">
              {Array.from({ length: 15 }, (_, index) => <option value={index + 1} key={index + 1}>{index + 1}</option>)}
            </select>
          </label>
          <div className="mode-toggle" aria-label="Writing guide mode">
            <button className={guideMode === "free" ? "active" : ""} onClick={() => setGuideMode("free")}>Free canvas</button>
            <button className={guideMode === "boxes" ? "active" : ""} onClick={() => setGuideMode("boxes")}>田字格</button>
          </div>
          <div className="tool-group history-group">
            <button className="tool-button" onClick={undo} disabled={!undoStack.length} aria-label="Undo"><Icon name="undo"/><span>Undo</span></button>
            <button className="tool-button" onClick={redo} disabled={!redoStack.length} aria-label="Redo"><Icon name="redo"/><span>Redo</span></button>
            <button className="tool-button danger" onClick={resetDrawing} disabled={!strokes.length} aria-label="Clear all"><Icon name="trash"/><span>Clear</span></button>
          </div>
        </div>

        <div className="board-scroller">
          <div ref={hostRef} className={`canvas-host mode-${guideMode}`} style={{ "--character-count": characterCount } as React.CSSProperties}>
            <ChineseGuide count={characterCount} mode={guideMode}/>
            <canvas
              ref={canvasRef}
              aria-label={`Write ${target} here. Use one region per Chinese character.`}
              onPointerDown={pointerDown}
              onPointerMove={pointerMove}
              onPointerUp={finishPointer}
              onPointerCancel={finishPointer}
              onLostPointerCapture={finishPointer}
            />
          </div>
        </div>

        <div className="action-row">
          <p>{guideMode === "free" ? "Leave a clear vertical space between characters." : "Write one character inside each square."}</p>
          <button className="mark-button" onClick={mark} disabled={marking || recognizerState !== "ready" || !strokes.length}><Icon name="check"/>{marking ? "Marking…" : "Mark answer"}</button>
        </div>
      </section>

      {message && <p className="notice error" role="alert">{message}</p>}
      {result && (
        <section className={`result-card ${result.correct ? "correct" : "incorrect"}`} aria-live="polite">
          <div className="result-heading"><span>{result.correct ? "✓" : "×"}</span><div><p className="eyebrow">Your result</p><h2>{result.correct ? "Correct!" : "Not quite"}</h2></div></div>
          <p className="detected-copy">What you wrote looks like: <strong>{result.detected}</strong></p>
          <div className="character-comparison">
            {Array.from(result.expected).map((expected, index) => (
              <div className={result.expectedRanks[index] !== null && result.expectedRanks[index]! <= result.threshold ? "match" : "mismatch"} key={index}>
                <span>Expected</span><strong>{expected}</strong><span>Top guess</span><strong>{result.detectedCharacters[index] ?? "?"}</strong>
                <span>Expected rank</span><strong className="rank-value">{result.expectedRanks[index] ?? "Not found"}</strong>
              </div>
            ))}
          </div>
          {result.correct && result.expectedRanks.some((rank) => rank !== 1) && (
            <p className="rank-note">Accepted because every expected character appeared within the top {result.threshold} candidates.</p>
          )}
          {result.weakSplit && guideMode === "free" && <p className="spacing-warning">Tip: leave a clearer space between each character next time.</p>}
          <div className="result-actions"><button onClick={resetDrawing}>Try again</button><button onClick={() => { setTarget(null); resetDrawing(); }}>Choose another word</button></div>
        </section>
      )}

      {process.env.NODE_ENV === "development" && target && (
        <details className="debug-panel"><summary>Developer diagnostics</summary><pre>{JSON.stringify({ strokes: strokes.length, pointsPerStroke: strokes.map((stroke) => stroke.points.length), dimensions, separators: debugSeparators, mode: guideMode }, null, 2)}</pre></details>
      )}
      <footer>Recognition powered locally by hanzi_lookup (LGPL) and Make Me a Hanzi-derived data (Arphic Public License). No handwriting leaves this device.</footer>
    </main>
  );
}
