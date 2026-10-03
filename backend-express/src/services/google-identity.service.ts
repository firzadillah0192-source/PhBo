import { OAuth2Client } from 'google-auth-library';
import { AppError } from '../lib/errors.js';
export type GoogleClaims = { subject: string; email: string; name: string | null; avatar_url: string | null };
export type GoogleVerifier = { verify(token: string): Promise<GoogleClaims> };
export class GoogleIdentityService implements GoogleVerifier {
  constructor(private readonly clientId: string, private readonly client = new OAuth2Client()) {}
  async verify(token: string): Promise<GoogleClaims> {
    try {
      if (!this.clientId.trim()) throw new Error();
      const ticket = await this.client.verifyIdToken({ idToken: token, audience: this.clientId.trim() });
      const claims = ticket.getPayload();
      if (!claims || !['accounts.google.com', 'https://accounts.google.com'].includes(claims.iss)
        || !claims.sub?.trim() || !claims.email?.includes('@') || ![true, 'true', '1'].includes(claims.email_verified as never)) throw new Error();
      return { subject: claims.sub.trim(), email: claims.email.trim().toLowerCase(), name: claims.name?.trim() || null, avatar_url: claims.picture?.trim() || null };
    } catch { throw new AppError(401, 'GOOGLE_TOKEN_INVALID', 'Google sign-in could not be verified.'); }
  }
}
