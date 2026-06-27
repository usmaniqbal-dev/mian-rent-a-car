# Mian Rent A Car

## Local mode

Run `npm.cmd start` and open [http://localhost:3000](http://localhost:3000).

Local mode saves data to the configured `DATA_EXPORT_PATH` folder and keeps browser storage in sync.

## Deploy on Vercel with Neon Postgres

1. Push this folder to a GitHub repository and import the repository in Vercel.
2. In the Vercel Marketplace, add a **Neon Postgres** integration to the project. Copy its connection string into the `POSTGRES_URL` environment variable.
3. In Vercel Storage, connect a **Blob** store to this project. Modern Vercel Blob stores use native project/OIDC credentials, so no manual Blob token is required. If this is an older Blob setup, `BLOB_READ_WRITE_TOKEN` is still supported as a fallback.
4. Add a random, 32-character-or-longer `JWT_SECRET`.
5. Deploy and confirm `GET /api/health` returns `{ "ok": true, "storage": "neon+vercel-blob" }`.

On Vercel, application data is stored in Neon Postgres. New image uploads and generated PDF exports are moved to Vercel Blob and stored as URLs in the database. Local development data uses `./.data`; no Windows-specific path is required.

Built-in admin credentials are fixed:

- Admin: `admin` / `admin`
- Super Admin: `ADMIN1` / `ADMIN1`

## Future SQL reference

`future-mysql-schema.sql` is a separate MySQL reference schema. It is not used by the local or Vercel runtime.
