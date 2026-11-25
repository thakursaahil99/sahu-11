import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dobSchema, emailSchema, nameSchema, passwordSchema, phoneSchema } from './auth';
import { calculateAge, parseIsoDate } from '../utils/age';

function isoYearsAgo(years: number, dayOffset = 0): string {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear() - years, now.getUTCMonth(), now.getUTCDate() + dayOffset));
  return d.toISOString().slice(0, 10);
}

test('dob: turning 18 today is allowed', () => {
  assert.equal(dobSchema.safeParse(isoYearsAgo(18)).success, true);
});

test('dob: one day short of 18 is rejected', () => {
  assert.equal(dobSchema.safeParse(isoYearsAgo(18, 1)).success, false);
});

test('dob: impossible or malformed dates are rejected', () => {
  assert.equal(parseIsoDate('2001-02-30'), null);
  assert.equal(dobSchema.safeParse('2001-13-01').success, false);
  assert.equal(dobSchema.safeParse('01-01-2001').success, false);
});

test('calculateAge counts birthdays later in the year', () => {
  const dob = new Date(Date.UTC(2000, 11, 31));
  assert.equal(calculateAge(dob, new Date(Date.UTC(2020, 11, 30))), 19);
  assert.equal(calculateAge(dob, new Date(Date.UTC(2020, 11, 31))), 20);
});

test('phone: normalises Indian numbers to E.164', () => {
  assert.equal(phoneSchema.parse('98765 43210'), '+919876543210');
  assert.equal(phoneSchema.parse('919876543210'), '+919876543210');
  assert.equal(phoneSchema.safeParse('12345').success, false);
});

test('email: trims and lowercases', () => {
  assert.equal(emailSchema.parse('  Foo@Example.COM '), 'foo@example.com');
});

test('password: requires a letter and a digit', () => {
  assert.equal(passwordSchema.safeParse('abcdefgh').success, false);
  assert.equal(passwordSchema.safeParse('abcd1234').success, true);
});

test('name: accepts Indian scripts, rejects digits and symbols', () => {
  for (const ok of ['राहुल शर्मा', 'அருண் குமார்', "Zoë O'Brien", 'Dr. A. Rao']) assert.equal(nameSchema.safeParse(ok).success, true, ok);
  for (const bad of ['R2D2', '<script>', ' ', '-Rahul']) assert.equal(nameSchema.safeParse(bad).success, false, bad);
});
