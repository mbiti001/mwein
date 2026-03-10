// =====================================
// MWEIN MEDICAL - ADMIN BACKEND
// Express.js + SQLite Analytics Server
// =====================================

const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcryptjs = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const bodyParser = require('body-parser');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// =====================================
// DATABASE SETUP
// =====================================
const db = new sqlite3.Database('./data/mwein-analytics.db', (err) => {
    if (err) console.error('Database connection error:', err);
    else console.log('Connected to SQLite database');
});

// Initialize database tables
db.serialize(() => {
    // Admin users table
    db.run(`CREATE TABLE IF NOT EXISTS admins (
        id INTEGER PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Visitor tracking table
    db.run(`CREATE TABLE IF NOT EXISTS visitors (
        id INTEGER PRIMARY KEY,
        ip_address TEXT,
        page_url TEXT NOT NULL,
        referrer TEXT,
        user_agent TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Page views table
    db.run(`CREATE TABLE IF NOT EXISTS page_views (
        id INTEGER PRIMARY KEY,
        page_name TEXT NOT NULL,
        view_count INTEGER DEFAULT 1,
        last_viewed DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // User actions table
    db.run(`CREATE TABLE IF NOT EXISTS user_actions (
        id INTEGER PRIMARY KEY,
        action_type TEXT NOT NULL,
        page TEXT,
        details TEXT,
        ip_address TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Form submissions table
    db.run(`CREATE TABLE IF NOT EXISTS form_submissions (
        id INTEGER PRIMARY KEY,
        form_name TEXT NOT NULL,
        email TEXT,
        phone TEXT,
        message TEXT,
        ip_address TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    console.log('Database tables initialized');
});

// =====================================
// AUTHENTICATION MIDDLEWARE
// =====================================
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) return res.status(401).json({ error: 'Access token required' });

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ error: 'Invalid token' });
        req.user = user;
        next();
    });
};

// =====================================
// AUTH ROUTES
// =====================================

// Register admin (first-time setup only)
app.post('/api/auth/register', (req, res) => {
    const { username, email, password } = req.body;

    if (!username || !email || !password) {
        return res.status(400).json({ error: 'All fields required' });
    }

    const hashedPassword = bcryptjs.hashSync(password, 10);

    db.run(
        'INSERT INTO admins (username, email, password) VALUES (?, ?, ?)',
        [username, email, hashedPassword],
        function(err) {
            if (err) return res.status(400).json({ error: 'User already exists' });
            res.status(201).json({ message: 'Admin registered successfully' });
        }
    );
});

// Login
app.post('/api/auth/login', (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ error: 'Email and password required' });
    }

    db.get('SELECT * FROM admins WHERE email = ?', [email], (err, user) => {
        if (err || !user) return res.status(401).json({ error: 'Invalid credentials' });

        const isPasswordValid = bcryptjs.compareSync(password, user.password);
        if (!isPasswordValid) return res.status(401).json({ error: 'Invalid credentials' });

        const token = jwt.sign({ id: user.id, username: user.username, email: user.email }, JWT_SECRET, { expiresIn: '24h' });
        res.json({ token, user: { id: user.id, username: user.username, email: user.email } });
    });
});

// =====================================
// VISITOR TRACKING ROUTES
// =====================================

// Log visitor
app.post('/api/track/visitor', (req, res) => {
    const { page_url, referrer, user_agent } = req.body;
    const ip_address = req.ip || req.connection.remoteAddress;

    db.run(
        'INSERT INTO visitors (ip_address, page_url, referrer, user_agent) VALUES (?, ?, ?, ?)',
        [ip_address, page_url, referrer, user_agent],
        (err) => {
            if (err) console.error('Error logging visitor:', err);
            res.json({ success: true });
        }
    );

    // Update page views
    db.get('SELECT * FROM page_views WHERE page_name = ?', [page_url], (err, row) => {
        if (row) {
            db.run('UPDATE page_views SET view_count = view_count + 1, last_viewed = CURRENT_TIMESTAMP WHERE page_name = ?', [page_url]);
        } else {
            db.run('INSERT INTO page_views (page_name, view_count) VALUES (?, 1)', [page_url]);
        }
    });
});

// Log user action
app.post('/api/track/action', (req, res) => {
    const { action_type, page, details } = req.body;
    const ip_address = req.ip || req.connection.remoteAddress;

    db.run(
        'INSERT INTO user_actions (action_type, page, details, ip_address) VALUES (?, ?, ?, ?)',
        [action_type, page, JSON.stringify(details), ip_address],
        (err) => {
            if (err) console.error('Error logging action:', err);
            res.json({ success: true });
        }
    );
});

// =====================================
// ANALYTICS ROUTES (Admin only)
// =====================================

// Get dashboard stats
app.get('/api/analytics/dashboard', authenticateToken, (req, res) => {
    db.get('SELECT COUNT(*) as total_visitors FROM visitors', (err, visitors) => {
        db.get('SELECT COUNT(*) as total_page_views FROM page_views', (err2, views) => {
            db.get('SELECT COUNT(*) as total_actions FROM user_actions', (err3, actions) => {
                db.get('SELECT COUNT(*) as total_submissions FROM form_submissions', (err4, submissions) => {
                    res.json({
                        total_visitors: visitors?.total_visitors || 0,
                        total_page_views: views?.total_page_views || 0,
                        total_actions: actions?.total_actions || 0,
                        total_submissions: submissions?.total_submissions || 0
                    });
                });
            });
        });
    });
});

// Get page views breakdown
app.get('/api/analytics/page-views', authenticateToken, (req, res) => {
    db.all('SELECT page_name, view_count, last_viewed FROM page_views ORDER BY view_count DESC', (err, rows) => {
        if (err) return res.status(500).json({ error: 'Database error' });
        res.json(rows || []);
    });
});

// Get recent visitors
app.get('/api/analytics/recent-visitors', authenticateToken, (req, res) => {
    db.all(`SELECT ip_address, page_url, referrer, timestamp FROM visitors ORDER BY timestamp DESC LIMIT 50`, (err, rows) => {
        if (err) return res.status(500).json({ error: 'Database error' });
        res.json(rows || []);
    });
});

// Get recent actions
app.get('/api/analytics/recent-actions', authenticateToken, (req, res) => {
    db.all(`SELECT action_type, page, details, timestamp FROM user_actions ORDER BY timestamp DESC LIMIT 50`, (err, rows) => {
        if (err) return res.status(500).json({ error: 'Database error' });
        res.json(rows || []);
    });
});

// Get form submissions
app.get('/api/analytics/form-submissions', authenticateToken, (req, res) => {
    db.all(`SELECT form_name, email, phone, message, timestamp FROM form_submissions ORDER BY timestamp DESC LIMIT 100`, (err, rows) => {
        if (err) return res.status(500).json({ error: 'Database error' });
        res.json(rows || []);
    });
});

// Log form submission
app.post('/api/track/form-submission', (req, res) => {
    const { form_name, email, phone, message } = req.body;
    const ip_address = req.ip || req.connection.remoteAddress;

    db.run(
        'INSERT INTO form_submissions (form_name, email, phone, message, ip_address) VALUES (?, ?, ?, ?, ?)',
        [form_name, email, phone, message, ip_address],
        (err) => {
            if (err) console.error('Error logging form submission:', err);
            res.json({ success: true });
        }
    );
});

// =====================================
// SERVER START
// =====================================
app.listen(PORT, () => {
    console.log(`✅ Mwein Medical Backend running on http://localhost:${PORT}`);
    console.log(`📊 Analytics API ready`);
});
