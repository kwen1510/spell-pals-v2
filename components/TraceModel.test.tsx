import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TraceModel } from "./TraceModel";

describe("display-only tracing model", () => {
  it("renders one enlarged Chinese glyph in each square without a drawing canvas", () => {
    const markup = renderToStaticMarkup(<TraceModel characters="听写" />);

    expect(markup).toContain('class="trace-model-svg"');
    expect(markup).toContain('viewBox="0 0 600 300"');
    expect(markup.match(/<text/g)).toHaveLength(2);
    expect(markup).toContain("听");
    expect(markup).toContain("写");
    expect(markup).not.toContain("<polyline");
    expect(markup).not.toContain("<canvas");
    expect(markup).toContain('aria-hidden="true"');
  });
});
