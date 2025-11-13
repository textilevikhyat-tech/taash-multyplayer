// models/Transaction.js
const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const WalletSchema = new Schema({
  username: { type: String, required: true, unique: true },
  coins: { type: Number, default: 100 },
  isAdmin: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Wallet', WalletSchema);
