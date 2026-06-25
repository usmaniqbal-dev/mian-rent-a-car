# Mian Rent A Car

## Local mode

Run `npm.cmd start` and open [http://localhost:3000](http://localhost:3000).

Local mode saves data to the configured `DATA_EXPORT_PATH` folder and keeps browser storage in sync.

## Deploy on Vercel with Neon Postgres

1. Push this folder to a GitHub repository and import the repository in Vercel.
2. In the Vercel Marketplace, add a **Neon Postgres** integration to the project. Copy its connection string into the `POSTGRES_URL` environment variable.
3. Create a Vercel Blob store and add its `BLOB_READ_WRITE_TOKEN` to the project environment variables.
4. Add a random, 32-character-or-longer `JWT_SECRET`.
5. Set `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `SUPER_ADMIN_USERNAME`, and `SUPER_ADMIN_PASSWORD`. Both passwords must be unique and at least 12 characters. Passwords are never committed to the repository.
6. If production users already exist but you need Neon to match the current Vercel environment passwords, set `AUTH_SYNC_FROM_ENV=true` for one redeploy. After confirming login works, set it back to `false` or remove it.
7. Deploy and confirm `GET /api/health` returns `{ "ok": true, "storage": "postgres" }`.

On Vercel, application data is stored in Neon Postgres. New image uploads and generated PDF exports are moved to Vercel Blob and stored as URLs in the database. Local development data uses `./.data`; no Windows-specific path is required.

## Future SQL reference

`future-mysql-schema.sql` is a separate MySQL reference schema. It is not used by the local or Vercel runtime.
