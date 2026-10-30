import { cn } from "../../lib/utils.js";
/** Sandboxed preview shared by templates and broadcasts; no scripts; only hosted images and YouTube thumbnails may load. */
export function EmailPreview({
  html,
  title = "Email preview",
  className,
  allowVideos = false,
}: {
  html: string;
  title?: string;
  className?: string;
  /** Only enable for the server's strictly rendered newsletter web preview. */
  allowVideos?: boolean;
}) {
  return (
    <iframe
      title={title}
      sandbox={allowVideos ? "allow-scripts allow-same-origin" : ""}
      className={cn("w-full h-96 rounded-lg border bg-white", className)}
      srcDoc={`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; img-src data: ${window.location.origin}/media/ https://i.ytimg.com/vi/; ${allowVideos ? "frame-src https://www.youtube-nocookie.com;" : ""} style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">${html}`}
    />
  );
}
