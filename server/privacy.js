'use strict';

function sanitizePublicComplaint(complaint) {
  if (!complaint) return null;
  const {
    reporterId,
    reporterPhone,
    reporterEmail,
    phone,
    email,
    uploadToken,
    uploadTokenHash,
    ...publicComplaint
  } = complaint;
  return {
    ...publicComplaint,
    reporterName: 'Citizen',
    name: 'Citizen',
    reporterPhone: '',
    reporterEmail: '',
    phone: '',
    email: '',
    isPublicView: true
  };
}

module.exports = { sanitizePublicComplaint };
