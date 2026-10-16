import { expect, test, type Page } from '@playwright/test';

// Quickstart V10 (375 px) and V11 (reduced motion, dark scheme). Dev sign-in, stub providers, seeded data.

async function signIn(page: Page, who: 'learner2' | 'admin') {
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Sign in as' })).toBeVisible();
  const button =
    who === 'admin'
      ? page.getByRole('button').filter({ hasText: /admin/i })
      : page.getByRole('button').filter({ hasText: /learner/ }).nth(1);
  await button.first().click();
  await expect(page).toHaveURL(/\/puzzles$/);
}

/** V10: no horizontal page scroll. Waits for the page heading so the check runs on rendered content. */
async function expectFits(page: Page, label: string) {
  await expect(page.getByRole('heading').first(), `${label}: heading`).toBeVisible();
  await page.waitForLoadState('networkidle');
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth), { message: `${label}: scrollWidth` })
    .toBeLessThanOrEqual(375);
}

/** Ask the Coach. A click before hydration does nothing, so retry until the card shows. */
async function askCoach(page: Page) {
  const card = page.getByRole('article');
  await expect(async () => {
    await page.getByRole('button', { name: 'What next?' }).click();
    await expect(card).toBeVisible({ timeout: 3000 });
  }).toPass({ timeout: 20_000 });
  return card;
}

async function visit(page: Page, path: string, label = path) {
  await page.goto(path);
  await expectFits(page, label);
}

test.describe('375 px (V10)', () => {
  test.use({ viewport: { width: 375, height: 800 } });

  test('login and every learner route fit without horizontal scroll', async ({ page }) => {
    test.setTimeout(180_000);
    await visit(page, '/login');
    await signIn(page, 'learner2');
    await expectFits(page, '/puzzles');
    await expect(page.getByRole('button', { name: 'Menu', exact: true })).toBeVisible();

    const href = await page.getByRole('link', { name: /^Play/ }).first().getAttribute('href');
    expect(href).toMatch(/^\/puzzles\/[^/]+\/play$/);
    await visit(page, href!, 'play');

    await page.getByRole('button', { name: 'Submit answers' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Submit anyway' }).click();
    await expect(page.getByText(/^Score:\s*0 \/ \d+/)).toBeVisible();
    await expectFits(page, 'session result');

    await visit(page, '/coach');
    await page.getByLabel('Goal (optional)').fill('learn indexes');
    const card = await askCoach(page);
    await expectFits(page, '/coach with recommendation');
    await card.getByRole('link', { name: 'Why this?' }).click();
    await expect(page.getByRole('heading', { name: 'The same path as text' })).toBeVisible();
    await expectFits(page, 'decision why-path');

    await visit(page, '/mastery');
    await visit(page, '/account');
    await visit(page, '/sources');
    await visit(page, '/sources/new');
    await visit(page, '/review');
    // A task and a source the learner does not have: the Not found page must fit too.
    await visit(page, '/tasks/does-not-exist', 'task (not found)');
    await visit(page, '/sources/does-not-exist', 'source (not found)');
  });

  test('admin routes fit; a table scrolls inside its own box', async ({ page }) => {
    test.setTimeout(120_000);
    await signIn(page, 'admin');
    await visit(page, '/admin');
    const modelHref = await page.locator('main a[href^="/admin/"]').first().getAttribute('href');
    expect(modelHref).toBeTruthy();
    await visit(page, modelHref!, 'admin list');
    // The first model (access codes) is empty on a fresh seed; visit a record only when one exists.
    const rows = page.locator(`main a[href^="${modelHref}/"]`);
    if ((await rows.count()) > 0) await visit(page, (await rows.first().getAttribute('href'))!, 'admin detail');
    await visit(page, '/review', 'review (admin)');
  });
});

// Parse "0.01ms, 0s" style lists into milliseconds.
const msList = (value: string) => value.split(',').map((v) => (v.trim().endsWith('ms') ? parseFloat(v) : parseFloat(v) * 1000));

/** Resolve any CSS colour (oklch included) to sRGB through a canvas, then contrast ratio. */
async function contrast(page: Page, fgSelector: string, bgSelector: string) {
  return page.evaluate(
    ([fgSel, bgSel]) => {
      const toRgb = (css: string) => {
        const c = document.createElement('canvas').getContext('2d')!;
        c.fillStyle = '#000';
        c.fillStyle = css;
        c.fillRect(0, 0, 1, 1);
        const [r, g, b] = c.getImageData(0, 0, 1, 1).data;
        return [r!, g!, b!];
      };
      const lum = ([r, g, b]: number[]) => {
        const f = (v: number) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
        return 0.2126 * f(r!) + 0.7152 * f(g!) + 0.0722 * f(b!);
      };
      const fg = toRgb(getComputedStyle(document.querySelector(fgSel!)!).color);
      const bg = toRgb(getComputedStyle(document.querySelector(bgSel!)!).backgroundColor);
      const [hi, lo] = [lum(fg), lum(bg)].sort((a, b) => b - a);
      return (hi! + 0.05) / (lo! + 0.05);
    },
    [fgSelector, bgSelector],
  );
}

test.describe('reduced motion and dark scheme (V11)', () => {
  test.use({ colorScheme: 'dark', reducedMotion: 'reduce', viewport: { width: 1024, height: 800 } });

  test('no motion, readable tokens and visible focus rings', async ({ page }) => {
    test.setTimeout(120_000);
    await signIn(page, 'learner2');
    expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
    expect(await page.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches)).toBe(true);

    const motionFree = async (label: string) => {
      const offenders = await page.evaluate(() => {
        const out: string[] = [];
        for (const el of document.querySelectorAll('*')) {
          const s = getComputedStyle(el);
          out.push(`${el.tagName}|${s.animationDuration}|${s.transitionDuration}|${s.animationIterationCount}`);
        }
        return out;
      });
      for (const row of offenders) {
        const [tag, anim, trans, iter] = row.split('|');
        expect(Math.max(...msList(anim!)), `${label}: ${tag} animation`).toBeLessThanOrEqual(0.01);
        expect(Math.max(...msList(trans!)), `${label}: ${tag} transition`).toBeLessThanOrEqual(0.01);
        if (Math.max(...msList(anim!)) > 0) expect(iter, `${label}: ${tag} iterations`).toBe('1');
      }
      const running = await page.evaluate(() =>
        document.getAnimations().filter((a) => a.playState === 'running' && Number(a.effect?.getComputedTiming().iterations) > 1).length,
      );
      expect(running, `${label}: infinite animations`).toBe(0);
    };

    // Play board: place a word, then check there is no animation left running.
    const href = await page.getByRole('link', { name: /^Play/ }).first().getAttribute('href');
    await page.goto(href!);
    await expect(page.getByRole('button', { name: 'Submit answers' })).toBeVisible();
    await page.getByRole('button', { name: /blank 1 of \d+, empty/ }).first().click();
    await page.getByRole('group', { name: 'Word bank' }).getByRole('button').first().click();
    await motionFree('play board');

    // Foreground against background, and muted text against the page, in dark.
    expect(await contrast(page, 'body', 'body')).toBeGreaterThanOrEqual(7);
    expect(await contrast(page, 'p, span', 'body')).toBeGreaterThanOrEqual(4.5);

    // Focus ring: Tab onto the first control; the focused element has an outline or box-shadow.
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    const ring = await page.evaluate(() => {
      const s = getComputedStyle(document.activeElement!);
      return { outline: s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0, shadow: s.boxShadow !== 'none' };
    });
    expect(ring.outline || ring.shadow, 'focus ring on the first tabbed control').toBe(true);

    // Coach card and why-path.
    await page.goto('/coach');
    const card = await askCoach(page);
    expect(await contrast(page, 'article', 'body')).toBeGreaterThanOrEqual(7);
    await motionFree('coach');
    await card.getByRole('link', { name: 'Why this?' }).click();
    await expect(page.getByRole('heading', { name: 'The same path as text' })).toBeVisible();
    await page.waitForLoadState('networkidle');
    await motionFree('why-path');

    // Every other screen stays readable: the dark page background is dark, the text light.
    for (const path of ['/puzzles', '/mastery', '/account', '/sources', '/sources/new']) {
      await page.goto(path);
      await expect(page.getByRole('heading').first()).toBeVisible();
      expect(await contrast(page, 'main h1', 'body'), `${path}: heading contrast`).toBeGreaterThanOrEqual(7);
      await motionFree(path);
    }
  });
});
