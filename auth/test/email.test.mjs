import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';

const { outputFiles } = await build({
  entryPoints: ['../shared/email/otp.ts'], bundle: true, write: false, format: 'esm',
});
const { brandedSender, buildOtpEmail, OTP_SUBJECT } = await import(
  'data:text/javascript;base64,' + Buffer.from(outputFiles[0].text).toString('base64')
);

test('shared email preserves leading zeroes, brand and expiry in both MIME alternatives', () => {
  const message = buildOtpEmail('024359', 'GU · 投资工作台');
  assert.equal(message.subject, 'kedoupi（codepi） 登录验证码');
  assert.equal(message.subject, OTP_SUBJECT);
  for (const body of [message.html, message.text]) {
    for (const expected of ['024359', 'kedoupi（codepi）', 'GU · 投资工作台', '8 分钟内有效', '请勿向他人提供验证码']) {
      assert.ok(body.includes(expected));
    }
  }
  assert.match(message.html, /<table role="presentation"/);
  assert.doesNotMatch(message.html, /<script|<img|<link|https?:\/\//i);
});

test('HTML escapes variable content and keeps the code out of the subject and preheader', () => {
  const message = buildOtpEmail('<123456>', '<img src=x onerror=alert(1)>');
  assert.ok(message.html.includes('&lt;123456&gt;'));
  assert.ok(message.html.includes('&lt;img'));
  assert.doesNotMatch(message.html, /<img/);
  assert.doesNotMatch(message.subject, /123456/);
  assert.doesNotMatch(message.html.match(/<div[^>]*>.*?<\/div>/)?.[0] ?? '', /123456/);
});

test('sender replaces a legacy name, preserves the verified address and rejects malformed headers', () => {
  for (const configured of ['login@example.test', 'Old brand <login@example.test>']) {
    assert.equal(brandedSender(configured), 'kedoupi（codepi） <login@example.test>');
  }
  for (const value of ['', 'invalid', 'a@example.test\nBcc: other@example.test', 'a@example.test, b@example.test']) {
    assert.throws(() => brandedSender(value), /invalid_mail_sender/);
  }
});
