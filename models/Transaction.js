const mongoose = require("mongoose");

const WalletSchema = new mongoose.Schema(
  {
    username: { type: String, required: true },     // ❗ unique हटाया गया
    coins: { type: Number, default: 100 }           // starting balance
  },
  { timestamps: true }                               // auto createdAt, updatedAt
);

module.exports = mongoose.model("Wallet", WalletSchema);
