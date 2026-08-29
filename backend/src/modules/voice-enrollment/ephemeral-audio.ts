import { DomainInputError } from '../domain/domain.errors';

export class EphemeralEnrollmentAudio {
  private samples: Uint8Array[];

  constructor(samples: readonly Uint8Array[]) {
    if (samples.length === 0 || samples.some((sample) => sample.byteLength === 0)) {
      throw new DomainInputError('Enrollment requires one or more non-empty audio samples.');
    }
    this.samples = samples.map((sample) => Uint8Array.from(sample));
  }

  view(): readonly Uint8Array[] {
    if (this.samples.length === 0)
      throw new DomainInputError('Enrollment audio was already cleared.');
    return this.samples;
  }

  clear(): void {
    for (const sample of this.samples) sample.fill(0);
    this.samples = [];
  }

  get cleared(): boolean {
    return this.samples.length === 0;
  }
}
