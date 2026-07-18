import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { GoogleSessionGuard } from './google-session.guard';
import { EditAccessGuard, ReelsReadGuard } from './edit-access.guard';

@Module({
  controllers: [AuthController],
  providers: [AuthService, GoogleSessionGuard, EditAccessGuard, ReelsReadGuard],
  exports: [AuthService, GoogleSessionGuard, EditAccessGuard, ReelsReadGuard],
})
export class AuthModule {}
