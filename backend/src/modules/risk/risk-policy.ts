import { InterventionType } from '../../generated/prisma/client';

export type RiskPolicyActivationMode = 'ENGINEERING_ONLY' | 'PRODUCTION';
export type ThresholdClassification = 'ENGINEERING_FIXTURE_NOT_CALIBRATED' | 'PROMOTED_CALIBRATION';

export interface RiskPolicyDocumentV1 {
  schemaVersion: '1.0.0';
  activationMode: RiskPolicyActivationMode;
  thresholdClassification: ThresholdClassification;
  thresholdVersion: string;
  calibrationVersion: string | null;
  quality: {
    minimumScore: number;
    minimumSpeechDurationMs: number;
    rejectingReasonCodes: string[];
  };
  thresholds: {
    identityEnter: number;
    identityClear: number;
    spoofEnter: number;
    spoofClear: number;
  };
  fusion: {
    fastWeight: number;
    deepWeight: number;
  };
  hysteresis: {
    entryConsecutiveWindows: number;
    clearConsecutiveWindows: number;
    maximumWindowGap: number;
  };
  interventions: {
    highRisk: InterventionType[];
    critical: InterventionType[];
  };
}

export class RiskPolicyValidationError extends Error {
  readonly code = 'RISK_POLICY_INVALID';

  constructor() {
    super('The versioned risk policy document is invalid.');
    this.name = 'RiskPolicyValidationError';
  }
}

function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new RiskPolicyValidationError();
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new RiskPolicyValidationError();
}

function number(value: unknown, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new RiskPolicyValidationError();
  }
  return value;
}

function integer(value: unknown, minimum: number, maximum: number): number {
  const parsed = number(value, minimum, maximum);
  if (!Number.isInteger(parsed)) throw new RiskPolicyValidationError();
  return parsed;
}

function text(value: unknown, maximum: number): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximum) {
    throw new RiskPolicyValidationError();
  }
  return value;
}

function interventions(value: unknown): InterventionType[] {
  const allowed = new Set<string>(Object.values(InterventionType));
  if (
    !Array.isArray(value) ||
    value.some((item) => typeof item !== 'string' || !allowed.has(item))
  ) {
    throw new RiskPolicyValidationError();
  }
  return [...new Set(value as InterventionType[])];
}

export function parseRiskPolicyDocument(value: unknown): RiskPolicyDocumentV1 {
  const root = object(value);
  exactKeys(root, [
    'schemaVersion',
    'activationMode',
    'thresholdClassification',
    'thresholdVersion',
    'calibrationVersion',
    'quality',
    'thresholds',
    'fusion',
    'hysteresis',
    'interventions',
  ]);
  if (root.schemaVersion !== '1.0.0') throw new RiskPolicyValidationError();
  if (!['ENGINEERING_ONLY', 'PRODUCTION'].includes(String(root.activationMode))) {
    throw new RiskPolicyValidationError();
  }
  if (
    !['ENGINEERING_FIXTURE_NOT_CALIBRATED', 'PROMOTED_CALIBRATION'].includes(
      String(root.thresholdClassification),
    )
  ) {
    throw new RiskPolicyValidationError();
  }
  const quality = object(root.quality);
  exactKeys(quality, ['minimumScore', 'minimumSpeechDurationMs', 'rejectingReasonCodes']);
  if (
    !Array.isArray(quality.rejectingReasonCodes) ||
    quality.rejectingReasonCodes.some((item) => typeof item !== 'string' || item.length > 80)
  ) {
    throw new RiskPolicyValidationError();
  }
  const thresholds = object(root.thresholds);
  exactKeys(thresholds, ['identityEnter', 'identityClear', 'spoofEnter', 'spoofClear']);
  const fusion = object(root.fusion);
  exactKeys(fusion, ['fastWeight', 'deepWeight']);
  const fastWeight = number(fusion.fastWeight, 0, 1);
  const deepWeight = number(fusion.deepWeight, 0, 1);
  if (Math.abs(fastWeight + deepWeight - 1) > Number.EPSILON * 8) {
    throw new RiskPolicyValidationError();
  }
  const hysteresis = object(root.hysteresis);
  exactKeys(hysteresis, ['entryConsecutiveWindows', 'clearConsecutiveWindows', 'maximumWindowGap']);
  const configuredInterventions = object(root.interventions);
  exactKeys(configuredInterventions, ['highRisk', 'critical']);
  const activationMode = root.activationMode as RiskPolicyActivationMode;
  const thresholdClassification = root.thresholdClassification as ThresholdClassification;
  const calibrationVersion =
    root.calibrationVersion === null ? null : text(root.calibrationVersion, 80);
  if (
    (activationMode === 'PRODUCTION' || thresholdClassification === 'PROMOTED_CALIBRATION') &&
    (activationMode !== 'PRODUCTION' ||
      thresholdClassification !== 'PROMOTED_CALIBRATION' ||
      calibrationVersion === null)
  ) {
    throw new RiskPolicyValidationError();
  }
  return {
    schemaVersion: '1.0.0',
    activationMode,
    thresholdClassification,
    thresholdVersion: text(root.thresholdVersion, 80),
    calibrationVersion,
    quality: {
      minimumScore: number(quality.minimumScore, 0, 1),
      minimumSpeechDurationMs: integer(quality.minimumSpeechDurationMs, 0, 300_000),
      rejectingReasonCodes: [...new Set(quality.rejectingReasonCodes as string[])],
    },
    thresholds: {
      identityEnter: number(thresholds.identityEnter, 0, 1),
      identityClear: number(thresholds.identityClear, 0, 1),
      spoofEnter: number(thresholds.spoofEnter, 0, 1),
      spoofClear: number(thresholds.spoofClear, 0, 1),
    },
    fusion: { fastWeight, deepWeight },
    hysteresis: {
      entryConsecutiveWindows: integer(hysteresis.entryConsecutiveWindows, 1, 100),
      clearConsecutiveWindows: integer(hysteresis.clearConsecutiveWindows, 1, 100),
      maximumWindowGap: integer(hysteresis.maximumWindowGap, 0, 10_000),
    },
    interventions: {
      highRisk: interventions(configuredInterventions.highRisk),
      critical: interventions(configuredInterventions.critical),
    },
  };
}
