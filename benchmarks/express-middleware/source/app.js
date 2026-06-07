const express = require('express');
const { authMiddleware, roleCheck } = require('./auth');

const app = express();
app.use(express.json());

// Public endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

// Protected endpoint
app.get('/api/users/me', authMiddleware, (req, res) => {
  res.json({ user: req.user });
});

// Admin only endpoint
app.post('/api/admin/config', authMiddleware, roleCheck('admin'), (req, res) => {
  const { setting, value } = req.body;
  if (!setting) {
    return res.status(400).json({ error: 'Setting name is required' });
  }
  // Store config
  res.json({ success: true, updated: setting });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

module.exports = app;
