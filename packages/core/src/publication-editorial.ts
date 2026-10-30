import { publicOrigin } from "./origins.js";
import type { OperationId } from "@narada/contracts/operations";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  aboutInput,
  siteInput,
  defaultAbout,
  defaultSite,
  collectionInput,
  collectionUpdateInput,
  collectionIdsInput,
  siteRevision,
} from "@narada/contracts/publication-site";
import type {
  PublicationAbout,
  PublicationAboutInput,
  PublicationSite,
  PublicationSiteInput,
  EditorialCollection,
  IssueCollections,
} from "@narada/contracts/types";
import type { Runtime } from "./runtime.js";
import type { Publication, Issue } from "./newsletter-model.js";
import { AppError, type Entity } from "./model.js";
import {
  newsletterCommit,
  replaceRevision,
  reserveNewsletterSlug,
} from "./publications.js";
import type { MutationCommit } from "./idempotency.js";
import { ProductPagination } from "./product-pagination.js";
import { renderIssue } from "./newsletter-content.js";
import { PublicationPages } from "./publication-pages.js";
import { editorDocument } from "./message-content.js";
import { defaultPublicationSite, sitePath } from "./publication-site.js";

type Snapshot = PublicationAbout | PublicationSite;
type CollectionRecord = EditorialCollection & Entity;
const collectionKey = (id: string, cid: string) => `COLLECTION#${id}#${cid}`;
const singletonKey = (id: string, kind: string) =>
  `PUBLICATIONSITE#${id}#${kind}`;
export const isEditorialOperation = (
  id: string,
): id is Extract<
  OperationId,
  | `publications.about.${string}`
  | `publications.site.${string}`
  | `publications.collections.${string}`
  | `issues.collections.${string}`
> =>
  /^publications\.(about|site|collections)\./.test(id) ||
  /^issues\.collections\./.test(id);
export function collectionEdgeWrites(store: Runtime["store"], issue: Issue) {
  return (issue.collectionIds ?? []).map((cid) => ({
    Put: {
      TableName: store.config.APP_TABLE,
      Item: {
        pk: `COLLECTIONISSUE#${issue.publicationId}#${cid}#${issue.id}`,
        sk: "META",
        publicationId: issue.publicationId,
        collectionId: cid,
        issueId: issue.id,
        scope: `collection-issues#${issue.publicationId}#${cid}`,
        sort: `${issue.publishedAt ?? issue.createdAt}#${issue.id}`,
      },
    },
  }));
}
export class PublicationEditorial {
  constructor(private runtime: Runtime) {}
  get store() {
    return this.runtime.store;
  }
  guard(row: Entity & { revision: number }) {
    return {
      ConditionCheck: {
        TableName: this.store.config.APP_TABLE,
        Key: { pk: row.pk, sk: row.sk },
        ConditionExpression: "revision = :r",
        ExpressionAttributeValues: { ":r": row.revision },
      },
    };
  }
  async snapshot(pub: Publication, kind: "about"): Promise<PublicationAbout>;
  async snapshot(pub: Publication, kind: "site"): Promise<PublicationSite>;
  async snapshot(pub: Publication, kind: "about" | "site"): Promise<Snapshot>;
  async snapshot(pub: Publication, kind: "about" | "site"): Promise<Snapshot> {
    const row = await this.store.get<Entity & Snapshot>(
      singletonKey(pub.id, kind),
    );
    if (!row)
      return {
        publicationId: pub.id,
        revision: 0,
        draft: kind === "about" ? defaultAbout : defaultSite,
        published: null,
      } as Snapshot;
    const { publicationId, revision, draft, published } = row;
    return { publicationId, revision, draft, published } as Snapshot;
  }
  async collection(
    pub: Publication,
    id: string,
    active = false,
  ): Promise<EditorialCollection> {
    const row = await this.store.get<CollectionRecord>(
      collectionKey(pub.id, id),
    );
    if (
      !row ||
      row.publicationId !== pub.id ||
      (active && row.status !== "active")
    )
      throw new AppError(404, "Collection not found");
    const {
      id: cid,
      publicationId,
      name,
      slug,
      description,
      status,
      revision,
    } = row;
    return {
      id: cid,
      publicationId,
      name,
      slug,
      description,
      status,
      revision,
    };
  }
  async collectionBySlug(pub: Publication, slug: string) {
    const row = await this.store.get<Entity>(
      `COLLECTIONSLUG#${pub.id}#${slug}`,
    );
    if (!row) throw new AppError(404, "Collection not found");
    return this.collection(pub, String(row.id), true);
  }
  async collections(pub: Publication, query: unknown = {}) {
    const page = await new ProductPagination(
      this.store,
    ).records<CollectionRecord>(
      `collections#${pub.id}`,
      "COLLECTION#",
      query,
      (r) => r.publicationId === pub.id,
    );
    return {
      ...page,
      data: page.data.map(
        ({ id, publicationId, name, slug, description, status, revision }) => ({
          id,
          publicationId,
          name,
          slug,
          description,
          status,
          revision,
        }),
      ),
    };
  }
  classification(issue: Issue): IssueCollections {
    return {
      publicationId: issue.publicationId,
      issueId: issue.id,
      revision: issue.collectionRevision ?? 0,
      issueRevision: issue.revision,
      collectionIds: issue.collectionIds ?? [],
    };
  }
  async validateAbout(pub: Publication, raw: unknown) {
    const value = aboutInput.parse(raw);
    const rendered = renderIssue(
      {
        title: value.title,
        document: editorDocument.parse(value.document),
        slug: "about",
        subtitle: "",
        subject: "",
        preheader: "",
      },
      {
        target: "web",
        origin: publicOrigin(this.runtime.config),
        allowEmpty: true,
      },
    );
    // The editor uses the shared environment media library. Require uploaded media
    // to exist; never fetch arbitrary URLs or execute imported markup.
    const visit = async (node: unknown): Promise<void> => {
      if (!node || typeof node !== "object") return;
      const n = node as {
        type?: string;
        attrs?: { src?: string };
        content?: unknown[];
      };
      if (n.type === "image") {
        const match = String(n.attrs?.src).match(
          /\/media\/([a-f0-9]{64})\.(png|jpg|gif|webp)$/,
        );
        if (!match || !(await this.store.get(`MEDIA#${match[1]}`)))
          throw new AppError(
            422,
            "Choose an uploaded image from this environment",
          );
      }
      for (const child of n.content ?? []) await visit(child);
    };
    await visit(value.document);
    return { value, rendered };
  }
  async validateSite(
    pub: Publication,
    raw: unknown,
    live = false,
    preview = false,
  ) {
    const value = siteInput.parse(raw);
    const ids = new Set([
      ...value.collectionIds,
      ...value.navigation.flatMap((i) =>
        i.type === "collection" ? [i.collectionId] : [],
      ),
    ]);
    const guards = [];
    for (const cid of ids) {
      const col = await this.collection(pub, cid, live);
      guards.push(
        this.guard({ ...col, pk: collectionKey(pub.id, cid), sk: "META" }),
      );
    }
    if (value.featuredIssueId) {
      const issue = await this.runtime.issues.get(
        pub.id,
        value.featuredIssueId,
        preview,
      );
      if (!issue.publicVersionId && !preview)
        throw new AppError(422, "Choose a public issue to feature");
      guards.push(this.guard(issue));
    }
    if (live && value.navigation.some((i) => i.type === "about")) {
      const about = await this.snapshot(pub, "about");
      if (!about.published)
        throw new AppError(422, "Publish About before adding it to navigation");
      guards.push(
        this.guard({ ...about, pk: singletonKey(pub.id, "about"), sk: "META" }),
      );
    }
    return { value, guards };
  }
  // Runs before receipt lookup as well as on execution. Archived collections remain
  // addressable for replay; domain state/revision checks belong only to execution.
  async authorizeLinks(
    pub: Publication,
    id: string,
    params: Record<string, string>,
    body: Record<string, unknown>,
    query: Record<string, unknown>,
  ) {
    if (params.collectionId!) await this.collection(pub, params.collectionId!);
    if (query.collectionId)
      await this.collection(pub, String(query.collectionId));
    if (id === "issues.collections.update")
      for (const cid of collectionIdsInput.parse(body.collectionIds))
        await this.collection(pub, cid);
    if (id.startsWith("publications.site.")) {
      const draft = body.draft ?? (await this.snapshot(pub, "site")).draft;
      const v = siteInput.parse(draft);
      for (const cid of new Set([
        ...v.collectionIds,
        ...v.navigation.flatMap((i) =>
          i.type === "collection" ? [i.collectionId] : [],
        ),
      ]))
        await this.collection(pub, cid);
      if (v.featuredIssueId)
        return this.runtime.issues.get(pub.id, v.featuredIssueId, true);
    }
  }
  async run(
    pub: Publication,
    issue: Issue | undefined,
    id: string,
    params: Record<string, string>,
    body: Record<string, unknown>,
    query: Record<string, unknown>,
    commit?: MutationCommit,
  ): Promise<unknown> {
    const action = id.split(".").at(-1)!;
    if (
      id.startsWith("publications.about.") ||
      id.startsWith("publications.site.")
    ) {
      const kind = id.split(".")[1] as "about" | "site";
      const current = await this.snapshot(pub, kind);
      if (action === "get") return current;
      if (siteRevision.parse(body.revision) !== current.revision)
        throw new AppError(409, "Website changed; reload before continuing");
      let draft = current.draft;
      let guards: ReturnType<PublicationEditorial["guard"]>[] = [];
      let html = "";
      if (action !== "withdraw") {
        if (kind === "about") {
          const result = await this.validateAbout(
            pub,
            action === "publish"
              ? current.draft
              : (body.draft ?? current.draft),
          );
          draft = result.value;
          html = result.rendered.html;
        } else {
          const result = await this.validateSite(
            pub,
            action === "publish"
              ? current.draft
              : (body.draft ?? current.draft),
            action === "publish",
            action === "preview",
          );
          draft = result.value;
          guards = result.guards;
        }
      }
      if (action === "preview") {
        const pages = new PublicationPages(this.runtime);
        return {
          html:
            kind === "site"
              ? await pages.home(
                  pub,
                  true,
                  undefined,
                  draft as PublicationSiteInput,
                )
              : await pages.page(pub, `<article>${html}</article>`, {
                  origin: publicOrigin(this.runtime.config),
                  path: sitePath(
                    defaultPublicationSite(
                      pub,
                      publicOrigin(this.runtime.config),
                    ),
                    "/about",
                  ),
                  private: true,
                  preview: true,
                }),
        };
      }
      if (action === "publish" && pub.status === "draft")
        throw new AppError(
          422,
          "Activate the publication before publishing its website",
        );
      if (
        action === "publish" &&
        kind === "about" &&
        !renderIssue(
          {
            ...(draft as PublicationAboutInput),
            document: editorDocument.parse(
              (draft as PublicationAboutInput).document,
            ),
            slug: "about",
            subtitle: "",
            subject: "",
            preheader: "",
          },
          { target: "web", origin: publicOrigin(this.runtime.config) },
        ).text.trim()
      )
        throw new AppError(422, "Add content before publishing About");
      const published =
        action === "publish"
          ? {
              versionId: randomUUID(),
              publishedAt: new Date().toISOString(),
              content: draft,
            }
          : action === "withdraw"
            ? null
            : current.published;
      const result = {
        ...current,
        revision: current.revision + 1,
        draft,
        published,
      } as Snapshot;
      const row = { ...result, pk: singletonKey(pub.id, kind), sk: "META" };
      const writes = [
        this.guard(pub),
        current.revision
          ? replaceRevision(this.store, row, current.revision)
          : this.store.create(row),
        ...guards,
      ];
      if (action === "publish" && published)
        writes.push(
          this.store.create({
            pk: `PUBLICATIONSITEVERSION#${pub.id}#${published.versionId}`,
            sk: "META",
            ...published,
          }),
        );
      return newsletterCommit(this.store, writes, result, commit);
    }
    if (id.startsWith("publications.collections.")) {
      if (action === "list") return this.collections(pub, query);
      if (action === "get") return this.collection(pub, params.collectionId!);
      const table = this.store.config.APP_TABLE;
      if (action === "create" || action === "archive") {
        const pk = `COLLECTIONREGISTRY#${pub.id}`;
        const registry = (await this.store.get<
          Entity & { revision: number; ids: string[] }
        >(pk)) ?? { pk, sk: "META", revision: 0, ids: [] };
        const col =
          action === "create"
            ? {
                ...collectionInput.parse(body),
                id: randomUUID(),
                publicationId: pub.id,
                revision: 1,
                status: "active" as const,
              }
            : await this.collection(pub, params.collectionId!);
        if (
          action === "archive" &&
          siteRevision.parse(body.revision) !== col.revision
        )
          throw new AppError(
            409,
            "Collection changed; reload before continuing",
          );
        if (action === "create" && registry.ids.length >= 20)
          throw new AppError(
            422,
            "A publication supports up to 20 active collections",
          );
        const result =
          action === "archive"
            ? {
                ...col,
                status: "archived" as const,
                revision: col.revision + 1,
              }
            : col;
        const next = {
          ...registry,
          revision: registry.revision + 1,
          ids:
            action === "create"
              ? [...registry.ids, col.id]
              : registry.ids.filter((v) => v !== col.id),
        };
        const row = {
          ...result,
          pk: collectionKey(pub.id, col.id),
          sk: "META",
          scope: `collections#${pub.id}`,
          sort: col.id,
        };
        return newsletterCommit(
          this.store,
          [
            this.guard(pub),
            registry.revision
              ? replaceRevision(this.store, next, registry.revision)
              : this.store.create(next),
            action === "create"
              ? this.store.create(row)
              : replaceRevision(this.store, row, col.revision),
            ...(action === "create"
              ? [
                  reserveNewsletterSlug(
                    this.store,
                    `COLLECTIONSLUG#${pub.id}#${col.slug}`,
                    col.id,
                  ),
                ]
              : []),
          ],
          result,
          commit,
        );
      }
      const col = await this.collection(pub, params.collectionId!, true),
        input = collectionUpdateInput.parse(body);
      if (input.revision !== col.revision)
        throw new AppError(409, "Collection changed; reload before continuing");
      const result = {
        ...col,
        name: input.name,
        description: input.description,
        revision: col.revision + 1,
      };
      return newsletterCommit(
        this.store,
        [
          this.guard(pub),
          replaceRevision(
            this.store,
            {
              ...result,
              pk: collectionKey(pub.id, col.id),
              sk: "META",
              scope: `collections#${pub.id}`,
              sort: col.id,
            },
            col.revision,
          ),
        ],
        result,
        commit,
      );
    }
    if (!issue) throw new AppError(404, "Issue not found");
    if (action === "get") return this.classification(issue);
    const input = z
      .object({
        revision: siteRevision,
        issueRevision: siteRevision,
        collectionIds: collectionIdsInput,
      })
      .strict()
      .parse(body);
    if (
      input.revision !== (issue.collectionRevision ?? 0) ||
      input.issueRevision !== issue.revision
    )
      throw new AppError(
        409,
        "Issue collections changed; reload before continuing",
      );
    const guards = [];
    for (const cid of input.collectionIds) {
      const col = await this.collection(pub, cid, true);
      guards.push(
        this.guard({ ...col, pk: collectionKey(pub.id, cid), sk: "META" }),
      );
    }
    const next = {
      ...issue,
      collectionIds: input.collectionIds,
      collectionRevision: input.revision + 1,
      revision: issue.revision + 1,
    };
    const removed = (issue.collectionIds ?? [])
      .filter((cid) => !input.collectionIds.includes(cid))
      .map((cid) => ({
        Delete: {
          TableName: this.store.config.APP_TABLE,
          Key: {
            pk: `COLLECTIONISSUE#${pub.id}#${cid}#${issue.id}`,
            sk: "META",
          },
        },
      }));
    return newsletterCommit(
      this.store,
      [
        this.guard(pub),
        replaceRevision(this.store, next, issue.revision),
        ...guards,
        ...removed,
        ...collectionEdgeWrites(this.store, next),
      ],
      this.classification(next),
      commit,
    );
  }
  async publicIssue(pub: Publication, issueId: string) {
    const issue = await this.store.get<Issue>(`ISSUE#${issueId}`);
    if (
      !issue ||
      issue.publicationId !== pub.id ||
      issue.deletedAt ||
      !issue.publicVersionId
    )
      return;
    const version = await this.runtime.issues.version(issue.publicVersionId);
    if (version.publicationId !== pub.id || version.issueId !== issue.id)
      return;
    return {
      id: issue.id,
      title: version.draft.title,
      subtitle: version.draft.subtitle,
      slug: version.draft.slug,
      publishedAt: issue.publishedAt,
      coverAssetId: version.draft.coverAssetId,
      coverAlt: version.draft.coverAlt,
    };
  }
  async collectionIssues(pub: Publication, cid: string, query: unknown = {}) {
    await this.collection(pub, cid, true);
    const page = await new ProductPagination(this.store).records<Entity>(
      `collection-issues#${pub.id}#${cid}`,
      "COLLECTIONISSUE#",
      query,
      async (row) => {
        const i = await this.store.get<Issue>(`ISSUE#${row.issueId}`);
        return (
          !!i &&
          i.publicationId === pub.id &&
          !i.deletedAt &&
          !!i.publicVersionId &&
          !!i.collectionIds?.includes(cid)
        );
      },
    );
    const data = [];
    for (const row of page.data) {
      const card = await this.publicIssue(pub, String(row.issueId));
      if (card) data.push(card);
    }
    return { ...page, data };
  }
}
