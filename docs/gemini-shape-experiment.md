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

First baseline: `gemini-3.1-pro-preview`, temperature 0, structured JSON output.

| Controlled case | Expected | Gemini | Deterministic | Latency |
|---|---|---|---|---:|
| Official complete `听` median | pass | pass | pass | 20.3 s |
| Missing bottom line of `口` | fail | fail | fail | 17.2 s |
| Continuous one-movement `口` | pass | pass | pass | 13.4 s |
| Modest whole-character distortion | pass | pass | pass | 9.9 s |
| Substantial unrelated extra diagonal | fail | fail | fail | 22.8 s |

Agreement was 5/5 on this small synthetic feasibility set. This does not establish classroom accuracy. The next useful gate is a blinded set of natural Apple Pencil attempts and deliberate errors that were not used to write the prompt.

Flash-Lite was then tested using stable `gemini-3.1-flash-lite` with structured JSON, temperature `0`, and `thinking_level: "minimal"`. Gemini 3.1 does not support a literal zero thinking budget; `minimal` is its closest supported setting.

| Flash-Lite controlled case | Expected | Gemini | Latency |
|---|---|---|---:|
| Official complete `听` median | pass | pass | 1.8 s |
| Missing bottom line of `口` | fail | **pass** | 1.7 s |
| Continuous one-movement `口` | pass | **fail** | 1.9 s |
| Modest whole-character distortion | pass | pass | 1.6 s |
| Substantial unrelated extra diagonal | fail | fail | 2.1 s |

Flash-Lite agreement was 3/5. It was fast but failed both tests that distinguish visible shape from official pen-lift structure, so it is not suitable as the correctness gate.

The active comparison now uses `gemini-3-flash-preview` with the same structured schema, temperature `0`, and `thinking_level: "minimal"`.

| Gemini 3 Flash controlled case | Expected | Gemini | Latency |
|---|---|---|---:|
| Official complete `听` median | pass | pass | 2.8 s |
| Missing bottom line of `口` | fail | fail | 2.6 s |
| Continuous one-movement `口` | pass | pass | 2.7 s |
| Modest whole-character distortion | pass | pass | 2.4 s |
| Substantial unrelated extra diagonal | fail | fail | 3.4 s |

Gemini 3 Flash agreement was 6/6 after the rubric explicitly required every official visible path. The set now includes a malformed `老` whose lower `匕` was replaced by a broad U-shaped curve; it failed and returned concise Traditional Chinese feedback. The server also fails closed when any expected path check is missing or malformed.

## Current recommendation

Gemini 3 Flash is the active grader. Local WASM and MyScript are not loaded or called. The student interface shows the binary result and only the two short structured feedback fields; the component assessment remains server-side. Production remains protected by authentication, same-origin checks, request limits, payload limits, and the explicit environment flag.
