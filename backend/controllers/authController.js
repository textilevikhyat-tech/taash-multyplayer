const User = require('../models/User');
const Wallet = require('../models/Transaction');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;

exports.register = async (req, res) => {
  const { username, password } = req.body;

  try {
    const exists = await User.findOne({ username });
    if (exists) return res.status(400).json({ message: "Username already exists" });

    const hash = await bcrypt.hash(password, 10);

    const newUser = new User({
      username,
      passwordHash: hash
    });

    await newUser.save();

    // create wallet
    const wallet = new Wallet({ username, coins: 100 });
    await wallet.save();

    return res.json({ message: "Registered successfully" });

  } catch (err) {
    console.error("Register Error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};


exports.login = async (req, res) => {
  const { username, password } = req.body;

  try {
    const user = await User.findOne({ username });
    if (!user) return res.status(400).json({ message: "User not found" });

    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) return res.status(400).json({ message: "Incorrect password" });

    const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: "1d" });

    res.json({ token, username });
  } catch (err) {
    console.error("Login Error:", err);
    res.status(500).json({ message: "Server error" });
  }
};
