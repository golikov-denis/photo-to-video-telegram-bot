CREATE TABLE users (
  telegram_user_id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE generations (
  id UUID PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(telegram_user_id) ON DELETE CASCADE,
  chat_id TEXT NOT NULL,
  effect TEXT CHECK (effect IN ('NATURAL', 'CINEMATIC', 'CUSTOM')),
  custom_prompt TEXT,
  prompt_text TEXT,
  telegram_file_id TEXT NOT NULL,
  telegram_file_unique_id TEXT NOT NULL,
  declared_file_size BIGINT,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (
    status IN (
      'DRAFT', 'WAITING_FOR_PROMPT', 'CONFIRMED', 'UPLOADING', 'SUBMITTED',
      'PROCESSING', 'SUCCEEDED', 'SENT', 'FAILED', 'CANCELLED'
    )
  ),
  source_url TEXT,
  source_pathname TEXT,
  result_url TEXT,
  provider_task_id TEXT UNIQUE,
  safe_error TEXT,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  send_attempts INTEGER NOT NULL DEFAULT 0 CHECK (send_attempts >= 0),
  poll_lease_until TIMESTAMPTZ,
  delivery_lease_until TIMESTAMPTZ,
  confirmed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE dialog_states (
  user_id TEXT PRIMARY KEY REFERENCES users(telegram_user_id) ON DELETE CASCADE,
  current_generation_id UUID NOT NULL REFERENCES generations(id) ON DELETE CASCADE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE processed_updates (
  update_id BIGINT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE rate_limit_buckets (
  user_id TEXT NOT NULL REFERENCES users(telegram_user_id) ON DELETE CASCADE,
  bucket_start TIMESTAMPTZ NOT NULL,
  request_count INTEGER NOT NULL,
  PRIMARY KEY (user_id, bucket_start)
);

CREATE INDEX generations_user_created_idx ON generations(user_id, created_at DESC);
CREATE INDEX generations_confirmed_idx ON generations(confirmed_at)
  WHERE confirmed_at IS NOT NULL;
CREATE INDEX generations_poll_idx ON generations(status, poll_lease_until)
  WHERE status IN ('SUBMITTED', 'PROCESSING');
CREATE INDEX generations_delivery_idx ON generations(status, delivery_lease_until)
  WHERE status = 'SUCCEEDED';
CREATE INDEX generations_cleanup_idx ON generations(created_at)
  WHERE source_pathname IS NOT NULL;
CREATE INDEX processed_updates_created_idx ON processed_updates(created_at);
