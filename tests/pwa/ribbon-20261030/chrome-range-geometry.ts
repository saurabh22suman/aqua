// Chrome's Range geometry, for jsdom.
//
// jsdom has no layout, so `Range.getClientRects()` does not exist there.
// The ribbon's text measurement then falls back to "no text rectangles",
// which made the whole unit suite blind to the case that matters: in
// Chrome a range over an element's contents returns the DESCENDANT
// ELEMENTS' boxes as well as the text rectangles, so a full-width
// wrapper (a card, a list, a page section) becomes a blocker that spans
// the page.
//
// MDN, Range.getClientRects(): "This is created by aggregating the
// results of calls to Element.getClientRects() for all the elements in
// the range."
//
// This fixture gives jsdom that behaviour on top of the mocked
// getBoundingClientRect, so a test can see what Chrome sees:
//
//   * a range over an ELEMENT's contents → the descendant elements'
//     boxes (Chrome's aggregation), which is what over-blocks;
//   * a range over TEXT → the text's own line boxes, which jsdom cannot
//     measure, so the fixture keeps only what an INLINE parent can say
//     (an inline element's client rects ARE its text boxes) and reports
//     nothing for a block parent.
//
// It is a geometry fixture, not a production change: it only makes the
// suite able to see the difference.
//
// Agent-owned file (tests/pwa/ribbon-20261030/**).

export function installChromeRangeGeometry(): void {
  Object.defineProperty(Range.prototype, "getClientRects", {
    configurable: true,
    writable: true,
    value(this: Range): DOMRect[] {
      const start = this.startContainer;
      const end = this.endContainer;

      // A range over TEXT: Chrome returns the text's own line boxes.
      if (start.nodeType === 3 || end.nodeType === 3) {
        const parent =
          start.nodeType === 3 ? start.parentElement : end.parentElement;
        if (!parent) return [];
        const display = window.getComputedStyle(parent).display;
        if (display !== "inline" && display !== "inline-block") return [];
        return Array.from(parent.getClientRects());
      }

      // A range over an ELEMENT's contents: the descendant elements'
      // boxes, which is what Chrome aggregates.
      const ancestor = this.commonAncestorContainer;
      const scope = ancestor instanceof Element ? ancestor : ancestor.parentElement;
      if (!scope) return [];
      return Array.from(scope.querySelectorAll("*"))
        .map((element) => element.getBoundingClientRect())
        .filter((rect) => rect.width > 0 && rect.height > 0);
    },
  });
}
