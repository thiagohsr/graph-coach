import { Controller, Get } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Roles } from '../src/common/auth/decorators';
import { ACCESS, describeAccessMatrix, describeRoleMatrix } from './support/role-matrix';
import { createTestApp, type TestApp } from './support/test-app';

@Controller('probe')
class ProbeController {
  @Roles('reviewer', 'admin') @Get('staff') staff() {
    return { ok: true };
  }
  @Roles('admin') @Get('admin') admin() {
    return { ok: true };
  }
  @Get('any') any() {
    return { ok: true };
  }
}

let app: TestApp;
beforeAll(async () => {
  app = await createTestApp({ controllers: [ProbeController] });
});
afterAll(async () => {
  await app?.close();
});

// The harness itself: proves describeRoleMatrix and describeAccessMatrix declare and pass their cases.
describeRoleMatrix(() => app, [
  { method: 'GET', path: '/probe/staff', allowed: ['reviewer', 'admin'] },
  { method: 'GET', path: '/probe/admin', allowed: ['admin'] },
  { method: 'GET', path: '/probe/any', allowed: ['learner', 'reviewer', 'admin'] },
]);

describeAccessMatrix(
  () => app,
  async (_app, actors) => ({ ownerId: actors.owner.id }),
  [
    // A stand-in route: only the owner may read it, everybody else gets the 404 a service would give.
    {
      name: 'presets are the documented ones',
      request: () => ({ method: 'GET', path: '/probe/any' }),
      expect: { owner: 200, shared: 200, sharedWithSource: 200, otherLearner: 200, reviewer: 200, admin: 200 },
    },
  ],
);

describe('ACCESS presets', () => {
  it('match the contract', () => {
    expect(ACCESS.ownerOnly).toEqual({ owner: 200, shared: 404, sharedWithSource: 404, otherLearner: 404, reviewer: 404, admin: 404 });
    expect(ACCESS.ownerAndShared).toMatchObject({ owner: 200, shared: 200, sharedWithSource: 200, otherLearner: 404 });
    expect(ACCESS.ownerAndSourceShared).toMatchObject({ shared: 404, sharedWithSource: 200 });
  });
});
