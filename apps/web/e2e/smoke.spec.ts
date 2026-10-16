import { expect, test } from '@playwright/test';

const FORBIDDEN_KEYS = new Set(['answers', 'expected', 'correct']);

function findForbiddenKey(value: unknown, trail = '$'): string | null {
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const hit = findForbiddenKey(value[i], `${trail}[${i}]`);
      if (hit) return hit;
    }
  } else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if (FORBIDDEN_KEYS.has(key)) return `${trail}.${key}`;
      const hit = findForbiddenKey(child, `${trail}.${key}`);
      if (hit) return hit;
    }
  }
  return null;
}

// The single path: register -> play -> recommendation -> why-path. Dev sign-in, stub providers, no internet.
test('learner2 plays one puzzle, asks what next, and reads why', async ({ page }) => {
  // Step 1: sign in as the second demo learner (learner2@example.test, no history).
  await page.goto('/login');
  await expect(page.getByText('Development sign-in')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Sign in as' })).toBeVisible();
  // The picker lists accounts in the order learner, learner2, reviewer, admin.
  const learners = page.getByRole('button').filter({ hasText: /learner/ });
  await expect(learners).toHaveCount(2);
  await learners.nth(1).click();
  await expect(page).toHaveURL(/\/puzzles$/);

  // Step 2: follow the first "Play" link and inspect the play payload.
  const playLink = page.getByRole('link', { name: /^Play/ }).first();
  await expect(playLink).toBeVisible();
  const playResponse = page.waitForResponse(
    (r) => r.request().method() === 'GET' && /\/api\/puzzles\/[^/]+\/play(\?|$)/.test(r.url()),
  );
  await playLink.click();
  const response = await playResponse;
  expect(response.ok()).toBe(true);
  expect(findForbiddenKey(await response.json())).toBeNull();

  // Step 3: submit with every blank empty and confirm the dialog.
  await page.getByRole('button', { name: 'Submit answers' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Submit with empty blanks?')).toBeVisible();
  await dialog.getByRole('button', { name: 'Submit anyway' }).click();
  await expect(page.getByText(/^Score:\s*0 \/ \d+/)).toBeVisible();

  // Step 4: "What next?" on the result page, then on /coach.
  await page.getByRole('link', { name: 'What next?' }).click();
  await expect(page).toHaveURL(/\/coach$/);
  await page.getByRole('button', { name: 'What next?' }).click();
  const card = page.getByRole('article');
  await expect(card).toBeVisible();
  await expect(card.getByRole('link', { name: 'Why this?' })).toBeVisible();

  // Step 5: follow "Why this?" and read the path as text.
  await card.getByRole('link', { name: 'Why this?' }).click();
  const heading = page.getByRole('heading', { name: 'The same path as text' });
  await expect(heading).toBeVisible();
  await expect(page.getByRole('region', { name: 'The same path as text' }).getByRole('listitem').first()).toBeVisible();
});
