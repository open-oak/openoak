import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { chromium, devices } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import { hashPassword } from 'better-auth/crypto';
import { createAccountTestDatabase } from '../helpers/database.mjs';
const db = await createAccountTestDatabase(), port = 3428, origin = 'http://localhost:' + port;
let browser, page, logs = '';
const server = spawn(process.execPath, [createRequire(import.meta.url).resolve('next/dist/bin/next'), 'start', '-p', String(port)], { cwd: fileURLToPath(new URL('../../', import.meta.url)), env: { ...process.env, DATABASE_URL: db.url, ACCOUNT_DATABASE_URL: db.url, DATABASE_SCHEMA: db.schema, AUTH_COOKIE_DOMAIN: '', BETTER_AUTH_URL: origin, BETTER_AUTH_SECRET: 'account-test-secret-at-least-32-characters', RESEND_API_KEY: '', NODE_ENV: 'production' }, stdio: ['ignore', 'pipe', 'pipe'] });
server.stdout.on('data', d => logs += d);
server.stderr.on('data', d => logs += d);
try {
    for (let i = 0; i < 100; i++) {
        try {
            if ((await fetch(origin + '/login')).ok)
                break;
        }
        catch { }
        if (i === 99)
            throw Error(logs);
        await new Promise(r => setTimeout(r, 100));
    }
    browser = await chromium.launch({ headless: true });
    const password = await hashPassword('test-password-only');
    for (const device of ['desktop', 'mobile']) {
        const context = await browser.newContext(device === 'mobile' ? devices['Pixel 7'] : { viewport: { width: 1440, height: 1000 } });
        await context.grantPermissions(['clipboard-read', 'clipboard-write']);
        page = await context.newPage();
        const errors = [];
        page.on('pageerror', e => errors.push(e.message));
        await page.goto(origin + '/connected-ai');
        await page.getByRole('heading', { name: 'AI connections', exact: true }).waitFor();
        assert.equal(await page.getByRole('tab', { name: 'Setup', exact: true }).getAttribute('aria-selected'), 'true');
        const copy = page.getByRole('button', { name: 'Copy address', exact: true });
        await copy.click();
        await page.getByText('Copied', { exact: true }).waitFor();
        assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'https://mcp.openoak.org');
        const codex = page.locator('summary').filter({ hasText: /^Codex$/ });
        await codex.focus(); await page.keyboard.press('Enter');
        await page.getByRole('link', { name: 'Codex setup guide', exact: true }).waitFor();
        await page.keyboard.press('Enter');
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        assert.deepEqual((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations.map(v => v.id), []);
        await page.screenshot({ path: '/tmp/openoak-ai-setup-' + device + '.png', fullPage: true });
        await page.evaluate(() => { navigator.clipboard.writeText = async () => { throw new Error('denied'); }; });
        await copy.click();
        await page.getByText('Copy failed', { exact: true }).waitFor();
        await page.getByRole('tab', { name: 'Setup', exact: true }).press('ArrowRight');
        await page.getByRole('heading', { name: 'Sign in to see your connections', exact: true }).waitFor();
        assert.equal(await page.getByRole('tab', { name: 'Connected services', exact: true }).getAttribute('aria-selected'), 'true');
        await page.reload();
        await page.getByRole('heading', { name: 'Sign in to see your connections', exact: true }).waitFor();
        const userId = randomUUID(), otherId = randomUUID(), clientId = randomUUID(), consentId = randomUUID(), email = userId + '@example.test';
        for (const id of [userId, otherId])
            await db.pool.query('INSERT INTO "User" (id,email,name,"emailVerified","updatedAt") VALUES ($1,$2,$3,true,now())', [id, id + '@example.test', 'UI verification']);
        await db.pool.query('INSERT INTO "Account" (id,issuer,"accountId","providerId","userId",password,"updatedAt") VALUES ($1,$4,$2,\'credential\',$2,$3,now())', [randomUUID(), userId, password, 'local:credential']);
        await page.getByRole('tabpanel').getByRole('link', { name: 'Sign in', exact: true }).click();
        await page.getByLabel('Email', { exact: true }).fill(email);
        await page.getByLabel('Password', { exact: true }).fill('test-password-only');
        await page.getByRole('button', { name: 'Sign in', exact: true }).click();
        await page.waitForURL(origin + '/connected-ai?tab=services');
        await page.getByRole('heading', { name: 'No AI apps connected yet' }).waitFor();
        await page.getByRole('tab', { name: 'Connected services', exact: true }).press('ArrowLeft');
        await page.getByRole('heading', { name: 'One address for your OpenOak apps' }).waitFor();
        await page.getByRole('tab', { name: 'Connected services', exact: true }).click();
        await page.screenshot({ path: '/tmp/openoak-connected-empty-' + device + '.png', fullPage: true });
        await db.pool.query('INSERT INTO "oauthClient" (id,"clientId",name,uri,scopes,contacts,"redirectUris","postLogoutRedirectUris","grantTypes","responseTypes") VALUES ($1,$1,\'Example AI\',\'https://example.test\',$2,$3,$3,$3,$3,$3)', [clientId, ['openoak:read', 'openoak:write'], []]);
        for (const [id, owner, scopes, createdAt] of [[consentId, userId, ['openoak:read'], '2026-08-01T08:09:10Z'], [randomUUID(), userId, ['openoak:write', 'offline_access'], '2026-09-30T12:00:00Z'], [randomUUID(), otherId, ['openoak:read'], '2026-07-01T00:00:00Z']])
            await db.pool.query('INSERT INTO "oauthConsent" (id,"clientId","userId",scopes,"createdAt","updatedAt") VALUES ($1,$2,$3,$4,$5,now())', [id, clientId, owner, scopes, createdAt]);
        for (const owner of [userId, otherId]) {
            await db.pool.query('INSERT INTO "oauthAccessToken" (id,"clientId","userId",scopes) VALUES ($1,$2,$3,$4)', [randomUUID(), clientId, owner, ['openoak:read']]);
            await db.pool.query('INSERT INTO "oauthRefreshToken" (id,token,"clientId","userId",scopes) VALUES ($1,$1,$2,$3,$4)', [randomUUID(), clientId, owner, ['openoak:read']]);
        }
        await page.reload();
        await page.getByRole('heading', { name: 'Example AI', exact: true }).waitFor();
        assert.equal(await page.locator('article').count(), 1);
        assert.equal(await page.locator('article time').getAttribute('datetime'), '2026-08-01T08:09:10.000Z');
        assert.match(await page.locator('article time').innerText(), /1 Aug 2026, 08:09:10 UTC/);
        assert.equal(await page.getByRole('heading', { name: 'AI connections', exact: true }).count(), 1);
        assert.doesNotMatch(await page.locator('body').innerText(), /[→↗]/);
        await page.getByText('Read your notes, boards, lists, tasks, and subtasks', { exact: true }).waitFor();
        await page.getByText('Create, edit, move, and delete your OpenOak data', { exact: true }).waitFor();
        assert.equal(await page.getByText('Client ID', { exact: true }).isVisible(), false);
        const details = page.locator('article summary');
        await details.focus();
        await page.keyboard.press('Enter');
        await page.getByText('Client ID', { exact: true }).waitFor();
        await page.keyboard.press('Enter');
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        const audit = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
        assert.deepEqual(audit.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => n.target) })), []);
        await page.screenshot({ path: '/tmp/openoak-connected-' + device + '.png', fullPage: true });
        await db.pool.query('UPDATE "oauthConsent" SET "createdAt"=NULL WHERE "userId"=$1', [userId]);
        await page.reload();
        await page.getByText('Connection date unavailable', { exact: true }).waitFor();
        assert.equal(await page.locator('article time').count(), 0);
        await page.getByRole('button', { name: 'Disconnect Example AI', exact: true }).click();
        await page.getByRole('heading', { name: 'No AI apps connected yet' }).waitFor();
        assert.equal((await db.pool.query('SELECT count(*)::int n FROM "oauthConsent" WHERE "userId"=$1', [userId])).rows[0].n, 0);
        assert.equal((await db.pool.query('SELECT count(*)::int n FROM "oauthConsent" WHERE "userId"=$1', [otherId])).rows[0].n, 1);
        for (const table of ['oauthAccessToken', 'oauthRefreshToken']) {
            assert.ok((await db.pool.query(`SELECT revoked FROM "${table}" WHERE "userId"=$1`, [userId])).rows[0].revoked);
            assert.equal((await db.pool.query(`SELECT revoked FROM "${table}" WHERE "userId"=$1`, [otherId])).rows[0].revoked, null);
        }
        assert.equal((await db.pool.query('SELECT count(*)::int n FROM "OauthRevocation" WHERE "userId"=$1', [userId])).rows[0].n, 1);
        assert.deepEqual(errors, []);
        await page.goto(origin + '/apps');
        assert.equal(await page.getByRole('link', { name: 'AI connections', exact: true }).count(), 1);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        console.log(device + ': public setup, clipboard success/failure, keyboard tabs, sign-in continuation, earliest consent timestamp, missing-date fallback, single AI entry, empty state, readable access, combined consents, accessibility, scoped disconnect PASS');
        await context.close();
    }
}
catch (e) {
    if (page && !page.isClosed()) {
        console.error(await page.locator('body').innerText());
        await page.screenshot({ path: '/tmp/openoak-connected-failure.png' });
    }
    console.error(logs.slice(-3000));
    throw e;
}
finally {
    await browser?.close();
    server.kill('SIGTERM');
    await new Promise(r => server.exitCode !== null ? r() : server.once('exit', r));
    await db.close();
}
