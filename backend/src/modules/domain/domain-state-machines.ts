import {
  AlertStatus,
  AnalysisSessionStatus,
  CallStatus,
  ConsentStatus,
  InterventionStatus,
  TrackBindingStatus,
  VerificationStatus,
  VoiceprintStatus,
} from '../../generated/prisma/client';
import { IllegalDomainTransitionError } from './domain.errors';

type TransitionMap<T extends string> = Readonly<Record<T, ReadonlySet<T>>>;

export const callTransitions: TransitionMap<CallStatus> = {
  REQUESTED: new Set([CallStatus.AUTHORIZED, CallStatus.CANCELLED, CallStatus.FAILED]),
  AUTHORIZED: new Set([CallStatus.ACTIVE, CallStatus.CANCELLED, CallStatus.FAILED]),
  ACTIVE: new Set([CallStatus.ENDING, CallStatus.FAILED]),
  ENDING: new Set([CallStatus.ENDED, CallStatus.FAILED]),
  ENDED: new Set(),
  CANCELLED: new Set(),
  FAILED: new Set(),
};

export const consentTransitions: TransitionMap<ConsentStatus> = {
  GRANTED: new Set([ConsentStatus.REVOKED, ConsentStatus.EXPIRED]),
  REVOKED: new Set(),
  EXPIRED: new Set(),
};

export const voiceprintTransitions: TransitionMap<VoiceprintStatus> = {
  ENROLLING: new Set([VoiceprintStatus.ACTIVE, VoiceprintStatus.FAILED]),
  ACTIVE: new Set([VoiceprintStatus.REVOKED, VoiceprintStatus.DELETED]),
  REVOKED: new Set([VoiceprintStatus.DELETED]),
  FAILED: new Set([VoiceprintStatus.DELETED]),
  DELETED: new Set(),
};

export const trackBindingTransitions: TransitionMap<TrackBindingStatus> = {
  AUTHORIZED: new Set([
    TrackBindingStatus.ACTIVE,
    TrackBindingStatus.REJECTED,
    TrackBindingStatus.REVOKED,
  ]),
  ACTIVE: new Set([TrackBindingStatus.SUPERSEDED, TrackBindingStatus.REVOKED]),
  SUPERSEDED: new Set(),
  REVOKED: new Set(),
  REJECTED: new Set(),
};

export const analysisTransitions: TransitionMap<AnalysisSessionStatus> = {
  AUTHORIZED: new Set([
    AnalysisSessionStatus.STARTING,
    AnalysisSessionStatus.REVOKED,
    AnalysisSessionStatus.EXPIRED,
  ]),
  STARTING: new Set([
    AnalysisSessionStatus.ACTIVE,
    AnalysisSessionStatus.FAILED,
    AnalysisSessionStatus.REVOKED,
  ]),
  ACTIVE: new Set([
    AnalysisSessionStatus.DEGRADED,
    AnalysisSessionStatus.STOPPING,
    AnalysisSessionStatus.FAILED,
    AnalysisSessionStatus.EXPIRED,
    AnalysisSessionStatus.REVOKED,
  ]),
  DEGRADED: new Set([
    AnalysisSessionStatus.ACTIVE,
    AnalysisSessionStatus.STOPPING,
    AnalysisSessionStatus.FAILED,
    AnalysisSessionStatus.EXPIRED,
    AnalysisSessionStatus.REVOKED,
  ]),
  STOPPING: new Set([AnalysisSessionStatus.STOPPED, AnalysisSessionStatus.FAILED]),
  STOPPED: new Set(),
  FAILED: new Set(),
  EXPIRED: new Set(),
  REVOKED: new Set(),
};

export const interventionTransitions: TransitionMap<InterventionStatus> = {
  REQUIRED: new Set([
    InterventionStatus.ACKNOWLEDGED,
    InterventionStatus.IN_PROGRESS,
    InterventionStatus.EXPIRED,
    InterventionStatus.CANCELLED,
    InterventionStatus.FAILED,
  ]),
  ACKNOWLEDGED: new Set([
    InterventionStatus.IN_PROGRESS,
    InterventionStatus.EXPIRED,
    InterventionStatus.CANCELLED,
    InterventionStatus.FAILED,
  ]),
  IN_PROGRESS: new Set([
    InterventionStatus.SATISFIED,
    InterventionStatus.DECLINED,
    InterventionStatus.EXPIRED,
    InterventionStatus.FAILED,
  ]),
  SATISFIED: new Set(),
  DECLINED: new Set(),
  EXPIRED: new Set(),
  CANCELLED: new Set(),
  FAILED: new Set(),
};

export const verificationTransitions: TransitionMap<VerificationStatus> = {
  PENDING: new Set([
    VerificationStatus.PASSED,
    VerificationStatus.FAILED,
    VerificationStatus.EXPIRED,
    VerificationStatus.CANCELLED,
  ]),
  PASSED: new Set(),
  FAILED: new Set(),
  EXPIRED: new Set(),
  CANCELLED: new Set(),
};

export const alertTransitions: TransitionMap<AlertStatus> = {
  PENDING: new Set([AlertStatus.DELIVERED, AlertStatus.FAILED, AlertStatus.CANCELLED]),
  DELIVERED: new Set(),
  FAILED: new Set(),
  CANCELLED: new Set(),
};

export function assertTransition<T extends string>(
  aggregate: string,
  transitions: TransitionMap<T>,
  from: T,
  to: T,
): void {
  if (!transitions[from].has(to)) throw new IllegalDomainTransitionError(aggregate, from, to);
}
