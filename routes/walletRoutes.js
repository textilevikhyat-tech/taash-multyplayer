const express = require('express');
const jwt = require('jsonwebtoken');
const Wallet = require('../models/Transaction');

const router = express.Router();

// Middleware: verify token
const auth = (req, res, next) => {
  const header = req.headers.authorization;

  if (!header)
    return res.status(401).json({ message: "No token provided" });

  try {
    const token = header.split(" ")[1];
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch (err) {
    return res.status(401).json({ message: "Invalid token" });
  }
};

// -------- GET COINS --------
router.get("/", auth, async (req, res) => {
  try {
    const wallet = await Wallet.findOne({ username: req.user.username });
    return res.json({ coins: wallet?.coins || 0 });
  } catch (err) {
    return res.status(500).json({ message: "Server error" });
  }
});

// -------- ADD COINS --------
router.post("/add", auth, async (req, res) => {
  try {
    const { coins } = req.body;

    if (typeof coins !== "number")
      return res.status(400).json({ message: "Invalid coins value" });

    const wallet = await Wallet.findOne({ username: req.user.username });
    wallet.coins += coins;

    await wallet.save();
    return res.json({ coins: wallet.coins });

  } catch (err) {
    return res.status(500).json({ message: "Server error" });
  }
});

// -------- DEDUCT COINS --------
router.post("/deduct", auth, async (req, res) => {
  try {
    const { coins } = req.body;

    if (typeof coins !== "number")
      return res.status(400).json({ message: "Invalid coins value" });

    const wallet = await Wallet.findOne({ username: req.user.username });
    wallet.coins = Math.max(wallet.coins - coins, 0);

    await wallet.save();
    return res.json({ coins: wallet.coins });

  } catch (err) {
    return res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;
