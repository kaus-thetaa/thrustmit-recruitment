import bcrypt from 'bcryptjs';import dotenv from 'dotenv';import{pool}from'../src/db.js';dotenv.config();
const password=await bcrypt.hash('ChangeMe123!',12);
const users=[['Admin','admin@example.com',password,'ADMIN'],['Test Checker','checker@example.com',password,'TEST_CHECKER'],['Interviewer','interviewer@example.com',password,'INTERVIEWER']];
for(const u of users)await pool.query(`INSERT INTO users(name,email,password_hash,role) VALUES(?,?,?,?) ON DUPLICATE KEY UPDATE name=VALUES(name),role=VALUES(role)`,u);
console.log('Seeded users. Default password: ChangeMe123! (change before production).');await pool.end();
