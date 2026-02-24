# GitHub Setup

## GitHub App (repo integration)

Create a GitHub App with minimum permissions:

- Checks: Read/Write
- Pull Requests: Read/Write
- Contents: Read (Write only if branch creation is needed)
- Metadata: Read
- Actions: Read (optional)

Set webhook URL to:

- Local via tunnel: `https://<tunnel>/v1/webhooks/github`
- Cloud Run: `${API_URL}/v1/webhooks/github`

Subscribe to events:

- Pull request
- Push

## OAuth app (user login)

Configure callback URL:

- Local: `http://localhost:3000/signin/callback`
- Prod: `https://<web-domain>/signin/callback`

## Required env vars

- `GITHUB_APP_ID`
- `GITHUB_APP_PRIVATE_KEY`
- `GITHUB_CLIENT_ID`
- `GITHUB_CLIENT_SECRET`
- `GITHUB_WEBHOOK_SECRET`
