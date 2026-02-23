# sensibullterminal

## Vercel + Kaggle backend (recommended)

To avoid browser CORS failures on Vercel, use the built-in serverless proxy route:

- Frontend backend URL: `/api/kaggle`
- Server env var on Vercel: `KAGGLE_BACKEND_URL=https://<your-kaggle-or-tunnel-url>`
- Optional server env var: `KAGGLE_TERMINAL_AUTH=<shared-secret>`

This route forwards requests from Vercel to your Kaggle backend so the browser stays same-origin.
