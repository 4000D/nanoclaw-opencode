import { describe, it, expect } from 'vitest';
import {
  AGENT_CLI_BIN,
  AGENT_CLI_ENV_PREFIX,
  AGENT_SDK_PACKAGE,
  AGENT_SERVE_URL_REGEX,
  AGENT_WEB_URL_REGEX,
  ENV_VAR_MAP,
  buildAgentEnv,
} from './agent-cli.js';

describe('agent-cli', () => {
  describe('constants', () => {
    it('exports AGENT_CLI_BIN', () => {
      expect(AGENT_CLI_BIN).toBe('opencode');
    });

    it('exports AGENT_CLI_ENV_PREFIX', () => {
      expect(AGENT_CLI_ENV_PREFIX).toBe('OPENCODE');
    });

    it('exports AGENT_SDK_PACKAGE', () => {
      expect(AGENT_SDK_PACKAGE).toBe('@opencode-ai/sdk');
    });

    it('exports AGENT_SERVE_URL_REGEX', () => {
      expect(AGENT_SERVE_URL_REGEX).toBeInstanceOf(RegExp);
    });

    it('exports AGENT_WEB_URL_REGEX', () => {
      expect(AGENT_WEB_URL_REGEX).toBeInstanceOf(RegExp);
    });

    it('exports ENV_VAR_MAP', () => {
      expect(ENV_VAR_MAP).toBeDefined();
      expect(typeof ENV_VAR_MAP).toBe('object');
    });
  });

  describe('AGENT_SERVE_URL_REGEX', () => {
    it('matches opencode serve output', () => {
      const output = 'opencode server listening on http://127.0.0.1:8080';
      const match = output.match(AGENT_SERVE_URL_REGEX);
      expect(match).not.toBeNull();
      expect(match?.[1]).toBe('http://127.0.0.1:8080');
    });

    it('matches https URLs', () => {
      const output = 'opencode server listening on https://example.com:443';
      const match = output.match(AGENT_SERVE_URL_REGEX);
      expect(match).not.toBeNull();
      expect(match?.[1]).toBe('https://example.com:443');
    });

    it('does not match without protocol', () => {
      const output = 'opencode server listening on 127.0.0.1:8080';
      const match = output.match(AGENT_SERVE_URL_REGEX);
      expect(match).toBeNull();
    });
  });

  describe('AGENT_WEB_URL_REGEX', () => {
    it('matches web interface URLs', () => {
      const output = 'Web interface:     http://127.0.0.1:3000/';
      const match = output.match(AGENT_WEB_URL_REGEX);
      expect(match).not.toBeNull();
      expect(match?.[0]).toBe('http://127.0.0.1:3000/');
    });

    it('matches https URLs', () => {
      const output = 'https://192.168.1.1:8443/';
      const match = output.match(AGENT_WEB_URL_REGEX);
      expect(match).not.toBeNull();
      expect(match?.[0]).toBe('https://192.168.1.1:8443/');
    });

    it('matches various port numbers', () => {
      const output = 'http://127.0.0.1:9999/';
      const match = output.match(AGENT_WEB_URL_REGEX);
      expect(match).not.toBeNull();
    });
  });

  describe('ENV_VAR_MAP', () => {
    it('maps CLAUDE_CODE_DISABLE_AUTO_MEMORY to OPENCODE_DISABLE_AUTOCOMPACT', () => {
      expect(ENV_VAR_MAP.CLAUDE_CODE_DISABLE_AUTO_MEMORY).toBe(
        'OPENCODE_DISABLE_AUTOCOMPACT',
      );
    });

    it('sets CLAUDE_CODE_OAUTH_TOKEN to null', () => {
      expect(ENV_VAR_MAP.CLAUDE_CODE_OAUTH_TOKEN).toBeNull();
    });

    it('sets CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS to null', () => {
      expect(ENV_VAR_MAP.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS).toBeNull();
    });

    it('sets CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD to null', () => {
      expect(
        ENV_VAR_MAP.CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD,
      ).toBeNull();
    });
  });

  describe('buildAgentEnv', () => {
    it('returns empty object when no options provided', () => {
      const env = buildAgentEnv();
      expect(env).toEqual({});
    });

    it('returns empty object when options is undefined', () => {
      const env = buildAgentEnv(undefined);
      expect(env).toEqual({});
    });

    it('sets OPENCODE_DISABLE_AUTOCOMPACT when disableAutocompact is true', () => {
      const env = buildAgentEnv({ disableAutocompact: true });
      expect(env).toEqual({ OPENCODE_DISABLE_AUTOCOMPACT: '1' });
    });

    it('does not set OPENCODE_DISABLE_AUTOCOMPACT when disableAutocompact is false', () => {
      const env = buildAgentEnv({ disableAutocompact: false });
      expect(env).toEqual({});
    });

    it('returns a new object each time', () => {
      const env1 = buildAgentEnv({ disableAutocompact: true });
      const env2 = buildAgentEnv({ disableAutocompact: true });
      expect(env1).not.toBe(env2);
      expect(env1).toEqual(env2);
    });
  });
});
