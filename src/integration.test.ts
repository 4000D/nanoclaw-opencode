import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';
import {
  AGENT_CLI_BIN,
  AGENT_CLI_ENV_PREFIX,
  AGENT_SDK_PACKAGE,
} from './agent-cli.js';

const repoRoot = resolve(__dirname, '..');

describe('OpenCode migration audit', () => {
  it('has no legacy env-prefix references in source except agent-cli mapping/tests', () => {
    const legacyPrefix = ['CLAUDE', 'CODE'].join('_');
    const result = execSync(
      `grep -rn "${legacyPrefix}" src/ container/agent-runner/src/ setup/ --include="*.ts" || true`,
      {
        cwd: repoRoot,
        encoding: 'utf8',
      },
    );

    const lines = result.split('\n').filter(Boolean);
    const unexpected = lines.filter((line) => !line.includes('agent-cli'));
    expect(unexpected).toHaveLength(0);
  });

  it('exports expected agent-cli constants', () => {
    expect(AGENT_CLI_BIN).toBe('opencode');
    expect(AGENT_CLI_ENV_PREFIX).toBe('OPENCODE');
    expect(AGENT_SDK_PACKAGE).toBe('@opencode-ai/sdk');
  });

  it('has no legacy env vars in container-runner', () => {
    const legacyPrefix = ['CLAUDE', 'CODE'].join('_');
    const content = readFileSync(
      resolve(repoRoot, 'src/container-runner.ts'),
      'utf8',
    );
    expect(content).not.toMatch(new RegExp(`${legacyPrefix}_[A-Z0-9_]+`));
  });

  it('does not depend on anthropic claude sdk in agent runner package', () => {
    const packageJson = readFileSync(
      resolve(repoRoot, 'container/agent-runner/package.json'),
      'utf8',
    );
    expect(packageJson).not.toContain('@anthropic-ai/claude-agent-sdk');
  });

  it('installs opencode in container Dockerfile', () => {
    const dockerfile = readFileSync(
      resolve(repoRoot, 'container/Dockerfile'),
      'utf8',
    );
    expect(dockerfile).toMatch(/npm install -g .*\bopencode\b/);
  });

  it('imports opencode sdk in agent runner entrypoint', () => {
    const indexTs = readFileSync(
      resolve(repoRoot, 'container/agent-runner/src/index.ts'),
      'utf8',
    );
    expect(indexTs).toContain("from '@opencode-ai/sdk'");
  });
});
