const mongoose = require("mongoose");
const validator = require("validator");
const bcrypt = require("bcryptjs");
const Stylist = require("./stylistModel");
const AddressSchema = new mongoose.Schema({
  country: { type: String, required: true },
  state: { type: String, required: true },
  city: { type: String, required: true },
  town: { type: String },
  landmark: { type: String },
  homeAddress: { type: String, required: true },
});
const UserSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, "name can't be empty"],
  },
  email: {
    type: String,
    required: [true, "Email can't be empty"],
    validate: {
      validator: validator.isEmail,
      message: "Please provide a valid email",
    },
  },
  password: {
    type: String,
    required: [true, "Password can't be empty"],
    validate: {
      validator: function (value) {
        return validator.isStrongPassword(value, {
          minLength: 6,
          minLowercase: 1,
          minUppercase: 1,
          minNumbers: 1,
          minSymbols: 1,
        });
      },
      message: "Enter a stronger password",
    },
  },
  role: {
    type: String,
    default: "user",
    enum: ["admin", "user", "stylist"],
  },
  company: {
    type: mongoose.Types.ObjectId,
    ref: "Stylist",
    default: null,
  },
  addresses: {
    type: [AddressSchema],
    default: [],
    required: false,
  },
  isVerified: { type: Boolean, default: false },
  verificationToken: { type: String },
  verificationTokenExpirationDate: { type: String },
});

UserSchema.pre("save", async function () {
  if (!this.isModified("password")) {
    return;
  }
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

UserSchema.methods.comparePassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

module.exports = mongoose.model("User", UserSchema);
