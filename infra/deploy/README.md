# ZyApp production deployment

Target: Ubuntu Server 24.04 LTS x86_64 with Docker Engine and Compose v2.

## Public surface

- Allow inbound TCP 22, 80 and 443 in the cloud security group.
- Allow inbound UDP 443 for HTTP/3, or remove that port mapping if UDP is unavailable.
- Do not expose PostgreSQL 5432, Redis 6379 or API 3100 publicly.

## WeChat Mini Program legal domains

For the production-test Mini Program, save these values in “Mini Program admin
console → Development management → Development settings → Server domains”:

```text
request: https://judian.icu
uploadFile: https://judian.icu
downloadFile: https://judian.icu
socket: leave empty
```

Wait for propagation, enable legal-domain validation in WeChat DevTools, rebuild,
and verify avatar upload plus persisted avatar display on a physical phone.

## Files and secrets

1. Copy `production.env.example` to `production.env` on the server.
2. Set `APP_DOMAIN` to a DNS name whose A record resolves to the server public IP.
3. Generate independent URL-safe random values for PostgreSQL, Redis, device enrollment and phone verification.
4. Keep `POSTGRES_PASSWORD` identical to the password embedded in `DATABASE_URL`.
5. Keep `REDIS_PASSWORD` identical to the password embedded in `REDIS_URL`.
6. Set permissions with `chmod 600 infra/deploy/production.env`.

From the Windows development machine, generate the file without printing secrets:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File infra/scripts/new-production-env.ps1 `
  -Domain api.example.com
```

For an initial server-only smoke test before a domain is available, add `-HttpOnly` and pass the public IP. HTTP-only mode must not be used to enroll the cashier PC or transmit business data.

Let’s Encrypt now supports short-lived public IP certificates. To test HTTPS directly by public IP, set `APP_DOMAIN` to the IP address, `CADDYFILE_PATH=./Caddyfile.ip-https`, and keep the production Let’s Encrypt `ACME_CA`. The certificate is renewed automatically by Caddy.

Production disables mock phone verification, mock WeChat payment and miniapp development login. Those features remain unavailable until real providers are configured.

During an ICP filing review, the isolated test API may temporarily set `TEST_MINIAPP_VIRTUAL_PHONE` together with real `TEST_MINIAPP_WECHAT_AUTH_MODE=wechat` credentials. The production API does not receive this variable. Remove it as soon as WeChat phone-number capability is approved.

## BGG metadata import

BGG integration is disabled by default. After written approval, place the XML API token in `${BGG_SECRETS_DIRECTORY}/xml-api-token` on the server with owner-only permissions. The file is mounted read-only at `/run/secrets/bgg/xml-api-token`; never put the token value in `production.env`, Git, desktop configuration, logs or the Mini Program.

Set `BGG_METADATA_MODE=xmlapi` only after the token has passed an isolated real-request check. Test and production APIs read the same explicit mode, but must still be deployed and verified test-first. Keep `BGG_PUBLIC_IMAGES_ENABLED=false` unless the written license explicitly permits public image use. The deployment wrappers accept `-BggTokenPath`, upload it separately from source and environment files, install it with owner-only permissions, and remove the temporary remote copy.

## Start

```bash
cd /opt/zyapp
docker compose --env-file infra/deploy/production.env \
  -f infra/deploy/compose.production.yml up -d --build
docker compose --env-file infra/deploy/production.env \
  -f infra/deploy/compose.production.yml ps
curl --fail --show-error --silent https://YOUR_DOMAIN/v1/health/ready
```

Caddy obtains and renews the TLS certificate automatically after DNS resolves and ports 80/443 are reachable.

The Windows deployment wrapper can install Docker, upload only the current desktop update files and start the stack:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File infra/scripts/deploy-production.ps1 `
  -HostName 203.0.113.10 `
  -SshUser ubuntu `
  -KeyPath C:\Keys\server.pem
```

## Backup

```bash
sudo DEPLOY_DIR=/opt/zyapp bash /opt/zyapp/infra/deploy/backup-postgres.sh
```

Schedule it daily with root cron, then copy backups to COS or another machine. A backup on the same server is not disaster recovery.
