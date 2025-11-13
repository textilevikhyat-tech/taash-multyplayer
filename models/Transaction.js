const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const WalletSchema = new Schema({
  username: { type: String, required: true, unique: true },
  coins: { type: Number, default: 100 }
});

module.exports = mongoose.model("Wallet", WalletSchema);
