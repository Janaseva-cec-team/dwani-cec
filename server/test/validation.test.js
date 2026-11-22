'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { validateComplaintInput, canTransitionStatus, VALID_PRIORITIES } = require('../validation');

const validComplaint = {
  title: 'Large pothole near school',
  category: 'Road damage and potholes',
  area: 'Kadri',
  landmark: 'Near school gate',
  description: 'A large pothole is creating a safety hazard for road users.',
  name: 'Test Citizen',
  phone: '9876543210',
  email: 'citizen@example.com',
  lat: 12.895,
  lng: 74.855
};

test('accepts a valid complaint payload', () => {
  assert.deepEqual(validateComplaintInput(validComplaint), { ok: true });
});

test('rejects unsupported categories', () => {
  assert.equal(validateComplaintInput({ ...validComplaint, category: 'Unknown' }).ok, false);
});

test('rejects too-short and too-long descriptions', () => {
  assert.equal(validateComplaintInput({ ...validComplaint, description: 'short' }).ok, false);
  assert.equal(validateComplaintInput({ ...validComplaint, description: 'x'.repeat(3001) }).ok, false);
});

test('requires latitude and longitude as a pair', () => {
  assert.equal(validateComplaintInput({ ...validComplaint, lng: undefined }).ok, false);
});

test('rejects out-of-range coordinates', () => {
  assert.equal(validateComplaintInput({ ...validComplaint, lat: 91 }).ok, false);
});

test('rejects malformed contact information', () => {
  assert.equal(validateComplaintInput({ ...validComplaint, email: 'not-an-email' }).ok, false);
  assert.equal(validateComplaintInput({ ...validComplaint, phone: 'abc' }).ok, false);
});

test('allows only explicitly supported status transitions', () => {
  assert.equal(canTransitionStatus('Submitted', 'Verified'), true);
  assert.equal(canTransitionStatus('Submitted', 'Resolved'), false);
  assert.equal(canTransitionStatus('Resolved', 'Reopened'), true);
  assert.equal(canTransitionStatus('Resolved', 'Assigned'), false);
});

test('priority vocabulary is constrained', () => {
  assert.deepEqual(VALID_PRIORITIES, ['Critical', 'High', 'Medium', 'Low']);
});
