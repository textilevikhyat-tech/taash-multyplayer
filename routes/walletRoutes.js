// routes/walletRoutes.js
const express = require("express");
const jwt = require("jsonwebtoken");
const Wallet = require("../models/Wallet");
const router = express.Router();

const auth = (req,res,next) => {
  const h = req.headers.authorization;
  if(!h) return res.status(401).json({ message: "No token" });
  try {
    const token = h.split(" ")[1];
    req.user = jwt.verify(token, process.env.JWT_SECRET || "replace_this_secret");
    next();
  } catch (e) { return res.status(401).json({ message: "Invalid token" }); }
};

router.get("/", auth, async (req,res) => {
  const w = await Wallet.findOne({ username: req.user.username });
  return res.json({ coins: w ? w.coins : 0 });
});

router.post("/add", auth, async (req,res) => {
  const { coins } = req.body;
  const w = await Wallet.findOneAndUpdate({ username: req.user.username }, { $inc: { coins } }, { upsert: true, new: true });
  return res.json({ coins: w.coins });
});

module.exports = router;
