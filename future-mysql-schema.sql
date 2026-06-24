-- Future MySQL schema only. This file is NOT used by the running local-mode app.
CREATE DATABASE IF NOT EXISTS mian_rent_a_car CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE mian_rent_a_car;

CREATE TABLE users (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(80) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('admin','super_admin') NOT NULL DEFAULT 'admin',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
CREATE TABLE objects (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  object_key VARCHAR(100) NOT NULL UNIQUE,
  label VARCHAR(150) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE object_fields (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  object_id BIGINT UNSIGNED NOT NULL,
  field_key VARCHAR(100) NOT NULL,
  label VARCHAR(150) NOT NULL,
  field_type VARCHAR(40) NOT NULL,
  options_json JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_object_field (object_id,field_key),
  CONSTRAINT fk_field_object FOREIGN KEY (object_id) REFERENCES objects(id) ON DELETE CASCADE
);
CREATE TABLE cars (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  car_name VARCHAR(150), car_number VARCHAR(100) NOT NULL UNIQUE,
  model VARCHAR(100), color VARCHAR(80), registration_number VARCHAR(100),
  renting_station VARCHAR(150), chassis_no VARCHAR(150), engine_number VARCHAR(150),
  details_json JSON NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
CREATE TABLE car_images (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, car_id BIGINT UNSIGNED NOT NULL,
  image_path VARCHAR(500) NOT NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_car_image FOREIGN KEY (car_id) REFERENCES cars(id) ON DELETE CASCADE
);
CREATE TABLE customers (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(150) NOT NULL, phone VARCHAR(60), identity_card VARCHAR(100) UNIQUE,
  address TEXT, customer_image_path VARCHAR(500), details_json JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
CREATE TABLE customer_id_images (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, customer_id BIGINT UNSIGNED NOT NULL,
  image_path VARCHAR(500) NOT NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_customer_id_image FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
);
CREATE TABLE drivers (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(150) NOT NULL, phone VARCHAR(60), identity_card VARCHAR(100) UNIQUE,
  address TEXT, details_json JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
CREATE TABLE driver_id_images (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, driver_id BIGINT UNSIGNED NOT NULL,
  image_path VARCHAR(500) NOT NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_driver_id_image FOREIGN KEY (driver_id) REFERENCES drivers(id) ON DELETE CASCADE
);
CREATE TABLE rentals (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  rental_type ENUM('with_driver','without_driver') NOT NULL,
  seq_no VARCHAR(50), rental_date DATE, car_number VARCHAR(100), driver_name VARCHAR(150),
  customer_name VARCHAR(150), phone VARCHAR(60), identity_card VARCHAR(100),
  rent DECIMAL(14,2) NOT NULL DEFAULT 0, fuel_expense DECIMAL(14,2) NOT NULL DEFAULT 0,
  toll DECIMAL(14,2) NOT NULL DEFAULT 0, driver_commission DECIMAL(14,2) NOT NULL DEFAULT 0,
  profit DECIMAL(14,2) NOT NULL DEFAULT 0, details_json JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_rental_date (rental_date), KEY idx_rental_car (car_number), KEY idx_rental_driver (driver_name)
);
CREATE TABLE expenses (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  expense_type ENUM('car','rent','food','other') NOT NULL, expense_date DATE NOT NULL,
  expense_time TIME NULL, car_number VARCHAR(100) NULL, person_name VARCHAR(150) NULL,
  reason VARCHAR(150) NULL, amount DECIMAL(14,2) NOT NULL, notes TEXT NULL,
  details_json JSON NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_expense_date (expense_date), KEY idx_expense_car (car_number)
);
CREATE TABLE app_settings (
  setting_key VARCHAR(100) PRIMARY KEY, setting_value JSON NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- CRUD templates for the future API:
-- INSERT INTO cars (car_name,car_number,model,color,details_json) VALUES (?,?,?,?,?);
-- UPDATE cars SET car_name=?,model=?,color=?,details_json=? WHERE id=?;
-- DELETE FROM cars WHERE id=?;
-- SELECT * FROM cars WHERE car_number=?;
-- Use matching INSERT / UPDATE / DELETE statements for customers, drivers, rentals, expenses, objects and object_fields.

-- Profit after all car expenses:
CREATE OR REPLACE VIEW car_profit_summary AS
SELECT c.car_number,
  COALESCE(SUM(r.rent),0) AS sales,
  COALESCE(SUM(r.fuel_expense+r.toll+r.driver_commission),0)+COALESCE((SELECT SUM(e.amount) FROM expenses e WHERE e.expense_type='car' AND e.car_number=c.car_number),0) AS expenses,
  COALESCE(SUM(r.profit),0)-COALESCE((SELECT SUM(e.amount) FROM expenses e WHERE e.expense_type='car' AND e.car_number=c.car_number),0) AS net_profit
FROM cars c LEFT JOIN rentals r ON r.car_number=c.car_number GROUP BY c.id,c.car_number;
