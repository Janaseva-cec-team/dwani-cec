'use strict';

const VALID_STATUSES = ['Submitted', 'Verified', 'Assigned', 'In Progress', 'Resolved', 'Rejected', 'Reopened'];
const VALID_PRIORITIES = ['Critical', 'High', 'Medium', 'Low'];

const STATUS_TRANSITIONS = {
  Submitted: ['Verified', 'Rejected'],
  Verified: ['Assigned', 'In Progress', 'Rejected'],
  Assigned: ['In Progress', 'Rejected'],
  'In Progress': ['Resolved', 'Rejected'],
  Resolved: ['Reopened'],
  Rejected: ['Reopened'],
  Reopened: ['Verified', 'Assigned', 'In Progress', 'Rejected']
};

const SUPPORTED_CATEGORIES = new Set([
  'Road damage and potholes',
  'Garbage and waste management',
  'Water leakage',
  'Drainage and sewage',
  'Streetlight failure',
  'Electricity and exposed wires',
  'Public safety',
  'Traffic problems',
  'Park and public-space maintenance',
  'Other civic issues'
]);

function validOptionalText(value, max, label) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || value.trim().length > max) return `${label} must be ${max} characters or fewer.`;
  return null;
}

function validateComplaintInput(input = {}) {
  const { title, category, area, landmark, description, name, phone, email, lat, lng } = input;
  if (typeof category !== 'string' || !SUPPORTED_CATEGORIES.has(category)) {
    return { ok: false, error: 'Please select a supported complaint category.' };
  }
  if (typeof area !== 'string' || area.trim().length < 2 || area.trim().length > 80) {
    return { ok: false, error: 'Area must be between 2 and 80 characters.' };
  }
  if (typeof description !== 'string' || description.trim().length < 10 || description.trim().length > 3000) {
    return { ok: false, error: 'Description must be between 10 and 3000 characters.' };
  }
  for (const [value, max, label] of [
    [title, 120, 'Title'], [landmark, 160, 'Landmark'], [name, 80, 'Name'], [phone, 24, 'Phone'], [email, 254, 'Email']
  ]) {
    const error = validOptionalText(value, max, label);
    if (error) return { ok: false, error };
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    return { ok: false, error: 'Enter a valid email address.' };
  }
  if (phone && !/^[+()\-\s\d]{7,24}$/.test(phone.trim())) {
    return { ok: false, error: 'Enter a valid phone number.' };
  }
  const hasLat = lat !== undefined && lat !== null && lat !== '';
  const hasLng = lng !== undefined && lng !== null && lng !== '';
  if (hasLat !== hasLng) return { ok: false, error: 'Both latitude and longitude are required together.' };
  if (hasLat) {
    const latitude = Number(lat);
    const longitude = Number(lng);
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
        !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      return { ok: false, error: 'The supplied coordinates are invalid.' };
    }
  }
  return { ok: true };
}

function canTransitionStatus(current, next) {
  return Boolean(STATUS_TRANSITIONS[current] && STATUS_TRANSITIONS[current].includes(next));
}

module.exports = {
  VALID_STATUSES,
  VALID_PRIORITIES,
  SUPPORTED_CATEGORIES,
  STATUS_TRANSITIONS,
  validateComplaintInput,
  canTransitionStatus
};
