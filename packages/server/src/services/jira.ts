export interface JiraConfig {
  baseUrl: string;
  email: string;
  apiToken: string;
}

export interface DoneTicket { key: string; summary: string; url: string; resolvedAt: number }

const authHeader = (cfg: JiraConfig) => `Basic ${Buffer.from(`${cfg.email}:${cfg.apiToken}`).toString('base64')}`;

// Messages carry only the status and response body: never headers, the token or its base64 form.
async function fail(res: Response): Promise<never> {
  const text = (await res.text()).slice(0, 200);
  console.error(`[visitors] jira request failed: ${res.status}`);
  throw new Error(`[jira] ${res.status}: ${text}`);
}

export async function jiraMyself(cfg: JiraConfig, fetchImpl: typeof fetch = fetch): Promise<void> {
  const res = await fetchImpl(`${cfg.baseUrl}/rest/api/3/myself`, {
    method: 'GET',
    headers: { Authorization: authHeader(cfg), Accept: 'application/json' },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) return fail(res);
}

function post(cfg: JiraConfig, body: Record<string, unknown>, fetchImpl: typeof fetch): Promise<Response> {
  return fetchImpl(`${cfg.baseUrl}/rest/api/3/search/jql`, {
    method: 'POST',
    headers: { Authorization: authHeader(cfg), Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
}

// JQL takes "yyyy-MM-dd HH:mm" in the Jira user's timezone; callers pass a lookback wide enough to cover it.
const jqlDate = (iso: string): string => new Date(iso).toISOString().slice(0, 16).replace('T', ' ');

export async function fetchDoneTickets(cfg: JiraConfig, sinceIso: string, fetchImpl: typeof fetch = fetch): Promise<DoneTicket[]> {
  const jql = `assignee = currentUser() AND statusCategory = Done AND statusCategoryChangedDate >= "${jqlDate(sinceIso)}"`;
  const out: DoneTicket[] = [];
  let nextPageToken: string | undefined;
  for (;;) {
    const res: Response = await post(cfg, {
      jql, fields: ['summary', 'statuscategorychangedate'], maxResults: 100,
      ...(nextPageToken ? { nextPageToken } : {}),
    }, fetchImpl);
    if (!res.ok) return fail(res);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const json: any = await res.json();
    for (const i of json.issues ?? []) {
      out.push({
        key: i.key,
        summary: i.fields.summary,
        url: `${cfg.baseUrl}/browse/${i.key}`,
        resolvedAt: Math.floor(Date.parse(i.fields.statuscategorychangedate) / 1000),
      });
    }
    if (!json.nextPageToken) return out;
    nextPageToken = json.nextPageToken;
  }
}
