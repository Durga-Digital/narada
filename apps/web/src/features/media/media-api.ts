import {
  MAX_IMAGE_BYTES,
  type MediaAsset,
} from "@narada/contracts/media-content";
export async function uploadImage(file: File): Promise<MediaAsset> {
  if (file.size > MAX_IMAGE_BYTES)
    throw new Error("Choose an image under 3 MB");
  const response = await fetch("/api/admin/media", {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/octet-stream",
      "X-File-Name": encodeURIComponent(file.name),
    },
    body: file,
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.url)
    throw new Error(data?.error ?? "Image upload failed. Please try again.");
  return data;
}
// Stable callback: changing it rebuilds the email editor's image extension.
export async function uploadEditorImage(file: File) {
  const asset = await uploadImage(file);
  return { url: asset.url };
}
