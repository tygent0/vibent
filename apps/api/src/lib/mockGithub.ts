import { GithubClient } from "./github.js";

export function createMockGithubClient(): GithubClient {
  return {
    checks: {
      async listForRef() {
        return { data: { check_runs: [] } };
      },
      async update() {
        return {};
      },
      async create() {
        return {};
      }
    },
    issues: {
      async listComments() {
        return { data: [] };
      },
      async updateComment() {
        return {};
      },
      async createComment() {
        return {};
      }
    }
  };
}
