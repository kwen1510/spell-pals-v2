# 听写小助手

A static, browser-only Chinese handwriting spelling checker. Handwriting is captured as pointer strokes and recognized locally with `gugray/hanzi_lookup`; no image OCR or backend is used.

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

The static export is written to `out/` and can be deployed to Vercel or any static host.

## GitHub Pages

The included GitHub Actions workflow tests, builds, and deploys this project at:

<https://kwen1510.github.io/spell-pals-v2/>

In the repository's **Settings → Pages**, set **Source** to **GitHub Actions**. Every push to `main` then deploys automatically.

The Pages build uses `/spell-pals-v2` as its base path for Next.js assets, the handwriting Web Worker, and WASM. A normal `npm run build` keeps the root path used by Vercel; no code changes are required when switching hosts.

## Recognition licensing

The bundled `hanzi_lookup` JavaScript/WASM files are distributed under the GNU LGPL. Its embedded character data is derived from Make Me a Hanzi and Arphic fonts and is distributed under the Arphic Public License. Copies of both notices are included under `public/licenses/`, with upstream source at <https://github.com/gugray/hanzi_lookup>.
