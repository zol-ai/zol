import { requirePool, getPool } from "./db";

export type CallRow = {
  id: string;
  call_sid: string;
  stream_sid: string | null;
  from_number: string | null;
  to_number: string | null;
  direction: string;
  status: string;
  started_at: Date;
  ended_at: Date | null;
  duration_seconds: number | null;
  summary: string | null;
  intent: string | null;
  outcome: string | null;
  recording_url: string | null;
  recording_sid: string | null;
  transferred_at: Date | null;
  transfer_reason: string | null;
};

export type TurnRow = {
  id: string;
  role: "caller" | "agent" | "system";
  content: string;
  at: Date;
};

/** Insert the call row on the first Twilio webhook. Idempotent on call_sid. */
export async function startCall(input: {
  callSid: string;
  from?: string;
  to?: string;
  direction?: string;
}): Promise<void> {
  await requirePool().query(
    `insert into calls (call_sid, from_number, to_number, direction)
     values ($1, $2, $3, $4)
     on conflict (call_sid) do nothing`,
    [input.callSid, input.from ?? null, input.to ?? null, input.direction ?? "inbound"],
  );
}

export async function attachStream(callSid: string, streamSid: string): Promise<void> {
  await requirePool().query(
    `update calls set stream_sid = $2, updated_at = now() where call_sid = $1`,
    [callSid, streamSid],
  );
}

export async function appendTurn(
  callSid: string,
  role: TurnRow["role"],
  content: string,
): Promise<void> {
  if (!content.trim()) return;
  await requirePool().query(
    `insert into call_turns (call_id, role, content)
     select id, $2, $3 from calls where call_sid = $1`,
    [callSid, role, content],
  );
}

export async function finishCall(input: {
  callSid: string;
  status: string;
  durationSeconds?: number;
  recordingUrl?: string;
}): Promise<void> {
  await requirePool().query(
    `update calls
       set status = $2,
           ended_at = coalesce(ended_at, now()),
           duration_seconds = coalesce($3, duration_seconds),
           recording_url = coalesce($4, recording_url),
           updated_at = now()
     where call_sid = $1`,
    [input.callSid, input.status, input.durationSeconds ?? null, input.recordingUrl ?? null],
  );
}

export async function saveRecordingSid(callSid: string, recordingSid: string): Promise<void> {
  await requirePool().query(
    `update calls set recording_sid = $2, updated_at = now() where call_sid = $1`,
    [callSid, recordingSid],
  );
}

export async function saveRecording(
  callSid: string,
  recordingSid: string,
  recordingUrl: string,
): Promise<void> {
  await requirePool().query(
    `update calls set recording_sid = $2, recording_url = $3, updated_at = now()
     where call_sid = $1`,
    [callSid, recordingSid, recordingUrl],
  );
}

export async function markTransferred(callSid: string, reason: string): Promise<void> {
  await requirePool().query(
    `update calls set transferred_at = now(), transfer_reason = $2, outcome = 'transferred',
            updated_at = now()
     where call_sid = $1`,
    [callSid, reason],
  );
}

export async function saveAnalysis(
  callSid: string,
  analysis: { summary: string; intent: string; outcome: string },
): Promise<void> {
  await requirePool().query(
    `update calls
        set summary = $2, intent = $3,
            outcome = case when transferred_at is not null then 'transferred' else $4 end,
            updated_at = now()
      where call_sid = $1`,
    [callSid, analysis.summary, analysis.intent, analysis.outcome],
  );
}

export async function listCalls(limit = 100): Promise<CallRow[] | null> {
  const pool = getPool();
  if (!pool) return null;
  const { rows } = await pool.query<CallRow>(
    `select * from calls order by started_at desc limit $1`,
    [limit],
  );
  return rows;
}

export async function getCall(id: string): Promise<{ call: CallRow; turns: TurnRow[] } | null> {
  const pool = getPool();
  if (!pool) return null;
  const callRes = await pool.query<CallRow>(`select * from calls where id = $1`, [id]);
  const call = callRes.rows[0];
  if (!call) return null;
  const turnsRes = await pool.query<TurnRow>(
    `select id, role, content, at from call_turns where call_id = $1 order by at, id`,
    [id],
  );
  return { call, turns: turnsRes.rows };
}

export async function getTranscript(callSid: string): Promise<TurnRow[]> {
  const { rows } = await requirePool().query<TurnRow>(
    `select t.id, t.role, t.content, t.at
       from call_turns t join calls c on c.id = t.call_id
      where c.call_sid = $1 order by t.at, t.id`,
    [callSid],
  );
  return rows;
}

export async function callStats(): Promise<{
  total: number;
  today: number;
  avgDuration: number | null;
} | null> {
  const pool = getPool();
  if (!pool) return null;
  const { rows } = await pool.query<{ total: string; today: string; avg: string | null }>(
    `select count(*)::text as total,
            count(*) filter (where started_at >= date_trunc('day', now()))::text as today,
            avg(duration_seconds)::text as avg
       from calls`,
  );
  const r = rows[0];
  return {
    total: Number(r.total),
    today: Number(r.today),
    avgDuration: r.avg ? Math.round(Number(r.avg)) : null,
  };
}
