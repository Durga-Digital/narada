import { parseFragment, serialize, type DefaultTreeAdapterMap } from "parse5";
/** Preserve the historical default article base for legacy saved relative links.
 * This operates on the article fragment only, never on site navigation or forms. */
export function publicationContentLinks(
  html: string,
  historicalArticleUrl: string,
) {
  const document = parseFragment(html);
  function visit(node: DefaultTreeAdapterMap["node"]) {
    if ("attrs" in node)
      for (const attr of node.attrs) {
        if (
          !["href", "src", "poster"].includes(attr.name) ||
          !attr.value ||
          attr.value.startsWith("#") ||
          /^[a-z][a-z0-9+.-]*:/i.test(attr.value)
        )
          continue;
        try {
          attr.value = new URL(attr.value, historicalArticleUrl).href;
        } catch {
          /* Existing renderer validation remains authoritative. */
        }
      }
    if ("childNodes" in node) for (const child of node.childNodes) visit(child);
  }
  visit(document);
  return serialize(document);
}
