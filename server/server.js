const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('./db');
const crypto = require('crypto');
const { validateComplaintInput, canTransitionStatus, VALID_PRIORITIES } = require('./validation');
const { sanitizePublicComplaint } = require('./privacy');

// Load local environment variables without requiring an extra runtime dependency.
if (typeof process.loadEnvFile === 'function') {
  try { process.loadEnvFile(path.join(__dirname, '.env')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}

const app = express();

// Baseline browser security headers. CSP is intentionally not imposed here because
// the existing frontend loads map tiles and libraries from configured external origins.
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), payment=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});
const PORT = process.env.PORT || 3000;

const allowedOrigins = (process.env.CORS_ORIGIN || '').split(',').map(v => v.trim()).filter(Boolean);
app.use(cors({
  origin(origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    if (process.env.NODE_ENV !== 'production' && allowedOrigins.length === 0) return callback(null, true);
    return callback(new Error('Origin not allowed by CORS'));
  },
  credentials: false
}));
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(self)');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
  next();
});

// Small in-memory rate limiter. Use a shared store (e.g. Redis) when running multiple instances.
const rateBuckets = new Map();
function rateLimit({ windowMs = 15 * 60 * 1000, max = 100 } = {}) {
  return (req, res, next) => {
    const key = `${req.ip}:${req.path}`;
    const now = Date.now();
    let bucket = rateBuckets.get(key);
    if (!bucket || now >= bucket.resetAt) bucket = { count: 0, resetAt: now + windowMs };
    bucket.count += 1;
    rateBuckets.set(key, bucket);
    if (rateBuckets.size > 10000) {
      for (const [k, v] of rateBuckets) if (now >= v.resetAt) rateBuckets.delete(k);
    }
    res.setHeader('RateLimit-Limit', String(max));
    res.setHeader('RateLimit-Remaining', String(Math.max(0, max - bucket.count)));
    if (bucket.count > max) {
      res.setHeader('Retry-After', String(Math.ceil((bucket.resetAt - now) / 1000)));
      return res.status(429).json({ error: 'Too many requests. Please try again later.' });
    }
    rateBuckets.set(key, bucket);
    next();
  };
}
app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
  next();
});
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

const uploadsDir = path.join(__dirname, 'uploads');
fs.mkdirSync(uploadsDir, { recursive: true });

// Multer storage for photos and videos
const storage = multer.diskStorage({
  destination: (_req, _f, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const safeName = `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
    cb(null, safeName);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 }, // 15MB
  fileFilter: (_req, file, cb) => {
    const allowed = new Set(['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime', 'video/webm']);
    const ext = path.extname(file.originalname).toLowerCase();
    const allowedExtensions = new Set(['.jpg', '.jpeg', '.png', '.webp', '.mp4', '.mov', '.webm']);
    if (allowed.has(file.mimetype.toLowerCase()) && allowedExtensions.has(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only JPG, PNG, WEBP and MP4 are accepted.'));
    }
  }
});

app.use('/uploads', express.static(uploadsDir));
app.use(express.static(path.join(__dirname, '..')));

// ============================================================
// Auth Middleware
// ============================================================
function getUserFromReq(req) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    return db.getSessionUser(token);
  }
  return null;
}

function requireAuth(req, res, next) {
  const user = getUserFromReq(req);
  if (!user) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  req.user = user;
  next();
}

function canManageComplaint(user, complaint) {
  return Boolean(user && complaint && (user.role === 'admin' || complaint.reporterId === user.id));
}

function requireComplaintUploadAccess(req, res, next) {
  const complaint = db.getComplaint(req.params.id);
  if (!complaint) return res.status(404).json({ error: 'Complaint not found' });
  if (canManageComplaint(getUserFromReq(req), complaint)) {
    req.complaint = complaint;
    return next();
  }
  const supplied = String(req.headers['x-upload-token'] || '');
  const expected = complaint.uploadTokenHash;
  if (supplied && expected) {
    const actualHash = crypto.createHash('sha256').update(supplied).digest();
    const expectedHash = Buffer.from(expected, 'hex');
    if (actualHash.length === expectedHash.length && crypto.timingSafeEqual(actualHash, expectedHash)) {
      req.complaint = complaint;
      return next();
    }
  }
  return res.status(403).json({ error: 'You are not allowed to upload files to this complaint' });
}

function requireAdmin(req, res, next) {
  const user = getUserFromReq(req);
  if (!user || user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  req.user = user;
  next();
}

// Utility: Mask sensitive contact info for public view
function sanitizeComplaintForUser(complaint, user) {
  if (!complaint) return null;
  const isOwner = user && (user.id === complaint.reporterId || (user.email && user.email === complaint.reporterEmail));
  const isAdmin = user && user.role === 'admin';

  const { uploadTokenHash, ...safeComplaint } = complaint;

  if (isOwner || isAdmin) {
    return safeComplaint;
  }

  // Public visitor view: remove reporter identifiers and contact data.
  return sanitizePublicComplaint(safeComplaint);
}

// Category to Department & SLA Mapping
const CATEGORY_MAP = {
  'Road damage and potholes': {
    department: 'PWD (Roads & Infrastructure)',
    sla: '7 days',
    slaHours: 168,
    priority: 'High',
    officer: 'Ravi Kumar (JE - PWD Kadri)'
  },
  'Garbage and waste management': {
    department: 'Health & Sanitation Section',
    sla: '24 hours',
    slaHours: 24,
    priority: 'High',
    officer: 'Suresh Nayak (Sanitary Inspector)'
  },
  'Water leakage': {
    department: 'Mangaluru City Water Supply Board',
    sla: '48 hours',
    slaHours: 48,
    priority: 'Critical',
    officer: 'Rajesh Bhat (Assistant Executive Engineer)'
  },
  'Drainage and sewage': {
    department: 'Engineering Section (Drainage & Sewage)',
    sla: '72 hours',
    slaHours: 72,
    priority: 'High',
    officer: 'Premanand Rao (Executive Engineer)'
  },
  'Streetlight failure': {
    department: 'MESCOM (Electrical Division)',
    sla: '48 hours',
    slaHours: 48,
    priority: 'Medium',
    officer: 'Ganesh Poojary (Section Officer Kadri)'
  },
  'Electricity and exposed wires': {
    department: 'MESCOM (Electrical Division)',
    sla: '12 hours',
    slaHours: 12,
    priority: 'Critical',
    officer: 'Kiran Shetty (Line Inspector)'
  },
  'Public safety': {
    department: 'Mangaluru City Traffic Police',
    sla: '12 hours',
    slaHours: 12,
    priority: 'Critical',
    officer: 'Inspector Harish (Traffic Division West)'
  },
  'Traffic problems': {
    department: 'Mangaluru City Traffic Police',
    sla: '12 hours',
    slaHours: 12,
    priority: 'Medium',
    officer: 'Sub-Inspector Deepa K'
  },
  'Park and public-space maintenance': {
    department: 'Parks & Public Spaces Department',
    sla: '4 days',
    slaHours: 96,
    priority: 'Low',
    officer: 'Vasant Kumar (Horticulture Superintendent)'
  },
  'Other civic issues': {
    department: 'Ward Office / General Administration',
    sla: '5 days',
    slaHours: 120,
    priority: 'Medium',
    officer: 'Sharath Hegde (Ward Officer Central)'
  }
};

// Fallback for legacy categories
CATEGORY_MAP['Garbage / Illegal Dumping'] = CATEGORY_MAP['Garbage and waste management'];
CATEGORY_MAP['Pothole / Road Damage'] = CATEGORY_MAP['Road damage and potholes'];
CATEGORY_MAP['Broken Streetlight'] = CATEGORY_MAP['Streetlight failure'];
CATEGORY_MAP['Drainage / Waterlogging'] = CATEGORY_MAP['Drainage and sewage'];
CATEGORY_MAP['Beach / Public Space Litter'] = CATEGORY_MAP['Garbage and waste management'];
CATEGORY_MAP['Traffic / Parking'] = CATEGORY_MAP['Traffic problems'];
CATEGORY_MAP['Other'] = CATEGORY_MAP['Other civic issues'];

// ============================================================
// API ROUTES
// ============================================================

app.get('/api/health', (_req, res) => {
  try {
    const storage = db.getHealth();
    res.json({ ok: true, service: 'dhwani-api', timestamp: new Date().toISOString(), storage });
  } catch (_error) {
    res.status(503).json({ ok: false, service: 'dhwani-api', error: 'Storage health check failed.' });
  }
});

// Metadata
app.get('/api/departments', (_req, res) => {
  res.json(db.getDepartments());
});

app.get('/api/categories', (_req, res) => {
  const categories = [
    { name: 'Road damage and potholes', emoji: '🛣️', color: '#e03131', dept: 'PWD (Roads & Infrastructure)' },
    { name: 'Garbage and waste management', emoji: '🗑️', color: '#f08c00', dept: 'Health & Sanitation Section' },
    { name: 'Water leakage', emoji: '💧', color: '#1971c2', dept: 'Mangaluru City Water Supply Board' },
    { name: 'Drainage and sewage', emoji: '🌊', color: '#9c36b5', dept: 'Engineering Section (Drainage & Sewage)' },
    { name: 'Streetlight failure', emoji: '💡', color: '#f59f00', dept: 'MESCOM (Electrical Division)' },
    { name: 'Electricity and exposed wires', emoji: '⚡', color: '#e8590c', dept: 'MESCOM (Electrical Division)' },
    { name: 'Public safety', emoji: '🚨', color: '#c92a2a', dept: 'Mangaluru City Traffic Police' },
    { name: 'Traffic problems', emoji: '🚦', color: '#d9480f', dept: 'Mangaluru City Traffic Police' },
    { name: 'Park and public-space maintenance', emoji: '🌳', color: '#2f9e44', dept: 'Parks & Public Spaces Department' },
    { name: 'Other civic issues', emoji: '📌', color: '#868e96', dept: 'Ward Office / General Administration' }
  ];
  res.json(categories);
});

// ------------------------------------------------------------
// AUTH
// ------------------------------------------------------------
app.post('/api/auth/register', rateLimit({ max: 8 }), (req, res) => {
  const { name, email, phone, password } = req.body || {};
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Name, email, and password are required' });
  }

  if (String(name).trim().length < 2 || String(name).length > 80 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email)) ||
      String(password).length < 10 || String(password).length > 128) {
    return res.status(400).json({ error: 'Enter a valid name and email. Password must be 10–128 characters.' });
  }

  if (phone !== undefined && phone !== null && (typeof phone !== 'string' || phone.length > 24)) {
    return res.status(400).json({ error: 'Phone number must be at most 24 characters.' });
  }
  const normalizedEmail = String(email).trim().toLowerCase();
  const existing = db.getUserByEmail(normalizedEmail);
  if (existing) {
    return res.status(409).json({ error: 'An account with this email already exists' });
  }

  // Citizens register as 'citizen'; admin creation can be allowed if explicitly requested or default
  const user = db.addUser({
    name: String(name).trim(),
    email: normalizedEmail,
    phone: typeof phone === 'string' ? phone.trim() : '',
    password,
    role: 'citizen'
  });

  const token = db.createSession(user.id);

  // Welcome notification
  db.addNotification({
    userId: user.id,
    title: 'Welcome to Dhwani Mangaluru',
    message: `Hello ${user.name}, your account is active. You can now report issues, track their progress in real-time, and view your complaint history.`,
    type: 'general'
  });

  const { passwordHash, ...safeUser } = user;
  res.status(201).json({ user: safeUser, token });
});

app.post('/api/auth/login', rateLimit({ max: 10 }), (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  const user = db.authenticateUser(email, password);
  if (!user) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const token = db.createSession(user.id);
  const { passwordHash, ...safeUser } = user;
  res.json({ user: safeUser, token });
});

app.get('/api/auth/me', (req, res) => {
  const user = getUserFromReq(req);
  if (!user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  const { passwordHash, ...safeUser } = user;
  res.json({ user: safeUser });
});

app.post('/api/auth/logout', (req, res) => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    db.deleteSession(authHeader.slice(7).trim());
  }
  res.json({ ok: true });
});

app.put('/api/auth/profile', requireAuth, (req, res) => {
  const { name, phone, password } = req.body || {};
  const patch = {};
  if (name !== undefined) {
    if (typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 80) {
      return res.status(400).json({ error: 'Name must be 2–80 characters.' });
    }
    patch.name = name.trim();
  }
  if (phone !== undefined) {
    if (typeof phone !== 'string' || phone.length > 24) {
      return res.status(400).json({ error: 'Phone number must be a text value of at most 24 characters.' });
    }
    patch.phone = phone.trim();
  }
  if (password) {
    if (String(password).length < 10 || String(password).length > 128) {
      return res.status(400).json({ error: 'Password must be 10–128 characters.' });
    }
    patch.password = password;
  }

  const updated = db.updateUser(req.user.id, patch);
  const { passwordHash, ...safeUser } = updated;
  res.json({ user: safeUser });
});

// ------------------------------------------------------------
// COMPLAINTS
// ------------------------------------------------------------

// List complaints (with filters)
app.get('/api/complaints', (req, res) => {
  const user = getUserFromReq(req);
  const list = db.getComplaints(req.query);
  const sanitized = list.map(c => sanitizeComplaintForUser(c, user));
  res.json(sanitized);
});

// Single complaint by ID (direct URL & tracking support)
app.get('/api/complaints/:id', (req, res) => {
  const user = getUserFromReq(req);
  const c = db.getComplaint(req.params.id);
  if (!c) {
    return res.status(404).json({ error: `Complaint with reference ${req.params.id} not found` });
  }
  res.json(sanitizeComplaintForUser(c, user));
});

// Create Complaint
app.post('/api/complaints', rateLimit({ windowMs: 60 * 60 * 1000, max: 8 }), (req, res) => {
  const user = getUserFromReq(req);
  const {
    title,
    category,
    area,
    landmark,
    description,
    name,
    phone,
    email,
    priority,
    lat,
    lng,
    photos,
    videos
  } = req.body || {};

  const validation = validateComplaintInput({ title, category, area, landmark, description, name, phone, email, lat, lng });
  if (!validation.ok) return res.status(400).json({ error: validation.error });

  const meta = CATEGORY_MAP[category];
  if (!meta) return res.status(400).json({ error: 'Please select a supported complaint category.' });
  const generatedId = db.getNextComplaintId();
  const now = new Date();

  // SLA calculation
  const slaHoursNum = meta.slaHours || 120;
  const expectedDate = new Date(now.getTime() + slaHoursNum * 60 * 60 * 1000).toISOString();

  const finalTitle = title && title.trim().length > 0
    ? title.trim()
    : `${category} reported at ${area}`;

  const reporterName = user ? user.name : (name || 'Anonymous Citizen');
  const reporterPhone = user ? (user.phone || phone || '') : (phone || '');
  const reporterEmail = user ? user.email : (email || '');
  const reporterId = user ? user.id : null;

  const hasCoords = lat !== null && lat !== undefined && lng !== null && lng !== undefined && !isNaN(Number(lat)) && !isNaN(Number(lng));
  const numericLat = hasCoords ? Number(lat) : null;
  const numericLng = hasCoords ? Number(lng) : null;
  const coords = hasCoords ? [numericLat, numericLng] : null;

  const uploadToken = crypto.randomBytes(32).toString('hex');
  const complaint = {
    id: generatedId,
    uploadTokenHash: crypto.createHash('sha256').update(uploadToken).digest('hex'),
    title: finalTitle,
    category,
    area,
    landmark: landmark ? landmark.trim() : '',
    description: description.trim(),
    name: reporterName,
    phone: reporterPhone,
    email: reporterEmail,
    reporterId,
    reporterName,
    reporterPhone,
    reporterEmail,
    photos: Array.isArray(photos) ? photos : [],
    videos: Array.isArray(videos) ? videos : [],
    photo: Array.isArray(photos) && photos.length > 0 ? photos[0] : null,
    status: 'Submitted',
    priority: meta.priority || 'Medium',
    department: meta.department,
    officer: meta.officer || null,
    slaHours: meta.sla,
    expectedResolutionDate: expectedDate,
    resolutionPhoto: null,
    resolutionRemarks: null,
    rejectionReason: null,
    lat: numericLat,
    lng: numericLng,
    coords,
    isPublic: true,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    resolvedAt: null,
    statusHistory: [
      {
        id: `sh_${Date.now()}_init`,
        status: 'Submitted',
        changedBy: reporterName,
        role: 'Citizen',
        timestamp: now.toISOString(),
        remarks: 'Complaint registered successfully in Dhwani system.',
        evidencePhoto: null
      }
    ],
    notes: []
  };

  db.addComplaint(complaint);

  // Notify user if authenticated
  if (reporterId) {
    db.addNotification({
      userId: reporterId,
      complaintId: complaint.id,
      title: 'Complaint Registered',
      message: `Your complaint ${complaint.id} regarding "${complaint.title}" has been submitted to ${complaint.department}.`,
      type: 'status_update'
    });
  }

  // Notify admins
  db.addNotification({
    userId: 'all_admins',
    complaintId: complaint.id,
    title: 'New Civic Report Filed',
    message: `[${complaint.id}] New ${complaint.priority} priority report in ${complaint.area}: "${complaint.title}".`,
    type: 'assignment'
  });

  res.status(201).json({ ...sanitizeComplaintForUser(complaint, user), uploadToken });
});

// Upload media to existing complaint
app.post('/api/complaints/:id/upload', requireComplaintUploadAccess, upload.array('files', 5), (req, res) => {
  const c = db.getComplaint(req.params.id);
  if (!c) return res.status(404).json({ error: 'Complaint not found' });
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: 'No files uploaded' });
  }
  if (req.files.some(file => !hasValidFileSignature(file))) {
    removeUploadedFiles(req.files);
    return res.status(415).json({ error: 'The uploaded file content does not match an allowed image or video format.' });
  }

  const uploadedUrls = req.files.map(f => `/uploads/${f.filename}`);
  const images = [];
  const videos = [];

  req.files.forEach(f => {
    const url = `/uploads/${f.filename}`;
    if (f.mimetype.startsWith('video/')) videos.push(url);
    else images.push(url);
  });

  c.photos = Array.from(new Set([...(c.photos || []), ...images]));
  c.videos = Array.from(new Set([...(c.videos || []), ...videos]));
  if (!c.photo && c.photos.length > 0) c.photo = c.photos[0];
  c.updatedAt = new Date().toISOString();

  db.updateComplaint(req.params.id, c);

  res.json({
    success: true,
    urls: uploadedUrls,
    photos: c.photos,
    videos: c.videos,
    complaint: sanitizeComplaintForUser(c, getUserFromReq(req))
  });
});

// Legacy single photo endpoint (kept for complete backward compatibility)
app.post('/api/complaints/:id/photo', requireComplaintUploadAccess, upload.single('photo'), (req, res) => {
  const c = db.getComplaint(req.params.id);
  if (!c) return res.status(404).json({ error: 'Complaint not found' });
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  if (!hasValidFileSignature(req.file)) {
    removeUploadedFiles([req.file]);
    return res.status(415).json({ error: 'The uploaded file content does not match an allowed image format.' });
  }

  const url = `/uploads/${req.file.filename}`;
  c.photos = c.photos || [];
  if (!c.photos.includes(url)) c.photos.push(url);
  c.photo = url;
  c.updatedAt = new Date().toISOString();

  db.updateComplaint(req.params.id, c);
  res.json({ photo: url, complaint: sanitizeComplaintForUser(c, getUserFromReq(req)) });
});

// Update complaint status & assignment (Admin / Authority action)
app.patch('/api/complaints/:id/status', requireAdmin, (req, res) => {
  const user = req.user;
  const {
    status,
    officer,
    department,
    priority,
    remarks,
    evidencePhoto
  } = req.body || {};

  const allowed = ['Submitted', 'Verified', 'Assigned', 'In Progress', 'Resolved', 'Rejected', 'Reopened'];
  if (!status || !allowed.includes(status)) {
    return res.status(400).json({ error: `Invalid status. Allowed values: ${allowed.join(', ')}` });
  }

  const c = db.getComplaint(req.params.id);
  if (!c) return res.status(404).json({ error: 'Complaint not found' });
  if (!canTransitionStatus(c.status || 'Submitted', status)) {
    return res.status(409).json({ error: `Status transition from "${c.status}" to "${status}" is not allowed.` });
  }
  if (priority && !VALID_PRIORITIES.includes(priority)) {
    return res.status(400).json({ error: 'Invalid priority value.' });
  }
  if (department && (typeof department !== 'string' || department.length > 120)) {
    return res.status(400).json({ error: 'Invalid department value.' });
  }
  if (officer !== undefined && (typeof officer !== 'string' || officer.length > 120)) {
    return res.status(400).json({ error: 'Invalid officer value.' });
  }
  if (remarks !== undefined && (typeof remarks !== 'string' || remarks.length > 1000)) {
    return res.status(400).json({ error: 'Remarks must be 1000 characters or fewer.' });
  }

  // Determine actor name
  const actorName = user ? user.name : (req.body.adminName || 'Municipal Authority');
  const actorRole = user ? (user.role === 'admin' ? 'Municipal Authority' : 'Authorized Officer') : 'Municipal Authority';

  const extra = {};
  if (department) extra.department = department;
  if (officer !== undefined) extra.officer = officer;
  if (priority) extra.priority = priority;

  const updated = db.addStatusChange(
    req.params.id,
    status,
    actorName,
    actorRole,
    remarks,
    evidencePhoto,
    extra
  );

  // Notify the citizen if there's a registered reporter
  if (c.reporterId) {
    db.addNotification({
      userId: c.reporterId,
      complaintId: c.id,
      title: `Complaint Status: ${status}`,
      message: `Your complaint [${c.id}] is now marked as "${status}". ${remarks ? 'Remark: ' + remarks : ''}`,
      type: status === 'Resolved' ? 'resolution' : 'status_update'
    });
  }

  res.json(sanitizeComplaintForUser(updated, user));
});

// Add progress remark/note
app.post('/api/complaints/:id/notes', requireAuth, (req, res) => {
  const user = getUserFromReq(req);
  const { text } = req.body || {};
  if (typeof text !== 'string' || text.trim().length === 0 || text.length > 1000) {
    return res.status(400).json({ error: 'Note text is required and must be 1000 characters or fewer.' });
  }

  const c = db.getComplaint(req.params.id);
  if (!c) return res.status(404).json({ error: 'Complaint not found' });
  if (!canManageComplaint(user, c)) return res.status(403).json({ error: 'You cannot update this complaint' });

  const authorName = user ? user.name : (req.body.author || 'Citizen / Officer');
  const authorRole = user ? (user.role === 'admin' ? 'Municipal Official' : 'Citizen') : 'Update';

  const note = {
    id: `note_${Date.now()}`,
    text: text.trim(),
    author: authorName,
    role: authorRole,
    at: new Date().toISOString()
  };

  db.addNote(req.params.id, note);
  const updated = db.getComplaint(req.params.id);

  // If added by admin, notify citizen; if added by citizen, notify admin
  if (user && user.role === 'admin' && c.reporterId) {
    db.addNotification({
      userId: c.reporterId,
      complaintId: c.id,
      title: 'New Update on your Complaint',
      message: `Officer ${authorName} posted an update on [${c.id}]: "${text.slice(0, 80)}${text.length > 80 ? '...' : ''}"`,
      type: 'status_update'
    });
  }

  res.json(sanitizeComplaintForUser(updated, user));
});

// ------------------------------------------------------------
// NOTIFICATIONS
// ------------------------------------------------------------
app.get('/api/notifications', (req, res) => {
  const user = getUserFromReq(req);
  if (!user) {
    return res.json([]);
  }
  const notifs = db.getNotifications(user.id);
  res.json(notifs);
});

app.patch('/api/notifications/:id/read', requireAuth, (req, res) => {
  const result = db.markNotificationRead(req.params.id, req.user.id);
  if (!result) return res.status(404).json({ error: 'Notification not found' });
  res.json(result);
});

app.patch('/api/notifications/read-all', requireAuth, (req, res) => {
  db.markAllNotificationsRead(req.user.id);
  res.json({ ok: true });
});

// ------------------------------------------------------------
// STATS & ANALYTICS
// ------------------------------------------------------------
app.get('/api/stats/summary', (_req, res) => {
  res.json(db.getStatsSummary());
});

app.get('/api/stats/analytics', (_req, res) => {
  res.json(db.getAnalytics());
});

// Reset (demo cleanup)
app.post('/api/reset', requireAdmin, (_req, res) => {
  db.reset();
  res.json({ ok: true });
});

// ------------------------------------------------------------
// SPA Fallback Routing
// ------------------------------------------------------------
app.get(/^\/(?!api|uploads).*/, (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'index.html'));
});

// Error handling middleware
app.use((err, _req, res, _next) => {
  console.error('Server error:', err);
  const status = Number(err.status) >= 400 && Number(err.status) < 600 ? Number(err.status) : 500;
  res.status(status).json({ error: status >= 500 ? 'An unexpected server error occurred.' : err.message });
});

app.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(`✅ Dhwani — Professional Civic Platform Backend`);
  console.log(`   Running at http://localhost:${PORT}`);
  console.log(`======================================================\n`);
});