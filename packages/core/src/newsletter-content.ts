import { AppError } from "./model.js";
import { escapeHtml, editorDocument } from "./message-content.js";
import type { IssueDraft } from "./newsletter-model.js";
import { hostedImageUrl, youtubeVideo } from "./media-content.js";
type Node = {
  type?: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: Node[];
  content?: Node[];
};
export function renderIssue(
  draft: IssueDraft,
  options: {
    target?: "web" | "email";
    origin?: string;
    allowEmpty?: boolean;
  } = {},
) {
  const doc = editorDocument.parse(draft.document);
  if (/\{\{/.test(JSON.stringify(draft)))
    throw new AppError(
      422,
      "Contact personalization is not supported in newsletter issues",
    );
  let nodes = 0;
  function render(node: Node, depth = 0): { html: string; text: string } {
    if (++nodes > 5000 || depth > 20)
      throw new AppError(422, "Issue content is too complex");
    if (!node || typeof node !== "object")
      throw new AppError(422, "Invalid issue block");
    if (node.type === "text") {
      if (typeof node.text !== "string")
        throw new AppError(422, "Invalid text block");
      let html = escapeHtml(node.text),
        text = node.text;
      if (node.marks !== undefined && !Array.isArray(node.marks))
        throw new AppError(422, "Invalid text formatting");
      for (const mark of node.marks ?? []) {
        const tags: Record<string, string> = {
          bold: "strong",
          italic: "em",
          underline: "u",
          strike: "s",
          code: "code",
        };
        if (!mark || typeof mark !== "object")
          throw new AppError(422, "Invalid text formatting");
        if (Object.hasOwn(tags, mark.type ?? ""))
          html = `<${tags[mark.type!]}>${html}</${tags[mark.type!]}>`;
        else if (mark.type === "link") {
          const href = String(mark.attrs?.href ?? "");
          let url: URL;
          try {
            url = new URL(href);
          } catch {
            throw new AppError(
              422,
              "Links must use a complete https, http or mailto URL",
            );
          }
          if (!["https:", "http:", "mailto:"].includes(url.protocol))
            throw new AppError(422, "Unsafe link in issue");
          text += ` (${url.href})`;
          html = `<a href="${escapeHtml(url.href)}" rel="noopener noreferrer">${html}</a>`;
        } else if (mark.type !== "textStyle")
          throw new AppError(422, `Unsupported formatting: ${mark.type}`);
      }
      return { html, text };
    }
    if (node.type === "image") {
      const src =
        options.origin && hostedImageUrl(node.attrs?.src, options.origin);
      if (!src)
        throw new AppError(
          422,
          "Choose an image from this environment’s image library",
        );
      const alt =
        typeof node.attrs?.alt === "string" ? node.attrs.alt.slice(0, 500) : "";
      const width = Number(node.attrs?.width),
        height = Number(node.attrs?.height);
      if (
        !Number.isInteger(width) ||
        !Number.isInteger(height) ||
        width < 1 ||
        height < 1 ||
        width > 8000 ||
        height > 8000
      )
        throw new AppError(422, "Invalid image dimensions");
      const displayWidth = Math.min(width, 680);
      return {
        html: `<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" width="${displayWidth}" height="${Math.max(1, Math.round((height * displayWidth) / width))}" style="display:block;max-width:100%;height:auto;margin:24px auto">`,
        text: `${alt || "Image"}: ${src}\n`,
      };
    }
    if (node.type === "youtube") {
      const video =
        typeof node.attrs?.src === "string" && youtubeVideo(node.attrs.src);
      if (!video) throw new AppError(422, "Use a valid YouTube video link");
      const title =
        typeof node.attrs?.title === "string"
          ? node.attrs.title.slice(0, 200) || "YouTube video"
          : "YouTube video";
      const link = `<a href="${video.url}" rel="noopener noreferrer">Watch ${escapeHtml(title)} on YouTube</a>`;
      return {
        html:
          options.target === "web"
            ? `<div style="margin:24px 0"><iframe src="${video.embed}" title="${escapeHtml(title)}" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" allow="encrypted-media; picture-in-picture; fullscreen" allowfullscreen style="border:0;width:100%;aspect-ratio:16/9"></iframe><p>${link}</p></div>`
            : `<p><a href="${video.url}"><img src="${video.thumbnail}" alt="Watch ${escapeHtml(title)} on YouTube" width="480" height="360" style="display:block;max-width:100%;height:auto"></a></p><p>${link}</p>`,
        text: `Watch ${title} on YouTube: ${video.url}\n`,
      };
    }
    const tags: Record<string, string> = {
      doc: "",
      paragraph: "p",
      bulletList: "ul",
      orderedList: "ol",
      listItem: "li",
      blockquote: "blockquote",
      codeBlock: "pre",
      horizontalRule: "hr",
      hardBreak: "br",
    };
    let tag = Object.hasOwn(tags, node.type ?? "")
      ? tags[node.type!]
      : undefined;
    if (node.type === "heading") {
      const level = Number(node.attrs?.level ?? 2);
      if (!Number.isInteger(level) || level < 1 || level > 6)
        throw new AppError(422, "Invalid heading level");
      tag = `h${level}`;
    }
    if (tag === undefined)
      throw new AppError(422, `Unsupported newsletter block: ${node.type}`);
    if (node.content !== undefined && !Array.isArray(node.content))
      throw new AppError(422, "Invalid block content");
    const children = (node.content ?? []).map((c) => render(c, depth + 1));
    const html = children.map((c) => c.html).join("");
    const text = children.map((c) => c.text).join("");
    return {
      html: tag
        ? ["hr", "br"].includes(tag)
          ? `<${tag}>`
          : `<${tag}>${html}</${tag}>`
        : html,
      text: text + (tag ? "\n" : ""),
    };
  }
  const body = render(doc as Node);
  if (!body.text.trim() && !options.allowEmpty)
    throw new AppError(422, "Write some issue content before publishing");
  const html = `${draft.preheader ? `<div style="display:none">${escapeHtml(draft.preheader)}</div>` : ""}<h1>${escapeHtml(draft.title)}</h1>${draft.subtitle ? `<p>${escapeHtml(draft.subtitle)}</p>` : ""}${body.html}`;
  const text = `${draft.title}\n${draft.subtitle ? draft.subtitle + "\n" : ""}\n${body.text}`;
  if (html.length > 48000 || text.length > 28000)
    throw new AppError(422, "Issue exceeds email content limits");
  return { html, text };
}
