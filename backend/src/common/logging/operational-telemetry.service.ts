import { Injectable } from '@nestjs/common';

type Labels = Record<string, string>;

const metricNamePattern = /^swar_backend_[a-z0-9_]+$/u;
const labelNamePattern = /^[a-z][a-z0-9_]*$/u;
const labelValuePattern = /^[A-Za-z0-9_.-]{1,80}$/u;

function key(name: string, labels: Labels): string {
  const normalized = Object.entries(labels).sort(([left], [right]) => left.localeCompare(right));
  return JSON.stringify([name, normalized]);
}

@Injectable()
export class OperationalTelemetryService {
  private readonly counters = new Map<string, { name: string; labels: Labels; value: number }>();
  private readonly gauges = new Map<string, { name: string; labels: Labels; value: number }>();

  increment(name: string, labels: Labels = {}, amount = 1): void {
    this.assertSafe(name, labels);
    const metricKey = key(name, labels);
    const current = this.counters.get(metricKey);
    this.counters.set(metricKey, { name, labels, value: (current?.value ?? 0) + amount });
  }

  gauge(name: string, value: number, labels: Labels = {}): void {
    this.assertSafe(name, labels);
    if (!Number.isFinite(value) || value < 0) throw new Error('Operational gauge is invalid.');
    this.gauges.set(key(name, labels), { name, labels, value });
  }

  renderPrometheus(): string {
    return [...this.counters.values(), ...this.gauges.values()]
      .sort((left, right) =>
        key(left.name, left.labels).localeCompare(key(right.name, right.labels)),
      )
      .map(({ name, labels, value }) => {
        const entries = Object.entries(labels).sort(([left], [right]) => left.localeCompare(right));
        const suffix = entries.length
          ? `{${entries.map(([label, labelValue]) => `${label}="${labelValue}"`).join(',')}}`
          : '';
        return `${name}${suffix} ${value.toString()}`;
      })
      .join('\n')
      .concat('\n');
  }

  private assertSafe(name: string, labels: Labels): void {
    if (!metricNamePattern.test(name)) throw new Error('Operational metric name is invalid.');
    for (const [label, value] of Object.entries(labels)) {
      if (!labelNamePattern.test(label) || !labelValuePattern.test(value)) {
        throw new Error('Operational metric label is invalid.');
      }
    }
  }
}
