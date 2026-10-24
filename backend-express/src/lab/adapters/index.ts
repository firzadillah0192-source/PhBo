import type { LabAdapter, ProviderType } from '../types.js';
import { falAdapter } from './fal.js';
import { nineRouterAdapter, openaiAdapter, openaiCompatibleAdapter } from './openai.js';
import { recraftAdapter } from './recraft.js';
import { runwayAdapter } from './runway.js';
import { wavespeedAdapter } from './wavespeed.js';

// custom_rest providers can be registered and validated, but have no generic adapter: arbitrary request/response
// shapes cannot be executed safely, so they stay unavailable until a dedicated adapter is written.
export const ADAPTERS: Partial<Record<ProviderType, LabAdapter>> = { wavespeed: wavespeedAdapter, openai: openaiAdapter, openai_compatible: openaiCompatibleAdapter, fal: falAdapter, '9router': nineRouterAdapter, recraft: recraftAdapter, runway: runwayAdapter };
