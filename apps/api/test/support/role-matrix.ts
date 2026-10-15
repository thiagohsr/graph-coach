import { beforeAll, describe, expect, it } from 'vitest';
import type { Role } from '@coach/types';
import type { TestApp, TestUser } from './test-app';

export interface RouteCase {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  body?: unknown;
  allowed: Role[];
}

type Verb = 'get' | 'post' | 'put' | 'patch' | 'delete';

function send(app: TestApp, call: { method: RouteCase['method']; path: string; body?: unknown }) {
  const req = app.http[call.method.toLowerCase() as Verb](call.path);
  return call.body === undefined ? req : req.send(call.body as object);
}

const ROLES: Role[] = ['learner', 'reviewer', 'admin'];

/**
 * Role checks. One test per route and role: no token -> 401, expired token -> 401, role not in `allowed` -> 403,
 * a role in `allowed` is not refused by the guards (neither 401 nor 403), and a blocked caller -> 403 ACCOUNT_BLOCKED.
 */
export function describeRoleMatrix(getApp: () => TestApp, routes: RouteCase[]): void {
  const people = {} as Record<Role | 'blocked', TestUser>;
  let expired = '';

  beforeAll(async () => {
    const app = getApp();
    for (const role of ROLES) people[role] = await app.createUser({ role });
    people.blocked = await app.createUser({ role: 'learner' });
    await app.setStatus(people.blocked.id, 'blocked');
    expired = await app.expiredToken(people.learner.id);
  });

  for (const route of routes) {
    describe(`${route.method} ${route.path} roles`, () => {
      it('no token -> 401', async () => {
        const res = await send(getApp(), route);
        expect(res.status).toBe(401);
        expect(res.body.error.code).toBe('UNAUTHENTICATED');
      });

      it('expired token -> 401', async () => {
        const res = await send(getApp(), route).set('Authorization', `Bearer ${expired}`);
        expect(res.status).toBe(401);
      });

      for (const role of ROLES) {
        const allowed = route.allowed.includes(role);
        it(`${role} -> ${allowed ? 'not refused' : '403'}`, async () => {
          const res = await send(getApp(), route).set(people[role].auth);
          if (allowed) {
            expect([401, 403]).not.toContain(res.status);
          } else {
            expect(res.status).toBe(403);
            expect(res.body.error.code).toBe('FORBIDDEN');
          }
        });
      }

      it('blocked caller -> 403 ACCOUNT_BLOCKED', async () => {
        const res = await send(getApp(), route).set(people.blocked.auth);
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('ACCOUNT_BLOCKED');
      });
    });
  }
}

export type Actor = 'owner' | 'shared' | 'sharedWithSource' | 'otherLearner' | 'reviewer' | 'admin';

export type Actors = Record<Actor, TestUser>;

export interface AccessCase<C> {
  name: string;
  request: (ctx: C) => { method: RouteCase['method']; path: string; body?: unknown };
  /** Expected status per actor. Actors left out are not tested. */
  expect: Partial<Record<Actor, number>>;
}

/**
 * Ownership and sharing checks. Creates the six actors (owner, shared, sharedWithSource, and otherLearner are
 * learners; reviewer and admin have those roles and own nothing), calls `arrange` once to build the records, then
 * declares one test per case and actor.
 */
export function describeAccessMatrix<C>(
  getApp: () => TestApp,
  arrange: (app: TestApp, actors: Actors) => Promise<C>,
  cases: AccessCase<C>[],
): void {
  const actors = {} as Actors;
  let ctx: C;

  beforeAll(async () => {
    const app = getApp();
    actors.owner = await app.createUser({ role: 'learner', name: 'Owner' });
    actors.shared = await app.createUser({ role: 'learner', name: 'Shared' });
    actors.sharedWithSource = await app.createUser({ role: 'learner', name: 'Shared With Source' });
    actors.otherLearner = await app.createUser({ role: 'learner', name: 'Other Learner' });
    actors.reviewer = await app.createUser({ role: 'reviewer', name: 'Reviewer' });
    actors.admin = await app.createUser({ role: 'admin', name: 'Admin' });
    ctx = await arrange(app, actors);
  });

  for (const accessCase of cases) {
    describe(accessCase.name, () => {
      for (const [actor, status] of Object.entries(accessCase.expect) as Array<[Actor, number]>) {
        it(`${actor} -> ${status}`, async () => {
          const res = await send(getApp(), accessCase.request(ctx)).set(actors[actor].auth);
          expect(res.status).toBe(status);
        });
      }
    });
  }
}

/** Presets for `expect`. The reviewer and admin columns exist so every subsystem asserts "no staff exception". */
export const ACCESS: Record<'ownerOnly' | 'ownerAndShared' | 'ownerAndSourceShared', Partial<Record<Actor, number>>> = {
  ownerOnly: { owner: 200, shared: 404, sharedWithSource: 404, otherLearner: 404, reviewer: 404, admin: 404 },
  ownerAndShared: { owner: 200, shared: 200, sharedWithSource: 200, otherLearner: 404, reviewer: 404, admin: 404 },
  ownerAndSourceShared: { owner: 200, shared: 404, sharedWithSource: 200, otherLearner: 404, reviewer: 404, admin: 404 },
};
