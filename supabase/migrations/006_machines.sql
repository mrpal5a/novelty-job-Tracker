-- ============================================================
-- LABEL PRINTING JOB TRACKING SYSTEM
-- Migration 006: machines + machine_queue_items
-- ============================================================
-- Production machine board. Consolidates original 009 (tables) + 010
-- (labels_per_hour throughput column).
--
--   machines: printing machines — dynamic list. is_active=false marks a
--     fault ("not working as of now"); is_retired=true removes the
--     machine from the board while keeping its printing history intact.
--   machine_queue_items: jobs queued on a machine in sequence. Production
--     enters estimated start/finish; actual started_at / completed_at are
--     stamped automatically when they press Start / Complete. Done items
--     are never deleted — they are the per-machine printing history.
--   Unfinished items simply stay queued, so they carry forward to the
--   next day automatically.
-- ============================================================

CREATE TABLE machines (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name             TEXT NOT NULL,
  location         TEXT,
  is_active        BOOLEAN NOT NULL DEFAULT true,
  is_retired       BOOLEAN NOT NULL DEFAULT false,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Normal run rate in labels/hour, used to estimate finish times instead
  -- of Production typing them in for every job. NULL = no automatic
  -- estimate; anything typed by hand always wins.
  labels_per_hour  INTEGER CHECK (labels_per_hour IS NULL OR labels_per_hour > 0)
);

COMMENT ON COLUMN machines.labels_per_hour IS
  'Normal run rate in labels/hour. NULL = no automatic finish estimate.';

CREATE TABLE machine_queue_items (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  machine_id   UUID NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
  job_id       UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  position     INTEGER NOT NULL DEFAULT 0,
  est_start_at TIMESTAMPTZ,
  est_end_at   TIMESTAMPTZ,
  started_at   TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  status       TEXT NOT NULL DEFAULT 'queued'
               CHECK (status IN ('queued', 'printing', 'done')),
  created_by   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_mqi_machine_active
  ON machine_queue_items (machine_id, position) WHERE status <> 'done';
CREATE INDEX idx_mqi_completed_at
  ON machine_queue_items (completed_at) WHERE status = 'done';
-- A job appears at most once per machine while active; history rows never
-- block re-queueing the same job later.
CREATE UNIQUE INDEX idx_mqi_machine_job_active
  ON machine_queue_items (machine_id, job_id) WHERE status <> 'done';

-- Deny-by-default: only the service role (our API routes) touches these.
ALTER TABLE machines ENABLE ROW LEVEL SECURITY;
ALTER TABLE machine_queue_items ENABLE ROW LEVEL SECURITY;
