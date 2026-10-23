import { useEffect, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { cardState, type CardState } from '../lib/connect';
import { timeAgo } from '../lib/format';
import { uiEvent } from '../lib/telemetry';
import { Loading, btnPrimary, btnSecondary, inputCls, pageTitle, surface } from '../components/ui';

const PILL: Record<CardState, string> = {
  connected: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
  error: 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300',
  'not-connected': 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400',
};
const PILL_LABEL: Record<CardState, string> = {
  connected: 'Connected',
  error: 'Needs attention',
  'not-connected': 'Not connected',
};

function Card({ title, blurb, state, pill, error, children }: {
  title: string; blurb: string; state: CardState; pill?: string; error?: string | null; children: ReactNode;
}) {
  return (
    <section className={`${surface} p-5`}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold">{title}</h2>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${PILL[state]}`}>{pill ?? PILL_LABEL[state]}</span>
      </div>
      <p className="mt-1 text-sm text-zinc-500">{blurb}</p>
      {error && <p role="alert" className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">{error}</p>}
      <div className="mt-4 space-y-3">{children}</div>
    </section>
  );
}

const labelCls = 'block text-xs font-medium text-zinc-500';

export function ConnectView() {
  useEffect(() => uiEvent('connect.view'), []);
  const qc = useQueryClient();
  const status = useQuery({ queryKey: ['reef', 'connect'], queryFn: api.connect.status });
  const [token, setToken] = useState('');
  const [orgsText, setOrgsText] = useState<string | null>(null);
  const [baseUrl, setBaseUrl] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [apiToken, setApiToken] = useState('');

  const done = () => void qc.invalidateQueries({ queryKey: ['reef'] });
  const syncLimits = useMutation({ mutationFn: api.reef.refreshLimits, onSuccess: done });
  const saveGh = useMutation({
    mutationFn: (body: Parameters<typeof api.connect.saveGithub>[0]) => api.connect.saveGithub(body),
    onSuccess: () => { setToken(''); done(); },
  });
  const saveOrgs = useMutation({ mutationFn: api.connect.saveGithubOrgs, onSuccess: () => { setOrgsText(null); done(); } });
  const dropGh = useMutation({ mutationFn: api.connect.disconnectGithub, onSuccess: done });
  const saveJira = useMutation({ mutationFn: api.connect.saveJira, onSuccess: () => { setApiToken(''); done(); } });
  const dropJira = useMutation({ mutationFn: api.connect.disconnectJira, onSuccess: done });

  if (status.isLoading) return <Loading />;
  if (!status.data) return <p className="p-10 text-center text-sm text-red-600">Could not load connections.</p>;
  const { claude, github, jira } = status.data;

  const actionError = (m: { error: unknown }) => (m.error instanceof Error ? m.error.message : null);
  const orgs = orgsText ?? github.orgs.join(', ');
  const jiraUrl = baseUrl ?? jira.baseUrl ?? '';
  const jiraEmail = email ?? jira.email ?? '';

  return (
    <main className="mx-auto max-w-2xl space-y-4 p-6">
      <div>
        <h1 className={pageTitle}>Connect</h1>
        <p className="text-sm text-zinc-500">Optional. The Great Token Reef works without any of these.</p>
      </div>

      <Card
        title="Claude"
        blurb="Adds your real 5-hour and 7-day plan limits to the water and current."
        state={cardState(claude)}
        pill={claude.detected ? 'Detected' : 'Not detected'}
        error={actionError(syncLimits)}
      >
        <div className="flex items-center gap-3">
          <button
            className={`${btnSecondary} px-3 py-1.5 text-sm`}
            disabled={!claude.detected || syncLimits.isPending}
            onClick={() => { uiEvent('reef.limits.sync'); syncLimits.mutate(); }}
          >
            {syncLimits.isPending ? 'Syncing…' : 'Sync limits'}
          </button>
          {claude.limitsFetchedAt != null && <span className="text-xs text-zinc-400">Last synced {timeAgo(claude.limitsFetchedAt)}</span>}
        </div>
        <p className="text-xs text-zinc-400">Uses an unofficial Anthropic endpoint; it may stop working without notice.</p>
      </Card>

      <Card
        title="GitHub"
        blurb="Adds visitors for your merged pull requests and shows your open ones in fullscreen."
        state={cardState(github)}
        pill={github.connected && !github.error && github.login ? `Connected as ${github.login}` : undefined}
        error={github.error ?? actionError(saveGh) ?? actionError(saveOrgs) ?? actionError(dropGh)}
      >
        <div className="flex flex-wrap items-end gap-2">
          <button
            className={`${btnPrimary} px-3 py-1.5 text-sm`}
            disabled={saveGh.isPending}
            onClick={() => { uiEvent('connect.github.save', 'gh'); saveGh.mutate({ source: 'gh' }); }}
          >
            Use gh CLI
          </button>
          <span className="pb-1.5 text-xs text-zinc-400">or</span>
          <label className="min-w-0 flex-1">
            <span className={labelCls}>Personal access token</span>
            <input
              type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)}
              placeholder={github.source === 'token' ? 'Stored in your Keychain' : 'ghp_…'}
              className={`${inputCls} mt-1 w-full px-2 py-1.5 text-sm`}
            />
          </label>
          <button
            className={`${btnSecondary} px-3 py-1.5 text-sm`}
            disabled={!token.trim() || saveGh.isPending}
            onClick={() => { uiEvent('connect.github.save', 'token'); saveGh.mutate({ source: 'token', token: token.trim() }); }}
          >
            Save
          </button>
        </div>
        <div className="flex items-end gap-2">
          <label className="min-w-0 flex-1">
            <span className={labelCls}>Organizations (comma-separated, empty = all)</span>
            <input value={orgs} onChange={(e) => setOrgsText(e.target.value)} className={`${inputCls} mt-1 w-full px-2 py-1.5 text-sm`} />
          </label>
          <button
            className={`${btnSecondary} px-3 py-1.5 text-sm`}
            disabled={orgsText === null || saveOrgs.isPending}
            onClick={() => {
              uiEvent('connect.github.orgs');
              saveOrgs.mutate(orgs.split(',').map((o) => o.trim()).filter(Boolean));
            }}
          >
            Save orgs
          </button>
        </div>
        {github.source && (
          <button
            className="text-sm text-red-600 hover:underline disabled:opacity-40 dark:text-red-400"
            disabled={dropGh.isPending}
            onClick={() => { uiEvent('connect.github.disconnect'); dropGh.mutate(); }}
          >
            Disconnect
          </button>
        )}
      </Card>

      <Card
        title="Jira"
        blurb="Adds visitors for tickets you finish."
        state={cardState(jira)}
        error={jira.error ?? actionError(saveJira) ?? actionError(dropJira)}
      >
        <label className="block">
          <span className={labelCls}>Base URL</span>
          <input value={jiraUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://your-team.atlassian.net" className={`${inputCls} mt-1 w-full px-2 py-1.5 text-sm`} />
        </label>
        <label className="block">
          <span className={labelCls}>Email</span>
          <input type="email" value={jiraEmail} onChange={(e) => setEmail(e.target.value)} className={`${inputCls} mt-1 w-full px-2 py-1.5 text-sm`} />
        </label>
        <label className="block">
          <span className={labelCls}>API token</span>
          <input
            type="password" autoComplete="off" value={apiToken} onChange={(e) => setApiToken(e.target.value)}
            placeholder={jira.connected ? 'Stored in your Keychain' : ''}
            className={`${inputCls} mt-1 w-full px-2 py-1.5 text-sm`}
          />
        </label>
        <div className="flex items-center gap-4">
          <button
            className={`${btnPrimary} px-3 py-1.5 text-sm`}
            disabled={!jiraUrl.trim() || !jiraEmail.trim() || !apiToken.trim() || saveJira.isPending}
            onClick={() => {
              uiEvent('connect.jira.save');
              saveJira.mutate({ baseUrl: jiraUrl.trim(), email: jiraEmail.trim(), apiToken: apiToken.trim() });
            }}
          >
            Save
          </button>
          {jira.connected && (
            <button
              className="text-sm text-red-600 hover:underline disabled:opacity-40 dark:text-red-400"
              disabled={dropJira.isPending}
              onClick={() => { uiEvent('connect.jira.disconnect'); dropJira.mutate(); }}
            >
              Disconnect
            </button>
          )}
        </div>
      </Card>
    </main>
  );
}
