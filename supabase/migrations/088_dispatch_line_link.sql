-- ============================================================
-- 088_dispatch_line_link.sql
-- Tie a dispatch entry to the exact Job Separation line it ships.
--
-- Entries still match by PO + PM code when read (085). That can't choose
-- between two lines with the same PO and PM code, or find a line when the PO
-- was typed differently, so someone picks the line by hand and it's kept
-- here. A link wins over PO + PM matching. If the linked line is cancelled the
-- entry counts against no line until it's linked again: it never moves to
-- another line by itself.
-- ============================================================

ALTER TABLE pending_dispatch_notifications
  ADD COLUMN line_id   UUID REFERENCES job_separations(id) ON DELETE SET NULL,
  ADD COLUMN linked_by TEXT,
  ADD COLUMN linked_at TIMESTAMPTZ;

CREATE INDEX idx_pending_dispatch_notifications_line
  ON pending_dispatch_notifications (line_id)
  WHERE line_id IS NOT NULL;
