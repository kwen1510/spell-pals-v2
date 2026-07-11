import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  ChineseGuide,
  GUIDE_SQUARE_VIEWBOX_SIZE,
  MIN_WRITABLE_SQUARE_PX,
  guideBoardStyle,
} from "./ChineseGuide";

describe("ChineseGuide", () => {
  it.each([1, 2, 3])("keeps %i character guides square", (count) => {
    const style = guideBoardStyle(count);
    expect(style.aspectRatio).toBe(`${count} / 1`);
    expect(style["--character-count"]).toBe(count);
    expect(style["--minimum-square-size"]).toBe(`${MIN_WRITABLE_SQUARE_PX}px`);

    const markup = renderToStaticMarkup(createElement(ChineseGuide, { count, mode: "boxes" }));
    expect(markup).toContain(`viewBox="0 0 ${GUIDE_SQUARE_VIEWBOX_SIZE * count} ${GUIDE_SQUARE_VIEWBOX_SIZE}"`);
    expect(markup).toContain('preserveAspectRatio="xMinYMin meet"');
    expect(markup.match(/<rect /g)).toHaveLength(count);
    expect(markup.match(/<line /g)).toHaveLength(count * 2);
  });

  it("keeps free canvas blank", () => {
    const markup = renderToStaticMarkup(createElement(ChineseGuide, { count: 3, mode: "free" }));
    expect(markup).toContain('data-guide-mode="free"');
    expect(markup).not.toContain("<line ");
    expect(markup).toContain("<rect ");
  });

  it("places both dashed guides on the exact centre of every square", () => {
    const markup = renderToStaticMarkup(createElement(ChineseGuide, { count: 2, mode: "boxes" }));
    expect(markup).toContain('x1="150" y1="2" x2="150" y2="298"');
    expect(markup).toContain('x1="2" y1="150" x2="298" y2="150"');
    expect(markup.match(/stroke-dasharray="10 10"/g)).toHaveLength(4);
    expect(markup).toContain('transform="translate(300 0)"');
  });

  it("normalizes an invalid count to one writable square", () => {
    expect(guideBoardStyle(0)["--character-count"]).toBe(1);
    const markup = renderToStaticMarkup(createElement(ChineseGuide, { count: 0, mode: "boxes" }));
    expect(markup).toContain('viewBox="0 0 300 300"');
    expect(markup.match(/<rect /g)).toHaveLength(1);
  });
});
