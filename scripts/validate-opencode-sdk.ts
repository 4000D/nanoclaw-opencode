#!/usr/bin/env tsx
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { spawnSync } from 'child_process';

type Status = 'PASS' | 'FAIL' | 'PARTIAL';

interface CheckResult {
  key: string;
  title: string;
  status: Status;
  command: string;
  output: string;
  findings: string;
  workaround?: string;
}

function run(
  command: string,
  cwd?: string,
  timeout = 120_000,
): { code: number | null; out: string } {
  const result = spawnSync('bash', ['-lc', command], {
    cwd,
    encoding: 'utf8',
    timeout,
    maxBuffer: 8 * 1024 * 1024,
  });
  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';
  return {
    code: result.status,
    out: `${stdout}${stderr}`.trim(),
  };
}

function clip(text: string, max = 3000): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n...<truncated ${text.length - max} chars>`;
}

function result(
  key: string,
  title: string,
  status: Status,
  command: string,
  output: string,
  findings: string,
  workaround?: string,
): CheckResult {
  return {
    key,
    title,
    status,
    command,
    output: clip(output),
    findings,
    workaround,
  };
}

function markdown(results: CheckResult[]): string {
  const blocks = results.map((r) => {
    const lines = [
      `## ${r.key}. ${r.title}`,
      `Status: ${r.status}`,
      `Command: \`${r.command}\``,
      'Output:',
      '```text',
      r.output || '(no output)',
      '```',
      `Key Findings: ${r.findings}`,
    ];
    if (r.workaround) lines.push(`Workaround: ${r.workaround}`);
    return lines.join('\n');
  });

  return [
    '# Task 0: OpenCode SDK Validation Spike Results (Generated)',
    `Date: ${new Date().toISOString()}`,
    '',
    ...blocks,
    '',
  ].join('\n');
}

function main(): void {
  const checks: CheckResult[] = [];

  const tempRoot = mkdtempSync(path.join(tmpdir(), 'opencode-sdk-validation-'));
  const sdkDir = path.join(tempRoot, 'sdk');
  mkdirSync(sdkDir, { recursive: true });

  const installCmd = [
    'npm init -y --silent',
    'npm install --silent @opencode-ai/sdk',
    `node --input-type=module -e "const sdk=await import('${sdkDir}/node_modules/@opencode-ai/sdk/dist/index.js'); const c=sdk.createOpencodeClient({ baseUrl:'http://127.0.0.1:65535' }); const m=(o)=>Object.getOwnPropertyNames(Object.getPrototypeOf(o)).filter((k)=>k!=='constructor'); console.log('EXPORT_KEYS=' + Object.keys(sdk).sort().join(',')); console.log('SESSION_METHODS=' + m(c.session).join(',')); console.log('EVENT_METHODS=' + m(c.event).join(','));"`,
  ].join(' && ');
  const install = run(installCmd, sdkDir);
  checks.push(
    result(
      'A',
      '@opencode-ai/sdk API surface',
      install.out.includes('createOpencode') &&
        install.out.includes('SESSION_METHODS=')
        ? 'PASS'
        : 'FAIL',
      installCmd,
      install.out,
      'Validates createOpencode/createOpencodeClient exports plus session and event method availability.',
    ),
  );

  const serveCmd = `LOG="${tempRoot}/serve.log"; opencode serve --hostname 127.0.0.1 --port 4110 >"$LOG" 2>&1 & PID=$!; sleep 3; kill "$PID" >/dev/null 2>&1 || true; wait "$PID" 2>/dev/null || true; cat "$LOG"`;
  const serve = run(serveCmd, undefined, 30_000);
  checks.push(
    result(
      'B',
      'opencode serve URL output',
      /http:\/\/127\.0\.0\.1:4110/.test(serve.out) ? 'PASS' : 'FAIL',
      serveCmd,
      serve.out,
      'Checks whether serve logs a capturable localhost URL.',
    ),
  );

  const webCmd = `LOG="${tempRoot}/web.log"; opencode web --hostname 127.0.0.1 --port 4111 >"$LOG" 2>&1 & PID=$!; sleep 4; kill "$PID" >/dev/null 2>&1 || true; wait "$PID" 2>/dev/null || true; cat "$LOG"`;
  const web = run(webCmd, undefined, 30_000);
  checks.push(
    result(
      'C',
      'opencode web URL output',
      /Web interface:\s+http:\/\/127\.0\.0\.1:4111\//.test(web.out)
        ? 'PASS'
        : 'FAIL',
      webCmd,
      web.out,
      'Checks whether web mode logs browser URL on startup.',
    ),
  );

  const dockerCmd =
    'docker run --rm node:22-slim sh -c "npm install -g opencode --no-progress 2>&1 | tail -5 && which opencode"';
  const docker = run(dockerCmd, undefined, 240_000);
  checks.push(
    result(
      'D',
      'npm install -g opencode in Docker',
      docker.code === 0 && /opencode/.test(docker.out) ? 'PASS' : 'FAIL',
      dockerCmd,
      docker.out,
      'Validates Docker-based global install and binary path.',
      'If Docker is unavailable, validate the same command in CI or during container build stage.',
    ),
  );

  const claudeDir = path.join(tempRoot, 'claude-load');
  mkdirSync(path.join(claudeDir, '.claude'), { recursive: true });
  writeFileSync(
    path.join(claudeDir, '.claude', 'CLAUDE.md'),
    'LOCAL_CLAUDE_TEST_RULE: For every response, output exactly LOCAL_CLAUDE_TOKEN_987 and nothing else.\n',
    'utf8',
  );
  const claudeCmd = [
    `LOG="${tempRoot}/claude.log"`,
    'opencode serve --hostname 127.0.0.1 --port 4112 >"$LOG" 2>&1 & PID=$!',
    'sleep 3',
    `node --input-type=module -e "const { createOpencodeClient } = await import('${sdkDir}/node_modules/@opencode-ai/sdk/dist/index.js'); const dir='${claudeDir}'; const client=createOpencodeClient({ baseUrl:'http://127.0.0.1:4112' }); const s=await client.session.create({ query:{ directory:dir }, body:{ title:'claude-md-test' } }); const id=s.data?.id; const r=await client.session.prompt({ path:{ id }, query:{ directory:dir }, body:{ parts:[{ type:'text', text:'Reply with exactly NOT_LOADED' }] } }); const text=(r.data?.parts || []).filter((p)=>p.type==='text').map((p)=>p.text).join(' | '); console.log('TEXT_PARTS=' + text);"`,
    'STATUS=$?',
    'kill "$PID" >/dev/null 2>&1 || true',
    'wait "$PID" 2>/dev/null || true',
    'cat "$LOG"',
    'exit $STATUS',
  ].join('; ');
  const claude = run(claudeCmd, claudeDir, 240_000);
  checks.push(
    result(
      'E',
      '.claude/CLAUDE.md loading behavior',
      claude.out.includes('LOCAL_CLAUDE_TOKEN_987') ? 'PASS' : 'FAIL',
      claudeCmd,
      claude.out,
      'If local rule is loaded, response should be forced to LOCAL_CLAUDE_TOKEN_987 instead of NOT_LOADED.',
      'If local .claude/CLAUDE.md is ignored, inject required constraints via session.prompt body.system.',
    ),
  );

  const promptApiCmd = `node --input-type=module -e "const sdk=await import('${sdkDir}/node_modules/@opencode-ai/sdk/dist/index.js'); const c=sdk.createOpencodeClient({ baseUrl:'http://127.0.0.1:65535' }); const m=(o)=>Object.getOwnPropertyNames(Object.getPrototypeOf(o)).filter((k)=>k!=='constructor'); console.log('SESSION_METHODS=' + m(c.session).join(','));"`;
  const promptApi = run(promptApiCmd);
  checks.push(
    result(
      'F',
      'session.promptAsync vs session.prompt',
      promptApi.out.includes('promptAsync') && promptApi.out.includes('prompt')
        ? 'PASS'
        : 'FAIL',
      promptApiCmd,
      promptApi.out,
      'Confirms both blocking prompt() and non-blocking promptAsync() methods are available.',
    ),
  );

  const outputPath = process.argv[2];
  const doc = markdown(checks);
  if (outputPath) {
    writeFileSync(outputPath, doc, 'utf8');
    console.log(`Wrote validation report to ${outputPath}`);
  } else {
    console.log(doc);
  }

  rmSync(tempRoot, { recursive: true, force: true });
}

main();
