const express = require('express');
const router  = express.Router();
const { body, validationResult } = require('express-validator');
const { db } = require('../firebase');
const { verifyToken, requireRole } = require('../middleware/auth');

router.use(verifyToken);

const DUE_DAYS = 14;

// ── IMPORTANT: Specific routes pehle, :id baad mein ───
// FIX: Pehle /borrowings/my aur /borrowings/all tha neeche
// Express mein :id pehle aa raha tha, isliye /borrowings/my
// "borrowings" ko id samajhta tha — order fix kiya

// ── GET /api/books/borrowings/my ──────────────────────
router.get('/borrowings/my', async (req, res) => {
  try {
    // FIX: orderBy hata diya
    const snapshot   = await db.collection('borrowings')
      .where('userId', '==', req.user.uid)
      .get();

    const borrowings = snapshot.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => b.borrowedAt.localeCompare(a.borrowedAt));

    const active  = borrowings.filter(b => !b.returned);
    const history = borrowings.filter(b => b.returned);

    return res.json({
      success: true,
      data: { active, history, totalActive: active.length },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ── GET /api/books/borrowings/all ─────────────────────
router.get('/borrowings/all', requireRole('admin'), async (req, res) => {
  try {
    // FIX: orderBy hata diya
    const snapshot   = await db.collection('borrowings').get();
    const borrowings = snapshot.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => b.borrowedAt.localeCompare(a.borrowedAt));

    return res.json({ success: true, count: borrowings.length, data: borrowings });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ── GET /api/books ─────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    // FIX: orderBy hata diya
    const snapshot = await db.collection('books').get();
    let books = snapshot.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (a.title || '').localeCompare(b.title || ''));

    const { category, available } = req.query;
    if (category)           books = books.filter(b => b.category === category);
    if (available === 'true') books = books.filter(b => b.available > 0);

    return res.json({ success: true, count: books.length, data: books });
  } catch (err) {
    console.error('GET /books error:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ── GET /api/books/:id ─────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const doc = await db.collection('books').doc(req.params.id).get();
    if (!doc.exists) {
      return res.status(404).json({ success: false, message: 'Book not found.' });
    }
    return res.json({ success: true, data: { id: doc.id, ...doc.data() } });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ── POST /api/books ────────────────────────────────────
router.post(
  '/',
  requireRole('admin'),
  [
    body('title').notEmpty().withMessage('Title required'),
    body('author').notEmpty().withMessage('Author required'),
    body('category').notEmpty().withMessage('Category required'),
    body('total').isInt({ min: 1 }).withMessage('Total copies min 1'),
    body('isbn').notEmpty().withMessage('ISBN required'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { title, author, category, total, isbn, description } = req.body;

    try {
      // Duplicate ISBN check
      const existing = await db.collection('books').where('isbn', '==', isbn).get();
      if (!existing.empty) {
        return res.status(400).json({ success: false, message: 'Is ISBN ki book already hai.' });
      }

      const ref  = db.collection('books').doc();
      const data = {
        id:          ref.id,
        title,
        author,
        category,
        isbn,
        total:       parseInt(total),
        available:   parseInt(total),
        description: description || '',
        addedBy:     req.user.uid,
        createdAt:   new Date().toISOString(),
        updatedAt:   new Date().toISOString(),
      };

      await ref.set(data);
      return res.status(201).json({ success: true, message: `"${title}" library mein add ho gaya.`, data });
    } catch (err) {
      return res.status(500).json({ success: false, message: err.message });
    }
  }
);

// ── PUT /api/books/:id ─────────────────────────────────
router.put('/:id', requireRole('admin'), async (req, res) => {
  const { title, author, category, total, isbn, description } = req.body;

  try {
    const docRef = db.collection('books').doc(req.params.id);
    const doc    = await docRef.get();
    if (!doc.exists) {
      return res.status(404).json({ success: false, message: 'Book not found.' });
    }

    const updates = { updatedAt: new Date().toISOString() };
    if (title       !== undefined) updates.title       = title;
    if (author      !== undefined) updates.author      = author;
    if (category    !== undefined) updates.category    = category;
    if (isbn        !== undefined) updates.isbn        = isbn;
    if (description !== undefined) updates.description = description;
    if (total !== undefined) {
      const diff       = parseInt(total) - doc.data().total;
      updates.total    = parseInt(total);
      updates.available = Math.max(0, doc.data().available + diff);
    }

    await docRef.update(updates);
    return res.json({ success: true, message: 'Book updated.', data: { id: req.params.id, ...updates } });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ── DELETE /api/books/:id ──────────────────────────────
router.delete('/:id', requireRole('admin'), async (req, res) => {
  try {
    const doc = await db.collection('books').doc(req.params.id).get();
    if (!doc.exists) {
      return res.status(404).json({ success: false, message: 'Book not found.' });
    }
    await db.collection('books').doc(req.params.id).delete();
    return res.json({ success: true, message: 'Book removed.' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ── POST /api/books/:id/borrow ─────────────────────────
router.post('/:id/borrow', async (req, res) => {
  const bookId = req.params.id;
  const userId = req.user.uid;

  try {
    const bookRef = db.collection('books').doc(bookId);
    const bookDoc = await bookRef.get();

    if (!bookDoc.exists) {
      return res.status(404).json({ success: false, message: 'Book not found.' });
    }

    const book = bookDoc.data();
    if (book.available <= 0) {
      return res.status(400).json({ success: false, message: 'Koi bhi copy available nahi hai.' });
    }

    // Already borrowed check
    const activeSnap = await db.collection('borrowings')
      .where('userId', '==', userId)
      .where('bookId', '==', bookId)
      .where('returned', '==', false)
      .limit(1)
      .get();

    if (!activeSnap.empty) {
      return res.status(400).json({ success: false, message: 'Ye book tumne already borrow ki hui hai.' });
    }

    // Max 3 books limit
    const activeBorrowings = await db.collection('borrowings')
      .where('userId', '==', userId)
      .where('returned', '==', false)
      .get();

    if (activeBorrowings.size >= 3) {
      return res.status(400).json({ success: false, message: 'Maximum 3 books borrow ho sakti hain.' });
    }

    const dueDate   = new Date(Date.now() + DUE_DAYS * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const borrowRef = db.collection('borrowings').doc();

    await borrowRef.set({
      id:         borrowRef.id,
      userId,
      userName:   req.user.name || req.user.email,
      bookId,
      bookTitle:  book.title,
      borrowedAt: new Date().toISOString(),
      dueDate,
      returned:   false,
    });

    await bookRef.update({ available: book.available - 1 });

    return res.status(201).json({
      success: true,
      message: `"${book.title}" borrow ho gaya!`,
      data: { dueDate, bookTitle: book.title },
    });
  } catch (err) {
    console.error('Borrow error:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ── POST /api/books/:id/return ─────────────────────────
router.post('/:id/return', async (req, res) => {
  const bookId = req.params.id;
  const userId = req.user.uid;

  try {
    const borrowSnap = await db.collection('borrowings')
      .where('userId', '==', userId)
      .where('bookId', '==', bookId)
      .where('returned', '==', false)
      .limit(1)
      .get();

    if (borrowSnap.empty) {
      return res.status(404).json({ success: false, message: 'Koi active borrowing nahi mili.' });
    }

    const borrowRef = borrowSnap.docs[0].ref;
    const borrow    = borrowSnap.docs[0].data();
    const today     = new Date().toISOString().split('T')[0];
    const overdue   = today > borrow.dueDate;

    await borrowRef.update({
      returned:   true,
      returnedAt: new Date().toISOString(),
      overdue,
    });

    const bookRef = db.collection('books').doc(bookId);
    const bookDoc = await bookRef.get();
    if (bookDoc.exists) {
      await bookRef.update({ available: bookDoc.data().available + 1 });
    }

    return res.json({
      success: true,
      message: `"${borrow.bookTitle}" return ho gaya!`,
      data: { overdue, returnedAt: new Date().toISOString() },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
