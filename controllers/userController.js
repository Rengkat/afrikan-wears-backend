const User = require("../models/userModel");
const CustomError = require("../errors");
const { StatusCodes } = require("http-status-codes");

const getAllUsers = async (req, res, next) => {
  try {
    const users = await User.find({}).select("-password");
    res.status(StatusCodes.OK).json({ success: true, count: users.length, users });
  } catch (error) {
    next(error);
  }
};
const getDetailUser = async (req, res, next) => {};
const updateCurrentUser = async (req, res, next) => {};
const updateUser = async (req, res, next) => {};
const deleteUser = async (req, res, next) => {};
