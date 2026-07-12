# Structural grading v2

## Current pipeline

The production app currently supports the fixed words `听写`, `老师`, and
`飞机场`. Pointer input is captured as ordered, timestamped pen movements in
`components/HandwritingApp.tsx`. Identity recognition is supplied by MyScript
or the local HanziLookup WASM adapter. The selected target never changes
recognizer ranking.

The local correctness gate lives in
`lib/handwriting/whole-shape-validator.ts`. It normalizes the completed ink,
aligns it to pinned Hanzi Writer median data, and checks component presence,
owned model-path support, long gaps, extra ink, and known confusables. The
older strict stroke matcher remains coaching-only.

The repository does **not** yet contain spelling-list photo upload, Gemini
transcription, a pinned full IDS dataset, or arbitrary-character template
generation. It now contains an IDS parser and primitive-analysis boundary, so
a pinned dataset can be connected without changing the grader. Photo-list
transcription belongs after the deterministic grader has a calibrated template
and evaluation boundary.

## Problem being corrected

The original validator mixed two different kinds of evidence:

- correctness evidence: required component/path presence, major extra ink,
  identity-defining features, and a genuinely better confusable match;
- handwriting-quality evidence: coarse 3×3 occupancy, broad raster overlap,
  centring, proportions, and small local displacement.

That allowed a readable character to fail while its component chips still
said every major part was present. V2 makes hard and advisory evidence
explicit. Coarse region overlap can produce a practice tip, but cannot by
itself contradict a passing component and primitive assessment.

## Decision contract

Identity and structure remain independent:

1. Recognition must contain the expected character within the selected rank.
2. Every required component must be present.
3. Every required/critical visible path must meet its length-aware support
   requirement.
4. No large contiguous unmatched student primitive may remain.
5. A competing character must be materially better—not merely within raster
   noise—to force a retry.

The resulting category is:

- `correct`: all hard gates pass and there are no material advisory issues;
- `correct_with_tip`: all hard gates pass, but placement, proportion, coarse
  occupancy, or other handwriting-quality advice remains;
- `retry`: recognition is plausible but a structural hard gate fails;
- `incorrect`: reserved for a strong different-character match or multiple
  missing critical features;
- `incomplete`: one or more expected character regions are blank.

The student-facing compact mode maps `correct` and `correct_with_tip` to green;
all other completed decisions are red.

## Reviewable character templates

`CharacterTemplate` is the replaceable boundary between character data and
the grader. Templates are versioned and carry source/confidence metadata,
layout, component definitions, critical features, confusion rules, and
per-character tolerance overrides.

The first templates are reviewed, bundled, and deterministic for the seven
production characters. They wrap the already pinned Hanzi Writer medians and
manual component groupings. Future generated templates will be cached by
`character + version + dataset revision`; a reviewed template always wins over
an automatically generated one.

The intended future loaders are:

1. pinned Hanzi Writer/Make Me a Hanzi median adapter;
2. pinned IDS adapter for coarse layout and component relationships;
3. deterministic template generator;
4. optional low-confidence Gemini fallback for wording or missing structural
   descriptions, never pass/fail geometry.

## Structural evidence

The first implementation keeps vector trajectories as the primary source.
Model paths receive exclusive local student support so nearby ink cannot fill
two missing shapes. Support records:

- model coverage;
- owned student length ratio;
- longest unsupported run;
- endpoint presence;
- component presence and relative placement;
- unmatched student length and longest unmatched run;
- target-versus-confusable score margin.

Pen movement count, stroke order, and exact drawing direction are advisory.
One-to-many and many-to-one input are accepted because matching operates on
sampled local centreline geometry rather than movement identity.

`primitive-analysis.ts` exposes horizontal, vertical, falling, dot, hook,
curve, and turn probabilities plus intersections. Reviewed model templates
cache these primitive labels. The current hard gate still uses the more mature
exclusive centreline-path support; primitive labels are inspectable template
evidence and the extension point for a future global component matcher.

## Feedback rules

The structural engine emits deterministic codes. The UI may translate these
codes into friendly text, but it must not invent a failure from a bitmap
overlay. Hard errors and practice tips are rendered separately. A component
cannot simultaneously be labelled `in place` and `missing`.

## Calibration

Labelled samples use the expected character, raw pen movements, teacher label,
and optional notes. The evaluation report must show category confusion,
full-credit precision, correct-writing recall, and results by character. The
first priority is preventing false full credit for missing critical structure;
the second is reducing false retries for messy but complete student writing.

Threshold changes must be made in the central grading configuration and
backed by fixtures. Manual Apple Pencil samples remain required before treating
new character templates as reviewed.

## Threshold tuning procedure

1. Add anonymised attempts with `acceptable`, `borderline`, or `unacceptable`
   teacher labels and a stable writer/device group.
2. Run the automated adversarial fixtures before changing any threshold.
3. Change one value in `structural-grading-config.ts` at a time.
4. Compare false-reject and false-accept rates with
   `summarizeStructuralCalibration`; borderline attempts are reviewed but are
   excluded from the hard error rates.
5. Prefer lowering advisory sensitivity before weakening a hard structural
   gate. A hard gate should only move when the rejected attempt has the required
   visible path/component, or the accepted attempt demonstrably lacks it.
6. Promote a template to `reviewed` only after natural Pencil and deliberately
   incomplete samples have both been checked.
