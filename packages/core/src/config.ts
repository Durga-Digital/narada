import { z } from "zod";

const origin = z.url().refine((value) => {
  const url = new URL(value);
  return (
    ["http:", "https:"].includes(url.protocol) &&
    url.origin === value &&
    !url.username &&
    !url.password
  );
}, "Use a canonical HTTP(S) origin without a path or trailing slash");
const schema = z.object({
  API_ORIGIN: origin.optional(),
  DASHBOARD_ORIGIN: origin.optional(),
  PUBLIC_ORIGIN: origin.optional(),
  ASSET_ORIGIN: origin.optional(),
  // Pin to the previous auth origin before moving the issuer. Never rotate with a host.
  NARADA_INSTALLATION_ID: z.string().min(1).max(256).optional(),
  ACTIVITY_RETENTION_DAYS: z.coerce.number().int().min(1).max(3650).default(90),
  PUBLICATION_SITE_ORIGIN: z.url().optional(),
  PUBLICATION_SITE_FUNCTION_ARN: z.string().optional(),
  PUBLICATION_DOMAIN_ENVIRONMENT: z
    .string()
    .regex(/^[a-z0-9-]{1,40}$/)
    .default("local"),
  PUBLICATION_DOMAIN_ACCOUNT: z
    .string()
    .regex(/^\d{12}$/)
    .optional(),
  PUBLICATION_DOMAIN_LIMIT: z.coerce.number().int().min(1).max(100).default(5),
  MEDIA_BUCKET: z.string().optional(),
  MEDIA_DIRECTORY: z.string().optional(),
  NARADA_MODE: z.enum(["local", "aws"]).default("local"),
  AWS_REGION: z.string().default("us-east-1"),
  APP_TABLE: z.string().default("narada-local-app"),
  AUTH_TABLE: z.string().default("narada-local-auth"),
  DYNAMODB_ENDPOINT: z.url().optional(),
  SQS_ENDPOINT: z.url().optional(),
  WORK_QUEUE_URL: z.string().optional(),
  EVENT_QUEUE_URL: z.string().optional(),
  BETTER_AUTH_URL: z.url().default("http://localhost:5173"),
  BETTER_AUTH_SECRET: z.string().min(32),
  SMTP_HOST: z.string().default("127.0.0.1"),
  SMTP_PORT: z.coerce.number().default(1025),
  AUTH_FROM: z.string().default("Narada <auth@narada.test>"),
  SES_CONFIGURATION_SET: z.string().default("narada"),
  OWNER_EMAIL: z.email().default("owner@narada.test"),
});
export type Config = z.infer<typeof schema>;
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const config = schema.parse(env);
  if (config.NARADA_MODE === "local") {
    config.DYNAMODB_ENDPOINT ??= "http://127.0.0.1:8000";
    config.SQS_ENDPOINT ??= "http://127.0.0.1:9324";
    for (const endpoint of [config.DYNAMODB_ENDPOINT, config.SQS_ENDPOINT]) {
      if (
        !["localhost", "127.0.0.1", "dynamodb", "queue"].includes(
          new URL(endpoint).hostname,
        )
      ) {
        throw new Error("Local mode refuses non-local AWS endpoints");
      }
    }
    if (!["localhost", "127.0.0.1", "mail"].includes(config.SMTP_HOST))
      throw new Error("Local mode refuses external SMTP");
  } else if (config.DYNAMODB_ENDPOINT || config.SQS_ENDPOINT) {
    throw new Error("AWS mode refuses local endpoint overrides");
  }
  return config;
}
export function awsOptions(config: Config) {
  return {
    region: config.AWS_REGION,
    ...(config.NARADA_MODE === "local"
      ? {
          credentials: {
            accessKeyId: "naradalocal",
            secretAccessKey: "naradalocal",
          },
        }
      : {}),
  };
}
