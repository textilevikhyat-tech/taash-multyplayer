// backend/routes/walletRoutes.js
const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const Wallet = require('../models/Transaction');

const JWT_SECRET = process.env.JWT_SECRET || 'secret_123';

// Public: get wallet by username
router.get('/:username', async (req, res) => {
  try {
    const w = await Wallet.findOne({ username: req.params.username });
    res.json({ username: req.params.username, coins: w?.coins ?? 0 });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Protected add coins
router.post('/add', async (req, res) => {
  try {
    const auth = req.headers.authorization;
    if (!auth) return res.status(401).json({ message: 'No token' });
    const token = auth.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    const { coins } = req.body;
    const w = await Wallet.findOne({ username: decoded.username });
    if (!w) return res.status(404).json({ message: 'Wallet not found' });
    w.coins += Number(coins || 0);
    await w.save();
    res.json({ coins: w.coins });
  } catch (err) {
    res.status(401).json({ message: 'Invalid token' });
  }
});

// Protected deduct coins
router.post('/deduct', async (req, res) => {
  try {
    const auth = req.headers.authorization;
    if (!auth) return res.status(401).json({ message: 'No token' });
    const token = auth.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    const { coins } = req.body;
    const w = await Wallet.findOne({ username: decoded.username });
    if (!w) return res.status(404).json({ message: 'Wallet not found' });
    w.coins = Math.max(0, w.coins - Number(coins || 0));
    await w.save();
    res.json({ coins: w.coins });
  } catch (err) {
    res.status(401).json({ message: 'Invalid token' });
  }
});

module.exports = router;
