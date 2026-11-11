const VERCEL_WORKFLOW_WORLDS = new Set(['vercel', '@workflow/world-vercel']);

export function preferManagedVercelWorkflowWorld() {
  if (process.env.VERCEL !== '1') return;
  if (!process.env.WORKFLOW_TARGET_WORLD || VERCEL_WORKFLOW_WORLDS.has(process.env.WORKFLOW_TARGET_WORLD)) return;
  console.warn('[holofolder] Using managed Vercel Workflow on Vercel.');
  process.env.WORKFLOW_TARGET_WORLD = 'vercel';
}
