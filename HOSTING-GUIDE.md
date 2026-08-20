# Free hosting plan

Recommended architecture:

GitHub Pages → Render backend → Aiven MySQL

## 1. GitHub

Create a private repository such as `thrustmit-recruitment`.

Do not commit:
- `backend/.env`
- candidate Excel files
- production secrets

## 2. Aiven

Create a free MySQL service and copy its host, port, database, user and password.

## 3. Render

Create a Web Service from the GitHub repo.

Root directory:
`backend`

Build command:
`npm install`

Start command:
`npm start`

Set environment variables:

```env
PORT=10000
CORS_ORIGIN=https://YOUR-USERNAME.github.io/YOUR-REPO
JWT_SECRET=<long-random-secret>
DB_HOST=<AIVEN_HOST>
DB_PORT=<AIVEN_PORT>
DB_NAME=<AIVEN_DB>
DB_USER=<AIVEN_USER>
DB_PASSWORD=<AIVEN_PASSWORD>
WRITTEN_MAX_MARKS=20
WRITTEN_QUALIFIED_COUNT=150
```

Run migrations against the hosted database before production use.

## 4. GitHub Pages

Set the frontend build variable:

```env
VITE_API_BASE_URL=https://YOUR-RENDER-SERVICE.onrender.com/api
```

The included GitHub Actions workflow builds and deploys the Vite frontend.
