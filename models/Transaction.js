const mongoose = require("mongoose");

const WalletSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  coins: { type: Number, default: 100 },
  isAdmin: { type: Boolean, default: false }
});

module.exports = mongoose.model("Wallet", WalletSchema);
