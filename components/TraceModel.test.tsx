import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { getCharacterShapeReference } from "../lib/handwriting/character-shape-references";
import { TraceModel } from "./TraceModel";

describe("display-only tracing model", () => {
  it("renders one official median set in each square without a drawing canvas", () => {
    const markup = renderToStaticMarkup(<TraceModel characters="听写" />);
    const expectedPaths = getCharacterShapeReference("听")!.length + getCharacterShapeReference("写")!.length;

    expect(markup).toContain('class="trace-model-svg"');
    expect(markup).toContain('viewBox="0 0 600 300"');
    expect(markup.match(/<polyline/g)).toHaveLength(expectedPaths);
    expect(markup).not.toContain("<canvas");
    expect(markup).toContain('aria-hidden="true"');
  });
});
