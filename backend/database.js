const mongoose = require('mongoose');
// Models are required here so they register with mongoose before routes load
const Participant = require('./models/Participant');
const Admin       = require('./models/Admin');
const Airline     = require('./models/Airline');
// CertCounter is required only by the certificates route — not needed here

async function initDB() {
  const mongoUrl = process.env.MONGODB_URL;
  if (!mongoUrl) {
    throw new Error('MONGODB_URL environment variable is required');
  }

  const maxRetries = 5;
  let retries = 0;

  while (retries < maxRetries) {
    try {
      await mongoose.connect(mongoUrl, {
        dbName: 'certificateSystem',
        serverSelectionTimeoutMS: 5000,
        connectTimeoutMS: 10000,
      });
      console.log('✅ Connected to MongoDB Atlas');
      break;
    } catch (err) {
      retries++;
      const delay = Math.min(1000 * Math.pow(2, retries - 1), 10000);
      if (retries < maxRetries) {
        console.warn(`⚠️  MongoDB connection failed (attempt ${retries}/${maxRetries}). Retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        console.error(`❌ Failed to connect to MongoDB after ${maxRetries} attempts`);
        throw err;
      }
    }
  }

  // Seed default admin if none exists
  const adminCount = await Admin.countDocuments();
  if (adminCount === 0) {
    await Admin.create({
      name: 'IFOA Administrator',
      email: 'admin@ifoa.com',
      password: 'admin123',
      role: 'Administrator',
      organization: 'IFOA - International Flight Operations Academy',
    });
    console.log('✅ Default admin seeded: admin@ifoa.com / admin123');
  }

  // Seed demo airline account if none exists
  const airlineCount = await Airline.countDocuments();
  if (airlineCount === 0) {
    await Airline.create({
      name: 'Emirates Operations',
      airlineName: 'Emirates Airlines',
      email: 'ops@emirates.com',
      password: 'airline123',
    });
    console.log('✅ Demo airline seeded: ops@emirates.com / airline123');
  }

  // Seed participants if collection is empty
  const count = await Participant.countDocuments();
  if (count === 0) {
    await seedParticipants();
  }

}

async function seedParticipants() {
  // Seed participants with NO cert_sequence and cert_released = false.
  // cert_sequence is only assigned when an admin explicitly clicks Generate.
  const rows = [
    // cert_sequence intentionally omitted — must be absent (not null) for sparse index
    { first_name: 'John',   last_name: 'Smith',       participant_name: 'John Smith',       company: 'Emirates Airlines', department: 'Flight Operations',  training_type: 'FDI', training_date: '2025-06-15', modules: null,                                               airline_name: 'Emirates Airlines', locked: true, cert_released: false },
    { first_name: 'Sarah',  last_name: 'Johnson',     participant_name: 'Sarah Johnson',    company: 'Qatar Airways',     department: 'Safety Department',  training_type: 'HF',  training_date: '2025-07-20', modules: null,                                               airline_name: 'Qatar Airways',     locked: true, cert_released: false },
    { first_name: 'Ahmed',  last_name: 'Al-Rashid',   participant_name: 'Ahmed Al-Rashid',  company: 'Etihad Airways',    department: 'Flight Dispatch',    training_type: 'FDR', training_date: '2025-08-10', modules: 'Air Law,Aircraft Systems,Navigation,Meteorology', airline_name: 'Etihad Airways',    locked: true, cert_released: false },
    { first_name: 'Maria',  last_name: 'Garcia',      participant_name: 'Maria Garcia',     company: 'Oman Air',          department: 'Operations Control', training_type: 'FDA', training_date: '2025-09-05', modules: null,                                               airline_name: 'Oman Air',          locked: true, cert_released: false },
    { first_name: 'James',  last_name: 'Wilson',      participant_name: 'James Wilson',     company: 'Gulf Air',          department: 'Flight Operations',  training_type: 'FTL', training_date: '2025-10-12', modules: null,                                               airline_name: 'Gulf Air',          locked: true, cert_released: false },
    { first_name: 'Fatima', last_name: 'Al-Hassan',   participant_name: 'Fatima Al-Hassan', company: 'Saudi Airlines',    department: 'Flight Dispatch',    training_type: 'NDG', training_date: '2025-11-01', modules: null,                                               airline_name: 'Saudi Airlines',    locked: true, cert_released: false },
  ];

  await Participant.insertMany(rows);
  console.log('✅ Participant seed data inserted — all pending admin generation');
}

module.exports = { initDB, Participant };
