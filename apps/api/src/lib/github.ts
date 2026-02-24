export const ROLLING_COMMENT_MARKER = "<!-- vibent-evidence -->";

export interface GithubClient {
  checks: {
    listForRef(args: { owner: string; repo: string; ref: string }): Promise<{ data: { check_runs: Array<{ id: number; name: string }> } }>;
    update(args: {
      owner: string;
      repo: string;
      check_run_id: number;
      name: string;
      head_sha: string;
      status: "completed";
      conclusion: "success" | "failure";
      output: { title: string; summary: string };
    }): Promise<unknown>;
    create(args: {
      owner: string;
      repo: string;
      name: string;
      head_sha: string;
      status: "completed";
      conclusion: "success" | "failure";
      output: { title: string; summary: string };
    }): Promise<unknown>;
  };
  issues: {
    listComments(args: { owner: string; repo: string; issue_number: number }): Promise<{ data: Array<{ id: number; body: string }> }>;
    updateComment(args: { owner: string; repo: string; comment_id: number; body: string }): Promise<unknown>;
    createComment(args: { owner: string; repo: string; issue_number: number; body: string }): Promise<unknown>;
  };
}

interface PublishInput {
  owner: string;
  repo: string;
  prNumber: number;
  headSha: string;
  summary: string;
  passed: boolean;
}

export async function upsertEvidenceCheck(client: GithubClient, input: PublishInput): Promise<void> {
  const checkName = "Vibent Evidence";
  const listed = await client.checks.listForRef({
    owner: input.owner,
    repo: input.repo,
    ref: input.headSha
  });

  const existing = listed.data.check_runs.find((run) => run.name === checkName);
  const payload = {
    owner: input.owner,
    repo: input.repo,
    name: checkName,
    head_sha: input.headSha,
    status: "completed" as const,
    conclusion: input.passed ? "success" as const : "failure" as const,
    output: {
      title: "Vibent Evidence",
      summary: input.summary
    }
  };

  if (existing) {
    await client.checks.update({ ...payload, check_run_id: existing.id });
    return;
  }
  await client.checks.create(payload);
}

export async function upsertRollingComment(client: GithubClient, input: PublishInput): Promise<void> {
  const comments = await client.issues.listComments({
    owner: input.owner,
    repo: input.repo,
    issue_number: input.prNumber
  });

  const body = `${ROLLING_COMMENT_MARKER}\n## Vibent Evidence\n\n${input.summary}`;
  const existing = comments.data.find((comment) => comment.body.includes(ROLLING_COMMENT_MARKER));

  if (existing) {
    await client.issues.updateComment({
      owner: input.owner,
      repo: input.repo,
      comment_id: existing.id,
      body
    });
    return;
  }

  await client.issues.createComment({
    owner: input.owner,
    repo: input.repo,
    issue_number: input.prNumber,
    body
  });
}

export async function publishEvidence(client: GithubClient, input: PublishInput): Promise<void> {
  await upsertEvidenceCheck(client, input);
  await upsertRollingComment(client, input);
}
