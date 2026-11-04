import type { Request } from 'express';
import 'express-session';

export type AuthenticatedIdentity = {
  id: string;
  kind: 'HUMAN' | 'AGENT';
  mode: 'COOKIE' | 'BEARER';
  scopes: string[];
  ownerUserId?: string;
  ownerUsername?: string;
  agentName?: string;
  user?: {
    username: string;
    displayName: string;
    systemRole: 'ADMIN' | 'USER';
    mustChangePassword: boolean;
    credentialVersion: number;
  };
};
export interface ApiRequest extends Request {
  requestId: string;
  identity?: AuthenticatedIdentity;
}
declare module 'express-session' {
  interface SessionData {
    identity?: { principalId: string; credentialVersion: number; expiresAt: number };
    csrfToken?: string;
  }
}
