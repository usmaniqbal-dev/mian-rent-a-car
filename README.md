# Mian Rent A Car

## Local mode

Run `npm.cmd start` and open [http://localhost:3000](http://localhost:3000).

Local mode saves data to the configured `DATA_EXPORT_PATH` folder and keeps browser storage in sync.

## Deploy on Vercel with Neon Postgres

1. Push this folder to a GitHub repository and import the repository in Vercel.
2. In the Vercel Marketplace, add a **Neon Postgres** integration to the project. Copy its connection string into the `POSTGRES_URL` environment variable.
3. Create a Vercel Blob store and add its `BLOB_READ_WRITE_TOKEN` to the project environment variables.
4. Add a long random `JWT_SECRET` environment variable.
5. Deploy. The first Vercel request creates the required PostgreSQL tables and the two initial accounts:
   - `admin` / `admin`
   - `ADMIN1` / `ADMIN1`

On Vercel, application data is stored in Neon Postgres. New image uploads are moved to Vercel Blob and stored as URLs in the database. The Windows local export folders are used only when running locally.

## Future SQL reference

`future-mysql-schema.sql` is a separate MySQL reference schema. It is not used by the local or Vercel runtime.
