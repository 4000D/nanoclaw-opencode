import fs from 'fs';
import path from 'path';
import {
  createOpencode,
  type OpencodeClient,
  type Part,
} from '@opencode-ai/sdk';
import { fileURLToPath } from 'url';

interface ContainerInput {
  prompt: string;
  sessionId?: string;
  groupFolder: string;
  chatJid: string;
  isMain: boolean;
  isScheduledTask?: boolean;
  assistantName?: string;
}

interface ContainerOutput {
  status: 'success' | 'error';
  result: string | null;
  newSessionId?: string;
  error?: string;
}

interface SessionEntry {
  sessionId: string;
  fullPath: string;
  summary: string;
  firstPrompt: string;
}

interface SessionsIndex {
  entries: SessionEntry[];
}

const IPC_INPUT_DIR = '/workspace/ipc/input';
const IPC_INPUT_CLOSE_SENTINEL = path.join(IPC_INPUT_DIR, '_close');
const IPC_POLL_MS = 500;
const QUERY_DIRECTORY = '/workspace/group';

async function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}

const OUTPUT_START_MARKER = '---NANOCLAW_OUTPUT_START---';
const OUTPUT_END_MARKER = '---NANOCLAW_OUTPUT_END---';

function writeOutput(output: ContainerOutput): void {
  console.log(OUTPUT_START_MARKER);
  console.log(JSON.stringify(output));
  console.log(OUTPUT_END_MARKER);
}

function log(message: string): void {
  console.error(`[agent-runner] ${message}`);
}

function getSessionSummary(
  sessionId: string,
  transcriptPath: string,
): string | null {
  const projectDir = path.dirname(transcriptPath);
  const indexPath = path.join(projectDir, 'sessions-index.json');

  if (!fs.existsSync(indexPath)) {
    log(`Sessions index not found at ${indexPath}`);
    return null;
  }

  try {
    const index: SessionsIndex = JSON.parse(
      fs.readFileSync(indexPath, 'utf-8'),
    );
    const entry = index.entries.find((e) => e.sessionId === sessionId);
    if (entry?.summary) {
      return entry.summary;
    }
  } catch (err) {
    log(
      `Failed to read sessions index: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  return null;
}

async function createPreCompactHook(
  transcriptPath: string | null,
  sessionId: string,
  assistantName?: string,
): Promise<void> {
  if (!transcriptPath || !fs.existsSync(transcriptPath)) {
    log('No transcript found for archiving');
    return;
  }

  try {
    const content = fs.readFileSync(transcriptPath, 'utf-8');
    const messages = parseTranscript(content);

    if (messages.length === 0) {
      log('No messages to archive');
      return;
    }

    const summary = getSessionSummary(sessionId, transcriptPath);
    const name = summary ? sanitizeFilename(summary) : generateFallbackName();

    const conversationsDir = '/workspace/group/conversations';
    fs.mkdirSync(conversationsDir, { recursive: true });

    const date = new Date().toISOString().split('T')[0];
    const filename = `${date}-${name}.md`;
    const filePath = path.join(conversationsDir, filename);

    const markdown = formatTranscriptMarkdown(messages, summary, assistantName);
    fs.writeFileSync(filePath, markdown);

    log(`Archived conversation to ${filePath}`);
  } catch (err) {
    log(
      `Failed to archive transcript: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

function sanitizeFilename(summary: string): string {
  return summary
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}

function generateFallbackName(): string {
  const time = new Date();
  return `conversation-${time.getHours().toString().padStart(2, '0')}${time.getMinutes().toString().padStart(2, '0')}`;
}

interface ParsedMessage {
  role: 'user' | 'assistant';
  content: string;
}

function parseTranscript(content: string): ParsedMessage[] {
  const messages: ParsedMessage[] = [];

  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      if (entry.type === 'user' && entry.message?.content) {
        const text =
          typeof entry.message.content === 'string'
            ? entry.message.content
            : entry.message.content
                .map((c: { text?: string }) => c.text || '')
                .join('');
        if (text) messages.push({ role: 'user', content: text });
      } else if (entry.type === 'assistant' && entry.message?.content) {
        const textParts = entry.message.content
          .filter((c: { type: string }) => c.type === 'text')
          .map((c: { text: string }) => c.text);
        const text = textParts.join('');
        if (text) messages.push({ role: 'assistant', content: text });
      }
    } catch {}
  }

  return messages;
}

function formatTranscriptMarkdown(
  messages: ParsedMessage[],
  title?: string | null,
  assistantName?: string,
): string {
  const now = new Date();
  const formatDateTime = (d: Date) =>
    d.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });

  const lines: string[] = [];
  lines.push(`# ${title || 'Conversation'}`);
  lines.push('');
  lines.push(`Archived: ${formatDateTime(now)}`);
  lines.push('');
  lines.push('---');
  lines.push('');

  for (const msg of messages) {
    const sender = msg.role === 'user' ? 'User' : assistantName || 'Assistant';
    const content =
      msg.content.length > 2000
        ? msg.content.slice(0, 2000) + '...'
        : msg.content;
    lines.push(`**${sender}**: ${content}`);
    lines.push('');
  }

  return lines.join('\n');
}

function shouldClose(): boolean {
  if (fs.existsSync(IPC_INPUT_CLOSE_SENTINEL)) {
    try {
      fs.unlinkSync(IPC_INPUT_CLOSE_SENTINEL);
    } catch {}
    return true;
  }
  return false;
}

function drainIpcInput(): string[] {
  try {
    fs.mkdirSync(IPC_INPUT_DIR, { recursive: true });
    const files = fs
      .readdirSync(IPC_INPUT_DIR)
      .filter((f) => f.endsWith('.json'))
      .sort();

    const messages: string[] = [];
    for (const file of files) {
      const filePath = path.join(IPC_INPUT_DIR, file);
      try {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        fs.unlinkSync(filePath);
        if (data.type === 'message' && data.text) {
          messages.push(data.text);
        }
      } catch (err) {
        log(
          `Failed to process input file ${file}: ${err instanceof Error ? err.message : String(err)}`,
        );
        try {
          fs.unlinkSync(filePath);
        } catch {}
      }
    }
    return messages;
  } catch (err) {
    log(`IPC drain error: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}

function waitForIpcMessage(): Promise<string | null> {
  return new Promise((resolve) => {
    const poll = () => {
      if (shouldClose()) {
        resolve(null);
        return;
      }
      const messages = drainIpcInput();
      if (messages.length > 0) {
        resolve(messages.join('\n'));
        return;
      }
      setTimeout(poll, IPC_POLL_MS);
    };
    poll();
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractTextFromParts(parts: Part[] | undefined): string | null {
  if (!parts || parts.length === 0) {
    return null;
  }

  const text = parts
    .filter(
      (part): part is Extract<Part, { type: 'text' }> => part.type === 'text',
    )
    .map((part) => part.text)
    .join('');

  return text.trim().length > 0 ? text : null;
}

function getErrorMessage(error: unknown): string {
  if (!error) {
    return 'Unknown SDK error';
  }

  if (typeof error === 'string') {
    return error;
  }

  if (typeof error === 'object' && error !== null) {
    const maybeError = error as { name?: string; data?: { message?: string } };
    if (maybeError.data?.message) {
      return `${maybeError.name || 'Error'}: ${maybeError.data.message}`;
    }
    if (
      'message' in maybeError &&
      typeof (maybeError as { message?: unknown }).message === 'string'
    ) {
      return String((maybeError as { message: string }).message);
    }
  }

  return JSON.stringify(error);
}

function loadGlobalClaudeMd(isMain: boolean): string | undefined {
  const globalClaudeMdPath = '/workspace/global/CLAUDE.md';
  if (isMain || !fs.existsSync(globalClaudeMdPath)) {
    return undefined;
  }
  return fs.readFileSync(globalClaudeMdPath, 'utf-8');
}

async function resolveSession(
  client: OpencodeClient,
  sessionId: string | undefined,
  title: string,
): Promise<string> {
  if (sessionId) {
    const existing = await client.session.get({
      path: { id: sessionId },
      query: { directory: QUERY_DIRECTORY },
    });

    if (existing.data?.id) {
      return existing.data.id;
    }

    if (existing.error) {
      log(
        `Session ${sessionId} lookup failed (${getErrorMessage(existing.error)}), creating new session`,
      );
    }
  }

  const created = await client.session.create({
    query: { directory: QUERY_DIRECTORY },
    body: { title },
  });

  if (!created.data?.id) {
    throw new Error(
      `Failed to create session: ${created.error ? getErrorMessage(created.error) : 'No session id returned'}`,
    );
  }

  return created.data.id;
}

async function promptSessionAsync(
  client: OpencodeClient,
  sessionId: string,
  prompt: string,
  system?: string,
): Promise<void> {
  const promptAsync = (
    client.session as unknown as {
      promptAsync?: (options: {
        path: { id: string };
        query: { directory: string };
        body: {
          parts: [{ type: 'text'; text: string }];
          system?: string;
        };
      }) => Promise<{ error?: unknown }>;
    }
  ).promptAsync;

  if (!promptAsync) {
    throw new Error('OpenCode SDK does not expose session.promptAsync()');
  }

  const promptResult = await promptAsync({
    path: { id: sessionId },
    query: { directory: QUERY_DIRECTORY },
    body: {
      parts: [{ type: 'text', text: prompt }],
      ...(system ? { system } : {}),
    },
  });

  if (promptResult.error) {
    throw new Error(`Prompt failed: ${getErrorMessage(promptResult.error)}`);
  }
}

async function getLatestAssistantResult(
  client: OpencodeClient,
  sessionId: string,
  preferredMessageId?: string,
): Promise<string | null> {
  if (preferredMessageId) {
    const message = await client.session.message({
      path: { id: sessionId, messageID: preferredMessageId },
      query: { directory: QUERY_DIRECTORY },
    });

    if (message.data?.info.role === 'assistant') {
      return extractTextFromParts(message.data.parts);
    }
  }

  const messages = await client.session.messages({
    path: { id: sessionId },
    query: { directory: QUERY_DIRECTORY },
  });

  if (!messages.data) {
    if (messages.error) {
      throw new Error(
        `Failed to read session messages: ${getErrorMessage(messages.error)}`,
      );
    }
    return null;
  }

  for (let i = messages.data.length - 1; i >= 0; i--) {
    const message = messages.data[i];
    if (message.info.role === 'assistant') {
      return extractTextFromParts(message.parts);
    }
  }

  return null;
}

async function runQueryWithOpenCode(
  prompt: string,
  sessionId: string | undefined,
  containerInput: ContainerInput,
  client: OpencodeClient,
): Promise<{ newSessionId: string; closedDuringQuery: boolean }> {
  const activeSessionId = await resolveSession(
    client,
    sessionId,
    containerInput.groupFolder,
  );

  const globalClaudeMd = loadGlobalClaudeMd(containerInput.isMain);

  const subscription = await client.event.subscribe({
    query: { directory: QUERY_DIRECTORY },
  });

  await promptSessionAsync(client, activeSessionId, prompt, globalClaudeMd);

  let closedDuringQuery = false;
  let idle = false;
  let sessionError: string | null = null;
  let lastAssistantMessageId: string | undefined;

  while (!idle) {
    if (shouldClose()) {
      log('Close sentinel detected during query, aborting active session');
      closedDuringQuery = true;
      const abortResult = await client.session.abort({
        path: { id: activeSessionId },
        query: { directory: QUERY_DIRECTORY },
      });
      if (abortResult.error) {
        log(
          `Failed to abort session ${activeSessionId}: ${getErrorMessage(abortResult.error)}`,
        );
      }
      break;
    }

    const eventResult = await Promise.race([
      subscription.stream.next(),
      sleep(IPC_POLL_MS).then(() => null),
    ]);

    if (eventResult === null) {
      continue;
    }

    if (eventResult.done) {
      break;
    }

    const event = eventResult.value;

    if (event.type === 'message.updated') {
      if (
        event.properties.info.sessionID === activeSessionId &&
        event.properties.info.role === 'assistant'
      ) {
        lastAssistantMessageId = event.properties.info.id;
      }
      continue;
    }

    if (event.type === 'session.error') {
      if (
        !event.properties.sessionID ||
        event.properties.sessionID === activeSessionId
      ) {
        sessionError = getErrorMessage(event.properties.error);
      }
      continue;
    }

    if (
      event.type === 'session.idle' &&
      event.properties.sessionID === activeSessionId
    ) {
      idle = true;
    }
  }

  if (sessionError && !closedDuringQuery) {
    throw new Error(sessionError);
  }

  let result: string | null = null;
  if (!closedDuringQuery) {
    result = await getLatestAssistantResult(
      client,
      activeSessionId,
      lastAssistantMessageId,
    );

    writeOutput({
      status: 'success',
      result,
      newSessionId: activeSessionId,
    });

    await createPreCompactHook(
      null,
      activeSessionId,
      containerInput.assistantName,
    );
  }

  return { newSessionId: activeSessionId, closedDuringQuery };
}

function buildOpencodeConfig(
  mcpServerPath: string,
  containerInput: ContainerInput,
) {
  return {
    permission: {
      edit: 'allow' as const,
      bash: 'allow' as const,
      webfetch: 'allow' as const,
      doom_loop: 'allow' as const,
      external_directory: 'allow' as const,
    },
    mcp: {
      nanoclaw: {
        type: 'local' as const,
        command: ['node', mcpServerPath],
        environment: {
          NANOCLAW_CHAT_JID: containerInput.chatJid,
          NANOCLAW_GROUP_FOLDER: containerInput.groupFolder,
          NANOCLAW_IS_MAIN: containerInput.isMain ? '1' : '0',
        },
        enabled: true,
        timeout: 15000,
      },
    },
  };
}

async function main(): Promise<void> {
  let containerInput: ContainerInput;

  try {
    const stdinData = await readStdin();
    containerInput = JSON.parse(stdinData);
    try {
      fs.unlinkSync('/tmp/input.json');
    } catch {
      /* may not exist */
    }
    log(`Received input for group: ${containerInput.groupFolder}`);
  } catch (err) {
    writeOutput({
      status: 'error',
      result: null,
      error: `Failed to parse input: ${err instanceof Error ? err.message : String(err)}`,
    });
    process.exit(1);
  }

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const mcpServerPath = path.join(__dirname, 'ipc-mcp-stdio.js');

  process.env.OPENCODE_PERMISSION = process.env.OPENCODE_PERMISSION || 'allow';

  const opencode = await createOpencode({
    config: buildOpencodeConfig(mcpServerPath, containerInput),
  });

  let sessionId = containerInput.sessionId;
  fs.mkdirSync(IPC_INPUT_DIR, { recursive: true });

  // Clean up stale _close sentinel from previous container runs
  try {
    fs.unlinkSync(IPC_INPUT_CLOSE_SENTINEL);
  } catch {
    /* ignore */
  }

  // Build initial prompt (drain any pending IPC messages too)
  let prompt = containerInput.prompt;
  if (containerInput.isScheduledTask) {
    prompt = `[SCHEDULED TASK - The following message was sent automatically and is not coming directly from the user or group.]\n\n${prompt}`;
  }
  const pending = drainIpcInput();
  if (pending.length > 0) {
    log(`Draining ${pending.length} pending IPC messages into initial prompt`);
    prompt += '\n' + pending.join('\n');
  }

  // Query loop: run query → wait for IPC message → run new query → repeat
  try {
    while (true) {
      log(`Starting query (session: ${sessionId || 'new'})...`);

      const queryResult = await runQueryWithOpenCode(
        prompt,
        sessionId,
        containerInput,
        opencode.client,
      );
      sessionId = queryResult.newSessionId;

      // If _close was consumed during the query, exit immediately.
      // Don't emit a session-update marker (it would reset the host's
      // idle timer and cause a 30-min delay before the next _close).
      if (queryResult.closedDuringQuery) {
        log('Close sentinel consumed during query, exiting');
        break;
      }

      // Emit session update so host can track it
      writeOutput({ status: 'success', result: null, newSessionId: sessionId });

      log('Query ended, waiting for next IPC message...');

      // Wait for the next message or _close sentinel
      const nextMessage = await waitForIpcMessage();
      if (nextMessage === null) {
        log('Close sentinel received, exiting');
        break;
      }

      log(`Got new message (${nextMessage.length} chars), starting new query`);
      prompt = nextMessage;
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    log(`Agent error: ${errorMessage}`);
    writeOutput({
      status: 'error',
      result: null,
      newSessionId: sessionId,
      error: errorMessage,
    });
    process.exit(1);
  } finally {
    opencode.server.close();
  }
}

main();
