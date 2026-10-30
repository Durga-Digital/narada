import { Node } from "@tiptap/react";
import { youtubeVideo } from "@narada/contracts/media-content";

export const NewsletterImage = Node.create({
  name: "image",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    return {
      src: { default: "" },
      alt: { default: "" },
      width: { default: 680 },
      height: { default: 400 },
    };
  },
  parseHTML() {
    return [{ tag: "img[src]" }];
  },
  renderHTML({ node }) {
    return [
      "img",
      {
        src: node.attrs.src,
        alt: node.attrs.alt,
        width: node.attrs.width,
        height: node.attrs.height,
        style: "max-width:100%;height:auto;display:block;margin:24px auto",
      },
    ];
  },
});
export const NewsletterVideo = Node.create({
  name: "youtube",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    return { src: { default: "" }, title: { default: "YouTube video" } };
  },
  parseHTML() {
    return [
      {
        tag: "div[data-youtube]",
        getAttrs: (element) => ({
          src: element.getAttribute("data-youtube"),
          title: element.getAttribute("data-title"),
        }),
      },
    ];
  },
  renderHTML({ node }) {
    const video = youtubeVideo(String(node.attrs.src));
    return [
      "div",
      {
        "data-youtube": video?.url ?? "",
        "data-title": node.attrs.title,
        class: "newsletter-video",
        contenteditable: "false",
      },
      [
        "img",
        {
          src: video?.thumbnail ?? "",
          alt: `Video: ${node.attrs.title}`,
          width: 480,
          height: 360,
          style: "max-width:100%;height:auto",
        },
      ],
      ["p", {}, `${node.attrs.title} · YouTube`],
    ];
  },
});
