import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, readFileSync } from 'node:fs';

// ==================================================
//  Entry Points
// ==================================================
const projectRoot = new URL('../', import.meta.url);

function readSource(file) {
    return readFileSync(new URL(file, projectRoot), 'utf8');
}

function getScripts(file) {
    const html = readSource(file).replace(/<!--[\s\S]*?-->/g, '');
    return [...html.matchAll(/<script\b([^>]+)>/g)].map(([, attributes]) => ({
        src: attributes.match(/\bsrc="([^"]+)"/)?.[1],
        module: /\btype="module"/.test(attributes)
    }));
}

function getLocalImports(file) {
    return [...readSource(file).matchAll(/^import\s+['"](\.[^'"]+)['"]/gm)].map(match => match[1]);
}

for (const [page, entry] of [['index.html', 'main.js'], ['legacy/index.html', 'extension.js']]) {
    test(`${page}: local scripts are Vite module entries`, () => {
        const scripts = getScripts(page);
        const local = scripts.filter(script => script.src && !/^https?:\/\//.test(script.src));
        assert.deepEqual(local, [{ src: entry, module: true }]);
        assert.ok(existsSync(new URL(entry, new URL(page, projectRoot))));
    });
}

test('Both entry points import the shared game engine', () => {
    assert.deepEqual(getLocalImports('main.js'), ['./css/dino.css', './css/extension.css', './js/dino.js', './js/extension.js']);
    assert.deepEqual(getLocalImports('legacy/extension.js'), ['../js/dino.js']);
    for (const file of ['main.js', 'legacy/extension.js']) {
        for (const imported of getLocalImports(file)) {
            assert.ok(existsSync(new URL(imported, new URL(file, projectRoot))));
        }
    }
    assert.match(readSource('js/dino.js'), /window\['Runner'\] = Runner;/);
});

test('Legacy CDN libraries load in their original order before the module', () => {
    const scripts = getScripts('legacy/index.html');
    assert.deepEqual(scripts.map(script => script.src), [
        'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs-core@4.22.0/dist/tf-core.min.js',
        'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs-converter@4.22.0/dist/tf-converter.min.js',
        'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs-backend-webgl@4.22.0/dist/tf-backend-webgl.min.js',
        'https://cdn.jsdelivr.net/npm/@tensorflow-models/handpose@0.1.0/dist/handpose.min.js',
        'https://cdn.jsdelivr.net/npm/fingerpose@0.1.0/dist/fingerpose.min.js',
        'extension.js'
    ]);
    assert.ok(scripts.slice(0, -1).every(script => !script.module));
});

test('Vite configuration retains both HTML inputs and relative base', () => {
    const config = readSource('vite.config.js');
    assert.match(config, /base:\s*['"]\.\/['"]/);
    assert.match(config, /main:\s*resolve\(projectRoot, 'index\.html'\)/);
    assert.match(config, /legacy:\s*resolve\(projectRoot, 'legacy\/index\.html'\)/);
});
