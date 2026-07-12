# 听写小助手

A Chinese handwriting spelling checker graded by Gemini 3 Flash. Students receive only a green correct result or a red retry result.

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

Each square is sent independently to the authenticated `/api/gemini-shape` route. Gemini checks the expected character against the visible handwritten parts using structured output grounded by the bundled Make Me a Hanzi reference. Pen movement count and exact placement on the grid do not grade the answer. The Local WASM and MyScript implementations remain in source history but are not loaded, selected, or called by the application.

## Password login

Set the server-side `PASSWORD` environment variable. A successful login creates a seven-day, HttpOnly, SameSite=Strict session cookie signed with an HMAC derived from that password. Changing `PASSWORD` invalidates existing sessions. The page and server recognition routes reject unauthenticated requests; logging out immediately expires the cookie.

## Gemini shape assessor

The route uses `gemini-3-flash-preview`, structured output, temperature `0`, and the model's minimum supported thinking level. Configure `GEMINI_API_KEY` locally and run `npm run experiment:gemini-shape` for the controlled calibration set. Production also requires `GEMINI_SHAPE_EXPERIMENT_ENABLED=true`. Students see only the binary result plus one brief positive observation and one brief improvement when needed; internal component data is not exposed.

## Deploy to Vercel

Import the GitHub repository into Vercel or run `vercel --prod` after completing the verification commands above. Configure `PASSWORD`, `GEMINI_API_KEY`, and `GEMINI_SHAPE_EXPERIMENT_ENABLED=true` for Production.

## Recognition and shape-data licensing

Character median data is derived from Make Me a Hanzi and Arphic fonts under the Arphic Public License. Historical local-recognition and Hanzi Writer notices remain under `public/licenses/`; those recognizers are no longer shipped or called by the app.
