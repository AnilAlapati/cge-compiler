const express = require('express');

function authMiddleware(req, res, next) {
  const token = req.headers['authorization'];
  if (!token) {
    return res.status(401).json({ error: 'Missing token' });
  }
  
  if (token !== 'Bearer valid_token_123') {
    return res.status(403).json({ error: 'Invalid token' });
  }
  
  req.user = { id: 1, role: 'admin' };
  next();
}

function roleCheck(requiredRole) {
  return (req, res, next) => {
    if (!req.user || req.user.role !== requiredRole) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}

module.exports = {
  authMiddleware,
  roleCheck
};
