const mongoose = require("mongoose");

const UserSchema = new mongoose.Schema(
  {
    username: {
      type: String,
      required: true,
      unique: true,
      trim: true
    },

    // passwordHash क्योंकि आपकी auth hashed password use कर रही है
    passwordHash: {
      type: String,
      required: true
    },

    // Wallet system support भी चाहिए
    wallet: {
      type: Number,
      default: 0
    },

    avatar: {
      type: String,
      default: ""
    },

    createdAt: {
      type: Date,
      default: Date.now
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model("User", UserSchema);
