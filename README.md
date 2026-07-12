# 听写小助手

A Chinese handwriting spelling checker with two selectable recognition methods: the specialist MyScript recognition service through a server-side Next.js proxy (the default when configured), and a local `gugray/hanzi_lookup` WebAssembly ensemble as an offline fallback.

Each target character is presented in its own square 田字格 by default: two-character words use two squares and three-character words use three squares. On narrow screens the board scrolls horizontally instead of flattening the squares.

## Run locally

```bash
npm install
npm run dev
```

## Verify and build

```bash
npm test
npm run typecheck
npm run build
```

The production build is hosted on Vercel; GitHub remains the source repository.

## Recognition behaviour

Recognition is target-blind: the selected answer never changes candidate ranking. The app generates several conservative interpretations of the same raw strokes using timing and geometry, then combines their ranked results. The advanced recognition threshold defaults to top 1 and is capped at top 5.

Recognition alone cannot mark an answer correct. A second local, target-aware validator compares the completed visible ink with the expected character's official median paths. For correctness, the student and reference shapes are independently centred and uniformly scaled. This removes whole-character size and placement while preserving aspect ratio, internal gaps, component proportions, and relative line lengths. The validator then checks bidirectional coverage, local line direction, every visible model path, familiar components (for example `口` versus `斤` in `听`), conspicuous extra ink, and known look-alikes such as `帅/师`, `扬/汤/场`, or `杌/机`.

The pass rule is deterministic: the expected character must pass the selected recognition rank (top 1 by default) **and** every character must pass the normalized visible-shape check. A missing major part, collapsed component, greatly separated component, shortened major line, confusable character, or large stray mark fails even if MyScript guessed the target. Moderate size, centring, spacing, and proportion differences are feedback rather than automatic failures.

The completed visible shape is graded independently of pen lifts. A student can therefore use fewer connected pen movements or more separate pen movements when the resulting character still looks right. Small capture gaps are tolerated, but a large gap where a major part should continue is not. Official stroke count, order, direction, and curve matching remain available as non-blocking practice tips. When a shape needs work, the result offers a display-only tracing model inside the square grid; that SVG guide is never captured or sent to either recognizer.

The toolbar's Feedback switch is on by default and is remembered on the device. With feedback on, the app shows recognition evidence and local shape guidance. With feedback off, it keeps the same grading rule but presents only a green `Correct` result or a red retry result.

Timestamps help identify pauses and accidentally joined strokes. Pressure is retained in the captured data but is not used for grading because it varies across pen, touch, and mouse input.

## MyScript configuration

Copy `.env.example` to `.env.local` and set `MYSCRIPT_APPLICATION_KEY` and `MYSCRIPT_HMAC_KEY`. Keep both values server-side; neither key belongs in a `NEXT_PUBLIC_` variable.

## Experimental Gemini shape assessor

The development-only `/api/gemini-shape` route compares normalized student ink with the grounded Make Me a Hanzi component template using `gemini-3.1-pro-preview`. Configure `GEMINI_API_KEY` locally and run `npm run experiment:gemini-shape` for the synthetic calibration set. The experiment is disabled in production unless `GEMINI_SHAPE_EXPERIMENT_ENABLED=true` is explicitly configured. Gemini output does not override the deterministic grader.

## Deploy to Vercel

Import the GitHub repository into Vercel or run `vercel --prod` after completing the verification commands above. Configure both MyScript variables in the Vercel project for Preview and Production before deploying.

## Recognition and shape-data licensing

The bundled `hanzi_lookup` JavaScript/WASM files are distributed under the GNU LGPL. Shape validation adapts matcher and geometry techniques from Hanzi Writer under the MIT License. Character median data is derived from Make Me a Hanzi and Arphic fonts under the Arphic Public License. Copies of all notices are included under `public/licenses/`, with upstream sources at <https://github.com/gugray/hanzi_lookup> and <https://github.com/chanind/hanzi-writer>.
