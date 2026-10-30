import type * as T from "./types.js";
export type * from "./types.js";
export class NaradaError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly requestId?: string,
    readonly retryAfter?: number,
    readonly operationId?: string,
  ) {
    super(message);
    this.name = "NaradaError";
  }
}
export interface NaradaOptions {
  apiKey: string;
  baseUrl: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}
export interface RequestOptions {
  idempotencyKey?: string;
  signal?: AbortSignal;
}
function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 32768)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
  return btoa(binary);
}
const path = encodeURIComponent;
function query(
  options: T.ListOptions = {},
  status?: T.IssueStatus,
  collectionId?: string,
) {
  const params = new URLSearchParams();
  if (options.limit !== undefined) params.set("limit", String(options.limit));
  if (options.cursor) params.set("cursor", options.cursor);
  if (status) params.set("status", status);
  if (collectionId) params.set("collectionId", collectionId);
  return params.size ? `?${params}` : "";
}
/** Server-side client. Requests are never retried implicitly, including timeouts. */
export class Narada {
  approvals = {
    request: (input: T.SendApprovalRequest, options?: RequestOptions) =>
      this.request<T.SendApproval>("POST", "/approvals", input, options),
    list: (options?: T.ListOptions) =>
      this.request<T.Page<T.SendApproval>>(
        "GET",
        `/approvals${query(options)}`,
      ),
    get: (id: string) =>
      this.request<T.SendApproval>("GET", `/approvals/${path(id)}`),
  };
  sending = {
    get: () => this.request<T.SendingStatus>("GET", "/sending"),
    update: (
      input: { paused: boolean; revision: number },
      options?: RequestOptions,
    ) => this.request<T.SendingStatus>("PUT", "/sending", input, options),
    diagnostics: () => this.request<T.SesStatus>("GET", "/sending/diagnostics"),
  };
  metrics = {
    get: (options: T.MetricsOptions = {}) => {
      const params = new URLSearchParams();
      if (options.days !== undefined) params.set("days", String(options.days));
      if (options.domain !== undefined) params.set("domain", options.domain);
      return this.request<T.SendingMetrics>(
        "GET",
        `/metrics${params.size ? `?${params}` : ""}`,
      );
    },
  };
  integration = {
    guide: () => this.request<T.IntegrationGuide>("GET", "/integration/guide"),
  };
  resources = {
    search: (input: T.ResourceSearchOptions) => {
      const params = new URLSearchParams({
        kind: input.kind,
        text: input.text,
      });
      if (input.cursor !== undefined) params.set("cursor", input.cursor);
      if (input.limit !== undefined) params.set("limit", String(input.limit));
      return this.request<T.Page<T.ResourceReference>>(
        "GET",
        `/resources/search?${params}`,
      );
    },
  };
  domains = {
    create: (input: T.DomainRegistrationInput, options?: RequestOptions) =>
      this.request<T.SenderDomain>("POST", "/domains", input, options),
    updateMailFrom: (
      name: string,
      input: T.DomainMailFromInput,
      options?: RequestOptions,
    ) =>
      this.request<T.SenderDomain>(
        "PUT",
        `/domains/${path(name)}/mail-from`,
        input,
        options,
      ),
    enableDkim: (
      name: string,
      input: { revision: number },
      options?: RequestOptions,
    ) =>
      this.request<T.SenderDomain>(
        "POST",
        `/domains/${path(name)}/dkim`,
        input,
        options,
      ),
    list: (options?: T.ListOptions) =>
      this.request<T.Page<T.SenderDomain>>("GET", `/domains${query(options)}`),
    get: (name: string) =>
      this.request<T.SenderDomain>("GET", `/domains/${path(name)}`),
    refresh: (name: string, options?: RequestOptions) =>
      this.request<T.SenderDomain>(
        "POST",
        `/domains/${path(name)}/refresh`,
        undefined,
        options,
      ),
  };
  suppressions = {
    list: (options: T.SuppressionListOptions = {}) => {
      const suffix = query(options),
        params = new URLSearchParams(suffix);
      if (options.email !== undefined) params.set("email", options.email);
      return this.request<T.Page<T.Suppression>>(
        "GET",
        `/suppressions${params.size ? `?${params}` : ""}`,
      );
    },
    get: (email: string) =>
      this.request<T.Suppression>("GET", `/suppressions/${path(email)}`),
    create: (input: { email: string }, options?: RequestOptions) =>
      this.request<T.Suppression>("POST", "/suppressions", input, options),
    delete: (email: string, options?: RequestOptions) =>
      this.request<{ ok: true }>(
        "DELETE",
        `/suppressions/${path(email)}`,
        undefined,
        options,
      ),
  };
  webhooks = {
    events: () =>
      this.request<{
        data: {
          type: T.WebhookEventType;
          group: string;
          description: string;
        }[];
      }>("GET", "/webhooks/events"),
    list: (options?: T.ListOptions) =>
      this.request<T.Page<T.WebhookEndpoint>>(
        "GET",
        `/webhooks${query(options)}`,
      ),
    get: (id: string) =>
      this.request<T.WebhookEndpoint>("GET", `/webhooks/${path(id)}`),
    create: (input: T.WebhookInput, options?: RequestOptions) =>
      this.request<T.WebhookCreated>("POST", "/webhooks", input, options),
    update: (
      id: string,
      input: T.WebhookInput & { revision: number },
      options?: RequestOptions,
    ) =>
      this.request<T.WebhookEndpoint>(
        "PUT",
        `/webhooks/${path(id)}`,
        input,
        options,
      ),
    delete: (id: string, options?: RequestOptions) =>
      this.request<{ ok: true }>(
        "DELETE",
        `/webhooks/${path(id)}`,
        undefined,
        options,
      ),
    deliveries: {
      list: (options?: T.ListOptions) =>
        this.request<T.Page<T.WebhookDelivery>>(
          "GET",
          `/webhooks/deliveries${query(options)}`,
        ),
      get: (id: string, options?: T.ListOptions) =>
        this.request<T.WebhookHistory>(
          "GET",
          `/webhooks/deliveries/${path(id)}${query(options)}`,
        ),
      retry: (id: string, options?: RequestOptions) =>
        this.request<{ ok: true }>(
          "POST",
          `/webhooks/deliveries/${path(id)}/retry`,
          undefined,
          options,
        ),
    },
  };
  operations = {
    list: (options?: T.ListOptions) =>
      this.request<T.Page<T.OperationStatus>>(
        "GET",
        `/operations${query(options)}`,
      ),
    get: (id: string) =>
      this.request<T.OperationStatus>("GET", `/operations/${path(id)}`),
    lookup: (input: T.OperationLookup) =>
      this.request<T.OperationStatus>("POST", "/operations/lookup", input),
  };
  capabilities = () => this.request<T.Capabilities>("GET", "/capabilities");
  private readonly baseUrl: string;
  private readonly transport: typeof fetch;
  constructor(private readonly options: NaradaOptions) {
    const url = new URL(options.baseUrl);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error(
        "baseUrl must be an HTTP(S) origin or path without credentials, query, or fragment",
      );
    if (!options.apiKey) throw new Error("apiKey is required");
    if (
      options.timeoutMs !== undefined &&
      (!Number.isInteger(options.timeoutMs) || options.timeoutMs <= 0)
    )
      throw new Error("timeoutMs must be a positive integer");
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.transport = options.fetch ?? globalThis.fetch;
  }
  private async request<R>(
    method: string,
    endpoint: string,
    body?: unknown,
    options: RequestOptions = {},
  ): Promise<R> {
    const timeout = AbortSignal.timeout(this.options.timeoutMs ?? 30000);
    const response = await this.transport(`${this.baseUrl}/api/v1${endpoint}`, {
      method,
      redirect: "error",
      signal: options.signal
        ? AbortSignal.any([timeout, options.signal])
        : timeout,
      headers: {
        authorization: `Bearer ${this.options.apiKey}`,
        accept: "application/json",
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        ...(options.idempotencyKey !== undefined
          ? { "idempotency-key": options.idempotencyKey }
          : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const raw = await response.text();
    let data: unknown;
    try {
      data = raw ? JSON.parse(raw) : undefined;
    } catch {
      throw new NaradaError(
        `Narada returned a non-JSON response (HTTP ${response.status})`,
        response.status,
        "invalid_response",
        response.headers.get("x-request-id") ?? undefined,
      );
    }
    if (!response.ok) {
      const error = data as
        | {
            error?: string;
            code?: string;
            requestId?: string;
            operationId?: string;
          }
        | undefined;
      const retry = response.headers.get("retry-after");
      throw new NaradaError(
        typeof error?.error === "string"
          ? error.error
          : `Narada HTTP ${response.status}`,
        response.status,
        error?.code,
        error?.requestId ?? response.headers.get("x-request-id") ?? undefined,
        retry && /^\d+$/.test(retry) ? Number(retry) : undefined,
        error?.operationId ??
          response.headers.get("x-operation-id") ??
          undefined,
      );
    }
    return data as R;
  }
  /** Backward-compatible alias for emails.send. */
  send = (
    input: T.EmailInput | T.TemplateEmailInput,
    options: RequestOptions = {},
  ) => this.emails.send(input, options);
  forms = {
    list: (options?: T.ListOptions) =>
      this.request<T.Page<T.Form>>("GET", `/forms${query(options)}`),
    get: (id: string) => this.request<T.Form>("GET", `/forms/${path(id)}`),
    create: (input: T.FormInput, options: RequestOptions = {}) =>
      this.request<T.Form>("POST", "/forms", input, options),
    update: (
      id: string,
      input: { draft: T.FormInput; revision: number },
      options: RequestOptions = {},
    ) => this.request<T.Form>("PUT", `/forms/${path(id)}`, input, options),
    publish: (
      id: string,
      input: { revision: number },
      options: RequestOptions = {},
    ) =>
      this.request<T.Form>(
        "POST",
        `/forms/${path(id)}/publish`,
        input,
        options,
      ),
    close: (
      id: string,
      input: { revision: number },
      options: RequestOptions = {},
    ) =>
      this.request<T.Form>("POST", `/forms/${path(id)}/close`, input, options),
    preview: (id: string) =>
      this.request<T.FormPreview>("GET", `/forms/${path(id)}/preview`),
    responses: (id: string, options?: T.ListOptions) =>
      this.request<T.Page<T.FormResponseSummary>>(
        "GET",
        `/forms/${path(id)}/responses${query(options)}`,
      ),
    response: (id: string, responseId: string) =>
      this.request<T.FormResponseDetail>(
        "GET",
        `/forms/${path(id)}/responses/${path(responseId)}`,
      ),
    retryResponse: (
      id: string,
      responseId: string,
      options: RequestOptions = {},
    ) =>
      this.request<T.FormResponseSummary>(
        "POST",
        `/forms/${path(id)}/responses/${path(responseId)}/retry`,
        undefined,
        options,
      ),
    exportResponses: (id: string, options?: T.ListOptions) =>
      this.request<T.FormExport>(
        "GET",
        `/forms/${path(id)}/export${query(options)}`,
      ),
    createBroadcast: (id: string, options: RequestOptions = {}) =>
      this.request<T.Broadcast>(
        "POST",
        `/forms/${path(id)}/broadcasts`,
        undefined,
        options,
      ),
  };
  publications = {
    about: {
      get: (id: string) =>
        this.request<T.PublicationAbout>(
          "GET",
          `/publications/${path(id)}/about`,
        ),
      update: (
        id: string,
        input: { revision: number; draft: T.PublicationAboutInput },
        options?: RequestOptions,
      ) =>
        this.request<T.PublicationAbout>(
          "PUT",
          `/publications/${path(id)}/about`,
          input,
          options,
        ),
      preview: (
        id: string,
        input: { revision: number; draft?: T.PublicationAboutInput },
      ) =>
        this.request<{ html: string }>(
          "POST",
          `/publications/${path(id)}/about/preview`,
          input,
        ),
      publish: (
        id: string,
        input: { revision: number },
        options?: RequestOptions,
      ) =>
        this.request<T.PublicationAbout>(
          "POST",
          `/publications/${path(id)}/about/publish`,
          input,
          options,
        ),
      withdraw: (
        id: string,
        input: { revision: number },
        options?: RequestOptions,
      ) =>
        this.request<T.PublicationAbout>(
          "POST",
          `/publications/${path(id)}/about/withdraw`,
          input,
          options,
        ),
    },
    site: {
      get: (id: string) =>
        this.request<T.PublicationSite>(
          "GET",
          `/publications/${path(id)}/site`,
        ),
      update: (
        id: string,
        input: { revision: number; draft: T.PublicationSiteInput },
        options?: RequestOptions,
      ) =>
        this.request<T.PublicationSite>(
          "PUT",
          `/publications/${path(id)}/site`,
          input,
          options,
        ),
      preview: (
        id: string,
        input: { revision: number; draft?: T.PublicationSiteInput },
      ) =>
        this.request<{ html: string }>(
          "POST",
          `/publications/${path(id)}/site/preview`,
          input,
        ),
      publish: (
        id: string,
        input: { revision: number },
        options?: RequestOptions,
      ) =>
        this.request<T.PublicationSite>(
          "POST",
          `/publications/${path(id)}/site/publish`,
          input,
          options,
        ),
    },
    collections: {
      list: (id: string, input?: T.ListOptions) =>
        this.request<T.Page<T.EditorialCollection>>(
          "GET",
          `/publications/${path(id)}/collections${query(input)}`,
        ),
      create: (
        id: string,
        input: T.EditorialCollectionInput,
        options?: RequestOptions,
      ) =>
        this.request<T.EditorialCollection>(
          "POST",
          `/publications/${path(id)}/collections`,
          input,
          options,
        ),
      get: (id: string, collectionId: string) =>
        this.request<T.EditorialCollection>(
          "GET",
          `/publications/${path(id)}/collections/${path(collectionId)}`,
        ),
      update: (
        id: string,
        collectionId: string,
        input: { revision: number; name: string; description: string },
        options?: RequestOptions,
      ) =>
        this.request<T.EditorialCollection>(
          "PUT",
          `/publications/${path(id)}/collections/${path(collectionId)}`,
          input,
          options,
        ),
      archive: (
        id: string,
        collectionId: string,
        input: { revision: number },
        options?: RequestOptions,
      ) =>
        this.request<T.EditorialCollection>(
          "POST",
          `/publications/${path(id)}/collections/${path(collectionId)}/archive`,
          input,
          options,
        ),
    },
    assets: {
      upload: (
        id: string,
        input: T.PublicationLogoInput,
        options?: RequestOptions,
      ) =>
        this.request<T.PublicationLogo>(
          "POST",
          `/publications/${path(id)}/assets`,
          input,
          options,
        ),
    },
    domain: {
      get: (id: string) =>
        this.request<T.PublicationDomainResult>(
          "GET",
          `/publications/${path(id)}/domain`,
        ),
      configure: (
        id: string,
        input: T.PublicationDomainConfigureInput,
        options?: RequestOptions,
      ) =>
        this.request<T.PublicationDomainResult>(
          "PUT",
          `/publications/${path(id)}/domain`,
          input,
          options,
        ),
      check: (
        id: string,
        input: T.PublicationDomainRevisionInput,
        options?: RequestOptions,
      ) =>
        this.request<T.PublicationDomainResult>(
          "POST",
          `/publications/${path(id)}/domain/check`,
          input,
          options,
        ),
      activate: (
        id: string,
        input: T.PublicationDomainRevisionInput,
        options?: RequestOptions,
      ) =>
        this.request<T.PublicationDomainResult>(
          "POST",
          `/publications/${path(id)}/domain/activate`,
          input,
          options,
        ),
      disconnect: (
        id: string,
        input: T.PublicationDomainRevisionInput,
        options?: RequestOptions,
      ) =>
        this.request<T.PublicationDomainResult>(
          "POST",
          `/publications/${path(id)}/domain/disconnect`,
          input,
          options,
        ),
    },

    branding: {
      update: (
        id: string,
        input: { branding: T.PublicationBranding; revision: number },
        options: RequestOptions = {},
      ) =>
        this.request<T.Publication>(
          "PUT",
          `/publications/${path(id)}/branding`,
          input,
          options,
        ),
      preview: (
        id: string,
        input: { branding: T.PublicationBranding; revision: number },
      ) =>
        this.request<{ html: string }>(
          "POST",
          `/publications/${path(id)}/branding/preview`,
          input,
        ),
    },
    logo: {
      upload: (
        id: string,
        input: T.PublicationLogoInput,
        options: RequestOptions = {},
      ) =>
        this.request<T.PublicationLogo>(
          "POST",
          `/publications/${path(id)}/logo`,
          input,
          options,
        ),
      uploadBytes: (
        id: string,
        input: { fileName: string; bytes: Uint8Array },
        options: RequestOptions = {},
      ) => {
        if (input.bytes.byteLength > 512 * 1024)
          throw new Error("Logo must be at most 512 KiB");
        return this.request<T.PublicationLogo>(
          "POST",
          `/publications/${path(id)}/logo`,
          {
            fileName: input.fileName,
            contentBase64: encodeBase64(input.bytes),
          },
          options,
        );
      },
    },
    list: (options?: T.ListOptions) =>
      this.request<T.Page<T.Publication>>(
        "GET",
        `/publications${query(options)}`,
      ),
    get: (id: string) =>
      this.request<T.Publication>("GET", `/publications/${path(id)}`),
    create: (input: T.PublicationInput, options: RequestOptions = {}) =>
      this.request<T.Publication>("POST", "/publications", input, options),
    update: (
      id: string,
      input: { settings: T.PublicationInput; revision: number },
      options: RequestOptions = {},
    ) =>
      this.request<T.Publication>(
        "PUT",
        `/publications/${path(id)}`,
        input,
        options,
      ),
    activate: (
      id: string,
      input: { revision: number },
      options: RequestOptions = {},
    ) =>
      this.request<T.Publication>(
        "POST",
        `/publications/${path(id)}/activate`,
        input,
        options,
      ),
    archive: (
      id: string,
      input: { revision: number },
      options: RequestOptions = {},
    ) =>
      this.request<T.Publication>(
        "POST",
        `/publications/${path(id)}/archive`,
        input,
        options,
      ),
    preview: (id: string) =>
      this.request<{ html: string }>(
        "GET",
        `/publications/${path(id)}/preview`,
      ),
    subscribers: (id: string, options?: T.ListOptions) =>
      this.request<T.Page<T.Subscriber>>(
        "GET",
        `/publications/${path(id)}/subscribers${query(options)}`,
      ),
  };
  issues = {
    collections: {
      get: (id: string, issueId: string) =>
        this.request<T.IssueCollections>(
          "GET",
          `/publications/${path(id)}/issues/${path(issueId)}/collections`,
        ),
      update: (
        id: string,
        issueId: string,
        input: {
          revision: number;
          issueRevision: number;
          collectionIds: string[];
        },
        options?: RequestOptions,
      ) =>
        this.request<T.IssueCollections>(
          "PUT",
          `/publications/${path(id)}/issues/${path(issueId)}/collections`,
          input,
          options,
        ),
    },
    delete: (
      publicationId: string,
      id: string,
      input: { revision: number },
      options?: RequestOptions,
    ) =>
      this.request<T.IssueDeleteResult>(
        "DELETE",
        `/publications/${path(publicationId)}/issues/${path(id)}`,
        input,
        options,
      ),
    list: (publicationId: string, options?: T.IssueListOptions) =>
      this.request<T.Page<T.Issue>>(
        "GET",
        `/publications/${path(publicationId)}/issues${query(options, options?.status, options?.collectionId)}`,
      ),
    create: (
      publicationId: string,
      input: T.IssueInput,
      options: RequestOptions = {},
    ) =>
      this.request<T.Issue>(
        "POST",
        `/publications/${path(publicationId)}/issues`,
        input,
        options,
      ),
    get: (publicationId: string, id: string) =>
      this.request<T.Issue>(
        "GET",
        `/publications/${path(publicationId)}/issues/${path(id)}`,
      ),
    update: (
      publicationId: string,
      id: string,
      input: { draft: T.IssueInput; revision: number },
      options: RequestOptions = {},
    ) =>
      this.request<T.Issue>(
        "PUT",
        `/publications/${path(publicationId)}/issues/${path(id)}`,
        input,
        options,
      ),
    preview: (publicationId: string, id: string) =>
      this.request<T.IssuePreview>(
        "GET",
        `/publications/${path(publicationId)}/issues/${path(id)}/preview`,
      ),
    test: (
      publicationId: string,
      id: string,
      input: { to: string; revision: number },
      options: RequestOptions = {},
    ) =>
      this.request<T.EmailAccepted>(
        "POST",
        `/publications/${path(publicationId)}/issues/${path(id)}/test`,
        input,
        options,
      ),
    publish: (
      publicationId: string,
      id: string,
      input: T.IssuePublishInput,
      options: RequestOptions = {},
    ) =>
      this.request<T.Issue>(
        "POST",
        `/publications/${path(publicationId)}/issues/${path(id)}/publish`,
        input,
        options,
      ),
    cancel: (
      publicationId: string,
      id: string,
      input: { revision: number },
      options: RequestOptions = {},
    ) =>
      this.request<T.Issue>(
        "POST",
        `/publications/${path(publicationId)}/issues/${path(id)}/cancel`,
        input,
        options,
      ),
    withdraw: (
      publicationId: string,
      id: string,
      input: { revision: number },
      options: RequestOptions = {},
    ) =>
      this.request<T.Issue>(
        "POST",
        `/publications/${path(publicationId)}/issues/${path(id)}/withdraw`,
        input,
        options,
      ),
    duplicate: (
      publicationId: string,
      id: string,
      options: RequestOptions = {},
    ) =>
      this.request<T.Issue>(
        "POST",
        `/publications/${path(publicationId)}/issues/${path(id)}/duplicate`,
        undefined,
        options,
      ),
    delivery: (publicationId: string, id: string) =>
      this.request<T.IssueDelivery>(
        "GET",
        `/publications/${path(publicationId)}/issues/${path(id)}/delivery`,
      ),
    recipients: (publicationId: string, id: string, options?: T.ListOptions) =>
      this.request<T.Page<T.Recipient>>(
        "GET",
        `/publications/${path(publicationId)}/issues/${path(id)}/recipients${query(options)}`,
      ),
  };
  templates = {
    list: (options?: T.ListOptions) =>
      this.request<T.Page<T.Template>>("GET", `/templates${query(options)}`),
    get: (id: string) =>
      this.request<T.Template>("GET", `/templates/${path(id)}`),
    create: (
      input: T.TemplateContent & { alias: string },
      options: RequestOptions = {},
    ) => this.request<T.Template>("POST", "/templates", input, options),
    update: (
      id: string,
      input: { draft: T.TemplateContent; revision: number },
      options: RequestOptions = {},
    ) =>
      this.request<T.Template>("PUT", `/templates/${path(id)}`, input, options),
    publish: (
      id: string,
      input: { revision: number },
      options: RequestOptions = {},
    ) =>
      this.request<T.Template>(
        "POST",
        `/templates/${path(id)}/publish`,
        input,
        options,
      ),
    archive: (
      id: string,
      input: { archived: boolean; revision: number },
      options: RequestOptions = {},
    ) =>
      this.request<T.Template>(
        "POST",
        `/templates/${path(id)}/archive`,
        input,
        options,
      ),
    duplicate: (
      id: string,
      input: { alias: string },
      options: RequestOptions = {},
    ) =>
      this.request<T.Template>(
        "POST",
        `/templates/${path(id)}/duplicate`,
        input,
        options,
      ),
    preview: (id: string, input: T.TemplatePreviewInput = {}) =>
      this.request<{ subject: string; html: string; text: string }>(
        "POST",
        `/templates/${path(id)}/preview`,
        input,
      ),
    test: (
      id: string,
      input: {
        from: string;
        to: string;
        variables?: Record<string, T.PropertyValue>;
      },
      options: RequestOptions = {},
    ) =>
      this.request<T.EmailAccepted>(
        "POST",
        `/templates/${path(id)}/test`,
        input,
        options,
      ),
    createBroadcast: (
      id: string,
      input: T.TemplateBroadcastInput = {},
      options: RequestOptions = {},
    ) =>
      this.request<T.Broadcast>(
        "POST",
        `/templates/${path(id)}/broadcasts`,
        input,
        options,
      ),
  };
  emails = {
    send: (
      input: T.EmailInput | T.TemplateEmailInput,
      options: RequestOptions = {},
    ) => this.request<T.EmailAccepted>("POST", "/emails", input, options),
    get: (id: string) =>
      this.request<T.EmailStatus>("GET", `/emails/${path(id)}`),
  };
  contactProperties = {
    list: (options?: T.ListOptions) =>
      this.request<T.Page<T.Property>>("GET", `/properties${query(options)}`),
    get: (key: string) =>
      this.request<T.Property>("GET", `/properties/${path(key)}`),
    create: (input: T.PropertyInput, options: RequestOptions = {}) =>
      this.request<T.Property>("POST", "/properties", input, options),
    update: (
      key: string,
      input: { property: T.PropertyInput; revision: number },
      options: RequestOptions = {},
    ) =>
      this.request<T.Property>(
        "PUT",
        `/properties/${path(key)}`,
        input,
        options,
      ),
  };
  topics = {
    list: (options?: T.ListOptions) =>
      this.request<T.Page<T.Topic>>("GET", `/topics${query(options)}`),
    get: (id: string) => this.request<T.Topic>("GET", `/topics/${path(id)}`),
    create: (input: T.TopicInput, options: RequestOptions = {}) =>
      this.request<T.Topic>("POST", "/topics", input, options),
    update: (
      id: string,
      input: { topic: T.TopicInput; revision: number },
      options: RequestOptions = {},
    ) => this.request<T.Topic>("PUT", `/topics/${path(id)}`, input, options),
  };
  contacts = {
    list: (options?: T.ListOptions) =>
      this.request<T.Page<T.Contact>>("GET", `/contacts${query(options)}`),
    create: (input: T.ContactInput, options: RequestOptions = {}) =>
      this.request<T.Contact>("POST", "/contacts", input, options),
    get: (email: string) =>
      this.request<T.ContactDetails>("GET", `/contacts/${path(email)}`),
    update: (
      email: string,
      input: {
        contact: Omit<T.Contact, "email" | "revision" | "addedAt">;
        revision: number;
      },
      options: RequestOptions = {},
    ) =>
      this.request<T.Contact>(
        "PUT",
        `/contacts/${path(email)}`,
        input,
        options,
      ),
    patchProperties: (
      email: string,
      input: {
        properties: Record<string, T.PropertyValue | null>;
        revision: number;
      },
      options: RequestOptions = {},
    ) =>
      this.request<T.Contact>(
        "PATCH",
        `/contacts/${path(email)}/properties`,
        input,
        options,
      ),
    subscribe: (
      email: string,
      topicId: string,
      input: T.SubscriptionInput,
      options: RequestOptions = {},
    ) =>
      this.request<T.Ok>(
        "POST",
        `/contacts/${path(email)}/topics/${path(topicId)}`,
        input,
        options,
      ),
    unsubscribeTopic: (
      email: string,
      topicId: string,
      options: RequestOptions = {},
    ) =>
      this.request<T.Ok>(
        "POST",
        `/contacts/${path(email)}/topics/${path(topicId)}/unsubscribe`,
        undefined,
        options,
      ),
    unsubscribe: (email: string, options: RequestOptions = {}) =>
      this.request<T.Ok>(
        "POST",
        `/contacts/${path(email)}/unsubscribe`,
        undefined,
        options,
      ),
  };
  segments = {
    list: (options?: T.ListOptions) =>
      this.request<T.Page<T.Segment>>("GET", `/segments${query(options)}`),
    get: (id: string) =>
      this.request<T.Segment>("GET", `/segments/${path(id)}`),
    create: (input: T.SegmentInput, options: RequestOptions = {}) =>
      this.request<T.Segment>("POST", "/segments", input, options),
    update: (
      id: string,
      input: { segment: T.SegmentInput; revision: number },
      options: RequestOptions = {},
    ) =>
      this.request<T.Segment>("PUT", `/segments/${path(id)}`, input, options),
    contacts: (id: string, options?: T.ListOptions) =>
      this.request<T.Page<T.SegmentMember>>(
        "GET",
        `/segments/${path(id)}/contacts${query(options)}`,
      ),
    import: (id: string, input: T.ImportInput, options: RequestOptions = {}) =>
      this.request<{ added: number; duplicates: number; total: number }>(
        "POST",
        `/segments/${path(id)}/import`,
        input,
        options,
      ),
    removeContact: (id: string, email: string, options: RequestOptions = {}) =>
      this.request<T.Ok>(
        "DELETE",
        `/segments/${path(id)}/contacts/${path(email)}`,
        undefined,
        options,
      ),
    addContact: (
      id: string,
      email: string,
      input?: T.SegmentMembershipInput,
      options: RequestOptions = {},
    ) =>
      this.request<T.SegmentMember>(
        "POST",
        `/segments/${path(id)}/contacts/${path(email)}`,
        input,
        options,
      ),
  };
  broadcasts = {
    list: (options?: T.ListOptions) =>
      this.request<T.Page<T.Broadcast>>("GET", `/broadcasts${query(options)}`),
    get: (id: string) =>
      this.request<T.Broadcast>("GET", `/broadcasts/${path(id)}`),
    create: (input: T.BroadcastInput, options: RequestOptions = {}) =>
      this.request<T.Broadcast>("POST", "/broadcasts", input, options),
    update: (
      id: string,
      input: { draft: T.BroadcastInput; revision: number },
      options: RequestOptions = {},
    ) =>
      this.request<T.Broadcast>(
        "PUT",
        `/broadcasts/${path(id)}`,
        input,
        options,
      ),
    recipients: (id: string, options?: T.ListOptions) =>
      this.request<T.Page<T.Recipient>>(
        "GET",
        `/broadcasts/${path(id)}/recipients${query(options)}`,
      ),
    preview: (id: string, contact?: string) =>
      this.request<T.Preview>(
        "GET",
        `/broadcasts/${path(id)}/preview${contact ? `?contact=${path(contact)}` : ""}`,
      ),
    test: (
      id: string,
      input: { to: string; previewEmail?: string },
      options: RequestOptions = {},
    ) =>
      this.request<T.EmailAccepted>(
        "POST",
        `/broadcasts/${path(id)}/test`,
        input,
        options,
      ),
    send: (
      id: string,
      input: T.SendBroadcastInput,
      options: RequestOptions = {},
    ) =>
      this.request<T.Broadcast>(
        "POST",
        `/broadcasts/${path(id)}/send`,
        input,
        options,
      ),
    cancel: (id: string, options: RequestOptions = {}) =>
      this.request<T.Broadcast>(
        "POST",
        `/broadcasts/${path(id)}/cancel`,
        undefined,
        options,
      ),
    duplicate: (id: string, options: RequestOptions = {}) =>
      this.request<T.Broadcast>(
        "POST",
        `/broadcasts/${path(id)}/duplicate`,
        undefined,
        options,
      ),
  };
}
