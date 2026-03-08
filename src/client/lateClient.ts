// Re-export everything from the new direct HTTP client
// This file exists for backward compatibility — all tool files import from here
export { LateApiClient, getClient, resetClient, toApiPlatform, toDisplayPlatform } from './lateApi.js';
