-- Editable agent configuration (single row) and recording/transfer bookkeeping.

create table if not exists agent_settings (
  id            integer primary key check (id = 1),
  instructions  text not null,
  voice         text not null default 'marin',
  updated_at    timestamptz not null default now()
);

alter table calls add column if not exists recording_sid   text;
alter table calls add column if not exists transferred_at  timestamptz;
alter table calls add column if not exists transfer_reason text;
