import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { GoogleGenerativeAI } from '@google/generative-ai';
import type { ProviderConfig, ProviderName } from './types.js';

export interface LLMProvider {
  complete(
    systemPrompt: string,
    userMessages: string[],
    responseJsonSchema: Record<string, unknown>,
  ): Promise<unknown>;
}

const RESPONSE_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    suggestions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          table: { type: 'string' },
          column: { type: 'string' },
          semanticType: { type: 'string' },
          generatorSpec: {
            type: 'object',
            properties: {
              kind: { type: 'string' },
              params: { type: 'object' },
            },
            required: ['kind', 'params'],
          },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          reasoning: { type: 'string' },
        },
        required: ['table', 'column', 'semanticType', 'generatorSpec', 'confidence', 'reasoning'],
      },
    },
    tableSuggestions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          table: { type: 'string' },
          statusDistributions: {
            type: 'object',
            additionalProperties: { type: 'number' },
          },
          personaSuggestions: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                selectionWeight: { type: 'number', minimum: 0, maximum: 1 },
                overrides: { type: 'array', items: { type: 'string' } },
              },
              required: ['name', 'selectionWeight', 'overrides'],
            },
          },
          reasoning: { type: 'string' },
        },
        required: ['table', 'reasoning'],
      },
    },
  },
  required: ['suggestions'],
};

function defaultModel(provider: ProviderName): string {
  switch (provider) {
    case 'anthropic': return 'claude-3-5-haiku-latest';
    case 'openai': return 'gpt-4o-mini';
    case 'google': return 'gemini-2.0-flash-lite';
    case 'deepseek': return 'deepseek-chat';
    case 'xai': return 'grok-2-latest';
    case 'openrouter': return 'gpt-4o-mini';
    case 'ollama': return 'llama3.2';
  }
}

function apiKey(config: ProviderConfig, envName: string): string {
  return config.apiKey ?? process.env[envName] ?? '';
}

// ─── Anthropic ─────────────────────────────────────────────────────────

class AnthropicProvider implements LLMProvider {
  private client: Anthropic;

  constructor(config: ProviderConfig) {
    const key = apiKey(config, 'ANTHROPIC_API_KEY') || 'sk-ant-placeholder';
    this.client = new Anthropic({ apiKey: key });
  }

  async complete(
    systemPrompt: string,
    userMessages: string[],
    responseJsonSchema: Record<string, unknown>,
  ): Promise<unknown> {
    const model = defaultModel('anthropic');
    const msg = await this.client.messages.create({
      model,
      max_tokens: 4096,
      system: [
        {
          type: 'text',
          text: systemPrompt,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: userMessages.map((content) => ({ role: 'user' as const, content })),
      tools: [
        {
          name: 'suggest',
          description: 'Suggest generator configurations for unresolved columns',
          input_schema: responseJsonSchema,
        },
      ],
      tool_choice: { type: 'tool', name: 'suggest' },
    });

    const block = msg.content.find((c: { type: string; input?: unknown }) => c.type === 'tool_use');
    if (!block || !block.input) {
      throw new Error('Anthropic did not return a tool_use block');
    }
    return block.input;
  }
}

// ─── OpenAI ────────────────────────────────────────────────────────────

class OpenAIProvider implements LLMProvider {
  private client: OpenAI;

  constructor(config: ProviderConfig) {
    const key = apiKey(config, 'OPENAI_API_KEY') || 'sk-placeholder';
    this.client = new OpenAI({ apiKey: key });
  }

  async complete(
    systemPrompt: string,
    userMessages: string[],
    responseJsonSchema: Record<string, unknown>,
  ): Promise<unknown> {
    const model = defaultModel('openai');
    const msg = await this.client.chat.completions.create({
      model,
      max_tokens: 4096,
      messages: [
        { role: 'system', content: systemPrompt },
        ...userMessages.map((content) => ({ role: 'user' as const, content })),
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'suggest',
          strict: true,
          schema: responseJsonSchema,
        },
      },
    });

    const content = msg.choices[0]?.message?.content;
    if (!content) throw new Error('OpenAI returned empty response');
    return JSON.parse(content);
  }
}

// ─── Google Gemini ─────────────────────────────────────────────────────

class GoogleProvider implements LLMProvider {
  private client: GoogleGenerativeAI;

  constructor(config: ProviderConfig) {
    const key = apiKey(config, 'GEMINI_API_KEY') || 'test-key';
    this.client = new GoogleGenerativeAI(key);
  }

  async complete(
    systemPrompt: string,
    userMessages: string[],
    _responseJsonSchema: Record<string, unknown>,
  ): Promise<unknown> {
    const modelName = defaultModel('google');
    const model = this.client.getGenerativeModel({
      model: modelName,
      systemInstruction: systemPrompt,
      generationConfig: {
        responseMimeType: 'application/json',
      },
    });

    const result = await model.generateContent(userMessages.join('\n\n'));
    const text = result.response.text();
    if (!text) throw new Error('Gemini returned empty response');
    return JSON.parse(text);
  }
}

// ─── OpenAI-compatible (DeepSeek, xAI, OpenRouter, Ollama) ────────────

class OpenAICompatibleProvider implements LLMProvider {
  private client: OpenAI;
  private providerName: ProviderName;

  constructor(config: ProviderConfig) {
    this.providerName = config.provider;
    const baseURL = config.baseURL ?? this.defaultBaseURL();
    const key = apiKey(config, 'OPENAI_API_KEY') || 'sk-placeholder';
    this.client = new OpenAI({
      apiKey: key,
      baseURL,
    });
  }

  private defaultBaseURL(): string {
    switch (this.providerName) {
      case 'deepseek': return 'https://api.deepseek.com/v1';
      case 'xai': return 'https://api.x.ai/v1';
      case 'openrouter': return 'https://openrouter.ai/api/v1';
      case 'ollama': return 'http://localhost:11434/v1';
      default: return 'https://api.openai.com/v1';
    }
  }

  async complete(
    systemPrompt: string,
    userMessages: string[],
    _responseJsonSchema: Record<string, unknown>,
  ): Promise<unknown> {
    const model = defaultModel(this.providerName);
    const msg = await this.client.chat.completions.create({
      model,
      max_tokens: 4096,
      messages: [
        { role: 'system', content: systemPrompt + '\n\nYou MUST respond with valid JSON only.' },
        ...userMessages.map((content) => ({ role: 'user' as const, content })),
      ],
      response_format: { type: 'json_object' },
    });

    const content = msg.choices[0]?.message?.content;
    if (!content) throw new Error(`${this.providerName} returned empty response`);
    return JSON.parse(content);
  }
}

// ─── Factory ───────────────────────────────────────────────────────────

export function createProvider(config: ProviderConfig): LLMProvider {
  switch (config.provider) {
    case 'anthropic':
      return new AnthropicProvider(config);
    case 'openai':
      return new OpenAIProvider(config);
    case 'google':
      return new GoogleProvider(config);
    case 'deepseek':
    case 'xai':
    case 'openrouter':
    case 'ollama':
      return new OpenAICompatibleProvider(config);
    default:
      throw new Error(`Unknown provider: ${String(config.provider)}`);
  }
}

export function getResponseSchema(): Record<string, unknown> {
  return RESPONSE_SCHEMA;
}
