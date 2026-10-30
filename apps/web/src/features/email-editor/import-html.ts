import DOMPurify from "dompurify";

// Import presentation properties into the editor's own nodes. Never attach
// imported stylesheets, selectors, positioning, or resource-loading CSS to the
// dashboard. Longhands also recover values from font/background shorthands.
const presentationProperties = [
  "color",
  "background-color",
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
  "line-height",
  "letter-spacing",
  "text-align",
  "text-decoration",
  "text-transform",
  "white-space",
  "vertical-align",
  "width",
  "min-width",
  "max-width",
  "height",
  "min-height",
  "max-height",
  "margin",
  "padding",
  "border-radius",
  "border-collapse",
  "border-spacing",
  "box-sizing",
  ...["top", "right", "bottom", "left"].flatMap((side) => [
    `margin-${side}`,
    `padding-${side}`,
    `border-${side}-width`,
    `border-${side}-style`,
    `border-${side}-color`,
  ]),
];

function safeValue(value: string) {
  // CSSOM has already parsed/normalized the declaration. Reject escapes and
  // functional values except literal colors: no URLs, variables, or expressions.
  return (
    value.length <= 500 &&
    !/[\\@<>]/.test(value) &&
    [...value.matchAll(/([\w-]+)\s*\(/g)].every((match) =>
      /^(rgb|rgba|hsl|hsla)$/i.test(match[1]!),
    )
  );
}

export function importEmailHtml(html: string): string {
  const body = DOMPurify.sanitize(html, {
    RETURN_DOM: true,
    USE_PROFILES: { html: true },
    FORBID_TAGS: ["style", "form", "input", "button", "iframe"],
    FORBID_ATTR: ["class", "id", "background"],
    ALLOW_DATA_ATTR: false,
  }) as HTMLBodyElement;
  // The editor's container shortcut flattens single-cell presentation tables
  // and discards their table/cell styles. Import them as ordinary table nodes;
  // its email exporter restores role="presentation" on the rendered tables.
  for (const table of body.querySelectorAll("table")) {
    if (table.getAttribute("role") === "presentation")
      table.removeAttribute("role");
    // Email layout tables reset inherited text alignment in a standalone
    // document. Make that explicit inside the dashboard's CSS reset too.
    if (!table.style.textAlign) table.style.textAlign = "start";
  }
  for (const element of [
    body,
    ...body.querySelectorAll<HTMLElement>("[style]"),
  ]) {
    const original = element.style;
    const clean = body.ownerDocument.createElement("span").style;
    for (const property of presentationProperties) {
      const value = original.getPropertyValue(property);
      if (value && safeValue(value)) clean.setProperty(property, value);
    }
    if (
      /^(none|block|inline|inline-block|table|table-row|table-cell)$/.test(
        original.display,
      )
    )
      clean.display = original.display;
    if (clean.cssText) element.setAttribute("style", clean.cssText);
    else element.removeAttribute("style");
  }
  // HTML documents often put inherited typography/backgrounds on <body>.
  // Tiptap parses a fragment, so retain those on an editable wrapper node.
  if (body.getAttribute("style")) {
    const wrapper = body.ownerDocument.createElement("div");
    wrapper.setAttribute("style", body.getAttribute("style")!);
    wrapper.append(...body.childNodes);
    return wrapper.outerHTML;
  }
  return body.innerHTML;
}
