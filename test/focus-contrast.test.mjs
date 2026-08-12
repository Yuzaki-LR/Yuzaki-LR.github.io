import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { projectRoot, readDist } from './helpers.mjs';

const cssPath = path.join(projectRoot, 'src', 'styles', 'global.css');

function ruleBody(css, selectorPattern) {
  const match = css.match(new RegExp(`${selectorPattern}\\s*\\{([^}]*)\\}`, 's'));
  assert.ok(match, `missing CSS rule for ${selectorPattern}`);
  return match[1];
}

function declaration(rule, property) {
  const match = rule.match(new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`, 'i'));
  assert.ok(match, `missing ${property} declaration`);
  return match[1].trim();
}

function customProperties(css) {
  const rootRule = ruleBody(css, ':root');
  return new Map(
    [...rootRule.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)]
      .map(([, name, value]) => [name, value.trim()]),
  );
}

function inlineCustomProperties(style) {
  return new Map(
    [...style.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+)(?:;|$)/gi)]
      .map(([, name, value]) => [name, value.trim()]),
  );
}

function resolveColor(value, properties) {
  const variable = value.match(/^var\((--[a-z0-9-]+)\)$/i);
  const resolved = variable ? properties.get(variable[1]) : value;
  assert.ok(resolved, `unable to resolve CSS color ${value}`);

  const hex = resolved.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)?.[1];
  assert.ok(hex, `CSS color must resolve to hex, received ${resolved}`);
  const expanded = hex.length === 3 ? [...hex].map((digit) => digit.repeat(2)).join('') : hex;
  return [0, 2, 4].map((offset) => Number.parseInt(expanded.slice(offset, offset + 2), 16));
}

function relativeLuminance(rgb) {
  const channels = rgb.map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.04045
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return (0.2126 * channels[0]) + (0.7152 * channels[1]) + (0.0722 * channels[2]);
}

function contrastRatio(first, second) {
  const [lighter, darker] = [relativeLuminance(first), relativeLuminance(second)]
    .sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

test('focus indicator has at least 3:1 contrast on white, surface, and footer backgrounds', async () => {
  const css = await readFile(cssPath, 'utf8');
  const properties = customProperties(css);
  const html = await readDist('index.html');
  const bodyStyle = html.match(/<body\s+style="([^"]+)"/i)?.[1];
  assert.ok(bodyStyle, 'built page must emit canonical theme tokens');
  const emittedTheme = inlineCustomProperties(bodyStyle);
  for (const name of ['--background', '--surface', '--text', '--accent', '--focus']) {
    const value = emittedTheme.get(name);
    assert.ok(value, `built page must emit ${name}`);
    properties.set(name, value);
  }
  const focusRule = ruleBody(
    css,
    'a:focus-visible\\s*,\\s*button:focus-visible\\s*,\\s*\\[tabindex\\]:focus-visible',
  );
  const outline = declaration(focusRule, 'outline');
  const outlineColorToken = outline.match(/(?:^|\s)(#[0-9a-f]{3,6}|var\(--[a-z0-9-]+\))$/i)?.[1];
  assert.ok(outlineColorToken, `focus outline must end with a resolvable color, received ${outline}`);

  const focusColor = resolveColor(outlineColorToken, properties);
  const backgrounds = new Map([
    ['white', resolveColor(properties.get('--background'), properties)],
    ['surface', resolveColor(properties.get('--surface'), properties)],
    [
      'footer',
      resolveColor(declaration(ruleBody(css, '\\.site-footer'), 'background'), properties),
    ],
  ]);

  const insufficientContrast = [...backgrounds]
    .map(([name, background]) => [name, contrastRatio(focusColor, background)])
    .filter(([, ratio]) => ratio < 3)
    .map(([name, ratio]) => `${name} ${ratio.toFixed(2)}:1`);

  assert.deepEqual(
    insufficientContrast,
    [],
    `focus-outline contrast must be at least 3:1; insufficient: ${insufficientContrast.join(', ')}`,
  );
});
