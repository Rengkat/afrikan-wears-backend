const User = require("../models/userModel");
const CustomError = require("../errors");
const crypto = require("crypto");
const { StatusCodes } = require("http-status-codes");
const sendVerificationEmail = require("../utils/Email/sendVerificationMail");
const register = async (req, res, next) => {
  const { name, email, password, company } = req.body;
  // check if details are present
  if (!name || !email || !password) {
    throw new CustomError.BadRequestError("Please provide all credentials");
  }
  // check if the email exist
  const existedUser = await User.findOne({ email });
  if (existedUser) {
    throw new CustomError.BadRequestError("Sorry, email already exist");
  }
  // create verification token
  const verificationToken = crypto.randomBytes(40).toString("hex");
  const expiration = new Date(new Date.now() + 1000 * 60 * 60);
  // create a user
  const user = await User.create({
    name,
    email,
    password,
    company,
    verificationToken,
    verificationTokenExpirationDate: expiration,
  });
  // send verification token email
  sendVerificationEmail({
    email: user.email,
    origin: process.env.ORIGIN,
    name: user.firstName,
    verificationToken,
  });
  // return response
  res.status(StatusCodes.CREATED).json({
    message: "Registration successful. Please check your email and verify it",
    success: true,
  });
};
const verifyEmail = async (req, res, next) => {
  const { email, verificationToken } = req.body;
  // check if details are passed
  if (!email || !verificationToken) {
    throw new CustomError.BadRequestError("Please provide all details");
  }
  // find user based on email
  const user = await User.findOne({ email });
  // check if user
  if (!user) {
    throw new CustomError.NotFoundError("User not found");
  }
  // check expiring of verify code and return
  if (user.verificationTokenExpirationDate > new Date(Date.now())) {
    throw new CustomError.BadRequestError("Verification token has expired. Please request new one");
  }
  // check if verification code is same
  if (user.verificationToken !== verificationToken) {
    throw new CustomError.BadRequestError("Invalid token");
  }
  // set user as verify and clear verification
  user.verificationToken = null;
  user.verificationTokenExpirationDate = null;
  await user.save();
  //return res
  res.status(StatusCodes.OK).json({
    message: "Email verification successful.",
    success: true,
  });
};
const login = async (req, res, next) => {
  // check if detail provided
  // check if user exist with email
  // check if password is correct
  // check if verified
  // create access token
  // check if refresh token exist
  // if exist reset the refresh token and the access token and return it
  // if refresh token does not exist, create one
  // create access token again
  // return response
};
const logout = async (req, res, next) => {};
const forgotPassword = async (req, res, next) => {};
const resetPassword = async (req, res, next) => {};
module.exports = {
  register,
  verifyEmail,
  login,
  logout,
  forgotPassword,
  resetPassword,
};
