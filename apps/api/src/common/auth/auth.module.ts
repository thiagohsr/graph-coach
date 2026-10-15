import { Global, Module } from '@nestjs/common';
import { ConfigModule, ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { CLOCK, type Clock } from '../clock';
import { CognitoTokenVerifier } from './cognito-token-verifier';
import { DevTokenVerifier } from './dev-token-verifier';
import { TOKEN_VERIFIER, type TokenVerifier } from './token-verifier';

/** Global. Provides TOKEN_VERIFIER by AUTH_MODE. Makes no network call at start (the key set is fetched on first use). */
@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: TOKEN_VERIFIER,
      inject: [ENV, CLOCK],
      useFactory: (env: Env, clock: Clock): TokenVerifier =>
        env.auth.mode === 'cognito'
          ? new CognitoTokenVerifier({
              issuer: env.auth.issuer,
              clientId: env.auth.clientId,
              jwks: { uri: env.auth.jwksUri },
              clock,
            })
          : new DevTokenVerifier({ secret: env.auth.jwtSecret, clock }),
    },
  ],
  exports: [TOKEN_VERIFIER],
})
export class AuthModule {}
