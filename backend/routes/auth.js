const express = require('express');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const Admin = require('../models/Admin');
const Airline = require('../models/Airline');
const { upload, cloudinary } = require('../services/upload');
const { sendPasswordResetEmail } = require('../services/emailService');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error('JWT_SECRET environment variable is required');

// ─────────────────────────────────────────────
//  JWT middleware — works for both admin & airline
// ─────────────────────────────────────────────
function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Access denied. No token provided.' });
  }
  try {
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    req.admin = decoded; // contains id, email, name, role, and airlineName for airlines
    // DEBUG: Log decoded token for airline users
    if (decoded.role === 'airline') {
      console.log('DEBUG authMiddleware: Airline JWT decoded', {
        id: decoded.id,
        airlineName: decoded.airlineName,
        role: decoded.role,
      });
    }
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token.' });
  }
}

// Admin-only middleware
function adminOnly(req, res, next) {
  if (req.admin?.role !== 'admin' && req.admin?.role !== 'Administrator') {
    return res.status(403).json({ error: 'Admin access required.' });
  }
  next();
}

// ─────────────────────────────────────────────
//  ADMIN SIGNUP
//  POST /api/auth/signup
// ─────────────────────────────────────────────
router.post('/signup', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password)
      return res.status(400).json({ error: 'Name, email, and password are required.' });
    if (password.length < 6)
      return res.status(400).json({ error: 'Password must be at least 6 characters.' });

    const existing = await Admin.findOne({ email });
    if (existing)
      return res.status(400).json({ error: 'An account with this email already exists.' });

    const admin = await Admin.create({ name, email, password });
    const token = jwt.sign(
      { id: admin._id, email: admin.email, name: admin.name, role: 'admin' },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.status(201).json({ token, admin: admin.toJSON() });
  } catch (err) {
    console.error('Admin signup error:', err);
    res.status(500).json({ error: err.message || 'Server error during signup.' });
  }
});

// ─────────────────────────────────────────────
//  ADMIN LOGIN
//  POST /api/auth/login
// ─────────────────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ error: 'Email and password are required.' });

    const admin = await Admin.findOne({ email });
    if (!admin)
      return res.status(401).json({ error: 'Invalid email or password.' });

    const isMatch = await admin.comparePassword(password);
    if (!isMatch)
      return res.status(401).json({ error: 'Invalid email or password.' });

    admin.lastLogin = new Date();
    await admin.save();

    const token = jwt.sign(
      { id: admin._id, email: admin.email, name: admin.name, role: 'admin' },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({ token, admin: { ...admin.toJSON(), role: 'admin' } });
  } catch (err) {
    console.error('Admin login error:', err);
    res.status(500).json({ error: err.message || 'Server error during login.' });
  }
});

// ─────────────────────────────────────────────
//  UPLOAD AIRLINE LOGO (call before signup)
//  POST /api/auth/airline/upload-logo
//  Body: multipart/form-data, field name = 'logo'
//  Returns: { logo_url: 'https://res.cloudinary.com/...' }
// ─────────────────────────────────────────────
router.post('/airline/upload-logo', upload.single('logo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });
    res.json({ logo_url: req.file.path });
  } catch (err) {
    console.error('Logo upload error:', err);
    res.status(500).json({ error: err.message || 'Upload failed.' });
  }
});

// ─────────────────────────────────────────────
//  AIRLINE SIGNUP
//  POST /api/auth/airline/signup
// ─────────────────────────────────────────────
router.post('/airline/signup', async (req, res) => {
  try {
    const { name, airlineName, email, password, logo_url } = req.body;
    if (!name || !airlineName || !email || !password)
      return res.status(400).json({ error: 'Name, airline name, email, and password are required.' });
    if (password.length < 6)
      return res.status(400).json({ error: 'Password must be at least 6 characters.' });

    const existing = await Airline.findOne({ email });
    if (existing)
      return res.status(400).json({ error: 'An account with this email already exists.' });

    const airline = await Airline.create({ name, airlineName, email, password, logo_url: logo_url || null });
    const token = jwt.sign(
      { id: airline._id, email: airline.email, name: airline.name, airlineName: airline.airlineName, role: 'airline' },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.status(201).json({ token, admin: airline.toJSON() });
  } catch (err) {
    console.error('Airline signup error:', err);
    // Return actual error so client can show meaningful message
    const msg = err.code === 11000
      ? 'An account with this email already exists.'
      : err.message || 'Server error during airline signup.';
    res.status(err.code === 11000 ? 400 : 500).json({ error: msg });
  }
});

// ─────────────────────────────────────────────
//  AIRLINE LOGIN
//  POST /api/auth/airline/login
// ─────────────────────────────────────────────
router.post('/airline/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ error: 'Email and password are required.' });

    const airline = await Airline.findOne({ email });
    if (!airline)
      return res.status(401).json({ error: 'Invalid email or password.' });

    const isMatch = await airline.comparePassword(password);
    if (!isMatch)
      return res.status(401).json({ error: 'Invalid email or password.' });

    airline.lastLogin = new Date();
    await airline.save();

    const token = jwt.sign(
      { id: airline._id, email: airline.email, name: airline.name, airlineName: airline.airlineName, role: 'airline' },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({ token, admin: { ...airline.toJSON(), role: 'airline' } });
  } catch (err) {
    console.error('Airline login error:', err);
    res.status(500).json({ error: err.message || 'Server error during airline login.' });
  }
});

// ─────────────────────────────────────────────
//  GET ME — works for admin and airline
//  GET /api/auth/me
// ─────────────────────────────────────────────
router.get('/me', authMiddleware, async (req, res) => {
  try {
    if (req.admin.role === 'airline') {
      const airline = await Airline.findById(req.admin.id);
      if (!airline) return res.status(404).json({ error: 'Airline user not found.' });
      return res.json({ ...airline.toJSON(), role: 'airline' });
    } else {
      const admin = await Admin.findById(req.admin.id);
      if (!admin) return res.status(404).json({ error: 'Admin not found.' });
      return res.json({ ...admin.toJSON(), role: 'admin' });
    }
  } catch (err) {
    res.status(500).json({ error: 'Server error.' });
  }
});

// ─────────────────────────────────────────────
//  UPDATE PROFILE
//  PUT /api/auth/profile
// ─────────────────────────────────────────────
router.put('/profile', authMiddleware, async (req, res) => {
  try {
    const Model = req.admin.role === 'airline' ? Airline : Admin;
    const user = await Model.findById(req.admin.id);
    if (!user) return res.status(404).json({ error: 'User not found.' });

    const { name, currentPassword, newPassword, newEmail, logo_url } = req.body;
    if (name && name.trim()) user.name = name.trim();
    if (logo_url !== undefined && req.admin.role === 'airline') user.logo_url = logo_url || null;

    if (newPassword) {
      if (!currentPassword)
        return res.status(400).json({ error: 'Current password is required to set a new password.' });
      const isMatch = await user.comparePassword(currentPassword);
      if (!isMatch)
        return res.status(401).json({ error: 'Current password is incorrect.' });
      if (newPassword.length < 6)
        return res.status(400).json({ error: 'New password must be at least 6 characters.' });
      user.password = newPassword;
    }

    if (newEmail) {
      if (!currentPassword)
        return res.status(400).json({ error: 'Current password is required to change email.' });
      const isMatch = await user.comparePassword(currentPassword);
      if (!isMatch)
        return res.status(401).json({ error: 'Current password is incorrect.' });
      
      // Check if email is already in use by another user
      const existingUser = await Model.findOne({ email: newEmail.trim(), _id: { $ne: user._id } });
      if (existingUser)
        return res.status(400).json({ error: 'This email is already in use.' });
      
      user.email = newEmail.trim();
    }

    await user.save();
    const role = req.admin.role === 'airline' ? 'airline' : 'admin';
    const token = jwt.sign(
      { id: user._id, email: user.email, name: user.name, role },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({ token, admin: { ...user.toJSON(), role } });
  } catch (err) {
    res.status(500).json({ error: 'Server error updating profile.' });
  }
});

// ─────────────────────────────────────────────
//  FORGOT PASSWORD — send reset link to airline email
//  POST /api/auth/airline/forgot-password
// ─────────────────────────────────────────────
router.post('/airline/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required.' });

    const airline = await Airline.findOne({ email: email.toLowerCase().trim() });
    // Always return success even if email not found — prevents email enumeration
    if (!airline) {
      return res.json({ message: 'If that email is registered, a reset link has been sent.' });
    }

    // Generate a secure random token
    const token  = crypto.randomBytes(32).toString('hex');
    const expiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hour from now

    airline.resetPasswordToken  = token;
    airline.resetPasswordExpiry = expiry;
    await airline.save();

    // Build reset URL — points to the frontend
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const resetUrl    = `${frontendUrl}/reset-password?token=${token}&email=${encodeURIComponent(airline.email)}`;

    await sendPasswordResetEmail({
      toEmail:     airline.email,
      airlineName: airline.airlineName,
      resetUrl,
    });

    res.json({ message: 'If that email is registered, a reset link has been sent.' });
  } catch (err) {
    console.error('Forgot password error:', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

// ─────────────────────────────────────────────
//  RESET PASSWORD — set new password using token
//  POST /api/auth/airline/reset-password
// ─────────────────────────────────────────────
router.post('/airline/reset-password', async (req, res) => {
  try {
    const { email, token, newPassword } = req.body;
    if (!email || !token || !newPassword)
      return res.status(400).json({ error: 'Email, token, and new password are required.' });
    if (newPassword.length < 6)
      return res.status(400).json({ error: 'Password must be at least 6 characters.' });

    const airline = await Airline.findOne({
      email:              email.toLowerCase().trim(),
      resetPasswordToken: token,
      resetPasswordExpiry:{ $gt: new Date() },  // not expired
    });

    if (!airline)
      return res.status(400).json({ error: 'Reset link is invalid or has expired. Please request a new one.' });

    // Set new password and clear reset token
    airline.password            = newPassword;  // pre-save hook hashes it
    airline.resetPasswordToken  = null;
    airline.resetPasswordExpiry = null;
    await airline.save();

    res.json({ message: 'Password reset successfully. You can now log in.' });
  } catch (err) {
    console.error('Reset password error:', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

module.exports = { router, authMiddleware, adminOnly };
