#!/usr/bin/env node
import { execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';

const patterns = [
  ['AWS access key', /\b(AKIA|ASIA)[0-9A-Z]{16}\b/],
  ['AWS secret key', /aws_?secret_?access_?key\s*[:=]\s*['"]?[A-Za-z0-9/+=]{40}/i],
  ['Bedrock API key', /ABSK[A-Za-z0-9+/=]{20,}/],
  ['Anthropic key', /sk-ant-[A-Za-z0-9_-]{20,}/],
  ['fal key', /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[0-9a-f]{32}\b/],
  ['Private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['GitHub token', /\bgh[pousr]_[A-Za-z0-9]{36,}\b/],
  ['Generic secret assignment', /\b(api[_-]?key|secret|token|password)\b\s*[:=]\s*['"][A-Za-z0-9_\-+/=]{24,}['"]/i],
];

const staged = process.argv.includes('--staged');
const files = execSync(staged ? 'git diff --cached --name-only --diff-filter=ACM' : 'git ls-files', { encoding: 'utf8' })
  .split('\n')
  .filter(Boolean)
  .filter((f) => !/\.(png|jpe?g|gif|webp|mp4|mp3|wav|ttf|otf|lock|ico)$/i.test(f) && !f.endsWith('yarn.lock'));

const blockedNames = files.filter((f) => /(^|\/)\.env(\.|$)/.test(f) && !f.endsWith('.env.example'));
const findings = blockedNames.map((f) => `${f}: env files must not be committed`);

for (const file of files) {
  if (!existsSync(file)) continue;
  const text = staged ? execSync(`git show :${JSON.stringify(file).slice(1, -1)}`, { encoding: 'utf8', maxBuffer: 1 << 26 }) : readFileSync(file, 'utf8');
  text.split('\n').forEach((line, i) => {
    for (const [name, re] of patterns) {
      if (re.test(line)) findings.push(`${file}:${i + 1}: possible ${name}`);
    }
  });
}

if (findings.length) {
  console.error('Possible secrets found, commit blocked:\n' + findings.join('\n'));
  process.exit(1);
}
