export const INTERNAL_SERVICE_AUTHENTICATOR = Symbol('INTERNAL_SERVICE_AUTHENTICATOR');
export const LIVEKIT_WEBHOOK_VERIFIER = Symbol('LIVEKIT_WEBHOOK_VERIFIER');

export interface InternalServiceAuthenticator {
  authenticate(authorization: string | undefined): Promise<{ serviceId: string }>;
}

export interface LiveKitWebhookVerifier {
  verify(authorization: string | undefined, rawBody: Buffer): Promise<{ eventId: string }>;
}
