-- Social Update database schema (MySQL 8+)
-- Run:  mysql -u root -p < database/schema.sql

CREATE DATABASE IF NOT EXISTS social_update
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE social_update;

CREATE TABLE IF NOT EXISTS users (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  role          ENUM(
                  'farmer',
                  'hotel_manager',
                  'processing_manager',
                  'orphanage_incharge',
                  'college_incharge',
                  'ngo_incharge',
                  'other'
                ) NOT NULL,
  org_name      VARCHAR(150) NOT NULL,
  contact_name  VARCHAR(100) NOT NULL,
  phone         VARCHAR(20)  NOT NULL,
  email         VARCHAR(150) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  district      VARCHAR(60)  NOT NULL,
  area          VARCHAR(100) NOT NULL,
  address       VARCHAR(255) NULL,
  latitude      DECIMAL(9,6) NULL,   -- optional pin dropped on the map
  longitude     DECIMAL(9,6) NULL,
  details       TEXT NULL,
  capacity      VARCHAR(100) NULL,
  website       VARCHAR(255) NULL,
  photo_url     VARCHAR(255) NULL,   -- optional farm / organisation picture
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_users_role (role),
  INDEX idx_users_district (district)
) ENGINE=InnoDB;

-- One table for everything members post:
--   produce          -> farmers selling crops
--   ingredient_need  -> hotels / colleges looking for ingredients
--   raw_material_need-> factories looking for raw material
--   surplus_food     -> hotels / colleges offering safe surplus meals
--   food_request     -> orphanages / NGOs asking for food
--   help_request     -> orphanages / NGOs asking for delivery persons or volunteers
--   transport_offer  -> 'other' members offering a vehicle (with free-from / free-until)
CREATE TABLE IF NOT EXISTS listings (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id     INT UNSIGNED NOT NULL,
  type        ENUM(
                'produce',
                'ingredient_need',
                'raw_material_need',
                'surplus_food',
                'food_request',
                'transport_offer',
                'help_request'
              ) NOT NULL,
  title       VARCHAR(150) NOT NULL,
  quantity    DECIMAL(10,2) NULL,
  unit        VARCHAR(20) NULL,
  price       DECIMAL(10,2) NULL,
  description TEXT NULL,
  image_url   VARCHAR(255) NULL,   -- optional picture (crop, food, etc.)
  vehicle         VARCHAR(60) NULL,   -- transport offers only
  help_kind       VARCHAR(20) NULL,   -- help requests only: delivery_person / volunteer / both
  available_from  DATETIME    NULL,   -- transport offers / help requests
  available_until DATETIME    NULL,   -- transport offers / help requests
  status      ENUM('open','closed') NOT NULL DEFAULT 'open',
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_listings_user FOREIGN KEY (user_id)
    REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_listings_type_status (type, status)
) ENGINE=InnoDB;

ALTER TABLE listings
  MODIFY type ENUM('produce','ingredient_need','raw_material_need',
                   'surplus_food','food_request','transport_offer',
                   'help_request') NOT NULL,
  ADD COLUMN help_kind VARCHAR(20) NULL AFTER vehicle;
