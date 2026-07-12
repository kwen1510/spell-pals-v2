# Gemini 3.1 grounded shape experiment

## Question

Can a multimodal model decide whether a student included all visible parts of a Chinese character without requiring official pen-lift count, exact stroke order, or calligraphic placement?

## Input

Each request sends:

1. A 384×384 PNG containing only the student's normalized ink.
2. A 384×384 PNG containing the normalized official median skeleton.
3. The expected IDS layout and reviewed component tree.
4. Make Me a Hanzi-derived component-to-stroke assignments.
5. A target-independent primitive summary of the student's lines, curves, hooks, turns, and relative lengths.

The writing grid, toolbar, expected-answer card, and recognizer result are not rendered into the student image. The prompt explicitly says that the expected answer is context rather than proof.

## Policy

- Pen movements and dictionary stroke count do not determine correctness.
- A complete `口` can be drawn as one loop or multiple movements.
- Whole-character translation, overall scale, modest rotation, wobble, and small gaps are tolerated.
- Missing visible pieces, seriously shortened long lines, large required-connection gaps, and substantial unrelated extra lines fail.
- An ambiguous image must return `uncertain`.

## Initial local result (2026-07-13)

Model: `gemini-3.1-pro-preview`, temperature 0, structured JSON output.

| Controlled case | Expected | Gemini | Deterministic | Latency |
|---|---|---|---|---:|
| Official complete `听` median | pass | pass | pass | 20.3 s |
| Missing bottom line of `口` | fail | fail | fail | 17.2 s |
| Continuous one-movement `口` | pass | pass | pass | 13.4 s |
| Modest whole-character distortion | pass | pass | pass | 9.9 s |
| Substantial unrelated extra diagonal | fail | fail | fail | 22.8 s |

Agreement was 5/5 on this small synthetic feasibility set. This does not establish classroom accuracy. The next useful gate is a blinded set of natural Apple Pencil attempts and deliberate errors that were not used to write the prompt.

## Current recommendation

Keep deterministic visible-piece matching as the instant primary gate. Gemini 3.1 Pro is currently too slow and costly for per-character primary grading, but it is promising as:

- a second opinion for deterministic `uncertain` cases;
- a teacher-only diagnostic experiment;
- an offline calibration tool for improving component rules.

The route is development-only by default. It must not be enabled in production without an explicit environment flag, rate limits, cost review, privacy notice, and a natural-handwriting accuracy gate.
