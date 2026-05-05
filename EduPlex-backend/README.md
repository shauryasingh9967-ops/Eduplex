# 🎓 EduPlex Backend v2.0 — Fixed

## Kya Fix Hua

| Bug | Fix |
|-----|-----|
| `User not found in database` | Auth middleware ab teeno collections check karta hai: `users` → `teachers` → `students` |
| Firestore `orderBy` + `where` composite index error | Saari `orderBy` queries hata di — JS mein sort karo |
| Profile update sirf `users` collection mein hota tha | Ab sahi collection mein update hota hai |
| `register` — teacher/student galat collection mein save hota tha | Role ke hisab se `users`/`teachers`/`students` mein save |
| Library `/borrowings/my` — `:id` se clash | Specific routes pehle rakhe |
| Student access check — uid mismatch | Doc ID aur uid dono se check karta hai |

---

## Setup

### 1. Files Extract Karo
```
C:\eduplex-backend\ mein sab paste karo
```

### 2. .env File Banao
```bash
copy .env.example .env
```

`.env` fill karo Firebase JSON se:
```env
PORT=5000
NODE_ENV=development
FIREBASE_PROJECT_ID=eduplex-49c9c
FIREBASE_PRIVATE_KEY_ID=...
FIREBASE_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----\n"
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-...@eduplex-49c9c.iam.gserviceaccount.com
FIREBASE_CLIENT_ID=...
```

### 3. Install + Run
```bash
npm install
npm run dev
```

### 4. Test
Browser mein: `http://localhost:5000`

---

## Firestore Structure — Sahi Tarika

```
users/          ← Admin profiles (Document ID = Firebase Auth UID)
  {uid}/
    name, email, role: "admin", dept, avatar, status

teachers/       ← Teacher profiles (Document ID = Firebase Auth UID)  
  {uid}/
    name, email, role: "teacher", dept, subject, exp, status

students/       ← Student profiles (Document ID = Firebase Auth UID)
  {uid}/
    name, email, role: "student", dept, year, gpa, status

courses/        ← Course data
attendance/     ← Attendance records
marks/          ← Student marks
books/          ← Library books
borrowings/     ← Borrow/return records
```

> ⚠️ **IMPORTANT**: Document ID = Firebase Auth UID hona chahiye
> Firebase Console → Authentication → Users → UID copy karo
> Firestore → collection → Document ID = wahi UID

---

## API Routes

### Auth
```
POST /api/auth/login         → idToken bhejo, user data milega
POST /api/auth/register      → Admin naya user banata hai  
GET  /api/auth/me            → Current user info
PUT  /api/auth/profile       → Profile update
```

### Students
```
GET    /api/students         → List (role-based)
GET    /api/students/:id     → Single student
POST   /api/students         → Add (Admin only)
PUT    /api/students/:id     → Update (Admin only)
DELETE /api/students/:id     → Delete (Admin only)
```

### Teachers
```
GET    /api/teachers         → List
GET    /api/teachers/:id     → Single
POST   /api/teachers         → Add (Admin)
PUT    /api/teachers/:id     → Update (Admin)
DELETE /api/teachers/:id     → Delete (Admin)
```

### Courses
```
GET    /api/courses          → List
POST   /api/courses          → Add (Admin)
PUT    /api/courses/:id      → Update (Admin)
DELETE /api/courses/:id      → Delete (Admin)
POST   /api/courses/:id/enroll → Student enroll
```

### Attendance
```
POST /api/attendance/mark              → Mark class attendance
GET  /api/attendance/student/:id       → Student ka attendance log
GET  /api/attendance/course/:id        → Course ka attendance
GET  /api/attendance/report            → Overall report (Admin)
```

### Marks
```
POST /api/marks                     → Save marks (Teacher/Admin)
GET  /api/marks/student/:id         → Student results + GPA
GET  /api/marks/course/:id          → Course results + stats
```

### Library
```
GET  /api/books                     → Book list
POST /api/books                     → Add book (Admin)
PUT  /api/books/:id                 → Update (Admin)
DELETE /api/books/:id               → Delete (Admin)
POST /api/books/:id/borrow          → Borrow book
POST /api/books/:id/return          → Return book
GET  /api/books/borrowings/my       → My borrowings
GET  /api/books/borrowings/all      → All borrowings (Admin)
```
