# Mwein Medical Backend - Admin Dashboard & Analytics

## Overview
This is a Node.js/Express backend that powers the admin dashboard and analytics for Mwein Medical. It tracks visitor data, page views, user actions, and form submissions.

## Features
- 🔐 Admin authentication (JWT tokens)
- 📊 Real-time analytics dashboard
- 👥 Visitor tracking
- ⚡ User action logging
- 📋 Form submission tracking
- 📈 Page views breakdown

## Installation

### 1. Install Node.js
Download from [nodejs.org](https://nodejs.org)

### 2. Install Dependencies
```bash
cd backend
npm install
```

### 3. Create Data Directory
```bash
mkdir data
```

### 4. Configure Environment
Edit `.env`:
```
PORT=3000
JWT_SECRET=your-super-secret-key-change-this
DATABASE_PATH=./data/mwein-analytics.db
```

### 5. Start the Server
```bash
npm start
# or for development with auto-reload:
npm run dev
```

The server will run on `http://localhost:3000`

## API Endpoints

### Authentication
- `POST /api/auth/register` - Register a new admin
- `POST /api/auth/login` - Login and get JWT token

### Tracking (no auth required)
- `POST /api/track/visitor` - Log a visitor
- `POST /api/track/action` - Log a user action
- `POST /api/track/form-submission` - Log a form submission

### Analytics (requires JWT token)
- `GET /api/analytics/dashboard` - Get dashboard stats
- `GET /api/analytics/page-views` - Get page views breakdown
- `GET /api/analytics/recent-visitors` - Get recent visitors
- `GET /api/analytics/recent-actions` - Get recent actions
- `GET /api/analytics/form-submissions` - Get form submissions

## Frontend Integration

### Add Tracking to Frontend
Add this to your website's footer or main script:

```javascript
// Track visitors
fetch('http://localhost:3000/api/track/visitor', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
        page_url: window.location.pathname,
        referrer: document.referrer,
        user_agent: navigator.userAgent
    })
});

// Track button clicks
document.addEventListener('click', (e) => {
    if (e.target.tagName === 'BUTTON') {
        fetch('http://localhost:3000/api/track/action', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action_type: 'button_click',
                page: window.location.pathname,
                details: { button: e.target.textContent }
            })
        });
    }
});

// Track form submissions
document.addEventListener('submit', (e) => {
    fetch('http://localhost:3000/api/track/form-submission', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            form_name: e.target.name || 'form',
            email: e.target.email?.value,
            phone: e.target.phone?.value,
            message: e.target.message?.value
        })
    });
});
```

## Admin Dashboard Access

1. Open `admin-login.html` in your browser
2. First time: Click "Create account" to register
3. Login with your email/password
4. View analytics on the dashboard

## Database Schema

The SQLite database includes:
- `admins` - Admin user accounts
- `visitors` - Visitor tracking data
- `page_views` - Page view statistics
- `user_actions` - User interaction log
- `form_submissions` - Form submission records

## Production Deployment

For production:
1. Change `JWT_SECRET` in `.env` to a strong random string
2. Use environment variables for database path
3. Enable HTTPS
4. Consider using PM2 for process management
5. Set up database backups
6. Configure CORS for your domain

## Security Notes
- Never commit `.env` to version control
- Use strong passwords for admin accounts
- Implement rate limiting on production
- Use HTTPS for all connections
- Regularly update dependencies

## Troubleshooting

**CORS errors?**
- Make sure backend is running on correct port
- Check `CORS` middleware in server.js

**Database errors?**
- Ensure `data/` directory exists
- Check file permissions

**Login fails?**
- Register an account first
- Check admin credentials

## Support
For issues, check the server logs or contact the development team.
