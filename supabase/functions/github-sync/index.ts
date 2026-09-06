import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';

const GATEWAY_URL = 'https://connector-gateway.lovable.dev/github';

type Action = 'overview' | 'file' | 'tree';

async function gh(path: string) {
  const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
  const GITHUB_API_KEY = Deno.env.get('GITHUB_API_KEY');
  if (!LOVABLE_API_KEY) throw new Error('LOVABLE_API_KEY is not configured');
  if (!GITHUB_API_KEY) throw new Error('GITHUB_API_KEY is not configured');

  const res = await fetch(`${GATEWAY_URL}/${path}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      'X-Connection-Api-Key': GITHUB_API_KEY,
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`[${res.status}] ${body}`);
  }
  return res.json();
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    // Require an authenticated app user — this proxies workspace GitHub credentials.
    const authHeader = req.headers.get('Authorization') ?? '';
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: userData } = await supabase.auth.getUser();
    if (!userData?.user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json().catch(() => ({}));
    const action: Action = body.action ?? 'overview';
    const owner = String(body.owner ?? '93jessycollin93-del');
    const repo = String(body.repo ?? 'sas-jacky');
    if (!/^[\w.-]+$/.test(owner) || !/^[\w.-]+$/.test(repo)) {
      return new Response(JSON.stringify({ error: 'Invalid owner/repo' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const base = `repos/${owner}/${repo}`;

    if (action === 'file') {
      const path = String(body.path ?? '');
      if (!path || path.includes('..')) {
        return new Response(JSON.stringify({ error: 'Invalid path' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const file = await gh(`${base}/contents/${path.split('/').map(encodeURIComponent).join('/')}`);
      const content = file.encoding === 'base64' && file.content
        ? new TextDecoder().decode(
            Uint8Array.from(atob(String(file.content).replace(/\n/g, '')), (c) => c.charCodeAt(0)),
          )
        : '';
      return new Response(JSON.stringify({ path: file.path, size: file.size, sha: file.sha, content }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'tree') {
      const branch = String(body.branch ?? '');
      const repoInfo = branch ? null : await gh(base);
      const ref = branch || repoInfo!.default_branch;
      const tree = await gh(`${base}/git/trees/${encodeURIComponent(ref)}?recursive=1`);
      return new Response(
        JSON.stringify({
          ref,
          truncated: tree.truncated,
          files: (tree.tree ?? [])
            .filter((n: { type: string }) => n.type === 'blob')
            .map((n: { path: string; size?: number; sha: string }) => ({ path: n.path, size: n.size, sha: n.sha })),
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // overview
    const repoInfo = await gh(base);
    const branch = repoInfo.default_branch;
    const [commits, pulls, branches] = await Promise.all([
      gh(`${base}/commits?sha=${encodeURIComponent(branch)}&per_page=20`),
      gh(`${base}/pulls?state=open&per_page=20&sort=updated&direction=desc`),
      gh(`${base}/branches?per_page=50`),
    ]);

    // Conflict detection: open PRs that GitHub reports as not mergeable.
    const conflicts: Array<{ number: number; title: string; state: string; url: string }> = [];
    for (const pr of pulls.slice(0, 10)) {
      try {
        const detail = await gh(`${base}/pulls/${pr.number}`);
        if (detail.mergeable === false || detail.mergeable_state === 'dirty') {
          conflicts.push({
            number: detail.number,
            title: detail.title,
            state: detail.mergeable_state ?? 'dirty',
            url: detail.html_url,
          });
        }
      } catch (_) { /* skip PRs we cannot inspect */ }
    }

    return new Response(
      JSON.stringify({
        fetchedAt: new Date().toISOString(),
        repo: {
          fullName: repoInfo.full_name,
          private: repoInfo.private,
          defaultBranch: branch,
          pushedAt: repoInfo.pushed_at,
          updatedAt: repoInfo.updated_at,
          htmlUrl: repoInfo.html_url,
          openIssues: repoInfo.open_issues_count,
          language: repoInfo.language,
        },
        branches: branches.map((b: { name: string; commit: { sha: string } }) => ({
          name: b.name,
          sha: b.commit?.sha,
        })),
        commits: commits.map((c: Record<string, any>) => ({
          sha: c.sha,
          message: c.commit?.message ?? '',
          author: c.commit?.author?.name ?? c.author?.login ?? 'unknown',
          date: c.commit?.author?.date,
          url: c.html_url,
        })),
        pulls: pulls.map((p: Record<string, any>) => ({
          number: p.number,
          title: p.title,
          author: p.user?.login,
          branch: `${p.head?.ref} → ${p.base?.ref}`,
          draft: p.draft,
          updatedAt: p.updated_at,
          url: p.html_url,
        })),
        conflicts,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('github-sync failed:', message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
