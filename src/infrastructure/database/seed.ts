import { db } from './db.js';
import { hashPassword, encryptField } from '../../common/security/crypto.js';
import { logger } from '../../common/observability/logger.js';

export async function seedDatabase() {
  logger.info('Starting database seeding...');
  db.clear();

  const passwordHash = await hashPassword('Password123!');

  // 1. Admin
  const admin = db.insert('users', {
    email: 'admin@amrutam.com',
    password_hash: passwordHash,
    role: 'ADMIN',
    is_active: true,
    mfa_enabled: false,
  });

  db.insert('profiles', {
    user_id: admin.id,
    first_name: 'System',
    last_name: 'Administrator',
    phone: '+919999999999',
  });

  // 2. Doctor 1 (Ayurveda Specialist)
  const docUser1 = db.insert('users', {
    email: 'dr.sharma@amrutam.com',
    password_hash: passwordHash,
    role: 'DOCTOR',
    is_active: true,
    mfa_enabled: false,
  });

  db.insert('profiles', {
    user_id: docUser1.id,
    first_name: 'Rajesh',
    last_name: 'Sharma',
    phone: '+919876543210',
  });

  const doc1 = db.insert('doctors', {
    user_id: docUser1.id,
    specialization: 'Ayurveda General Medicine',
    license_number: 'AYUR-DEL-2015-8941',
    years_of_experience: 12,
    bio: 'Specialist in holistic metabolic care and Ayurvedic constitutional assessment (Prakriti).',
    consultation_fee: 750.00,
    is_verified: true,
  });

  // 3. Doctor 2 (Panchakarma Specialist)
  const docUser2 = db.insert('users', {
    email: 'dr.menon@amrutam.com',
    password_hash: passwordHash,
    role: 'DOCTOR',
    is_active: true,
    mfa_enabled: false,
  });

  db.insert('profiles', {
    user_id: docUser2.id,
    first_name: 'Ananya',
    last_name: 'Menon',
    phone: '+919876543211',
  });

  const doc2 = db.insert('doctors', {
    user_id: docUser2.id,
    specialization: 'Panchakarma & Detoxification',
    license_number: 'AYUR-KER-2018-4521',
    years_of_experience: 8,
    bio: 'Expert in classical Panchakarma therapies and chronic inflammatory disorders.',
    consultation_fee: 1000.00,
    is_verified: true,
  });

  // 4. Patients
  const patientUser1 = db.insert('users', {
    email: 'patient.arjun@example.com',
    password_hash: passwordHash,
    role: 'PATIENT',
    is_active: true,
    mfa_enabled: false,
  });

  db.insert('profiles', {
    user_id: patientUser1.id,
    first_name: 'Arjun',
    last_name: 'Verma',
    phone: '+919123456780',
    date_of_birth: '1992-05-14',
    gender: 'Male',
    medical_history_encrypted: encryptField('Mild digestive distress, Pitta-predominant imbalance.'),
  });

  const patientUser2 = db.insert('users', {
    email: 'patient.priya@example.com',
    password_hash: passwordHash,
    role: 'PATIENT',
    is_active: true,
    mfa_enabled: false,
  });

  db.insert('profiles', {
    user_id: patientUser2.id,
    first_name: 'Priya',
    last_name: 'Nair',
    phone: '+919123456781',
    date_of_birth: '1996-09-22',
    gender: 'Female',
    medical_history_encrypted: encryptField('Chronic migraine, Vata imbalance history.'),
  });

  // 5. Future Slots for Dr. Sharma
  const now = new Date();
  const slotDate = new Date(now.getTime() + 24 * 60 * 60 * 1000); // Tomorrow
  slotDate.setHours(10, 0, 0, 0);

  const slot1 = db.insert('availability_slots', {
    doctor_id: doc1.id,
    start_time: slotDate.toISOString(),
    end_time: new Date(slotDate.getTime() + 30 * 60 * 1000).toISOString(),
    status: 'AVAILABLE',
  });

  const slot2Time = new Date(slotDate.getTime() + 60 * 60 * 1000);
  db.insert('availability_slots', {
    doctor_id: doc1.id,
    start_time: slot2Time.toISOString(),
    end_time: new Date(slot2Time.getTime() + 30 * 60 * 1000).toISOString(),
    status: 'AVAILABLE',
  });

  // Future Slot for Dr. Menon
  db.insert('availability_slots', {
    doctor_id: doc2.id,
    start_time: slotDate.toISOString(),
    end_time: new Date(slotDate.getTime() + 45 * 60 * 1000).toISOString(),
    status: 'AVAILABLE',
  });

  logger.info('Database successfully seeded with initial test records.', {
    adminEmail: 'admin@amrutam.com',
    doctors: [doc1.id, doc2.id],
    slotsAvailable: [slot1.id],
    defaultPassword: 'Password123!',
  });
}

// Auto-run if executed directly
if (process.argv[1]?.endsWith('seed.ts') || process.argv[1]?.endsWith('seed.js')) {
  seedDatabase()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Seeding failed', err);
      process.exit(1);
    });
}
