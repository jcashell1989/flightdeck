/**
 * Compatibility shim — re-exports from the canonical adapter location.
 * Phase 7: OpencodeInstanceClient moved to adapters/opencode-http/client.ts.
 * This file stays so that opencode/registry.ts and ipc/opencode.ts
 * (both kept for reference during transition) continue to compile.
 */
export { OpencodeInstanceClient } from '../adapters/opencode-http/client'
