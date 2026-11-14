-- Calls handled by the voice agent, one row per Twilio call.
create extension if not exists pgcrypto;

create table if not exists calls (
  id               uuid primary key default gen_random_uuid(),
  call_sid         text not null unique,
  stream_sid       text,
  from_number      text,                       -- E.164
  to_number        text,                       -- E.164
  direction        text not null default 'inbound',
  status           text not null default 'in-progress',
  started_at       timestamptz not null default now(),
  ended_at         timestamptz,
  duration_seconds integer,
  summary          text,
  intent           text,
  outcome          text,
  recording_url    text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists calls_started_at_idx on calls (started_at desc);
create index if not exists calls_from_number_idx on calls (from_number);

-- Transcript, one row per utterance.
create table if not exists call_turns (
  id        bigserial primary key,
  call_id   uuid not null references calls(id) on delete cascade,
  role      text not null check (role in ('caller', 'agent', 'system')),
  content   text not null,
  at        timestamptz not null default now()
);

create index if not exists call_turns_call_id_at_idx on call_turns (call_id, at);
