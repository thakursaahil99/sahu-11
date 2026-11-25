import { PrismaClient, UserRole } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { loadEnv } from '../src/config/env';

const env = loadEnv();
const prisma = new PrismaClient();

interface SeedUser {
  name: string;
  email: string;
  phone: string;
  password: string;
  dob: string;
  role: UserRole;
  referralCode: string;
  favouriteTeam?: string;
  city?: string;
}

const users: SeedUser[] = [
  {
    name: 'Demo Player',
    email: 'demo@dreamnew11.app',
    phone: '+919999999999',
    password: 'Demo@1234',
    dob: '1998-04-12',
    role: 'USER',
    referralCode: 'D11DEMO01',
    favouriteTeam: 'Mumbai',
    city: 'Mumbai',
  },
  {
    name: 'Super Admin',
    email: 'admin@dreamnew11.app',
    phone: '+919999999990',
    password: 'Admin@1234',
    dob: '1990-01-01',
    role: 'SUPER_ADMIN',
    referralCode: 'D11ADMIN1',
  },
  // One account per staff role, to try the admin panel's permissions.
  { name: 'Content Admin', email: 'content@dreamnew11.app', phone: '+919999999991', password: 'Admin@1234', dob: '1991-01-01', role: 'CONTENT_ADMIN', referralCode: 'D11STAFF1' },
  { name: 'Support Agent', email: 'support@dreamnew11.app', phone: '+919999999992', password: 'Admin@1234', dob: '1992-01-01', role: 'SUPPORT', referralCode: 'D11STAFF2' },
  { name: 'Finance Officer', email: 'finance@dreamnew11.app', phone: '+919999999993', password: 'Admin@1234', dob: '1993-01-01', role: 'FINANCE', referralCode: 'D11STAFF3' },
];

async function main(): Promise<void> {
  if (env.APP_MODE !== 'demo') {
    throw new Error('Refusing to seed demo accounts unless APP_MODE=demo');
  }
  for (const u of users) {
    const passwordHash = await bcrypt.hash(u.password, env.BCRYPT_ROUNDS);
    const data = {
      name: u.name,
      phone: u.phone,
      passwordHash,
      dob: new Date(`${u.dob}T00:00:00.000Z`),
      role: u.role,
      favouriteTeam: u.favouriteTeam ?? null,
      city: u.city ?? null,
      phoneVerifiedAt: new Date(),
      emailVerifiedAt: new Date(),
    };
    await prisma.user.upsert({
      where: { email: u.email },
      update: data,
      create: {
        ...data,
        email: u.email,
        referralCode: u.referralCode,
        termsAcceptedAt: new Date(),
        settings: { create: {} },
      },
    });
    console.log(`  ✓ ${u.role.padEnd(11)} ${u.email} / ${u.password}  (phone ${u.phone}, OTP 123456)`);
  }
}

main()
  .then(() => console.log('Seed complete.'))
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
