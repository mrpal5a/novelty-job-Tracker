-- ============================================================
-- Migration 108: who makes job cards, and deleting a wrong one
-- ============================================================
-- 1. job_card_edit: a feature ticked per department (Departments page). Given
--    here to the departments that could make cards until now (those with
--    job_separation_edit), so nobody loses access. Admin always has it.
--    Viewing needs no feature.
--
-- 2. An issued card can be deleted. Only Admin may, which the API checks
--    (is_super_admin); writes reach this table through the API alone. The
--    Activity Log keeps the deleted card with everything it said.
--    Deleting frees the number, so the right card can take it.
-- ============================================================

INSERT INTO public.department_feature_permissions (department_id, feature_key)
SELECT department_id, 'job_card_edit'
  FROM public.department_feature_permissions
 WHERE feature_key = 'job_separation_edit'
ON CONFLICT DO NOTHING;

DROP TRIGGER job_card_keep_consistent ON public.job_cards;
CREATE TRIGGER job_card_keep_consistent
  BEFORE INSERT OR UPDATE ON public.job_cards
  FOR EACH ROW EXECUTE FUNCTION public.job_card_keep_consistent();
