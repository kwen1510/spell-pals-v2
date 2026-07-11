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

Recognition alone cannot mark an answer correct. A second local, target-aware validator compares the completed ink shape with the expected character's official median paths. It keeps the fixed midpoint of the 田字格, checks bidirectional and local-direction shape coverage with only small translation/scale/rotation tolerance, and reports problems by quadrant, 3×3 grid area, and familiar component (for example `口` versus `斤` in `听`). It also rejects a result when the same ink is a better geometric match for a known look-alike such as `帅/师`, `杨/汤/场`, or `杬/机`.

The completed visible shape is graded independently of pen lifts. A student can therefore use fewer connected pen movements or more separate pen movements when the resulting character still looks right. Official stroke count, order, direction, and curve matching remain available as non-blocking practice tips. When a shape needs work, the result offers a display-only tracing model inside the square grid; that SVG guide is never captured or sent to either recognizer.

Timestamps help identify pauses and accidentally joined strokes. Pressure is retained in the captured data but is not used for grading because it varies across pen, touch, and mouse input.

## MyScript configuration

Copy `.env.example` to `.env.local` and set `MYSCRIPT_APPLICATION_KEY` and `MYSCRIPT_HMAC_KEY`. Keep both values server-side; neither key belongs in a `NEXT_PUBLIC_` variable.

## Deploy to Vercel

Import the GitHub repository into Vercel or run `vercel --prod` after completing the verification commands above. Configure both MyScript variables in the Vercel project for Preview and Production before deploying.

## Recognition and shape-data licensing

The bundled `hanzi_lookup` JavaScript/WASM files are distributed under the GNU LGPL. Shape validation adapts matcher and geometry techniques from Hanzi Writer under the MIT License. Character median data is derived from Make Me a Hanzi and Arphic fonts under the Arphic Public License. Copies of all notices are included under `public/licenses/`, with upstream sources at <https://github.com/gugray/hanzi_lookup> and <https://github.com/chanind/hanzi-writer>.
