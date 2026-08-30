import { Injectable } from '@nestjs/common';

import { EvidenceMode, RiskDecisionMode } from '../../generated/prisma/client';
import { ConfigurationService } from '../../config/configuration';
import type { RiskPolicyDocumentV1 } from './risk-policy';

export interface ProductionEvidenceStatus {
  evidenceMode: EvidenceMode;
  sufficientEvidence: boolean;
  allScoresCalibrated: boolean;
  calibrationVersions: ReadonlySet<string>;
  allModelsActiveAndTraceable: boolean;
}

export interface RiskActivationDecision {
  decisionMode: RiskDecisionMode;
  productionEligible: boolean;
  activationSuppressed: boolean;
  blockerCodes: string[];
}

@Injectable()
export class RiskActivationGateService {
  constructor(private readonly configuration: ConfigurationService) {}

  evaluate(
    policy: RiskPolicyDocumentV1,
    evidence: ProductionEvidenceStatus,
  ): RiskActivationDecision {
    const blockers: string[] = [];
    const configured = this.configuration.values.risk;
    if (configured.interventionMode !== 'PRODUCTION') blockers.push('ENGINEERING_ONLY_MODE');
    if (configured.phaseOScientificStatus !== 'PROMOTED') {
      blockers.push('PHASE_O_SCIENTIFIC_CALIBRATION_BLOCKED');
    }
    if (configured.phasePProductionStatus !== 'PROMOTED') {
      blockers.push('PHASE_P_NOT_PRODUCTION_PROMOTED');
    }
    if (configured.phaseQProductionStatus !== 'PROMOTED') {
      blockers.push('PHASE_Q_ENGINEERING_ONLY');
    }
    if (policy.activationMode !== 'PRODUCTION') blockers.push('POLICY_ENGINEERING_ONLY');
    if (policy.thresholdClassification !== 'PROMOTED_CALIBRATION') {
      blockers.push('THRESHOLDS_NOT_PROMOTED');
    }
    if (evidence.evidenceMode !== EvidenceMode.CALIBRATED) {
      blockers.push('EVIDENCE_NOT_CALIBRATED_MODE');
    }
    if (!evidence.sufficientEvidence) blockers.push('INSUFFICIENT_EVIDENCE');
    if (!evidence.allScoresCalibrated) blockers.push('CALIBRATED_SCORE_MISSING');
    if (!evidence.allModelsActiveAndTraceable) blockers.push('MODEL_TRACE_NOT_ACTIVE');
    if (
      policy.calibrationVersion === null ||
      evidence.calibrationVersions.size !== 1 ||
      !evidence.calibrationVersions.has(policy.calibrationVersion)
    ) {
      blockers.push('CALIBRATION_VERSION_MISMATCH');
    }
    const productionEligible = blockers.length === 0;
    const decisionMode = productionEligible
      ? RiskDecisionMode.PRODUCTION_ELIGIBLE
      : evidence.evidenceMode === EvidenceMode.SIMULATED
        ? RiskDecisionMode.ENGINEERING_TEST
        : evidence.evidenceMode === EvidenceMode.SHADOW
          ? RiskDecisionMode.SHADOW
          : RiskDecisionMode.CALIBRATED_BLOCKED;
    return {
      decisionMode,
      productionEligible,
      activationSuppressed: !productionEligible,
      blockerCodes: blockers,
    };
  }
}
