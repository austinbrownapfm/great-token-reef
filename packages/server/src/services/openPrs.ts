import type { OpenPr } from '@gtr/shared';
import type { Db } from '../store/db.ts';
import { computeFeedback, computeNeedsMe, computePrState, type RawPr } from './prCompute.ts';

export function replaceOpenPrs(db: Db, me: string, prs: RawPr[]): number {
  db.exec('BEGIN');
  try {
    db.exec('DELETE FROM open_prs');
    const insert = db.prepare(
      `INSERT INTO open_prs (id, repo, number, title, url, state, needs_me, bot_findings, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const pr of prs) {
      const state = computePrState(pr, me);
      const fb = computeFeedback(pr, me);
      const needsMe = computeNeedsMe(state, pr.checks, fb.newFeedback);
      insert.run(`${pr.owner}/${pr.repo}#${pr.number}`, pr.repo, pr.number, pr.title, pr.url, state, needsMe ? 1 : 0, fb.botFindings, pr.createdAt);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return prs.length;
}

export function listOpenPrs(db: Db): OpenPr[] {
  const rows = db.prepare(
    'SELECT id, repo, number, title, url, state, needs_me, bot_findings, created_at FROM open_prs ORDER BY created_at DESC, id ASC',
  ).all() as { id: string; repo: string; number: number; title: string; url: string; state: OpenPr['state']; needs_me: number; bot_findings: number; created_at: number }[];
  return rows.map((r) => ({
    id: r.id, repo: r.repo, number: r.number, title: r.title, url: r.url, state: r.state,
    needsMe: r.needs_me === 1, botFindings: r.bot_findings, createdAt: r.created_at,
  }));
}
