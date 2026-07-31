import { describe, it, expect } from 'vitest';
import type { Logger, AIProvider } from './index.js';
describe('SDK Interfaces', () => {
  it('Logger interface is defined', () => { const _l: Logger = { debug(){}, info(){}, warn(){}, error(){}, fatal(){}, child: () => ({} as Logger), setLevel(){} }; expect(_l).toBeDefined(); });
  it('AIProvider interface is defined', () => { const _p: AIProvider = { generate: async () => ({ content:'', usage:{promptTokens:0,completionTokens:0,totalTokens:0,estimatedCostUSD:0}, model:'test', requestId:'test' }), isAvailable: () => true, estimateCost: async () => ({estimatedCostUSD:0,estimatedTokens:0}) }; expect(_p).toBeDefined(); });
});
