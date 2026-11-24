import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, readFileSync } from 'node:fs';

// ==================================================
//  Release Metadata
// ==================================================
const projectRoot = new URL('../', import.meta.url);

function readSource(file) {
    return readFileSync(new URL(file, projectRoot), 'utf8');
}

const pkg = JSON.parse(readSource('package.json'));
const lock = JSON.parse(readSource('package-lock.json'));

test('Package and lockfile identify the same release', () => {
    assert.equal(pkg.version, '1.0.1');
    assert.equal(lock.version, pkg.version);
    assert.equal(lock.packages[''].version, pkg.version);
    assert.equal(lock.name, pkg.name);
    assert.equal(lock.packages[''].name, pkg.name);
    assert.deepEqual(lock.packages[''].dependencies, pkg.dependencies);
    assert.deepEqual(lock.packages[''].devDependencies, pkg.devDependencies);
});

test('MediaPipe runtime assets match the locked Hands version', () => {
    const version = readSource('js/extension.js').match(/const MEDIAPIPE_HANDS_VERSION = '([^']+)'/)[1];
    assert.equal(version, lock.packages['node_modules/@mediapipe/hands'].version);
});

test('Release documentation and license are present', () => {
    assert.match(readSource('CHANGELOG.md'), /## v1\.0\.1/);
    assert.match(readSource('README.md'), /\[CHANGELOG\.md\]\(\.\/CHANGELOG\.md\)/);
    for (const file of ['BENCHMARK.md', 'LICENSE', 'img/poster.webp', 'img/screenshot.gif', 'img/mobile-gesture-demo.webp']) {
        assert.ok(existsSync(new URL(file, projectRoot)), file);
    }
});

test('Both game pages retain the required local image assets', () => {
    for (const page of ['index.html', 'legacy/index.html']) {
        const source = readSource(page).replace(/<!--[\s\S]*?-->/g, '');
        for (const [, path] of source.matchAll(/<img\b[^>]*\bsrc="([^"\n]+)"/g)) {
            if (/^(https?:|data:)/.test(path)) continue;
            assert.ok(existsSync(new URL(path, new URL(page, projectRoot))), `${page}: ${path}`);
        }
    }
});
