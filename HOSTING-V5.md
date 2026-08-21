# V5 Hosting Recommendation

## Recommended architecture

```text
GitHub Pages
    ↓
Frontend
    ↓
Railway backend (recommended for a single-provider deployment)
    ↓
Railway MySQL
```

The current V5 code remains MySQL-compatible. It supports either the existing `DB_HOST`/`DB_PORT`/`DB_NAME`/`DB_USER`/`DB_PASSWORD` variables or a provider-supplied `MYSQL_URL` connection string.

## Why switch from the current Aiven free service?

Aiven's current free MySQL plan is genuinely free, but it explicitly reserves the right to power free services off after periods without continuous activity. That is exactly the behavior that caused the recruitment site to lose database connectivity. The free tier is also not covered by Aiven's 99.99% SLA and is intended for small workloads rather than high-traffic production use.

Railway now offers a MySQL service template. Its current free plan provides $1/month in usage credit; new accounts can receive a one-time $5 trial for up to 30 days. For a continuously available recruitment system, use a paid Hobby plan if you want predictable always-on operation. The Free plan is not a guarantee of unlimited always-on compute and can stop services when the account's free usage is exhausted.

## Migration plan

1. Create a Railway project.
2. Add a MySQL service.
3. Export the current live MySQL database to a SQL dump.
4. Import the dump into Railway MySQL.
5. Verify candidate counts and campaign/phase counts.
6. Deploy the V5 backend to Railway from GitHub.
7. Set `MYSQL_URL` (or the Railway `MYSQL*` variables) on the backend.
8. Run `npm run migrate` once against Railway.
9. Keep GitHub Pages for the frontend.
10. Set `VITE_API_BASE_URL` to the new backend URL.

## Important

Do not delete the Aiven service until Railway has been verified with the production candidate data.

Do not commit SQL dumps, `.env` files, Aiven/Railway credentials, or candidate exports to Git.
