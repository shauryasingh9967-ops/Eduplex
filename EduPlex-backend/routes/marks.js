const express = require('express');
const router  = express.Router();
const { body, validationResult } = require('express-validator');
const { db } = require('../firebase');
const { verifyToken, requireRole } = require('../middleware/auth');

router.use(verifyToken);

function calculateGrade(total) {
  if (total >= 90) return 'A+';
  if (total >= 85) return 'A';
  if (total >= 80) return 'A-';
  if (total >= 75) return 'B+';
  if (total >= 70) return 'B';
  if (total >= 65) return 'B-';
  if (total >= 60) return 'C+';
  if (total >= 55) return 'C';
  if (total >= 50) return 'D';
  return 'F';
}

// ── POST /api/marks ────────────────────────────────────
router.post(
  '/',
  requireRole('admin', 'teacher'),
  [
    body('courseId').notEmpty().withMessage('courseId required'),
    body('records').isArray({ min: 1 }).withMessage('records array required'),
    body('records.*.studentId').notEmpty(),
    body('records.*.midterm').isFloat({ min: 0, max: 100 }),
    body('records.*.final').isFloat({ min: 0, max: 100 }),
    body('records.*.assignment').isFloat({ min: 0, max: 100 }),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { courseId, records } = req.body;

    try {
      const courseDoc = await db.collection('courses').doc(courseId).get();
      // FIX: Course nahi mila toh gracefully handle karo
      const courseName = courseDoc.exists ? courseDoc.data().name : 'Unknown Course';

      const batch = db.batch();
      const saved = [];

      for (const record of records) {
        const { studentId, midterm, final: finalMark, assignment } = record;
        const total = Math.round(
          parseFloat(midterm) * 0.35 +
          parseFloat(finalMark) * 0.45 +
          parseFloat(assignment) * 0.20
        );
        const grade = calculateGrade(total);

        // Upsert — pehle check karo exist karta hai kya
        const existing = await db.collection('marks')
          .where('courseId', '==', courseId)
          .where('studentId', '==', studentId)
          .limit(1)
          .get();

        const data = {
          courseId,
          courseName,
          studentId,
          midterm:    parseFloat(midterm),
          final:      parseFloat(finalMark),
          assignment: parseFloat(assignment),
          total,
          grade,
          passed:     total >= 50,
          enteredBy:  req.user.uid,
          updatedAt:  new Date().toISOString(),
        };

        if (!existing.empty) {
          batch.update(existing.docs[0].ref, data);
        } else {
          const ref  = db.collection('marks').doc();
          data.id        = ref.id;
          data.createdAt = new Date().toISOString();
          batch.set(ref, data);
        }

        saved.push({ studentId, total, grade, passed: data.passed });
      }

      await batch.commit();

      return res.status(201).json({
        success: true,
        message: `Marks saved for ${records.length} students.`,
        data: saved,
      });
    } catch (err) {
      console.error('POST /marks error:', err.message);
      return res.status(500).json({ success: false, message: err.message });
    }
  }
);

// ── GET /api/marks/student/:studentId ─────────────────
router.get('/student/:studentId', async (req, res) => {
  const { studentId } = req.params;

  // FIX: Student access check — uid se compare karo
  if (req.user.role === 'student') {
    const isOwn = req.user.uid === studentId;
    if (!isOwn) {
      const stuDoc = await db.collection('students').doc(studentId).get();
      if (!stuDoc.exists || stuDoc.data().uid !== req.user.uid) {
        return res.status(403).json({ success: false, message: 'Access denied.' });
      }
    }
  }

  try {
    // FIX: orderBy('courseName') hata diya — composite index nahi chahiye
    const snapshot = await db.collection('marks')
      .where('studentId', '==', studentId)
      .get();

    const marks = snapshot.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (a.courseName || '').localeCompare(b.courseName || ''));

    const gradePoints = {
      'A+': 4.0, 'A': 4.0, 'A-': 3.7,
      'B+': 3.3, 'B': 3.0, 'B-': 2.7,
      'C+': 2.3, 'C': 2.0,
      'D':  1.0, 'F': 0.0,
    };

    const gpa = marks.length > 0
      ? (marks.reduce((sum, m) => sum + (gradePoints[m.grade] || 0), 0) / marks.length).toFixed(2)
      : '0.00';

    return res.json({
      success: true,
      data: {
        marks,
        gpa:          parseFloat(gpa),
        totalCourses: marks.length,
        passed:       marks.filter(m => m.passed).length,
        failed:       marks.filter(m => !m.passed).length,
      },
    });
  } catch (err) {
    console.error('GET /marks/student error:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ── GET /api/marks/course/:courseId ───────────────────
router.get('/course/:courseId', requireRole('admin', 'teacher'), async (req, res) => {
  try {
    // FIX: orderBy hata diya
    const snapshot = await db.collection('marks')
      .where('courseId', '==', req.params.courseId)
      .get();

    const marks  = snapshot.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => a.studentId.localeCompare(b.studentId));

    const totals  = marks.map(m => m.total);
    const avg     = totals.length > 0 ? (totals.reduce((a, b) => a + b, 0) / totals.length).toFixed(1) : 0;
    const high    = totals.length > 0 ? Math.max(...totals) : 0;
    const low     = totals.length > 0 ? Math.min(...totals) : 0;
    const gradeDist = {};
    marks.forEach(m => { gradeDist[m.grade] = (gradeDist[m.grade] || 0) + 1; });

    return res.json({
      success: true,
      data: { marks, stats: { avg: parseFloat(avg), high, low, total: marks.length, gradeDist } },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ── DELETE /api/marks/:id ──────────────────────────────
router.delete('/:id', requireRole('admin'), async (req, res) => {
  try {
    const doc = await db.collection('marks').doc(req.params.id).get();
    if (!doc.exists) {
      return res.status(404).json({ success: false, message: 'Marks record not found.' });
    }
    await db.collection('marks').doc(req.params.id).delete();
    return res.json({ success: true, message: 'Marks record deleted.' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
