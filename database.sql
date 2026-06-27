-- Mian Rent A Car production schema for Neon PostgreSQL.
-- Run this in the Neon SQL editor before first production use, or let the
-- server create the same tables on startup.

CREATE TABLE IF NOT EXISTS app_state (
  state_key TEXT PRIMARY KEY,
  payload JSONB NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS customers (
  id BIGSERIAL PRIMARY KEY,
  client_id TEXT UNIQUE,
  name TEXT,
  phone TEXT,
  identity_card TEXT,
  address TEXT,
  customer_photo_url TEXT,
  cnic_front_url TEXT,
  cnic_back_url TEXT,
  driving_license_url TEXT,
  extra JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS drivers (
  id BIGSERIAL PRIMARY KEY,
  client_id TEXT UNIQUE,
  name TEXT,
  father_name TEXT,
  relative_name TEXT,
  address TEXT,
  qoom TEXT,
  phone TEXT,
  family_number TEXT,
  phone2 TEXT,
  identity_card TEXT,
  customer_photo_url TEXT,
  cnic_front_url TEXT,
  cnic_back_url TEXT,
  driving_license_url TEXT,
  extra JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cars (
  id BIGSERIAL PRIMARY KEY,
  client_id TEXT UNIQUE,
  car_name TEXT,
  car_number TEXT,
  model TEXT,
  color TEXT,
  registration_number TEXT,
  renting_station TEXT,
  chassis_no TEXT,
  engine_number TEXT,
  image_url_1 TEXT,
  image_url_2 TEXT,
  image_url_3 TEXT,
  image_url_4 TEXT,
  extra JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS rentals (
  id BIGSERIAL PRIMARY KEY,
  client_id TEXT UNIQUE,
  rental_type TEXT NOT NULL CHECK (rental_type IN ('with_driver','without_driver')),
  seq_no TEXT,
  rental_date DATE,
  car_no TEXT,
  driver_name TEXT,
  customer_name TEXT,
  phone TEXT,
  identity_card TEXT,
  address TEXT,
  pickup_place TEXT,
  pickup_date TIMESTAMPTZ,
  dropup_place TEXT,
  dropup_date TIMESTAMPTZ,
  referrer TEXT,
  rent NUMERIC(12,2) DEFAULT 0,
  fuel_expense NUMERIC(12,2) DEFAULT 0,
  toll NUMERIC(12,2) DEFAULT 0,
  driver_commission NUMERIC(12,2) DEFAULT 0,
  profit NUMERIC(12,2) DEFAULT 0,
  customer_photo_url TEXT,
  cnic_front_url TEXT,
  cnic_back_url TEXT,
  driving_license_url TEXT,
  pdf_url TEXT,
  extra JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS without_driver_bookings (
  id BIGSERIAL PRIMARY KEY,
  rental_client_id TEXT UNIQUE,
  seq_no TEXT,
  customer_name TEXT,
  identity_card TEXT,
  guarantor_name TEXT,
  guarantor_identity_card TEXT,
  car_no TEXT,
  pickup_date TIMESTAMPTZ,
  dropup_date TIMESTAMPTZ,
  rent NUMERIC(12,2) DEFAULT 0,
  pdf_url TEXT,
  extra JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS with_driver_bookings (
  id BIGSERIAL PRIMARY KEY,
  rental_client_id TEXT UNIQUE,
  seq_no TEXT,
  customer_name TEXT,
  identity_card TEXT,
  driver_name TEXT,
  car_no TEXT,
  pickup_date TIMESTAMPTZ,
  dropup_date TIMESTAMPTZ,
  rent NUMERIC(12,2) DEFAULT 0,
  driver_commission NUMERIC(12,2) DEFAULT 0,
  pdf_url TEXT,
  extra JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS exported_pdfs (
  id BIGSERIAL PRIMARY KEY,
  client_id TEXT UNIQUE,
  record_type TEXT NOT NULL,
  record_client_id TEXT,
  customer_name TEXT,
  pdf_url TEXT NOT NULL,
  extra JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS reports (
  id BIGSERIAL PRIMARY KEY,
  client_id TEXT UNIQUE,
  report_type TEXT NOT NULL,
  title TEXT,
  file_url TEXT,
  extra JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS expenses (
  id BIGSERIAL PRIMARY KEY,
  client_id TEXT UNIQUE,
  expense_type TEXT NOT NULL,
  expense_date DATE,
  expense_time TEXT,
  car_no TEXT,
  person TEXT,
  receiving_person TEXT,
  reason TEXT,
  amount NUMERIC(12,2) DEFAULT 0,
  notes TEXT,
  extra JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS app_objects (
  id BIGSERIAL PRIMARY KEY,
  object_key TEXT UNIQUE NOT NULL,
  label TEXT NOT NULL,
  extra JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS app_fields (
  id BIGSERIAL PRIMARY KEY,
  client_id TEXT UNIQUE NOT NULL,
  object_key TEXT NOT NULL,
  field_key TEXT NOT NULL,
  name TEXT NOT NULL,
  field_type TEXT NOT NULL,
  options TEXT,
  extra JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS admin_settings (
  setting_key TEXT PRIMARY KEY,
  payload JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_customers_identity_card ON customers(identity_card);
CREATE INDEX IF NOT EXISTS idx_drivers_identity_card ON drivers(identity_card);
CREATE INDEX IF NOT EXISTS idx_cars_car_number ON cars(car_number);
CREATE INDEX IF NOT EXISTS idx_rentals_customer_name ON rentals(customer_name);
CREATE INDEX IF NOT EXISTS idx_rentals_car_no ON rentals(car_no);
CREATE INDEX IF NOT EXISTS idx_exported_pdfs_record_client_id ON exported_pdfs(record_client_id);
CREATE INDEX IF NOT EXISTS idx_reports_report_type ON reports(report_type);
CREATE INDEX IF NOT EXISTS idx_expenses_type_date ON expenses(expense_type, expense_date);
CREATE INDEX IF NOT EXISTS idx_app_fields_object_key ON app_fields(object_key);

ALTER TABLE customers ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS deleted_by TEXT;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS deleted_by TEXT;
ALTER TABLE cars ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE cars ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE cars ADD COLUMN IF NOT EXISTS deleted_by TEXT;
ALTER TABLE rentals ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE rentals ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE rentals ADD COLUMN IF NOT EXISTS deleted_by TEXT;
ALTER TABLE without_driver_bookings ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE without_driver_bookings ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE without_driver_bookings ADD COLUMN IF NOT EXISTS deleted_by TEXT;
ALTER TABLE with_driver_bookings ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE with_driver_bookings ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE with_driver_bookings ADD COLUMN IF NOT EXISTS deleted_by TEXT;
ALTER TABLE exported_pdfs ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE exported_pdfs ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE exported_pdfs ADD COLUMN IF NOT EXISTS deleted_by TEXT;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS deleted_by TEXT;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS deleted_by TEXT;
ALTER TABLE app_objects ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE app_objects ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE app_objects ADD COLUMN IF NOT EXISTS deleted_by TEXT;
ALTER TABLE app_fields ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE app_fields ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE app_fields ADD COLUMN IF NOT EXISTS deleted_by TEXT;

CREATE INDEX IF NOT EXISTS idx_customers_is_deleted ON customers(is_deleted);
CREATE INDEX IF NOT EXISTS idx_drivers_is_deleted ON drivers(is_deleted);
CREATE INDEX IF NOT EXISTS idx_cars_is_deleted ON cars(is_deleted);
CREATE INDEX IF NOT EXISTS idx_rentals_is_deleted ON rentals(is_deleted);
CREATE INDEX IF NOT EXISTS idx_without_driver_is_deleted ON without_driver_bookings(is_deleted);
CREATE INDEX IF NOT EXISTS idx_with_driver_is_deleted ON with_driver_bookings(is_deleted);
CREATE INDEX IF NOT EXISTS idx_reports_is_deleted ON reports(is_deleted);
CREATE INDEX IF NOT EXISTS idx_expenses_is_deleted ON expenses(is_deleted);
