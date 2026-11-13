// The pipeline rules every status change is judged by. Pure, so these pin the
// rules themselves: what comes before what, what a Repeat job skips, and what
// counts as moving backward.

import { describe, it, expect } from 'vitest';
import {
  STAGES, PIPELINE_STAGES, STAGE_PREREQUISITES, REPEAT_SKIPPED_STAGES,
  getPrerequisite, getVisibleStages, isStageSkipped, getProgressPercent,
  stageIndex, effectiveStageIndex, isBackwardMove, isPerReleaseStage,
} from './stages';

describe('the stage lists agree with each other', () => {
  it('every stage has a prerequisite entry, and every prerequisite is a real stage', () => {
    for (const s of STAGES) {
      expect(STAGE_PREREQUISITES).toHaveProperty([s]);
      const p = STAGE_PREREQUISITES[s];
      if (p) expect(STAGES).toContain(p);
    }
  });

  it('a pipeline stage comes after its own prerequisite', () => {
    for (const s of PIPELINE_STAGES) {
      const p = STAGE_PREREQUISITES[s];
      if (p) expect(stageIndex(p)).toBeLessThan(stageIndex(s));
    }
  });

  it('On Hold and PO Closed sit outside the pipeline', () => {
    expect(stageIndex('On Hold')).toBe(-1);
    expect(stageIndex('PO Closed')).toBe(-1);
  });
});

describe('Repeat jobs', () => {
  it('skip sample printing and both shade card stages', () => {
    const visible = getVisibleStages('Repeat');
    for (const s of REPEAT_SKIPPED_STAGES) {
      expect(visible).not.toContain(s);
      expect(isStageSkipped(s, 'Repeat')).toBe(true);
      expect(isStageSkipped(s, 'New')).toBe(false);
      expect(isStageSkipped(s, 'Artwork Changed')).toBe(false);
    }
    expect(visible).toHaveLength(PIPELINE_STAGES.length - 3);
  });

  it('go to printing straight from the job card', () => {
    expect(getPrerequisite('In Printing', 'Repeat')).toBe('Job Card Done');
    expect(getPrerequisite('In Printing', 'New')).toBe('Shade Card Approved');
  });

  it('never have a skipped stage as a prerequisite', () => {
    for (const s of getVisibleStages('Repeat')) {
      const p = getPrerequisite(s, 'Repeat');
      if (p) expect(REPEAT_SKIPPED_STAGES).not.toContain(p);
    }
  });
});

describe('getProgressPercent', () => {
  it('counts only the stages this job type has', () => {
    expect(getProgressPercent([], 'New')).toBe(0);
    expect(getProgressPercent([...PIPELINE_STAGES], 'New')).toBe(100);
    expect(getProgressPercent(getVisibleStages('Repeat'), 'Repeat')).toBe(100);
  });

  it('ignores On Hold and PO Closed stamps', () => {
    expect(getProgressPercent(['On Hold', 'PO Closed'], 'New')).toBe(0);
  });
});

describe('isBackwardMove', () => {
  it('earlier stage is backward, later or same is not', () => {
    expect(isBackwardMove('Packing', 'Plate Status')).toBe(true);
    expect(isBackwardMove('Plate Status', 'Packing')).toBe(false);
    expect(isBackwardMove('Packing', 'Packing')).toBe(false);
  });

  it('On Hold and PO Closed are reachable from anywhere', () => {
    expect(isBackwardMove('Dispatched', 'On Hold')).toBe(false);
    expect(isBackwardMove('Dispatched', 'PO Closed')).toBe(false);
  });

  it('a held job is measured by the furthest stage it reached', () => {
    const reached = ['PO Received', 'Artwork Pending', 'Packing'] as const;
    expect(effectiveStageIndex('On Hold', [...reached])).toBe(stageIndex('Packing'));
    expect(isBackwardMove('On Hold', 'Plate Status', [...reached])).toBe(true);
    expect(isBackwardMove('On Hold', 'Packing', [...reached])).toBe(false);
    expect(isBackwardMove('On Hold', 'Ready to Dispatch', [...reached])).toBe(false);
  });

  it('a held job with no stamps can go anywhere', () => {
    expect(isBackwardMove('On Hold', 'PO Received')).toBe(false);
  });

  it('nothing in the pipeline is forward of a closed PO', () => {
    expect(isBackwardMove('PO Closed', 'Dispatched')).toBe(true);
  });
});

describe('isPerReleaseStage', () => {
  it('prepress and shade approval stay on the job; printing onward is per release', () => {
    expect(isPerReleaseStage('Plate Status')).toBe(false);
    expect(isPerReleaseStage('Shade Card Approved')).toBe(false);
    expect(isPerReleaseStage('In Printing')).toBe(true);
    expect(isPerReleaseStage('Dispatched')).toBe(true);
    expect(isPerReleaseStage('On Hold')).toBe(false);
    expect(isPerReleaseStage('PO Closed')).toBe(false);
  });
});
