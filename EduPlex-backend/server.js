require('dotenv').config();

const express = require('express');
const cors    = require('cors');
const helmet  = require('helmet');
const morgan  = require('morgan');

const app = express();

// ── Routes ─────────────────────────────────────────────
const authRoutes       = require('./routes/auth');
const studentRoutes    = require('./routes/students');
const teacherRoutes    = require('./routes/teachers');
const courseRoutes     = require('./routes/courses');
const attendanceRoutes = require('./routes/attendance');
const marksRoutes      = require('./routes/marks');
const libraryRoutes    = require('./routes/library');

// ── Security ───────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }));

// ── CORS ───────────────────────────────────────────────
// FIX: Development mein * allow karo — production mein FRONTEND_URL use karo
app.use(cors({
  origin: process.env.NODE_ENV === 'production'
    ? (process.env.FRONTEND_URL || '*')
    : '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: false,
}));

// Preflight requests handle karo
app.options('*', cors());

// ── Body Parser ─────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ── Logger ─────────────────────────────────────────────
if (process.env.NODE_ENV !== 'production') {
  app.use(morgan('dev'));
}

// ── Health Check ───────────────────────────────────────
app.get('/', (req, res) => {
  res.json({
    success:   true,
    message:   '🎓 EduPlex Backend chal raha hai!',
    version:   '2.0.0',
    timestamp: new Date().toISOString(),
    routes: [
      'POST   /api/auth/login',
      'POST   /api/auth/register',
      'GET    /api/auth/me',
      'PUT    /api/auth/profile',
      'GET    /api/students',
      'POST   /api/students',
      'GET    /api/teachers',
      'POST   /api/teachers',
      'GET    /api/courses',
      'POST   /api/courses',
      'POST   /api/attendance/mark',
      'GET    /api/attendance/student/:id',
      'POST   /api/marks',
      'GET    /api/marks/student/:id',
      'GET    /api/books',
      'POST   /api/books/:id/borrow',
      'POST   /api/books/:id/return',
    ],
  });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: Math.round(process.uptime()) + 's' });
});

// ── API Routes ─────────────────────────────────────────
app.use('/api/auth',       authRoutes);
app.use('/api/students',   studentRoutes);
app.use('/api/teachers',   teacherRoutes);
app.use('/api/courses',    courseRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/marks',      marksRoutes);
app.use('/api/books',      libraryRoutes);

// ── 404 Handler ────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Route ${req.method} ${req.originalUrl} nahi mili.`,
  });
});

// ── Global Error Handler ───────────────────────────────
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err.stack || err.message);
  res.status(500).json({
    success: false,
    message: 'Server mein kuch gadbad ho gayi.',
    error:   process.env.NODE_ENV === 'development' ? err.message : undefined,
  });
});

// ── Start ──────────────────────────────────────────────
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log('\n╔═══════════════════════════════════════╗');
  console.log('║       🎓  EduPlex Backend v2.0        ║');
  console.log('╚═══════════════════════════════════════╝');
  console.log(`\n🚀  Server: http://localhost:${PORT}`);
  console.log(`📦  Mode:   ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔥  Firebase Project: ${process.env.FIREBASE_PROJECT_ID || 'NOT SET ⚠️'}`);
  console.log('\n✅  All routes ready!\n');
});

module.exports = app;
