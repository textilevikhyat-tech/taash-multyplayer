// routes/walletRoutes.js
const express = require('express');
const router = express.Router();
const Wallet = require('../models/Transaction');

// Get wallet by username
router.get('/:username', async (req, res) => {
  try {
    const w = await Wallet.findOne({ username: req.params.username });
    if (!w) return res.status(404).json({ message: 'Wallet not found' });
    res.json({ username: w.username, coins: w.coins, isAdmin: w.isAdmin || false });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
