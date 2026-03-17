/**
 * AI CLI abstraction for NanoClaw.
 * All agent CLI-specific logic lives here so swapping agents means changing one file.
 */

/** The agent CLI binary name. */
export const AGENT_CLI_BIN = 'opencode';

/** Environment variable prefix for the agent CLI. */
export const AGENT_CLI_ENV_PREFIX = 'OPENCODE';

/** The agent SDK package name. */
export const AGENT_SDK_PACKAGE = '@opencode-ai/sdk';

/** Regex to extract the serve URL from opencode serve output. */
export const AGENT_SERVE_URL_REGEX =
  /opencode server listening on (https?:\/\/\S+)/;

/** Regex to extract the web interface URL from opencode web output. */
export const AGENT_WEB_URL_REGEX = /https?:\/\/[\d.]+:\d+\//;

/**
 * Environment variable mapping from old Claude vars to new OpenCode equivalents.
 * null means "no equivalent, remove it"
 */
export const ENV_VAR_MAP = {
  CLAUDE_CODE_OAUTH_TOKEN: null, // OpenCode uses different auth
  CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: null, // No OpenCode equivalent
  CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD: null, // OpenCode reads .claude/ by default
  CLAUDE_CODE_DISABLE_AUTO_MEMORY: 'OPENCODE_DISABLE_AUTOCOMPACT',
} as const;

/** Options for building agent environment variables. */
export interface AgentEnvOptions {
  disableAutocompact?: boolean;
}

/**
 * Build environment variables for the agent container.
 * @param options Configuration options for the agent environment
 * @returns Record of environment variables to set
 */
export function buildAgentEnv(
  options?: AgentEnvOptions,
): Record<string, string> {
  const env: Record<string, string> = {};

  if (options?.disableAutocompact) {
    env['OPENCODE_DISABLE_AUTOCOMPACT'] = '1';
  }

  return env;
}
