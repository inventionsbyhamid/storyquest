# Deploying the StoryQuest server

The server is one Docker container with a volume for its SQLite database and media. It needs an https address, because the Fire TV media player only plays https URLs.

## Environment

Copy `apps/server/.env.example` and fill in:

| Variable | Value |
| --- | --- |
| `PUBLIC_BASE_URL` | the public https address, for example `https://storyquest.example.com` |
| `ADMIN_TOKEN` | a long random string (`openssl rand -hex 24`) |
| `DIRECTOR` | `bedrock` |
| `AWS_REGION` | for example `us-east-1` |
| `BEDROCK_API_KEY` or AWS credentials | Bedrock access for Claude |
| `BEDROCK_MODEL` | `anthropic.claude-opus-5-5` (default) |
| `VIDEO` | `fal` |
| `FAL_KEY` | your fal key |
| `SAFETY` | `guardrails` (with `GUARDRAIL_ID`) or `wordlist` |

Budget settings worth reviewing: `DAILY_VIDEO_SECONDS_CAP`, `DEVICE_DAILY_CUSTOM_LIMIT`, `SCENE_SECONDS`, `VIDEO_RESOLUTION`.

## Any Docker host

```bash
docker build -f apps/server/Dockerfile -t storyquest-api .
docker run -d --name storyquest-api --restart unless-stopped \
  -p 8080:8080 --env-file apps/server/.env \
  -v storyquest-data:/data storyquest-api
```

Put it behind any reverse proxy that terminates TLS (Caddy, Traefik, nginx, a Cloudflare tunnel).

## Coolify

1. New resource, Application, from this GitHub repository.
2. Build pack: Dockerfile. Base directory `/`, Dockerfile location `apps/server/Dockerfile`.
3. Port 8080. Health check path `/healthz`.
4. Persistent storage: mount a volume at `/data`.
5. Add the environment variables above and a domain. Coolify issues the certificate.

## After deploying

```bash
curl https://your-domain/healthz
curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" https://your-domain/v1/admin/daily
```

Before a demo or a judging period, pin your best stories and render every preset path so they play instantly and cannot fail:

```bash
curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" https://your-domain/v1/admin/ideas/<ideaId>/feature
curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" "https://your-domain/v1/admin/ideas/<ideaId>/warm?depth=6&force=true"
curl -H "Authorization: Bearer $ADMIN_TOKEN" https://your-domain/v1/admin/ideas/<ideaId>/warm   # progress
curl -H "Authorization: Bearer $ADMIN_TOKEN" https://your-domain/v1/admin/stats                 # spend and queue
```

A full six scene tree is 63 clips. If today's stories cannot be made (an outage or the budget cap), the app keeps showing the most recent stories that are ready.

Then build the Fire TV app against it: set `API_BASE_URL` in `apps/vega/src/config.ts` and run `yarn build:vega`.
