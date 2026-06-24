CREATE DATABASE IF NOT EXISTS mian_rent_a_car;
USE mian_rent_a_car;

CREATE TABLE IF NOT EXISTS users (id INT AUTO_INCREMENT PRIMARY KEY, username VARCHAR(80) UNIQUE NOT NULL, password_hash VARCHAR(255) NOT NULL, role ENUM('admin','super_admin') NOT NULL DEFAULT 'admin', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS objects (id INT AUTO_INCREMENT PRIMARY KEY, label VARCHAR(100) NOT NULL, api_name VARCHAR(100) UNIQUE NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS object_fields (id INT AUTO_INCREMENT PRIMARY KEY, object_id INT NOT NULL, label VARCHAR(100) NOT NULL, api_name VARCHAR(100) NOT NULL, field_type VARCHAR(30) NOT NULL, picklist_values JSON NULL, is_required BOOLEAN DEFAULT FALSE, default_value TEXT NULL, formula VARCHAR(255) NULL, lookup_object_id INT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (object_id) REFERENCES objects(id) ON DELETE CASCADE, FOREIGN KEY (lookup_object_id) REFERENCES objects(id) ON DELETE SET NULL);
CREATE TABLE IF NOT EXISTS cars (id INT AUTO_INCREMENT PRIMARY KEY, car_name VARCHAR(100), car_number VARCHAR(80) UNIQUE, model VARCHAR(80), color VARCHAR(50), registration_number VARCHAR(100), renting_station VARCHAR(120), chassis_no VARCHAR(100), engine_number VARCHAR(100), extra JSON NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS customers (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(120), phone VARCHAR(50), id_card_no VARCHAR(80) UNIQUE, address TEXT, id_card_image_path VARCHAR(255), extra JSON NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS drivers (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(120), father_name VARCHAR(120), brother_son_name VARCHAR(120), address TEXT, qoom VARCHAR(80), phone VARCHAR(50), family_number VARCHAR(50), phone2 VARCHAR(50), id_card_no VARCHAR(80) UNIQUE, id_card_image_path VARCHAR(255), extra JSON NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS rentals (id INT AUTO_INCREMENT PRIMARY KEY, seq_no INT NOT NULL, rental_type ENUM('with_driver','without_driver') NOT NULL, date DATE, car_id INT NULL, driver_id INT NULL, customer_id INT NULL, car_no VARCHAR(80), driver_name VARCHAR(120), customer_name VARCHAR(120), phone VARCHAR(50), id_card_no VARCHAR(80), address TEXT, pickup_place VARCHAR(150), pickup_date DATETIME, dropup_place VARCHAR(150), dropup_date DATETIME, refer_name VARCHAR(120), rent DECIMAL(12,2) DEFAULT 0, fuel_expense DECIMAL(12,2) DEFAULT 0, tool DECIMAL(12,2) DEFAULT 0, dr_cms DECIMAL(12,2) DEFAULT 0, profit DECIMAL(12,2) DEFAULT 0, notes TEXT, customer_photo_path VARCHAR(255), id_card_image_path VARCHAR(255), extra JSON NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, UNIQUE KEY seq_per_type (rental_type, seq_no));

-- Application records, uploaded images (as data URLs), trash and final-delete audit trail.
-- Keeping the archive means no business record is ever lost from the database.
CREATE TABLE IF NOT EXISTS system_state (
  state_key VARCHAR(80) PRIMARY KEY,
  payload LONGTEXT NOT NULL,
  revision INT NOT NULL DEFAULT 1,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
