import { Injectable } from '@nestjs/common';
import { Socket } from 'node:net';

import { ConfigurationService } from '../../config/configuration';

@Injectable()
export class DependencyProbeService {
  constructor(private readonly configuration: ConfigurationService) {}

  async probeMl(): Promise<boolean> {
    try {
      const url = new URL('/health', this.configuration.values.dependencies.mlInternalUrl);
      const response = await fetch(url, {
        method: 'GET',
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(this.configuration.values.dependencies.httpTimeoutMs),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  probeLiveKit(): Promise<boolean> {
    const url = new URL(this.configuration.values.dependencies.liveKitUrl);
    const port = Number(url.port || (url.protocol === 'wss:' ? 443 : 80));
    const timeout = this.configuration.values.dependencies.webSocketTimeoutMs;
    return new Promise((resolve) => {
      const socket = new Socket();
      let settled = false;
      const finish = (ready: boolean): void => {
        if (settled) return;
        settled = true;
        socket.destroy();
        resolve(ready);
      };
      socket.setTimeout(timeout, () => finish(false));
      socket.once('error', () => finish(false));
      socket.connect(port, url.hostname, () => finish(true));
    });
  }
}
