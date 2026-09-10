import * as oidc from "openid-client";

export type GoogleProfile = {
  subject: string;
  email: string;
  displayName: string;
};

type PendingAuthorization = {
  codeVerifier: string;
  nonce: string;
  createdAt: number;
};

export class GoogleOidcClient {
  private readonly pending = new Map<string, PendingAuthorization>();
  private configurationPromise: Promise<oidc.Configuration> | undefined;

  public constructor(
    private readonly options: {
      clientId: string;
      clientSecret: string;
      redirectUri: string;
      issuer?: string;
    },
  ) {}

  public async beginAuthorization(): Promise<{ state: string; url: URL }> {
    const configuration = await this.getConfiguration();
    const codeVerifier = oidc.randomPKCECodeVerifier();
    const codeChallenge = await oidc.calculatePKCECodeChallenge(codeVerifier);
    const state = oidc.randomState();
    const nonce = oidc.randomNonce();

    this.pending.set(state, { codeVerifier, nonce, createdAt: Date.now() });
    this.removeExpired();

    const url = oidc.buildAuthorizationUrl(configuration, {
      redirect_uri: this.options.redirectUri,
      scope: "openid email profile",
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      state,
      nonce,
    });
    return { state, url };
  }

  public async completeAuthorization(currentUrl: URL, state: string): Promise<GoogleProfile> {
    const pending = this.pending.get(state);
    if (!pending || Date.now() - pending.createdAt > 10 * 60 * 1000) {
      throw new Error("Google authorization state is invalid or expired");
    }

    const configuration = await this.getConfiguration();
    const tokens = await oidc.authorizationCodeGrant(configuration, currentUrl, {
      pkceCodeVerifier: pending.codeVerifier,
      expectedState: state,
      expectedNonce: pending.nonce,
    });
    this.pending.delete(state);

    const claims = tokens.claims();
    if (!claims?.sub || typeof claims.email !== "string" || claims.email_verified === false) {
      throw new Error("Google account did not provide a verified email");
    }

    return {
      subject: claims.sub,
      email: claims.email,
      displayName: typeof claims.name === "string" ? claims.name : claims.email,
    };
  }

  private async getConfiguration(): Promise<oidc.Configuration> {
    this.configurationPromise ??= oidc.discovery(
      new URL(this.options.issuer ?? "https://accounts.google.com"),
      this.options.clientId,
      this.options.clientSecret,
    );
    return this.configurationPromise;
  }

  private removeExpired(): void {
    const cutoff = Date.now() - 10 * 60 * 1000;
    for (const [state, pending] of this.pending) {
      if (pending.createdAt < cutoff) {
        this.pending.delete(state);
      }
    }
  }
}
