const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Transaction = require('../models/Transaction');

// ✅ Admin adds coins
router.post('/add-coins', async (req, res) => {
  try {
    const { username, coins } = req.body;
    const user = await User.findOne({ username });
    if (!user) return res.status(404).json({ message: 'User not found' });

    user.coins += coins;
    await user.save();

    const tx = new Transaction({ userId: user._id, type: 'add', coins, note: 'Admin top-up' });
    await tx.save();

    res.json({ message: `Added ${coins} coins to ${username}`, newBalance: user.coins });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ✅ Deduct coins
router.post('/deduct-coins', async (req, res) => {
  try {
    const { username, coins } = req.body;
    const user = await User.findOne({ username });
    if (!user) return res.status(404).json({ message: 'User not found' });
    if (user.coins < coins) return res.status(400).json({ message: 'Insufficient balance' });

    user.coins -= coins;
    await user.save();

    const tx = new Transaction({ userId: user._id, type: 'deduct', coins, note: 'Entry fee' });
    await tx.save();

    res.json({ message: `Deducted ${coins} coins`, newBalance: user.coins });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ✅ Check balance
router.get('/balance/:username', async (req, res) => {
  try {
    const user = await User.findOne({ username: req.params.username });
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json({ username: user.username, coins: user.coins });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
