const express = require('express');
const jwt = require('jsonwebtoken');
const Wallet = require('../models/Transaction');

const router = express.Router();

const auth = (req, res, next) => {
  const auth = req.headers.authorization;
  if (!auth) return res.status(401).json({ message: "No token" });

  try {
    const token = auth.split(" ")[1];
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch (err) {
    return res.status(401).json({ message: "Invalid token" });
  }
};

// get coins
router.get("/", auth, async (req, res) => {
  const wallet = await Wallet.findOne({ username: req.user.username });
  res.json({ coins: wallet?.coins || 0 });
});

// add coins
router.post("/add", auth, async (req, res) => {
  const { coins } = req.body;

  const wallet = await Wallet.findOne({ username: req.user.username });
  wallet.coins += coins;
  await wallet.save();

  res.json({ coins: wallet.coins });
});

// deduct coins
router.post("/deduct", auth, async (req, res) => {
  const { coins } = req.body;

  const wallet = await Wallet.findOne({ username: req.user.username });
  wallet.coins = Math.max(wallet.coins - coins, 0);
  await wallet.save();

  res.json({ coins: wallet.coins });
});

module.exports = router;
