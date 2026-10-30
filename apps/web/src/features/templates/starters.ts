import type { TemplateContent } from "@narada/core/template-model";
// Starter designs compose the same small set of email-safe layout primitives.
const paragraph = (text: string) =>
  `<p style="font:16px/1.7 Arial,sans-serif;color:#35463a;margin:16px 0">${text}</p>`;
const frame = (title: string, body: string) =>
  `<!doctype html><html><body style="margin:0;background:#f3f5ef;padding:32px 16px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center"><table role="presentation" width="600" style="width:100%;max-width:600px;background:#ffffff;border-radius:16px" cellpadding="32"><tr><td><p style="font:14px Arial,sans-serif;color:#496b45">A MESSAGE FOR YOU</p><h1 style="font:32px Georgia,serif;color:#223429">${title}</h1>${body}</td></tr></table></td></tr></table></body></html>`;
export const starters: Record<string, TemplateContent> = {
  blank: {
    name: "Untitled template",
    kind: "transactional",
    subject: "",
    html: "",
    text: "",
    variables: [],
  },
  blank_broadcast: {
    name: "Untitled broadcast template",
    kind: "broadcast",
    subject: "",
    html: "",
    text: "",
    variables: [],
  },
  welcome: {
    name: "Welcome",
    kind: "transactional",
    subject: "Welcome, {{vars.first_name}}",
    html: frame(
      "Welcome aboard.",
      paragraph("Hi {{vars.first_name}},") +
        paragraph("Your account is ready. We are glad you are here.") +
        paragraph("If you need a hand, just reply to this email."),
    ),
    text: "Hi {{vars.first_name}},\nYour account is ready. We are glad you are here.\nIf you need a hand, just reply to this email.",
    variables: [{ key: "first_name", type: "string", fallback: "friend" }],
  },
  code: {
    name: "Verification code",
    kind: "transactional",
    subject: "Your verification code",
    html: frame(
      "Your sign-in code",
      paragraph("Enter this code to finish signing in:") +
        '<p style="font:bold 32px monospace;letter-spacing:6px;color:#223429">{{vars.code}}</p>' +
        paragraph(
          "This code expires in 10 minutes. If you did not request it, you can ignore this email.",
        ),
    ),
    text: "Your sign-in code: {{vars.code}}\nThis code expires in 10 minutes. If you did not request it, ignore this email.",
    variables: [{ key: "code", type: "string" }],
  },
  update: {
    name: "Product update",
    kind: "broadcast",
    subject: "News from our team",
    html: frame(
      "Something new for you.",
      paragraph("Hi {{contact.first_name}},") +
        paragraph(
          "We have been working on something useful. Here is what is new.",
        ) +
        '<hr style="border:0;border-top:1px solid #e0e5dc">' +
        paragraph("Tell us what you think by replying to this email."),
    ),
    text: "Hi {{contact.first_name}},\nWe have been working on something useful. Here is what is new.\nTell us what you think by replying to this email.",
    variables: [],
  },
};

// Keep starter content editable from its first open. The HTML above remains the
// initial thumbnail/export; saving uses the same block serializer as broadcasts.
const textBlock = (text: string) => ({
  type: "paragraph",
  content: [{ type: "text", text }],
});
function starterDocument(
  title: string,
  paragraphs: string[],
  divider = false,
): NonNullable<TemplateContent["document"]> {
  const styles = {
    body: {
      backgroundColor: "#f3f5ef",
      padding: "24px 16px",
      fontFamily: "Arial, sans-serif",
      color: "#35463a",
    },
    container: {
      backgroundColor: "#ffffff",
      width: "600px",
      maxWidth: "100%",
      padding: "32px",
      borderRadius: "16px",
      margin: "0 auto",
    },
    h1: {
      fontFamily: "Georgia, serif",
      fontSize: "32px",
      color: "#223429",
      margin: "20px 0",
    },
    paragraph: { fontSize: "16px", lineHeight: "1.7", margin: "16px 0" },
  };
  return {
    type: "doc",
    content: [
      {
        type: "globalContent",
        attrs: {
          data: {
            theme: "basic",
            styles: Object.entries(styles).map(([key, props]) => ({
              id: key,
              title: key,
              classReference: key,
              inputs: Object.entries(props).map(([prop, value]) => ({
                label: prop,
                type: "text",
                prop,
                value,
                classReference: key,
              })),
            })),
          },
        },
      },
      {
        type: "container",
        content: [
          textBlock("A MESSAGE FOR YOU"),
          {
            type: "heading",
            attrs: { level: 1 },
            content: [{ type: "text", text: title }],
          },
          ...paragraphs.flatMap((text, i) =>
            divider && i === paragraphs.length - 1
              ? [{ type: "horizontalRule" }, textBlock(text)]
              : [textBlock(text)],
          ),
        ],
      },
    ],
  };
}
starters.welcome!.document = starterDocument(
  "Welcome aboard.",
  starters.welcome!.text.split("\n"),
);
starters.code!.document = starterDocument("Your sign-in code", [
  "Enter this code to finish signing in:",
  "{{vars.code}}",
  "This code expires in 10 minutes. If you did not request it, you can ignore this email.",
]);
starters.update!.document = starterDocument(
  "Something new for you.",
  starters.update!.text.split("\n"),
  true,
);

/** Recognize only untouched legacy starter bodies; never reinterpret imported HTML. */
export function editableTemplate(content: TemplateContent): TemplateContent {
  if (content.document) return content;
  const starter = Object.values(starters).find(
    (s) => s.document && s.html === content.html && s.text === content.text,
  );
  return starter
    ? { ...content, document: structuredClone(starter.document) }
    : content;
}
