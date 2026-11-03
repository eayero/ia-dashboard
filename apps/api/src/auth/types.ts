import type { Request } from 'express';
import 'express-session';

export type AuthenticatedIdentity = {
  id: string;
  kind: 'HUMAN' | 'AGENT';
  mode: 'COOKIE' | 'BEARER';
  scopes: string[];
};
export interface ApiRequest extends Request {
  requestId: string;
  identity?: AuthenticatedIdentity;
}
declare module 'express-session' {
  interface SessionData {
    login?: { state: string; nonce: string; verifier: string; startedAt: number };
    identity?: { principalId: string; issuer: string; subject: string; expiresAt: number };
    csrfToken?: string;
  }
}
