# 听写小助手

A Chinese handwriting spelling checker with two selectable recognition methods: a local `gugray/hanzi_lookup` WebAssembly ensemble, and the specialist MyScript recognition service through a server-side Next.js proxy.

Each target character is presented in its own Chinese writing square by default: two-character words use two squares and three-character words use three squares.

## Run locally

```bash
npm install
npm run dev
```

## Verify and export

```bash
npm test
npm run typecheck
npm run build
```

The production build is hosted on Vercel; GitHub remains the source repository.

## Recognition behaviour

Recognition is target-blind: the selected answer never changes candidate ranking. The app generates several conservative interpretations of the same raw strokes using timing and geometry, combines their ranked results, and checks whether each expected character appears within the selected acceptance threshold. The default threshold is top 15.

Timestamps help identify pauses and accidentally joined strokes. Pressure is retained in the captured data but is not used for grading because it varies across pen, touch, and mouse input.

## MyScript configuration

Copy `.env.example` to `.env.local` and set `MYSCRIPT_APPLICATION_KEY` and `MYSCRIPT_HMAC_KEY`. Keep both values server-side; neither key belongs in a `NEXT_PUBLIC_` variable.

## Deploy to Vercel

Import the GitHub repository into Vercel or run `vercel --prod` after completing the verification commands above. Configure both MyScript variables in the Vercel project for Preview and Production before deploying.

## Recognition licensing

The bundled `hanzi_lookup` JavaScript/WASM files are distributed under the GNU LGPL. Its embedded character data is derived from Make Me a Hanzi and Arphic fonts and is distributed under the Arphic Public License. Copies of both notices are included under `public/licenses/`, with upstream source at <https://github.com/gugray/hanzi_lookup>.
