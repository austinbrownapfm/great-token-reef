import { speciesName, type ReefCatch } from '@gtr/shared';

// SQL fragments and row mappers shared by the Reef's writers and readers.

export const TOK = '(input_tokens + output_tokens + cache_read_tokens + cache_w5m_tokens + cache_w1h_tokens)';
export const WINDOW_5H = 5 * 3600;

// The stored `name` column is a write-time snapshot kept for debugging; the
// catalog is the source of truth, so display names are DERIVED from the
// species index at the read boundary. Renaming a morph label is then a pure
// code change — no data migration. Legendaries keep their stored name
// (species 1000+ is a legendary id, not a catalog index).
export function deriveName<T extends { species: number; rarity: string; name: string }>(row: T): T {
  return row.rarity === 'legendary' ? row : { ...row, name: speciesName(row.species) };
}

/** A cc_catches row as stored: the API's ReefCatch adds the derived agent. */
export type CatchColumns = Omit<ReefCatch, 'agent'>;

// Codex session IDs are namespaced at ingestion; Claude IDs remain unchanged.
// Legendaries belong to the shared collection, not to either agent.
export function deriveCatch(row: CatchColumns): ReefCatch {
  return { ...deriveName(row), agent: row.rarity === 'legendary' ? null : row.session_id.startsWith('codex:') ? 'codex' : 'claude' };
}
