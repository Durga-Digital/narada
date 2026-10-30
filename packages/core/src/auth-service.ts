/** Narada's server-side auth boundary. Vendor plugin types stay in the adapter. */
export interface AuthUser {
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
  createdAt: Date;
  updatedAt: Date;
  image?: string | null;
}
export interface AuthSession {
  user: AuthUser;
  session: {
    id: string;
    userId: string;
    token: string;
    expiresAt: Date;
    createdAt: Date;
    updatedAt: Date;
    ipAddress?: string | null;
    userAgent?: string | null;
  };
}
export interface AuthWhere {
  field: string;
  value: string | number | boolean | null;
}
export interface AuthAdapter {
  findOne<T>(input: { model: string; where: AuthWhere[] }): Promise<T | null>;
  update<T>(input: {
    model: string;
    where: AuthWhere[];
    update: Record<string, unknown>;
  }): Promise<T | null>;
  delete(input: { model: string; where: AuthWhere[] }): Promise<void>;
}
export interface AccessTokenClaims {
  sub?: string;
  iss?: string;
  aud?: string | string[];
  exp?: number;
  iat?: number;
  nbf?: number;
  jti?: string;
  [claim: string]: unknown;
}
export interface AuthService {
  handler(request: Request): Promise<Response>;
  api: {
    getSession(input: { headers: Headers }): Promise<AuthSession | null>;
    signUpEmail(input: {
      body: { name: string; email: string; password: string };
    }): Promise<{ user: AuthUser; token: string | null }>;
    getOAuthClientPublic(input: {
      headers: Headers;
      query: { client_id: string };
    }): Promise<{ client_name?: string | null }>;
    createOAuthClient(input: {
      headers: Headers;
      body: {
        client_name: string;
        application_type: "native" | "web";
        redirect_uris: string[];
        token_endpoint_auth_method: "none";
        grant_types: ("authorization_code" | "refresh_token")[];
        response_types: "code"[];
        scope: string;
      };
    }): Promise<{ client_id: string; client_secret?: string }>;
    getOAuthConsents(input: {
      headers: Headers;
    }): Promise<{ id: string; clientId: string }[]>;
    deleteOAuthConsent(input: {
      headers: Headers;
      body: { id: string };
    }): Promise<void>;
    adminUpdateOAuthResource(input: {
      headers: Headers;
      params: { identifier: string };
      body: { accessTokenTtl: number };
    }): Promise<unknown>;
  };
  $context: Promise<{
    adapter: AuthAdapter;
    internalAdapter: {
      findUserByEmail(email: string): Promise<{ user: AuthUser } | null>;
    };
  }>;
  options: {
    emailAndPassword?: {
      onPasswordReset?: (input: { user: { id: string } }) => Promise<void>;
    };
  };
  /** Uses the configured provider's signature, issuer, audience and DPoP checks. */
  protectMcp(
    handler: (request: Request, claims: AccessTokenClaims) => Promise<Response>,
    options: { resource: string; challengeScopes: readonly string[] },
  ): (request: Request) => Promise<Response>;
}
