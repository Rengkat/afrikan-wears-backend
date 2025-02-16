const User = require("../models/userModel");
const CustomError = require("../errors");
const { StatusCodes } = require("http-status-codes");
const { createUserPayload } = require("../utils");
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
  // create a user
  // send verification token
  // return response
  res.status(StatusCodes.CREATED).json({
    success: true,
    message: "Account created. Please verify your email using the code sent to you.",
  });
};
const verifyEmail = async (req, res, next) => {
  // check if details are passed
  // find user based on email
  // check if user
  // check expiring of verify code and return
  // check if verification code is same
  // set user as verify and clear verification
  //return res
};
const login = async (req, res, next) => {
  const { email, password } = req.body;
  // check if detail provided
  if (!email || !password) {
    throw new CustomError.BadRequestError("Please provide all credentials");
  }
  // check if user exist with email
  const user = await User.findOne({ email });
  if (!user) {
    throw new CustomError.NotFoundError("User not found");
  }
  // check if password is correct
  const isPasswordCorrect = await user.comparePassword(password);
  if (!isPasswordCorrect) {
    throw new CustomError.BadRequestError("Incorrect password");
  }
  // check if verified
  const userPayload = createUserPayload(user);
  // create access token
  // check if refresh token exist
  // if exist reset the refresh token and the access token and return it
  // if refresh token does not exist, create one
  // create access token again
  // return response
  res.status(StatusCodes.OK).json({
    success: true,
    user: userPayload,
    message: "Logged in successfully",
  });
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
