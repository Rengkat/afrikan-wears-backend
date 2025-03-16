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
const getDetailUser = async (req, res, next) => {
  try {
    const { id } = req.params;

    const user = await User.findById(id).select("-password");
    if (!user) {
      throw new CustomError.NotFoundError(`User with ID ${id} not found`);
    }

    res.status(StatusCodes.OK).json({ success: true, user });
  } catch (error) {
    next(error);
  }
};
const updateCurrentUser = async (req, res, next) => {
  try {
    const { name, email, addresses } = req.body;
    const userId = req.user.id;

    const user = await User.findById(userId);
    if (!user) {
      throw new CustomError.NotFoundError("User not found");
    }

    user.name = name || user.name;
    user.email = email || user.email;
    user.addresses = addresses || user.addresses;

    await user.save();

    res.status(StatusCodes.OK).json({ success: true, user });
  } catch (error) {
    next(error);
  }
};
const updateUser = async (req, res, next) => {};
const deleteUser = async (req, res, next) => {};
