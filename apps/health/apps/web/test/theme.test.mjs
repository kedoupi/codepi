import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { journalColors } from '../src/lib/journal.ts';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const theme = read('../src/theme.css');
const colors = Object.fromEntries(
  [...theme.matchAll(/(--[\w-]+):\s*(#[\da-f]{6});/gi)].map(([, name, value]) => [name, value]),
);

function luminance(hex) {
  const channels = hex.slice(1).match(/../g).map(part => {
    const value = parseInt(part, 16) / 255;
    return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
  });
  return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
}

function contrast(foreground, background) {
  assert.ok(foreground && background, 'Both colors must be defined');
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (values[0] + .05) / (values[1] + .05);
}

test('Health theme follows shared defaults without overriding shared geometry or typography', () => {
  const styles = read('../src/styles.css');
  assert.match(styles, /@import "@kedoupi\/shared\/styles\/tokens\.css";\s*@import "\.\/theme\.css";/);
  assert.doesNotMatch(theme, /--kdp-(?:font|space|radius|content-width|reading-width|motion)[\w-]*\s*:/);
  const canvas = read('../index.html').match(/name="theme-color" content="([^"]+)"/)?.[1];
  assert.equal(canvas, colors['--kdp-canvas'], 'Browser chrome should match the local canvas');
});

test('Health text, links and button labels meet 4.5:1 across warm surfaces', () => {
  for (const background of ['--kdp-canvas', '--kdp-surface', '--kdp-accent-soft']) {
    for (const foreground of ['--kdp-ink', '--kdp-text', '--kdp-muted', '--kdp-accent', '--kdp-accent-strong']) {
      const ratio = contrast(colors[foreground], colors[background]);
      assert.ok(ratio >= 4.5, `${foreground} on ${background}: ${ratio.toFixed(2)}:1`);
    }
  }
  for (const background of ['--kdp-accent', '--kdp-accent-strong']) {
    const ratio = contrast('#ffffff', colors[background]);
    assert.ok(ratio >= 4.5, `White button label on ${background}: ${ratio.toFixed(2)}:1`);
  }
});

test('Health focus and chart series remain visible on paper surfaces', () => {
  assert.equal(new Set(Object.values(journalColors).slice(0, 3)).size, 3, 'Score series need distinct colors');
  for (const background of ['--kdp-canvas', '--kdp-surface', '--kdp-accent-soft']) {
    assert.ok(contrast(colors['--kdp-focus'], colors[background]) >= 3);
    for (const [series, color] of Object.entries(journalColors)) {
      const ratio = contrast(color, colors[background]);
      assert.ok(ratio >= 3, `${series} on ${background}: ${ratio.toFixed(2)}:1`);
    }
  }
});
