// Browser-safe media contracts shared by the editors and server renderer.
export const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
export const mediaKeyPattern = /^media\/[a-f0-9]{64}\.(png|jpg|gif)$/;
export interface MediaAsset {
  id: string;
  name: string;
  url: string;
  contentType: string;
  bytes: number;
  width: number;
  height: number;
  createdAt: string;
}
export function youtubeVideo(value: string) {
  try {
    const url = new URL(value.trim());
    if (
      !["https:", "http:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.port
    )
      return null;
    const host = url.hostname.toLowerCase();
    let id: string | null = null;
    if (host === "youtu.be") id = url.pathname.slice(1);
    else if (
      [
        "youtube.com",
        "www.youtube.com",
        "m.youtube.com",
        "www.youtube-nocookie.com",
      ].includes(host)
    ) {
      if (url.pathname === "/watch") id = url.searchParams.get("v");
      else
        id =
          /^\/(?:embed|shorts|live)\/([^/]+)\/?$/.exec(url.pathname)?.[1] ??
          null;
    }
    if (!id || !/^[\w-]{11}$/.test(id)) return null;
    return {
      id,
      url: `https://www.youtube.com/watch?v=${id}`,
      thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
      embed: `https://www.youtube-nocookie.com/embed/${id}`,
    };
  } catch {
    return null;
  }
}
export function hostedImageUrl(value: unknown, origin: string) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.origin === new URL(origin).origin &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      mediaKeyPattern.test(url.pathname.slice(1))
      ? url.href
      : null;
  } catch {
    return null;
  }
}
