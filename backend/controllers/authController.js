// backend/controllers/authController.js
const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Wallet = require('../models/Transaction');

const JWT_SECRET = process.env.JWT_SECRET || 'secret_123';

// Register
router.post('/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ message: 'Missing fields' });

    const existing = await User.findOne({ username });
    if (existing) return res.status(400).json({ message: 'Username exists' });

    const hash = await bcrypt.hash(password, 10);
    const user = new User({ username, passwordHash: hash });
    await user.save();

    // create wallet if not exists
    await Wallet.updateOne({ username }, { $setOnInsert: { username, coins: 100 } }, { upsert: true });

    res.json({ message: 'Registered successfully' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Login
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ message: 'Missing fields' });

    const user = await User.findOne({ username });
    if (!user) return res.status(400).json({ message: 'User not found' });

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return res.status(400).json({ message: 'Invalid password' });

    const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: '1d' });
    res.json({ token, username });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
