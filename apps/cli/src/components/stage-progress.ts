export type StageStatus = 'pending' | 'running' | 'success' | 'failed' | 'skipped';

export interface StageItem {
  name: string;
  status: StageStatus;
  detail?: string;
}

export function renderStageProgress(stages: StageItem[]): string {
  if (stages.length === 0) return '';

  const statusIcons: Record<StageStatus, string> = {
    pending: '[ ]',
    running: '[●]',
    success: '[✔]',
    failed: '[✖]',
    skipped: '[-]',
  };

  const steps = stages.map((s) => `${statusIcons[s.status]} ${s.name}`);
  const pipeline = steps.join(' ─── ');

  const details: string[] = [];
  for (const s of stages) {
    if (s.detail) {
      details.push(`  * ${s.name}: ${s.detail}`);
    }
  }

  const lines = [pipeline];
  if (details.length > 0) {
    lines.push('');
    lines.push('Details:');
    lines.push(...details);
  }

  return lines.join('\n');
}
