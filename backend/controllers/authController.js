// backend/controllers/authController.js
const User = require("../../models/User");
const Wallet = require("../../models/Wallet");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET || "replace_this_secret";

exports.register = async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ message: "Missing username/password" });
  try {
    const exists = await User.findOne({ username });
    if (exists) return res.status(400).json({ message: "Username exists" });
    const hash = await bcrypt.hash(password, 10);
    const u = new User({ username, passwordHash: hash });
    await u.save();
    await Wallet.create({ username, coins: 100 });
    return res.json({ message: "Registered" });
  } catch (e) {
    console.error("Register error:", e);
    return res.status(500).json({ message: "Server error" });
  }
};

exports.login = async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ message: "Missing" });
  try {
    const user = await User.findOne({ username });
    if (!user) return res.status(400).json({ message: "User not found" });
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return res.status(400).json({ message: "Invalid password" });
    const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: "1d" });
    return res.json({ token, username });
  } catch (e) {
    console.error("Login error:", e);
    return res.status(500).json({ message: "Server error" });
  }
};
