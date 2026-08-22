CREATE DATABASE IF NOT EXISTS recruitment CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE recruitment;

CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  email VARCHAR(190) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('ADMIN','TEST_CHECKER','INTERVIEWER') NOT NULL DEFAULT 'INTERVIEWER',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS campaigns (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(160) NOT NULL,
  recruitment_year YEAR NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  written_max_marks DECIMAL(6,2) NOT NULL DEFAULT 20,
  written_qualified_count INT UNSIGNED NOT NULL DEFAULT 150,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_campaign_name_year (name, recruitment_year)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS candidates (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  campaign_id BIGINT UNSIGNED NULL,
  registration_number VARCHAR(80) NULL,
  learner_id VARCHAR(100) NULL,
  name VARCHAR(180) NOT NULL,
  phone VARCHAR(40) NULL,
  email VARCHAR(190) NULL,
  branch VARCHAR(120) NULL,
  attendance ENUM('PRESENT','ABSENT','UNKNOWN') NOT NULL DEFAULT 'UNKNOWN',
  source_date VARCHAR(80) NULL,
  source_time_slot VARCHAR(80) NULL,
  source_classroom VARCHAR(80) NULL,
  source_status VARCHAR(120) NULL,
  source_attendance_raw VARCHAR(120) NULL,
  status VARCHAR(80) NOT NULL DEFAULT 'APPLIED FOR WRITTEN',
  notes TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,
  archived_status VARCHAR(80) NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_candidates_registration (registration_number),
  INDEX idx_candidates_campaign (campaign_id),
  INDEX idx_candidates_name (name),
  INDEX idx_candidates_learner (learner_id),
  INDEX idx_candidates_phone (phone),
  INDEX idx_candidates_email (email),
  INDEX idx_candidates_status (status),
  CONSTRAINT fk_candidate_campaign FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS written_tests (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  candidate_id BIGINT UNSIGNED NOT NULL UNIQUE,
  set_number TINYINT UNSIGNED NULL,
  marks DECIMAL(6,2) NULL,
  max_marks DECIMAL(6,2) NOT NULL DEFAULT 20,
  set_percentile DECIMAL(8,4) NULL,
  normalized_z DECIMAL(12,6) NULL,
  normalized_percentile DECIMAL(8,4) NULL,
  qualified BOOLEAN NULL,
  remarks TEXT NULL,
  scored_by BIGINT UNSIGNED NULL,
  scored_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_written_candidate FOREIGN KEY (candidate_id) REFERENCES candidates(id) ON DELETE CASCADE,
  CONSTRAINT fk_written_user FOREIGN KEY (scored_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_written_set (set_number),
  INDEX idx_written_norm_pct (normalized_percentile)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS interview_phases (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  campaign_id BIGINT UNSIGNED NULL,
  name VARCHAR(160) NOT NULL,
  phase_type ENUM('REC_INTERVIEW','TASKPHASE') NOT NULL DEFAULT 'TASKPHASE',
  description TEXT NULL,
  phase_order INT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_phase_campaign FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE SET NULL,
  CONSTRAINT fk_phase_user FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_phase_campaign_order (campaign_id, phase_order)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS interview_results (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  phase_id BIGINT UNSIGNED NOT NULL,
  candidate_id BIGINT UNSIGNED NOT NULL,
  interviewer_names JSON NULL,
  attendance ENUM('PRESENT','ABSENT','RESCHEDULED','EXCUSED') NOT NULL DEFAULT 'PRESENT',
  interview_date DATE NULL,
  remarks TEXT NULL,
  created_by BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_result_phase FOREIGN KEY (phase_id) REFERENCES interview_phases(id) ON DELETE CASCADE,
  CONSTRAINT fk_result_candidate FOREIGN KEY (candidate_id) REFERENCES candidates(id) ON DELETE CASCADE,
  CONSTRAINT fk_result_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_result_candidate (candidate_id),
  INDEX idx_result_phase (phase_id),
  INDEX idx_result_attendance (attendance),
  UNIQUE KEY uq_interview_candidate_phase (candidate_id, phase_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NULL,
  candidate_id BIGINT UNSIGNED NULL,
  action VARCHAR(80) NOT NULL,
  object_type VARCHAR(80) NOT NULL,
  object_id BIGINT UNSIGNED NULL,
  field_name VARCHAR(120) NULL,
  old_value TEXT NULL,
  new_value TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_audit_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_audit_candidate FOREIGN KEY (candidate_id) REFERENCES candidates(id) ON DELETE SET NULL,
  INDEX idx_audit_candidate (candidate_id),
  INDEX idx_audit_created (created_at)
) ENGINE=InnoDB;

INSERT INTO campaigns(name,recruitment_year,active,written_max_marks,written_qualified_count)
SELECT 'LMS Recruitment', YEAR(CURDATE()), 1, 20, 150
WHERE NOT EXISTS (SELECT 1 FROM campaigns WHERE recruitment_year=YEAR(CURDATE()));

INSERT INTO interview_phases(campaign_id,name,phase_type,description,phase_order,active)
SELECT c.id,'Recruitment Interview','REC_INTERVIEW','First interview after written round',1,1
FROM campaigns c
WHERE c.recruitment_year=YEAR(CURDATE())
  AND NOT EXISTS (SELECT 1 FROM interview_phases p WHERE p.campaign_id=c.id AND p.phase_order=1);
