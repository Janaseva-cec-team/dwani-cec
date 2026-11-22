'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { sanitizePublicComplaint } = require('../privacy');

test('public complaint response strips reporter identifiers and contact details', () => {
  const source = {
    id: 'CP-2026-0001',
    title: 'Pothole on road',
    reporterId: 'usr_private_123',
    reporterName: 'Private Citizen',
    reporterPhone: '+91 9876543210',
    reporterEmail: 'person@example.com',
    phone: '+91 9876543210',
    email: 'person@example.com',
    uploadToken: 'raw-secret',
    uploadTokenHash: 'hashed-secret',
    lat: 12.9,
    lng: 74.8
  };
  const result = sanitizePublicComplaint(source);
  assert.equal(result.reporterId, undefined);
  assert.equal(result.reporterPhone, '');
  assert.equal(result.reporterEmail, '');
  assert.equal(result.phone, '');
  assert.equal(result.email, '');
  assert.equal(result.uploadToken, undefined);
  assert.equal(result.uploadTokenHash, undefined);
  assert.equal(result.reporterName, 'Citizen');
  assert.equal(result.id, source.id);
});

test('public sanitizer safely handles null input', () => {
  assert.equal(sanitizePublicComplaint(null), null);
});
