import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { chromium, devices } from 'playwright';
import { createOutlineTestDatabase } from '../helpers/database.mjs';
const db = await createOutlineTestDatabase(), port = 3427, origin = 'http://localhost:' + port;
let browser, page, logs = '';
const server = spawn(process.execPath, [createRequire(import.meta.url).resolve('next/dist/bin/next'), 'start', '-p', String(port)], { cwd: fileURLToPath(new URL('../../', import.meta.url)), env: { ...process.env, DATABASE_URL: db.url, OUTLINE_DATABASE_URL: db.url, OUTLINE_DIRECT_URL: db.url, DATABASE_SCHEMA: db.schema, OUTLINE_DATABASE_SCHEMA: db.schema, ACCOUNT_DATABASE_URL: '', ACCOUNT_DATABASE_SCHEMA: '', NEXT_PUBLIC_ACCOUNT_URL: '', AUTH_COOKIE_DOMAIN: '', BETTER_AUTH_URL: origin, BETTER_AUTH_SECRET: 'outline-test-secret-at-least-32-characters', NODE_ENV: 'production' }, stdio: ['ignore', 'pipe', 'pipe'] });
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
    for (const device of ['desktop', 'mobile']) {
        const context = await browser.newContext({ ...(device === 'mobile' ? devices['Pixel 7'] : { viewport: { width: 1440, height: 1000 } }), reducedMotion: 'reduce' });
        const email = randomUUID() + '@example.test';
        const signup = await context.request.post(origin + '/api/auth/sign-up/email', { data: { email, password: 'test-password-only', name: 'Folder verification' }, headers: { origin } });
        assert.equal(signup.status(), 200);
        const { user } = await signup.json();
        page = await context.newPage();
        page.setDefaultTimeout(15000);
        page.on('dialog', dialog => dialog.accept());
        const errors = [];
        page.on('pageerror', e => errors.push(e.message));
        await page.goto(origin);
        const nav = async () => { if (device === 'mobile')
            await page.getByRole('button', { name: 'Open OpenOutline navigation', exact: true }).click(); };
        await nav();
        await page.getByRole('button', { name: 'New folder', exact: true }).filter({ visible: true }).click();
        await page.getByRole('textbox', { name: 'New folder name', exact: true }).fill('Research');
        await page.getByRole('button', { name: 'Create folder', exact: true }).click();
        await page.getByRole('region', { name: 'Notes in Research', exact: true }).filter({ visible: true }).waitFor();
        await page.getByRole('button', { name: 'New note', exact: true }).filter({ visible: true }).click();
        const title = page.getByRole('textbox', { name: 'Note title', exact: true }).filter({ visible: true });
        await title.fill('Folder workflow ' + device);
        const body = page.locator('[contenteditable="true"]');
        await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
        await page.getByRole('button', { name: 'Bold', exact: true }).filter({ visible: true }).click();
        await page.keyboard.insertText('Original text');
        await page.getByRole('button', { name: 'Copy note', exact: true }).filter({ visible: true }).click();
        await page.getByText('Note copied.', { exact: true }).waitFor();
        assert.equal(await page.evaluate(() => navigator.clipboard.readText()), `Folder workflow ${device}\n\n**Original text**`);
        await body.fill('Original text and https://openoak.org link');
        await title.click();
        const waitForSaved = async (expected, text = 'Original text') => { for (let i = 0; i < 100; i++) {
            const r = (await db.pool.query('SELECT * FROM "Note" WHERE "ownerId"=$1 AND title=$2', [user.id, expected])).rows[0];
            if (r?.body?.includes(text))
                return r;
            await new Promise(r => setTimeout(r, 100));
        } console.log((await db.pool.query('SELECT title,body,"folderId" FROM "Note" WHERE "ownerId"=$1', [user.id])).rows); throw Error('Note text did not persist'); };
        const note = await waitForSaved('Folder workflow ' + device);
        assert.ok(note.folderId);
        await nav();
        const research = page.getByRole('region', { name: 'Notes in Research', exact: true }).filter({ visible: true });
        const researchButton = page.getByRole('button', { name: 'Research', exact: true }).filter({ visible: true });
        await research.getByRole('button').filter({ hasText: 'Folder workflow ' + device }).waitFor();
        assert.equal(await researchButton.getAttribute('aria-expanded'), 'true');
        const parentBox = await researchButton.boundingBox(), childBox = await research.boundingBox();
        assert.ok(childBox.x > parentBox.x, 'Notes must be visually indented under their folder');
        await researchButton.focus(); await page.keyboard.press('Enter');
        assert.equal(await researchButton.getAttribute('aria-expanded'), 'false');
        assert.equal(await page.getByRole('region', { name: 'Notes in Research', exact: true }).filter({ visible: true }).count(), 0);
        await page.keyboard.press('Enter');
        await research.getByRole('button').filter({ hasText: 'Folder workflow ' + device }).click();
        // Hold only the move response while typing to reproduce the stale snapshot bug.
        let release, seen, finished;
        const held = new Promise(r => release = r), started = new Promise(r => seen = r), completed = new Promise(r => finished = r);
        const intercept = async (route) => { const request = route.request(); if (request.method() === 'POST' && request.postData()?.includes('"noteId"') && request.postData()?.includes('"folderId"')) {
            const response = await route.fetch();
            seen();
            await held;
            await route.fulfill({ response });
            finished();
        }
        else
            await route.continue(); };
        await page.route(origin + '/**', intercept);
        const movedView = page.waitForResponse(response => {
            if (response.request().method() !== 'POST') return false;
            try {
                const input = JSON.parse(response.request().postData() || 'null')?.[0];
                return input && Object.hasOwn(input, 'cursor') && input.folderId === null;
            } catch { return false; }
        });
        const moveFromMenu = async name => {
            await page.getByRole('button', { name: 'Note options', exact: true }).filter({ visible: true }).click();
            await page.getByRole(device === 'mobile' ? 'dialog' : 'menu').filter({ visible: true })
                .getByRole(device === 'mobile' ? 'button' : 'menuitem', { name, exact: true }).click();
        };
        assert.equal(await page.getByRole('combobox', { name: 'Move note to folder', exact: true }).count(), 0);
        await moveFromMenu('Unsorted Notes');
        await Promise.race([started, new Promise((_, reject) => setTimeout(() => reject(Error('Move was not intercepted')), 10000))]);
        await title.fill('Typed during move ' + device);
        await body.fill('Original text plus a newer draft during move');
        release();
        await Promise.race([completed, new Promise((_, reject) => setTimeout(() => reject(Error('Move response did not complete')), 15000))]);
        await movedView;
        // Keep the interceptor installed through the test; the released promise
        // lets later moves pass immediately, avoiding removal during queued saves.
        assert.equal(await title.inputValue(), 'Typed during move ' + device);
        assert.match(await body.innerText(), /newer draft during move/);
        await title.click();
        await waitForSaved('Typed during move ' + device, 'newer draft during move');
        let row = (await db.pool.query('SELECT * FROM "Note" WHERE id=$1', [note.id])).rows[0];
        assert.equal(row.folderId, null);
        assert.match(row.body, /newer draft during move/);
        await nav();
        const unsorted = page.getByRole('region', { name: 'Notes in Unsorted Notes', exact: true }).filter({ visible: true });
        await unsorted.getByRole('button').filter({ hasText: 'Typed during move ' + device }).waitFor();
        assert.equal(await page.getByRole('region', { name: 'Notes in Research', exact: true }).filter({ visible: true }).count(), 0);
        await unsorted.getByRole('button').filter({ hasText: 'Typed during move ' + device }).click();
        // Move back through the note options menu, then find the same note after refresh.
        await moveFromMenu('Research');
        for (let i = 0; i < 100; i++) {
            row = (await db.pool.query('SELECT * FROM "Note" WHERE id=$1', [note.id])).rows[0];
            if (row.folderId === note.folderId)
                break;
            await new Promise(r => setTimeout(r, 100));
        }
        assert.equal(row.folderId, note.folderId);
        await page.goto(origin + '/?note=' + note.id);
        await nav();
        await research.getByRole('button').filter({ hasText: 'Typed during move ' + device }).waitFor();
        assert.equal(await researchButton.getAttribute('aria-expanded'), 'true');
        const search = page.getByRole('searchbox', { name: 'Search notes', exact: true }).filter({ visible: true });
        // Switching back to recently loaded folders should not refetch or flash a loader.
        let pageRequests = 0;
        const delayedPage = async route => {
            const request = route.request();
            let input;
            try { input = JSON.parse(request.postData() || 'null')?.[0]; } catch { }
            if (request.method() === 'POST' && input && Object.hasOwn(input, 'cursor')) {
                pageRequests++;
                await new Promise(resolve => setTimeout(resolve, 700));
            }
            await route.fallback();
        };
        await page.route(origin + '/**', delayedPage);
        const allNotes = page.getByRole('button', { name: 'All Notes', exact: true }).filter({ visible: true });
        await allNotes.click();
        assert.equal(await page.getByText('Loading notes…', { exact: true }).filter({ visible: true }).count(), 0, 'No immediate loading flash');
        await page.getByText('Loading notes…', { exact: true }).filter({ visible: true }).waitFor();
        await page.getByRole('button').filter({ hasText: 'Welcome to Notes', visible: true }).waitFor();
        await researchButton.click();
        await research.getByRole('button').filter({ hasText: 'Typed during move ' + device }).waitFor();
        await allNotes.click();
        await page.getByRole('button').filter({ hasText: 'Welcome to Notes', visible: true }).waitFor();
        await researchButton.click();
        await research.getByRole('button').filter({ hasText: 'Typed during move ' + device }).waitFor();
        assert.equal(pageRequests, 1, 'Cached folder and All Notes views must not request their summaries again');
        assert.equal(await page.getByText('Loading notes…', { exact: true }).filter({ visible: true }).count(), 0);
        await page.unroute(origin + '/**', delayedPage);
        for (const theme of ['light', 'dark']) {
            await page.evaluate(theme => {
                document.documentElement.classList.toggle('dark', theme === 'dark');
                document.documentElement.classList.toggle('light', theme === 'light');
            }, theme);
            await page.evaluate(async () => {
                await Promise.all(document.getAnimations().filter(animation => animation.effect?.getTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {})));
            });
            const connector = research.locator('.notes-folder-connector').first();
            const ratio = await connector.evaluate(el => {
                const canvas = document.createElement('canvas'), ctx = canvas.getContext('2d');
                function luminance(color) {
                    ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1);
                    const rgb = [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3).map(v => v / 255).map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
                    return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
                }
                const style = getComputedStyle(el), line = luminance(style.color), panel = luminance(style.getPropertyValue('--notes-panel-solid'));
                return (Math.max(line, panel) + .05) / (Math.min(line, panel) + .05);
            });
            assert.ok(ratio >= 3, `${device} ${theme}: folder connector contrast ${ratio} must reach 3:1`);
            await page.screenshot({ path: '/tmp/openoak-folder-contrast-' + device + '-' + theme + '.png', fullPage: true });
        }
        await search.fill('Welcome');
        await page.getByRole('button').filter({ hasText: 'Welcome to Notes', visible: true }).waitFor();
        assert.equal(await page.getByRole('region', { name: 'Notes in Research', exact: true }).filter({ visible: true }).count(), 0);
        await search.fill('');
        await research.getByRole('button').filter({ hasText: 'Typed during move ' + device }).waitFor();
        await page.screenshot({ path: '/tmp/openoak-note-tree-' + device + '.png', fullPage: true });
        await research.getByRole('button').filter({ hasText: 'Typed during move ' + device }).click();
        assert.match(await page.locator('[contenteditable="true"]').innerText(), /newer draft during move/);
        await page.getByRole('dialog', { name: 'OpenOutline navigation' }).waitFor({ state: 'hidden' });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        await page.screenshot({ path: '/tmp/openoak-note-folders-' + device + '.png', fullPage: true });
        assert.deepEqual(errors, []);
        console.log(device + ': clipboard Markdown, nested folders, keyboard expand/collapse, create/move, in-flight text, deep-link refresh and global search PASS');
        await context.close();
    }
}
catch (e) {
    if (page && !page.isClosed()) {
        console.error(await page.locator('body').innerText());
        await page.screenshot({ path: '/tmp/openoak-note-folders-failure.png' });
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
