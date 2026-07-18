import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { GoogleSessionGuard } from './google-session.guard';

@Module({
  controllers: [AuthController],
  providers: [AuthService, GoogleSessionGuard],
  exports: [AuthService, GoogleSessionGuard],
})
export class AuthModule {}
