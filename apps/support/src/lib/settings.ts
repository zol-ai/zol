import { getPool, requirePool } from "./db";
import { env } from "./env";
import { DEFAULT_INSTRUCTIONS } from "./agent/prompt";

export type AgentSettings = {
  instructions: string;
  voice: string;
  updatedAt: Date | null;
  /** True when the row came from the database rather than the built-in default. */
  fromDatabase: boolean;
};

export const VOICES = ["marin", "cedar", "alloy", "ash", "ballad", "coral", "echo", "sage", "shimmer", "verse"] as const;

function defaults(): AgentSettings {
  return {
    instructions: DEFAULT_INSTRUCTIONS,
    voice: env.openaiVoice(),
    updatedAt: null,
    fromDatabase: false,
  };
}

/** Current settings; falls back to the built-in default if the DB is unset or down. */
export async function getAgentSettings(): Promise<AgentSettings> {
  const pool = getPool();
  if (!pool) return defaults();
  try {
    const { rows } = await pool.query<{ instructions: string; voice: string; updated_at: Date }>(
      `select instructions, voice, updated_at from agent_settings where id = 1`,
    );
    const row = rows[0];
    if (!row) return defaults();
    return { instructions: row.instructions, voice: row.voice, updatedAt: row.updated_at, fromDatabase: true };
  } catch (err) {
    console.error("getAgentSettings failed, using defaults", err);
    return defaults();
  }
}

export async function saveAgentSettings(input: { instructions: string; voice: string }): Promise<void> {
  await requirePool().query(
    `insert into agent_settings (id, instructions, voice, updated_at)
     values (1, $1, $2, now())
     on conflict (id) do update set instructions = excluded.instructions,
                                   voice = excluded.voice,
                                   updated_at = now()`,
    [input.instructions, input.voice],
  );
}
