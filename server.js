require('dotenv').config();

const express = require('express');
const jwt = require('jsonwebtoken');
const path = require('path');
const fs = require('fs');
const helmet = require('helmet');

let multer;
let sharp;
let uploadDependencyError = null;
try {
  multer = require('multer');
  sharp = require('sharp');
} catch (error) {
  uploadDependencyError = error;
  console.error('Upload dependencies are unavailable:', error.message);
}

const app = express();
const port = process.env.PORT || 3000;
const databaseUrl = process.env.POSTGRES_URL || process.env.DATABASE_URL;
const blobToken = process.env.BLOB_READ_WRITE_TOKEN || process.env.VERCEL_BLOB_READ_WRITE_TOKEN;
const isProduction = process.env.NODE_ENV === 'production' || Boolean(process.env.VERCEL);
const cloudMode = Boolean(process.env.VERCEL || databaseUrl);
const secret = process.env.JWT_SECRET || process.env.VERCEL_GIT_COMMIT_SHA || process.env.VERCEL_URL || 'mian-rent-a-car-session-fallback-secret';
const builtInAccounts = {
  admin: { username: 'admin', password: 'admin', role: 'admin' },
  admin1: { username: 'ADMIN1', password: 'ADMIN1', role: 'super_admin' }
};
const staticRoots = [path.join(__dirname, 'public'), path.join(process.cwd(), 'public'), __dirname, process.cwd()];
const staticRoot = staticRoots.find(root => fs.existsSync(path.join(root, 'index.html')));
const upload = multer ? multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 12 },
  fileFilter: (req, file, cb) => {
    if (!/^image\/(jpeg|png|webp|gif|heic|heif)$/i.test(file.mimetype || '')) {
      return cb(new Error('Only image files are allowed'));
    }
    cb(null, true);
  }
}) : null;

let savedState = null;
let revision = 0;
let sql;
let cloudReady;
const loginFailures = new Map();
const startupWarnings = [];
if (isProduction && !process.env.JWT_SECRET) startupWarnings.push('JWT_SECRET is not set; using a deployment-scoped fallback so the app can boot.');
if (isProduction && process.env.JWT_SECRET && process.env.JWT_SECRET.length < 32) startupWarnings.push('JWT_SECRET is shorter than 32 characters.');
if (isProduction && !databaseUrl) startupWarnings.push('POSTGRES_URL or DATABASE_URL is not set; business data APIs will report storage unavailable until Neon is connected.');
startupWarnings.forEach(message => console.warn(message));

app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", 'https://cdnjs.cloudflare.com', 'https://cdn.jsdelivr.net'],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      imgSrc: ["'self'", 'data:', 'https:', 'blob:'],
      fontSrc: ["'self'", 'data:', 'https://fonts.gstatic.com'],
      connectSrc: ["'self'"],
      frameSrc: ["'self'"],
      baseUri: ["'self'"],
      formAction: ["'self'"]
    }
  },
  crossOriginEmbedderPolicy: false
}));
app.use(express.json({ limit: '6mb' }));
if (staticRoot) app.use(express.static(staticRoot, { index: 'index.html', maxAge: isProduction ? '1h' : 0 }));
else console.warn('Frontend files were not found in the deployment bundle.');

function clientIp(req) {
  return String(req.headers['x-forwarded-for'] || req.ip || 'unknown').split(',')[0].trim();
}
function loginKey(req, username) {
  return `${clientIp(req)}:${String(username || '').trim().toLowerCase()}`;
}
function loginBlocked(req, username) {
  if (String(process.env.LOGIN_RATE_LIMIT_DISABLED || '').toLowerCase() === 'true') return false;
  const entry = loginFailures.get(loginKey(req, username));
  if (!entry) return false;
  if (entry.resetAt < Date.now()) {
    loginFailures.delete(loginKey(req, username));
    return false;
  }
  return entry.count >= 8;
}
function recordLoginFailure(req, username) {
  if (String(process.env.LOGIN_RATE_LIMIT_DISABLED || '').toLowerCase() === 'true') return;
  const key = loginKey(req, username);
  const now = Date.now();
  let entry = loginFailures.get(key);
  if (!entry || entry.resetAt < now) entry = { count: 0, resetAt: now + 15 * 60_000 };
  entry.count++;
  loginFailures.set(key, entry);
}
function clearLoginFailures(req, username) {
  loginFailures.delete(loginKey(req, username));
}
function cookieValue(req, name) {
  const cookies = String(req.headers.cookie || '').split(';');
  for (const cookie of cookies) {
    const [key, ...parts] = cookie.trim().split('=');
    if (key === name) return decodeURIComponent(parts.join('='));
  }
  return '';
}
function authToken(req) {
  return cookieValue(req, 'mian_token');
}
function findStaticAccount(username, password) {
  const normalized = String(username || '').trim().toLowerCase();
  const account = builtInAccounts[normalized];
  if (!account || String(password || '') !== account.password) return null;
  return account;
}

async function ensureCloud() {
  if (!cloudMode) return;
  if (!databaseUrl) throw new Error('Postgres is not configured. Add POSTGRES_URL or DATABASE_URL.');
  if (cloudReady) return cloudReady;
  cloudReady = (async () => {
    const { neon } = require('@neondatabase/serverless');
    sql = neon(databaseUrl);
    await createSchema();
  })();
  return cloudReady;
}

async function createSchema() {
  await sql`CREATE TABLE IF NOT EXISTS app_state (state_key TEXT PRIMARY KEY, payload JSONB NOT NULL, revision INTEGER NOT NULL DEFAULT 1, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`;
  await sql`CREATE TABLE IF NOT EXISTS customers (id BIGSERIAL PRIMARY KEY, client_id TEXT UNIQUE, name TEXT, phone TEXT, identity_card TEXT, address TEXT, customer_photo_url TEXT, cnic_front_url TEXT, cnic_back_url TEXT, driving_license_url TEXT, extra JSONB NOT NULL DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`;
  await sql`CREATE TABLE IF NOT EXISTS drivers (id BIGSERIAL PRIMARY KEY, client_id TEXT UNIQUE, name TEXT, father_name TEXT, relative_name TEXT, address TEXT, qoom TEXT, phone TEXT, family_number TEXT, phone2 TEXT, identity_card TEXT, customer_photo_url TEXT, cnic_front_url TEXT, cnic_back_url TEXT, driving_license_url TEXT, extra JSONB NOT NULL DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`;
  await sql`CREATE TABLE IF NOT EXISTS cars (id BIGSERIAL PRIMARY KEY, client_id TEXT UNIQUE, car_name TEXT, car_number TEXT, model TEXT, color TEXT, registration_number TEXT, renting_station TEXT, chassis_no TEXT, engine_number TEXT, image_url_1 TEXT, image_url_2 TEXT, image_url_3 TEXT, image_url_4 TEXT, extra JSONB NOT NULL DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`;
  await sql`CREATE TABLE IF NOT EXISTS rentals (id BIGSERIAL PRIMARY KEY, client_id TEXT UNIQUE, rental_type TEXT NOT NULL CHECK (rental_type IN ('with_driver','without_driver')), seq_no TEXT, rental_date DATE, car_no TEXT, driver_name TEXT, customer_name TEXT, phone TEXT, identity_card TEXT, address TEXT, pickup_place TEXT, pickup_date TIMESTAMPTZ, dropup_place TEXT, dropup_date TIMESTAMPTZ, referrer TEXT, rent NUMERIC(12,2) DEFAULT 0, fuel_expense NUMERIC(12,2) DEFAULT 0, toll NUMERIC(12,2) DEFAULT 0, driver_commission NUMERIC(12,2) DEFAULT 0, profit NUMERIC(12,2) DEFAULT 0, customer_photo_url TEXT, cnic_front_url TEXT, cnic_back_url TEXT, driving_license_url TEXT, pdf_url TEXT, extra JSONB NOT NULL DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`;
  await sql`CREATE TABLE IF NOT EXISTS without_driver_bookings (id BIGSERIAL PRIMARY KEY, rental_client_id TEXT UNIQUE, seq_no TEXT, customer_name TEXT, identity_card TEXT, guarantor_name TEXT, guarantor_identity_card TEXT, car_no TEXT, pickup_date TIMESTAMPTZ, dropup_date TIMESTAMPTZ, rent NUMERIC(12,2) DEFAULT 0, pdf_url TEXT, extra JSONB NOT NULL DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`;
  await sql`CREATE TABLE IF NOT EXISTS with_driver_bookings (id BIGSERIAL PRIMARY KEY, rental_client_id TEXT UNIQUE, seq_no TEXT, customer_name TEXT, identity_card TEXT, driver_name TEXT, car_no TEXT, pickup_date TIMESTAMPTZ, dropup_date TIMESTAMPTZ, rent NUMERIC(12,2) DEFAULT 0, driver_commission NUMERIC(12,2) DEFAULT 0, pdf_url TEXT, extra JSONB NOT NULL DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`;
  await sql`CREATE TABLE IF NOT EXISTS exported_pdfs (id BIGSERIAL PRIMARY KEY, client_id TEXT UNIQUE, record_type TEXT NOT NULL, record_client_id TEXT, customer_name TEXT, pdf_url TEXT NOT NULL, extra JSONB NOT NULL DEFAULT '{}'::jsonb, created_by TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`;
  await sql`CREATE TABLE IF NOT EXISTS reports (id BIGSERIAL PRIMARY KEY, client_id TEXT UNIQUE, report_type TEXT NOT NULL, title TEXT, file_url TEXT, extra JSONB NOT NULL DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`;
  await sql`CREATE TABLE IF NOT EXISTS expenses (id BIGSERIAL PRIMARY KEY, client_id TEXT UNIQUE, expense_type TEXT NOT NULL, expense_date DATE, expense_time TEXT, car_no TEXT, person TEXT, receiving_person TEXT, reason TEXT, amount NUMERIC(12,2) DEFAULT 0, notes TEXT, extra JSONB NOT NULL DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`;
  await sql`CREATE TABLE IF NOT EXISTS app_objects (id BIGSERIAL PRIMARY KEY, object_key TEXT UNIQUE NOT NULL, label TEXT NOT NULL, extra JSONB NOT NULL DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`;
  await sql`CREATE TABLE IF NOT EXISTS app_fields (id BIGSERIAL PRIMARY KEY, client_id TEXT UNIQUE NOT NULL, object_key TEXT NOT NULL, field_key TEXT NOT NULL, name TEXT NOT NULL, field_type TEXT NOT NULL, options TEXT, extra JSONB NOT NULL DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`;
  await sql`CREATE TABLE IF NOT EXISTS admin_settings (setting_key TEXT PRIMARY KEY, payload JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`;
  await sql`ALTER TABLE customers ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT FALSE`;
  await sql`ALTER TABLE customers ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`;
  await sql`ALTER TABLE customers ADD COLUMN IF NOT EXISTS deleted_by TEXT`;
  await sql`ALTER TABLE drivers ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT FALSE`;
  await sql`ALTER TABLE drivers ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`;
  await sql`ALTER TABLE drivers ADD COLUMN IF NOT EXISTS deleted_by TEXT`;
  await sql`ALTER TABLE cars ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT FALSE`;
  await sql`ALTER TABLE cars ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`;
  await sql`ALTER TABLE cars ADD COLUMN IF NOT EXISTS deleted_by TEXT`;
  await sql`ALTER TABLE rentals ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT FALSE`;
  await sql`ALTER TABLE rentals ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`;
  await sql`ALTER TABLE rentals ADD COLUMN IF NOT EXISTS deleted_by TEXT`;
  await sql`ALTER TABLE without_driver_bookings ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT FALSE`;
  await sql`ALTER TABLE without_driver_bookings ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`;
  await sql`ALTER TABLE without_driver_bookings ADD COLUMN IF NOT EXISTS deleted_by TEXT`;
  await sql`ALTER TABLE with_driver_bookings ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT FALSE`;
  await sql`ALTER TABLE with_driver_bookings ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`;
  await sql`ALTER TABLE with_driver_bookings ADD COLUMN IF NOT EXISTS deleted_by TEXT`;
  await sql`ALTER TABLE exported_pdfs ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT FALSE`;
  await sql`ALTER TABLE exported_pdfs ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`;
  await sql`ALTER TABLE exported_pdfs ADD COLUMN IF NOT EXISTS deleted_by TEXT`;
  await sql`ALTER TABLE reports ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT FALSE`;
  await sql`ALTER TABLE reports ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`;
  await sql`ALTER TABLE reports ADD COLUMN IF NOT EXISTS deleted_by TEXT`;
  await sql`ALTER TABLE expenses ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT FALSE`;
  await sql`ALTER TABLE expenses ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`;
  await sql`ALTER TABLE expenses ADD COLUMN IF NOT EXISTS deleted_by TEXT`;
  await sql`ALTER TABLE app_objects ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT FALSE`;
  await sql`ALTER TABLE app_objects ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`;
  await sql`ALTER TABLE app_objects ADD COLUMN IF NOT EXISTS deleted_by TEXT`;
  await sql`ALTER TABLE app_fields ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT FALSE`;
  await sql`ALTER TABLE app_fields ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`;
  await sql`ALTER TABLE app_fields ADD COLUMN IF NOT EXISTS deleted_by TEXT`;
}

function dataRoot() {
  return path.resolve(process.env.DATA_EXPORT_PATH || path.join(process.cwd(), '.data'));
}
function stateFile() {
  return path.join(dataRoot(), 'system-state.json');
}
function loadStateFromDisk() {
  if (cloudMode) return false;
  try {
    const disk = JSON.parse(fs.readFileSync(stateFile(), 'utf8'));
    savedState = disk.state || null;
    revision = +disk.revision || 0;
    return true;
  } catch (error) {
    if (error.code !== 'ENOENT') console.error('Could not read saved local data:', error.message);
    return false;
  }
}
if (!cloudMode) {
  fs.mkdirSync(dataRoot(), { recursive: true });
  loadStateFromDisk();
}

async function getState() {
  if (!cloudMode) {
    loadStateFromDisk();
    return { state: savedState, revision };
  }
  await ensureCloud();
  const rows = await sql`SELECT payload,revision FROM app_state WHERE state_key='main'`;
  return rows[0] ? { state: rows[0].payload, revision: rows[0].revision } : { state: null, revision: 0 };
}
function safeName(value) {
  return String(value || 'file').replace(/[<>:"/\\|?*\x00-\x1F]+/g, '_').replace(/\.+$/, '').slice(0, 100) || 'file';
}
function extensionForContentType(contentType) {
  if (contentType === 'application/pdf') return 'pdf';
  if (contentType === 'image/jpeg') return 'jpg';
  if (contentType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') return 'xlsx';
  if (contentType === 'text/csv') return 'csv';
  return 'bin';
}
function parseDataUrl(dataUrl) {
  const match = String(dataUrl || '').match(/^data:([a-zA-Z0-9+./-]+)(?:;[^,]+)?;base64,(.*)$/);
  if (!match) return null;
  return { contentType: match[1].toLowerCase(), buffer: Buffer.from(match[2], 'base64') };
}
async function optimizeImage(buffer) {
  if (!sharp) throw new Error('Image processing dependency is unavailable. Redeploy after installing dependencies.');
  let quality = 82;
  let output = await sharp(buffer, { failOn: 'none' })
    .rotate()
    .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality, mozjpeg: true })
    .toBuffer();
  while (output.length > 300 * 1024 && quality > 58) {
    quality -= 6;
    output = await sharp(buffer, { failOn: 'none' })
      .rotate()
      .resize({ width: 1400, height: 1400, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality, mozjpeg: true })
      .toBuffer();
  }
  return output;
}
async function putBlobBuffer(buffer, key, contentType) {
  if (!cloudMode) {
    if (contentType === 'application/pdf') return `data:application/pdf;base64,${buffer.toString('base64')}`;
    return `data:image/jpeg;base64,${buffer.toString('base64')}`;
  }
  const { put } = require('@vercel/blob');
  const filename = `mian-rent-a-car/${new Date().toISOString().slice(0, 10)}/${Date.now()}-${safeName(key)}.${extensionForContentType(contentType)}`;
  const options = { access: 'public', contentType, cacheControlMaxAge: 31536000 };
  try {
    return (await put(filename, buffer, options)).url;
  } catch (error) {
    if (!blobToken) throw error;
    return (await put(filename, buffer, { ...options, token: blobToken })).url;
  }
}
async function putImageBuffer(buffer, key) {
  const optimized = await optimizeImage(buffer);
  return putBlobBuffer(optimized, key, 'image/jpeg');
}
async function putDataUrl(dataUrl, key = 'file') {
  const parsed = parseDataUrl(dataUrl);
  if (!parsed) throw new Error('A valid base64 data URL is required.');
  if (parsed.contentType === 'application/pdf') return putBlobBuffer(parsed.buffer, key, 'application/pdf');
  if (parsed.contentType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') return putBlobBuffer(parsed.buffer, key, parsed.contentType);
  if (parsed.contentType === 'text/csv') return putBlobBuffer(parsed.buffer, key, parsed.contentType);
  if (parsed.contentType.startsWith('image/')) return putImageBuffer(parsed.buffer, key);
  throw new Error('Only PDF, spreadsheet, CSV, and image uploads are supported.');
}
async function moveFilesToBlob(value, key = 'file') {
  if (Array.isArray(value)) return Promise.all(value.map((item, index) => moveFilesToBlob(item, `${key}-${index + 1}`)));
  if (!value || (typeof value !== 'object' && typeof value !== 'string')) return value;
  if (typeof value === 'string') {
    if (/^data:(image\/|application\/pdf|application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet|text\/csv)/i.test(value)) return putDataUrl(value, key);
    return value;
  }
  const out = {};
  for (const [name, item] of Object.entries(value)) out[name] = await moveFilesToBlob(item, name);
  return out;
}
function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}
function toDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
function firstUrl(...values) {
  for (const value of values.flat()) if (typeof value === 'string' && /^https?:\/\//i.test(value)) return value;
  return null;
}
function urls(value) {
  return Array.isArray(value) ? value.filter(v => typeof v === 'string') : (value ? [value] : []);
}
function deleteInfo(item = {}) {
  return { isDeleted: Boolean(item.is_deleted), deletedAt: item.deleted_at || null, deletedBy: item.deleted_by || null };
}
async function syncDeletionFlags(state) {
  if (!cloudMode) return;
  for (const item of state.customers || []) await sql`UPDATE customers SET is_deleted=${deleteInfo(item).isDeleted},deleted_at=${deleteInfo(item).deletedAt},deleted_by=${deleteInfo(item).deletedBy} WHERE client_id=${String(item.id)}`;
  for (const item of state.drivers || []) await sql`UPDATE drivers SET is_deleted=${deleteInfo(item).isDeleted},deleted_at=${deleteInfo(item).deletedAt},deleted_by=${deleteInfo(item).deletedBy} WHERE client_id=${String(item.id)}`;
  for (const item of state.cars || []) await sql`UPDATE cars SET is_deleted=${deleteInfo(item).isDeleted},deleted_at=${deleteInfo(item).deletedAt},deleted_by=${deleteInfo(item).deletedBy} WHERE client_id=${String(item.id)}`;
  for (const item of state.expenses || []) await sql`UPDATE expenses SET is_deleted=${deleteInfo(item).isDeleted},deleted_at=${deleteInfo(item).deletedAt},deleted_by=${deleteInfo(item).deletedBy} WHERE client_id=${String(item.id)}`;
  for (const item of state.reports || []) await sql`UPDATE reports SET is_deleted=${deleteInfo(item).isDeleted},deleted_at=${deleteInfo(item).deletedAt},deleted_by=${deleteInfo(item).deletedBy} WHERE client_id=${String(item.id)}`;
  for (const item of state.pdfExports || []) await sql`UPDATE exported_pdfs SET is_deleted=${deleteInfo(item).isDeleted},deleted_at=${deleteInfo(item).deletedAt},deleted_by=${deleteInfo(item).deletedBy} WHERE client_id=${String(item.id)}`;
  for (const item of state.rentals || []) {
    const info = deleteInfo(item);
    await sql`UPDATE rentals SET is_deleted=${info.isDeleted},deleted_at=${info.deletedAt},deleted_by=${info.deletedBy} WHERE client_id=${String(item.id)}`;
    if (item.mode === 'without') await sql`UPDATE without_driver_bookings SET is_deleted=${info.isDeleted},deleted_at=${info.deletedAt},deleted_by=${info.deletedBy} WHERE rental_client_id=${String(item.id)}`;
    else await sql`UPDATE with_driver_bookings SET is_deleted=${info.isDeleted},deleted_at=${info.deletedAt},deleted_by=${info.deletedBy} WHERE rental_client_id=${String(item.id)}`;
  }
}
async function syncStateToTables(state) {
  if (!cloudMode) return;
  await ensureCloud();
  for (const item of state.customers || []) {
    await sql`INSERT INTO customers (client_id,name,phone,identity_card,address,customer_photo_url,cnic_front_url,cnic_back_url,driving_license_url,extra,updated_at) VALUES (${String(item.id)},${item.name || null},${item.phone || null},${item.identityCard || null},${item.address || null},${firstUrl(item.customerImage, item.customerPhoto)},${firstUrl(urls(item.idCardImages)[0], item.idCard, item.idCardPhoto)},${firstUrl(urls(item.idCardImages)[1])},${firstUrl(item.drivingLicense)},${JSON.stringify(item)}::jsonb,NOW()) ON CONFLICT (client_id) DO UPDATE SET name=EXCLUDED.name,phone=EXCLUDED.phone,identity_card=EXCLUDED.identity_card,address=EXCLUDED.address,customer_photo_url=EXCLUDED.customer_photo_url,cnic_front_url=EXCLUDED.cnic_front_url,cnic_back_url=EXCLUDED.cnic_back_url,driving_license_url=EXCLUDED.driving_license_url,extra=EXCLUDED.extra,updated_at=NOW()`;
  }
  for (const item of state.drivers || []) {
    await sql`INSERT INTO drivers (client_id,name,father_name,relative_name,address,qoom,phone,family_number,phone2,identity_card,customer_photo_url,cnic_front_url,cnic_back_url,driving_license_url,extra,updated_at) VALUES (${String(item.id)},${item.name || null},${item.fatherName || null},${item.relativeName || null},${item.address || null},${item.qoom || null},${item.phone || null},${item.familyNumber || null},${item.phone2 || null},${item.identityCard || null},${firstUrl(item.customerImage, item.customerPhoto)},${firstUrl(urls(item.idCardImages)[0], item.idCard, item.idCardPhoto)},${firstUrl(urls(item.idCardImages)[1])},${firstUrl(item.drivingLicense)},${JSON.stringify(item)}::jsonb,NOW()) ON CONFLICT (client_id) DO UPDATE SET name=EXCLUDED.name,father_name=EXCLUDED.father_name,relative_name=EXCLUDED.relative_name,address=EXCLUDED.address,qoom=EXCLUDED.qoom,phone=EXCLUDED.phone,family_number=EXCLUDED.family_number,phone2=EXCLUDED.phone2,identity_card=EXCLUDED.identity_card,customer_photo_url=EXCLUDED.customer_photo_url,cnic_front_url=EXCLUDED.cnic_front_url,cnic_back_url=EXCLUDED.cnic_back_url,driving_license_url=EXCLUDED.driving_license_url,extra=EXCLUDED.extra,updated_at=NOW()`;
  }
  for (const item of state.cars || []) {
    const images = urls(item.images);
    await sql`INSERT INTO cars (client_id,car_name,car_number,model,color,registration_number,renting_station,chassis_no,engine_number,image_url_1,image_url_2,image_url_3,image_url_4,extra,updated_at) VALUES (${String(item.id)},${item.carName || null},${item.carNumber || null},${item.model || null},${item.color || null},${item.registrationNumber || null},${item.rentingStation || null},${item.chassisNo || null},${item.engineNumber || null},${images[0] || null},${images[1] || null},${images[2] || null},${images[3] || null},${JSON.stringify(item)}::jsonb,NOW()) ON CONFLICT (client_id) DO UPDATE SET car_name=EXCLUDED.car_name,car_number=EXCLUDED.car_number,model=EXCLUDED.model,color=EXCLUDED.color,registration_number=EXCLUDED.registration_number,renting_station=EXCLUDED.renting_station,chassis_no=EXCLUDED.chassis_no,engine_number=EXCLUDED.engine_number,image_url_1=EXCLUDED.image_url_1,image_url_2=EXCLUDED.image_url_2,image_url_3=EXCLUDED.image_url_3,image_url_4=EXCLUDED.image_url_4,extra=EXCLUDED.extra,updated_at=NOW()`;
  }
  for (const item of state.rentals || []) {
    const rentalType = item.mode === 'without' ? 'without_driver' : 'with_driver';
    await sql`INSERT INTO rentals (client_id,rental_type,seq_no,rental_date,car_no,driver_name,customer_name,phone,identity_card,address,pickup_place,pickup_date,dropup_place,dropup_date,referrer,rent,fuel_expense,toll,driver_commission,profit,customer_photo_url,cnic_front_url,cnic_back_url,driving_license_url,pdf_url,extra,updated_at) VALUES (${String(item.id)},${rentalType},${item.seqNo || null},${item.date || null},${item.carNo || null},${item.driver || null},${item.customerName || null},${item.phone || null},${item.identityCard || null},${item.address || null},${item.pickupPlace || null},${toDate(item.pickupDate)},${item.dropupPlace || null},${toDate(item.dropupDate)},${item.referrer || null},${toNumber(item.rent)},${toNumber(item.fuelExpense)},${toNumber(item.toll)},${toNumber(item.driverCommission)},${toNumber(item.profit)},${firstUrl(item.customerPhoto, item.customerImage)},${firstUrl(urls(item.idCardImages)[0], item.idCardPhoto, item.idCard)},${firstUrl(urls(item.idCardImages)[1])},${firstUrl(item.drivingLicense)},${item.pdfUrl || null},${JSON.stringify(item)}::jsonb,NOW()) ON CONFLICT (client_id) DO UPDATE SET rental_type=EXCLUDED.rental_type,seq_no=EXCLUDED.seq_no,rental_date=EXCLUDED.rental_date,car_no=EXCLUDED.car_no,driver_name=EXCLUDED.driver_name,customer_name=EXCLUDED.customer_name,phone=EXCLUDED.phone,identity_card=EXCLUDED.identity_card,address=EXCLUDED.address,pickup_place=EXCLUDED.pickup_place,pickup_date=EXCLUDED.pickup_date,dropup_place=EXCLUDED.dropup_place,dropup_date=EXCLUDED.dropup_date,referrer=EXCLUDED.referrer,rent=EXCLUDED.rent,fuel_expense=EXCLUDED.fuel_expense,toll=EXCLUDED.toll,driver_commission=EXCLUDED.driver_commission,profit=EXCLUDED.profit,customer_photo_url=EXCLUDED.customer_photo_url,cnic_front_url=EXCLUDED.cnic_front_url,cnic_back_url=EXCLUDED.cnic_back_url,driving_license_url=EXCLUDED.driving_license_url,pdf_url=EXCLUDED.pdf_url,extra=EXCLUDED.extra,updated_at=NOW()`;
    if (rentalType === 'without_driver') {
      await sql`INSERT INTO without_driver_bookings (rental_client_id,seq_no,customer_name,identity_card,guarantor_name,guarantor_identity_card,car_no,pickup_date,dropup_date,rent,pdf_url,extra,updated_at) VALUES (${String(item.id)},${item.seqNo || null},${item.customerName || null},${item.identityCard || null},${item.guarantorName || null},${item.guarantorNic || null},${item.carNo || null},${toDate(item.pickupDate)},${toDate(item.dropupDate)},${toNumber(item.rent)},${item.pdfUrl || null},${JSON.stringify(item)}::jsonb,NOW()) ON CONFLICT (rental_client_id) DO UPDATE SET seq_no=EXCLUDED.seq_no,customer_name=EXCLUDED.customer_name,identity_card=EXCLUDED.identity_card,guarantor_name=EXCLUDED.guarantor_name,guarantor_identity_card=EXCLUDED.guarantor_identity_card,car_no=EXCLUDED.car_no,pickup_date=EXCLUDED.pickup_date,dropup_date=EXCLUDED.dropup_date,rent=EXCLUDED.rent,pdf_url=EXCLUDED.pdf_url,extra=EXCLUDED.extra,updated_at=NOW()`;
    } else {
      await sql`INSERT INTO with_driver_bookings (rental_client_id,seq_no,customer_name,identity_card,driver_name,car_no,pickup_date,dropup_date,rent,driver_commission,pdf_url,extra,updated_at) VALUES (${String(item.id)},${item.seqNo || null},${item.customerName || null},${item.identityCard || null},${item.driver || null},${item.carNo || null},${toDate(item.pickupDate)},${toDate(item.dropupDate)},${toNumber(item.rent)},${toNumber(item.driverCommission)},${item.pdfUrl || null},${JSON.stringify(item)}::jsonb,NOW()) ON CONFLICT (rental_client_id) DO UPDATE SET seq_no=EXCLUDED.seq_no,customer_name=EXCLUDED.customer_name,identity_card=EXCLUDED.identity_card,driver_name=EXCLUDED.driver_name,car_no=EXCLUDED.car_no,pickup_date=EXCLUDED.pickup_date,dropup_date=EXCLUDED.dropup_date,rent=EXCLUDED.rent,driver_commission=EXCLUDED.driver_commission,pdf_url=EXCLUDED.pdf_url,extra=EXCLUDED.extra,updated_at=NOW()`;
    }
  }
  for (const item of state.pdfExports || []) {
    if (!item.url) continue;
    await sql`INSERT INTO exported_pdfs (client_id,record_type,record_client_id,customer_name,pdf_url,extra,created_at) VALUES (${String(item.id)},${item.type || 'rental'},${item.recordId ? String(item.recordId) : null},${item.customerName || null},${item.url},${JSON.stringify(item)}::jsonb,${item.createdAt || new Date().toISOString()}) ON CONFLICT (client_id) DO UPDATE SET record_type=EXCLUDED.record_type,record_client_id=EXCLUDED.record_client_id,customer_name=EXCLUDED.customer_name,pdf_url=EXCLUDED.pdf_url,extra=EXCLUDED.extra`;
    await sql`INSERT INTO reports (client_id,report_type,title,file_url,extra,updated_at) VALUES (${String(item.id)},${item.type || 'rental'},${item.customerName || 'Exported PDF'},${item.url},${JSON.stringify(item)}::jsonb,NOW()) ON CONFLICT (client_id) DO UPDATE SET report_type=EXCLUDED.report_type,title=EXCLUDED.title,file_url=EXCLUDED.file_url,extra=EXCLUDED.extra,updated_at=NOW()`;
  }
  for (const item of state.reports || []) {
    if (!item.url && !item.fileUrl) continue;
    await sql`INSERT INTO reports (client_id,report_type,title,file_url,extra,updated_at) VALUES (${String(item.id)},${item.type || item.reportType || 'report'},${item.title || item.name || 'Report'},${item.url || item.fileUrl},${JSON.stringify(item)}::jsonb,NOW()) ON CONFLICT (client_id) DO UPDATE SET report_type=EXCLUDED.report_type,title=EXCLUDED.title,file_url=EXCLUDED.file_url,extra=EXCLUDED.extra,updated_at=NOW()`;
  }
  for (const item of state.expenses || []) {
    await sql`INSERT INTO expenses (client_id,expense_type,expense_date,expense_time,car_no,person,receiving_person,reason,amount,notes,extra,updated_at) VALUES (${String(item.id)},${item.type || 'other'},${item.date || null},${item.time || null},${item.carNo || null},${item.person || null},${item.receivingPerson || null},${item.reason || null},${toNumber(item.amount)},${item.notes || null},${JSON.stringify(item)}::jsonb,NOW()) ON CONFLICT (client_id) DO UPDATE SET expense_type=EXCLUDED.expense_type,expense_date=EXCLUDED.expense_date,expense_time=EXCLUDED.expense_time,car_no=EXCLUDED.car_no,person=EXCLUDED.person,receiving_person=EXCLUDED.receiving_person,reason=EXCLUDED.reason,amount=EXCLUDED.amount,notes=EXCLUDED.notes,extra=EXCLUDED.extra,updated_at=NOW()`;
  }
  const objectList = state.objects || ['Rental', 'Car', 'Customer', 'Driver'].map(label => ({ key: label.toLowerCase(), label }));
  for (const item of objectList) {
    if (!item?.key || !item?.label) continue;
    await sql`INSERT INTO app_objects (object_key,label,extra,updated_at) VALUES (${item.key},${item.label},${JSON.stringify(item)}::jsonb,NOW()) ON CONFLICT (object_key) DO UPDATE SET label=EXCLUDED.label,extra=EXCLUDED.extra,updated_at=NOW()`;
  }
  for (const [objectKey, fields] of Object.entries(state.fields || {})) {
    for (const item of fields || []) {
      const fieldKey = item.key || String(item.name || '').toLowerCase().replace(/\W+/g, '_');
      if (!fieldKey || !item.name) continue;
      const clientId = `${objectKey}:${fieldKey}`;
      await sql`INSERT INTO app_fields (client_id,object_key,field_key,name,field_type,options,extra,updated_at) VALUES (${clientId},${objectKey},${fieldKey},${item.name},${item.type || 'text'},${item.options || null},${JSON.stringify(item)}::jsonb,NOW()) ON CONFLICT (client_id) DO UPDATE SET object_key=EXCLUDED.object_key,field_key=EXCLUDED.field_key,name=EXCLUDED.name,field_type=EXCLUDED.field_type,options=EXCLUDED.options,extra=EXCLUDED.extra,updated_at=NOW()`;
    }
  }
  await sql`INSERT INTO admin_settings (setting_key,payload,updated_at) VALUES ('branding',${JSON.stringify(state.branding || {})}::jsonb,NOW()) ON CONFLICT (setting_key) DO UPDATE SET payload=EXCLUDED.payload,updated_at=NOW()`;
  await sql`INSERT INTO admin_settings (setting_key,payload,updated_at) VALUES ('dashboard',${JSON.stringify({ objects: state.objects || [], fields: state.fields || {}, expenses: state.expenses || [] })}::jsonb,NOW()) ON CONFLICT (setting_key) DO UPDATE SET payload=EXCLUDED.payload,updated_at=NOW()`;
  await syncDeletionFlags(state);
}
async function saveState(state, expectedRevision = 0) {
  const payload = await moveFilesToBlob(state);
  if (!cloudMode) {
    savedState = payload;
    revision++;
    fs.writeFileSync(stateFile(), JSON.stringify({ revision, state: savedState, savedAt: new Date().toISOString() }, null, 2));
    return { state: savedState, revision };
  }
  await ensureCloud();
  const current = await sql`SELECT revision FROM app_state WHERE state_key='main'`;
  const revisionNow = current[0]?.revision || 0;
  if (revisionNow && +expectedRevision !== revisionNow) {
    const error = new Error('CONFLICT');
    error.revision = revisionNow;
    throw error;
  }
  const newRevision = revisionNow + 1;
  await sql`INSERT INTO app_state (state_key,payload,revision,updated_at) VALUES ('main',${JSON.stringify(payload)}::jsonb,${newRevision},NOW()) ON CONFLICT (state_key) DO UPDATE SET payload=EXCLUDED.payload,revision=EXCLUDED.revision,updated_at=NOW()`;
  await syncStateToTables(payload);
  return { state: payload, revision: newRevision };
}
function auth(req, res, next) {
  try {
    const token = authToken(req);
    if (!token) throw new Error('Missing token');
    req.user = jwt.verify(token, secret, { algorithms: ['HS256'] });
    next();
  } catch {
    res.status(401).json({ message: 'Please sign in again' });
  }
}
function requireSuperAdmin(req, res, next) {
  if (req.user?.role !== 'super_admin') return res.status(403).json({ message: 'ADMIN1 access is required' });
  next();
}
async function loadCurrentState() {
  const current = await getState();
  return { state: current.state || {}, revision: current.revision || 0 };
}
const trashModules = {
  without_driver: { stateKey: 'rentals', table: 'rentals', match: item => item.mode === 'without', label: 'Without Driver' },
  with_driver: { stateKey: 'rentals', table: 'rentals', match: item => item.mode !== 'without', label: 'With Driver' },
  cars: { stateKey: 'cars', table: 'cars', label: 'Cars' },
  customers: { stateKey: 'customers', table: 'customers', label: 'Customers' },
  drivers: { stateKey: 'drivers', table: 'drivers', label: 'Drivers' },
  expenses: { stateKey: 'expenses', table: 'expenses', label: 'Expenses' },
  reports: { stateKey: 'reports', table: 'reports', label: 'Reports' }
};
function trashConfig(moduleName) {
  const key = String(moduleName || '').trim().toLowerCase();
  const aliases = { without: 'without_driver', with: 'with_driver', car: 'cars', customer: 'customers', driver: 'drivers', expense: 'expenses', report: 'reports' };
  return trashModules[aliases[key] || key] ? { key: aliases[key] || key, ...trashModules[aliases[key] || key] } : null;
}
function moduleItems(state, config) {
  const rows = Array.isArray(state[config.stateKey]) ? state[config.stateKey] : [];
  return config.match ? rows.filter(config.match) : rows;
}
function findModuleItem(state, config, id) {
  return moduleItems(state, config).find(item => String(item.id) === String(id));
}
function collectBlobUrls(value, output = new Set()) {
  if (!value) return output;
  if (typeof value === 'string') {
    if (/^https:\/\/[^/]+\.blob\.vercel-storage\.com\//i.test(value)) output.add(value);
    return output;
  }
  if (Array.isArray(value)) {
    value.forEach(item => collectBlobUrls(item, output));
    return output;
  }
  if (typeof value === 'object') Object.values(value).forEach(item => collectBlobUrls(item, output));
  return output;
}
async function deleteBlobUrls(urlList) {
  if (!cloudMode) return;
  const unique = [...new Set(urlList)].filter(Boolean);
  if (!unique.length) return;
  const { del } = require('@vercel/blob');
  for (const url of unique) {
    try {
      await del(url);
    } catch (error) {
      if (!blobToken) throw error;
      await del(url, { token: blobToken });
    }
  }
}
async function updateTypedDeletion(config, id, deleted, user) {
  if (!cloudMode) return;
  const at = deleted ? new Date().toISOString() : null;
  const by = deleted ? user.username : null;
  if (config.key === 'customers') await sql`UPDATE customers SET is_deleted=${deleted},deleted_at=${at},deleted_by=${by},updated_at=NOW() WHERE client_id=${String(id)}`;
  if (config.key === 'drivers') await sql`UPDATE drivers SET is_deleted=${deleted},deleted_at=${at},deleted_by=${by},updated_at=NOW() WHERE client_id=${String(id)}`;
  if (config.key === 'cars') await sql`UPDATE cars SET is_deleted=${deleted},deleted_at=${at},deleted_by=${by},updated_at=NOW() WHERE client_id=${String(id)}`;
  if (config.key === 'expenses') await sql`UPDATE expenses SET is_deleted=${deleted},deleted_at=${at},deleted_by=${by},updated_at=NOW() WHERE client_id=${String(id)}`;
  if (config.key === 'reports') await sql`UPDATE reports SET is_deleted=${deleted},deleted_at=${at},deleted_by=${by},updated_at=NOW() WHERE client_id=${String(id)}`;
  if (config.key === 'without_driver' || config.key === 'with_driver') {
    await sql`UPDATE rentals SET is_deleted=${deleted},deleted_at=${at},deleted_by=${by},updated_at=NOW() WHERE client_id=${String(id)}`;
    if (config.key === 'without_driver') await sql`UPDATE without_driver_bookings SET is_deleted=${deleted},deleted_at=${at},deleted_by=${by},updated_at=NOW() WHERE rental_client_id=${String(id)}`;
    else await sql`UPDATE with_driver_bookings SET is_deleted=${deleted},deleted_at=${at},deleted_by=${by},updated_at=NOW() WHERE rental_client_id=${String(id)}`;
  }
}
async function deleteTypedRecord(config, id, relatedPdfIds = []) {
  if (!cloudMode) return;
  if (config.key === 'customers') await sql`DELETE FROM customers WHERE client_id=${String(id)}`;
  if (config.key === 'drivers') await sql`DELETE FROM drivers WHERE client_id=${String(id)}`;
  if (config.key === 'cars') await sql`DELETE FROM cars WHERE client_id=${String(id)}`;
  if (config.key === 'expenses') await sql`DELETE FROM expenses WHERE client_id=${String(id)}`;
  if (config.key === 'reports') await sql`DELETE FROM reports WHERE client_id=${String(id)}`;
  if (config.key === 'without_driver' || config.key === 'with_driver') {
    await sql`DELETE FROM rentals WHERE client_id=${String(id)}`;
    await sql`DELETE FROM without_driver_bookings WHERE rental_client_id=${String(id)}`;
    await sql`DELETE FROM with_driver_bookings WHERE rental_client_id=${String(id)}`;
    await sql`DELETE FROM exported_pdfs WHERE record_client_id=${String(id)}`;
  }
  for (const pdfId of relatedPdfIds) {
    await sql`DELETE FROM exported_pdfs WHERE client_id=${String(pdfId)}`;
    await sql`DELETE FROM reports WHERE client_id=${String(pdfId)}`;
  }
}

async function loginHandler(req, res) {
  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '');
  try {
    if (!username || !password) return res.status(400).json({ message: 'Username and password are required' });
    if (loginBlocked(req, username)) return res.status(429).json({ message: 'Too many failed login attempts. Try again in 15 minutes.' });
    const account = findStaticAccount(username, password);
    if (!account) {
      recordLoginFailure(req, username);
      return res.status(401).json({ message: 'Incorrect username or password' });
    }
    clearLoginFailures(req, username);
    const token = jwt.sign({ username: account.username, role: account.role }, secret, { expiresIn: '8h' });
    res.cookie('mian_token', token, { httpOnly: true, secure: isProduction, sameSite: 'strict', maxAge: 8 * 60 * 60 * 1000, path: '/' });
    res.json({ ok: true, role: account.role, username: account.username });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Login failed. Please try again.' });
  }
}

app.get('/api/health', async (req, res) => {
  try {
    if (cloudMode) await ensureCloud();
    res.status(200).json({ ok: true, storage: cloudMode ? 'neon+vercel-blob' : 'local-dev', databaseConfigured: !cloudMode || Boolean(databaseUrl), blobConfigured: true, blobAuthMode: blobToken ? 'legacy-token-fallback' : 'vercel-oidc', authConfigured: true, warnings: startupWarnings });
  } catch (error) {
    res.status(503).json({ ok: false, message: error.message, warnings: startupWarnings });
  }
});
app.get('/api/branding', async (req, res) => {
  try {
    if (cloudMode) await ensureCloud();
    const { state } = await loadCurrentState();
    res.json({ ok: true, branding: state.branding || {} });
  } catch {
    res.json({ ok: true, branding: {} });
  }
});
app.post('/api/login', loginHandler);
app.post('/api/auth/login', loginHandler);
app.post('/api/logout', (req, res) => {
  res.clearCookie('mian_token', { path: '/' });
  res.json({ ok: true });
});
app.get('/api/state', auth, async (req, res) => {
  try { res.json(await getState()); }
  catch (error) { console.error(error); res.status(500).json({ message: 'Storage is unavailable' }); }
});
app.put('/api/state', auth, async (req, res) => {
  try {
    const state = req.body?.state;
    if (!state || typeof state !== 'object' || Array.isArray(state)) return res.status(400).json({ message: 'A complete record state is required' });
    const result = await saveState(state, +req.body.revision || 0);
    res.json({ ok: true, revision: result.revision, state: result.state });
  } catch (error) {
    if (error.message === 'CONFLICT') return res.status(409).json({ message: 'Records changed elsewhere. Reload before saving again.', revision: error.revision });
    console.error(error);
    res.status(500).json({ message: 'Storage save failed' });
  }
});
app.get('/api/trash/:module', auth, requireSuperAdmin, async (req, res) => {
  try {
    const config = trashConfig(req.params.module);
    if (!config) return res.status(404).json({ message: 'Unknown trash module' });
    const { state } = await loadCurrentState();
    const rows = moduleItems(state, config).filter(item => item.is_deleted);
    res.json({ ok: true, module: config.key, label: config.label, rows });
  } catch (error) {
    console.error('Trash list failed:', error.message);
    res.status(500).json({ message: 'Trash is unavailable' });
  }
});
app.post('/api/trash/:module/:id', auth, async (req, res) => {
  try {
    const config = trashConfig(req.params.module);
    if (!config) return res.status(404).json({ message: 'Unknown trash module' });
    const { state, revision } = await loadCurrentState();
    const item = findModuleItem(state, config, req.params.id);
    if (!item) return res.status(404).json({ message: 'Record not found' });
    item.is_deleted = true;
    item.deleted_at = new Date().toISOString();
    item.deleted_by = req.user.username;
    await updateTypedDeletion(config, item.id, true, req.user);
    const saved = await saveState(state, revision);
    res.json({ ok: true, state: saved.state, revision: saved.revision, record: item });
  } catch (error) {
    console.error('Soft delete failed:', error.message);
    res.status(500).json({ message: 'Could not move record to Trash' });
  }
});
app.post('/api/trash/:module/:id/restore', auth, requireSuperAdmin, async (req, res) => {
  try {
    const config = trashConfig(req.params.module);
    if (!config) return res.status(404).json({ message: 'Unknown trash module' });
    const { state, revision } = await loadCurrentState();
    const item = findModuleItem(state, config, req.params.id);
    if (!item) return res.status(404).json({ message: 'Record not found' });
    item.is_deleted = false;
    delete item.deleted_at;
    delete item.deleted_by;
    await updateTypedDeletion(config, item.id, false, req.user);
    const saved = await saveState(state, revision);
    res.json({ ok: true, state: saved.state, revision: saved.revision, record: item });
  } catch (error) {
    console.error('Trash restore failed:', error.message);
    res.status(500).json({ message: 'Could not restore record' });
  }
});
app.delete('/api/trash/:module/:id/permanent', auth, requireSuperAdmin, async (req, res) => {
  try {
    const config = trashConfig(req.params.module);
    if (!config) return res.status(404).json({ message: 'Unknown trash module' });
    const { state, revision } = await loadCurrentState();
    const list = Array.isArray(state[config.stateKey]) ? state[config.stateKey] : [];
    const item = list.find(row => String(row.id) === String(req.params.id) && (!config.match || config.match(row)));
    if (!item) return res.status(404).json({ message: 'Record not found' });
    const files = collectBlobUrls(item);
    const relatedPdfIds = [];
    if (config.key === 'without_driver' || config.key === 'with_driver') {
      for (const pdf of state.pdfExports || []) {
        if (String(pdf.recordId || '') === String(item.id)) {
          relatedPdfIds.push(pdf.id);
          collectBlobUrls(pdf, files);
          pdf.is_deleted = true;
        }
      }
      for (const report of state.reports || []) {
        if (relatedPdfIds.some(id => String(id) === String(report.id))) collectBlobUrls(report, files);
      }
      state.pdfExports = (state.pdfExports || []).filter(pdf => String(pdf.recordId || '') !== String(item.id));
      state.reports = (state.reports || []).filter(report => !relatedPdfIds.some(id => String(id) === String(report.id)));
    }
    if (config.key === 'reports') collectBlobUrls(item, files);
    state[config.stateKey] = list.filter(row => !(String(row.id) === String(item.id) && (!config.match || config.match(row))));
    await deleteBlobUrls([...files]);
    await deleteTypedRecord(config, item.id, relatedPdfIds);
    const saved = await saveState(state, revision);
    res.json({ ok: true, deletedFiles: files.size, state: saved.state, revision: saved.revision });
  } catch (error) {
    console.error('Permanent delete failed:', error.message);
    res.status(500).json({ message: 'Permanent delete failed' });
  }
});
function requireUploadDependencies(req, res, next) {
  if (!upload) {
    return res.status(503).json({
      message: 'Image upload is temporarily unavailable because deployment dependencies are incomplete.',
      detail: uploadDependencyError?.message || 'multer/sharp not loaded'
    });
  }
  next();
}
app.post('/api/files/images', auth, requireUploadDependencies, upload ? upload.array('images', 12) : (req, res, next) => next(), async (req, res) => {
  try {
    const files = req.files || [];
    if (!files.length) return res.status(400).json({ message: 'Select at least one image' });
    const urls = [];
    for (const file of files) urls.push(await putImageBuffer(file.buffer, file.originalname || 'image'));
    res.json({ ok: true, urls, url: urls[0] });
  } catch (error) {
    console.error('Image upload failed:', error.message);
    res.status(400).json({ message: error.message || 'Image upload failed' });
  }
});
app.post('/api/files/blob', auth, async (req, res) => {
  try {
    const contentType = String(req.body?.contentType || '').toLowerCase();
    const url = await putDataUrl(req.body?.dataUrl, req.body?.filename || 'file');
    if (cloudMode && contentType === 'application/pdf') {
      const id = String(req.body?.id || Date.now());
      await sql`INSERT INTO exported_pdfs (client_id,record_type,record_client_id,customer_name,pdf_url,extra,created_by) VALUES (${id},${req.body?.recordType || 'rental'},${req.body?.recordId ? String(req.body.recordId) : null},${req.body?.customerName || null},${url},${JSON.stringify(req.body || {})}::jsonb,${req.user.username}) ON CONFLICT (client_id) DO UPDATE SET pdf_url=EXCLUDED.pdf_url,extra=EXCLUDED.extra`;
      await sql`INSERT INTO reports (client_id,report_type,title,file_url,extra,updated_at) VALUES (${id},${req.body?.recordType || 'rental'},${req.body?.customerName || req.body?.filename || 'Exported PDF'},${url},${JSON.stringify(req.body || {})}::jsonb,NOW()) ON CONFLICT (client_id) DO UPDATE SET report_type=EXCLUDED.report_type,title=EXCLUDED.title,file_url=EXCLUDED.file_url,extra=EXCLUDED.extra,updated_at=NOW()`;
    } else if (cloudMode && ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'text/csv'].includes(contentType)) {
      const id = String(req.body?.id || Date.now());
      await sql`INSERT INTO reports (client_id,report_type,title,file_url,extra,updated_at) VALUES (${id},${req.body?.recordType || 'report'},${req.body?.title || req.body?.filename || 'Exported report'},${url},${JSON.stringify(req.body || {})}::jsonb,NOW()) ON CONFLICT (client_id) DO UPDATE SET report_type=EXCLUDED.report_type,title=EXCLUDED.title,file_url=EXCLUDED.file_url,extra=EXCLUDED.extra,updated_at=NOW()`;
    }
    res.json({ ok: true, url });
  } catch (error) {
    console.error('Blob upload failed:', error.message);
    res.status(500).json({ message: 'File upload failed' });
  }
});
app.post('/api/export/state', auth, async (req, res) => {
  try {
    const state = req.body?.state || {};
    if (cloudMode) {
      await syncStateToTables(await moveFilesToBlob(state));
      return res.json({ ok: true, mode: 'cloud' });
    }
    await saveState(state, revision);
    res.json({ ok: true, mode: 'local-dev', location: dataRoot() });
  } catch (error) {
    console.error('Export failed:', error.message);
    res.status(500).json({ message: 'Export failed' });
  }
});
app.get(/^\/(?!api(?:\/|$)).*/, (req, res, next) => {
  if (!staticRoot || !req.accepts('html')) return next();
  res.sendFile(path.join(staticRoot, 'index.html'));
});

if (require.main === module) app.listen(port, () => console.log(`Mian Rent A Car is running on http://localhost:${port} in ${cloudMode ? 'cloud' : 'local-dev'} mode`));
module.exports = app;
