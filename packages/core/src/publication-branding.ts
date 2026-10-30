import { assetOrigin } from "./origins.js";
import {
  brandingInput,
  logoInput,
  LOGO_MAX_BYTES,
} from "@narada/contracts/branding";
import type {
  PublicationLogo,
  PublicationBranding,
} from "@narada/contracts/types";
import type { Runtime } from "./runtime.js";
import type { Publication } from "./newsletter-model.js";
import { AppError, type Entity } from "./model.js";
import { inspectImage } from "./media.js";
import { newsletterCommit, replaceRevision } from "./publications.js";
import type { MutationCommit } from "./idempotency.js";

type LogoRecord = Entity & Omit<PublicationLogo, "url">;
const logoKey = (publicationId: string, assetId: string) =>
  `PUBLICATIONLOGO#${publicationId}#${assetId}`;
export class PublicationBrandingService {
  constructor(private runtime: Runtime) {}
  private dto(row: LogoRecord): PublicationLogo {
    const { publicationId, id, contentType, width, height } = row;
    return {
      publicationId,
      id,
      contentType,
      width,
      height,
      url: new URL(
        `/media/${id}.${contentType === "image/png" ? "png" : "jpg"}`,
        assetOrigin(this.runtime.config),
      ).href,
    };
  }
  async logo(
    pub: Publication,
    branding = pub.branding,
  ): Promise<PublicationLogo | undefined> {
    if (!branding?.logoAssetId) return;
    const row = await this.runtime.store.get<LogoRecord>(
      logoKey(pub.id, branding.logoAssetId),
    );
    if (!row || row.publicationId !== pub.id)
      throw new AppError(
        422,
        "Upload this logo for this publication before using it",
      );
    return this.dto(row);
  }
  async validate(
    pub: Publication,
    input: unknown,
  ): Promise<PublicationBranding> {
    const branding = brandingInput.parse({
      ...pub.branding,
      ...brandingInput.parse(input),
    });
    for (const assetId of [
      branding.logoAssetId,
      branding.wordmarkAssetId,
      branding.coverAssetId,
    ]) {
      if (assetId) await this.logo(pub, { ...branding, logoAssetId: assetId });
    }
    return branding;
  }
  async update(
    pub: Publication,
    input: unknown,
    revision: number,
    commit?: MutationCommit,
  ) {
    if (revision !== pub.revision)
      throw new AppError(409, "Publication changed; reload before continuing");
    const branding = await this.validate(pub, input);
    const next: Publication = {
      ...pub,
      branding,
      revision: revision + 1,
      updatedAt: new Date().toISOString(),
    };
    return newsletterCommit(
      this.runtime.store,
      [replaceRevision(this.runtime.store, next, revision)],
      next,
      commit,
    );
  }
  async upload(pub: Publication, input: unknown, commit?: MutationCommit) {
    const parsed = logoInput.parse(input);
    const bytes = Buffer.from(parsed.contentBase64, "base64");
    if (bytes.toString("base64") !== parsed.contentBase64)
      throw new AppError(422, "Invalid base64 image");
    if (!bytes.length || bytes.length > LOGO_MAX_BYTES)
      throw new AppError(413, "Logo must be at most 512 KiB");
    const image = inspectImage(bytes);
    if (
      !["image/png", "image/jpeg"].includes(image.contentType) ||
      image.width > 2048 ||
      image.height > 2048
    )
      throw new AppError(
        422,
        "Choose a PNG or JPEG logo up to 2048 pixels per side",
      );
    // Only immutable storage is written before the authorization/receipt transaction.
    const { asset, row: mediaRow } = await this.runtime.media.prepareUpload(
      bytes,
      parsed.fileName,
    );
    const row: LogoRecord = {
      pk: logoKey(pub.id, asset.id),
      sk: "META",
      publicationId: pub.id,
      id: asset.id,
      contentType: image.contentType as "image/png" | "image/jpeg",
      width: image.width,
      height: image.height,
    };
    const store = this.runtime.store;
    return newsletterCommit(
      store,
      [
        ...(mediaRow
          ? [
              {
                Put: {
                  TableName: store.config.APP_TABLE,
                  Item: mediaRow,
                  ConditionExpression: "attribute_not_exists(pk)",
                },
              },
            ]
          : []),
        {
          ConditionCheck: {
            TableName: store.config.APP_TABLE,
            Key: { pk: pub.pk, sk: pub.sk },
            ConditionExpression: "revision = :revision",
            ExpressionAttributeValues: { ":revision": pub.revision },
          },
        },
        { Put: { TableName: store.config.APP_TABLE, Item: row } },
      ],
      this.dto(row),
      commit,
    );
  }
}
