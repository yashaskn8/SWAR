import { Module } from '@nestjs/common';

import { BackendMaintenanceService } from './backend-maintenance.service';

@Module({
  providers: [BackendMaintenanceService],
  exports: [BackendMaintenanceService],
})
export class MaintenanceModule {}
