const Address = require("../models/userAddressModel");
const User = require("../models/userModel");
const CustomError = require("../errors");
const { StatusCodes } = require("http-status-codes");
const mongoose = require("mongoose");

const getAllAddresses = async (req, res, next) => {
  try {
    const userId = req.user.id;

    const addresses = await Address.find({ user: userId }).sort({ isDefault: -1, createdAt: -1 });

    res.status(StatusCodes.OK).json({
      success: true,
      fromCache: false,
      count: addresses.length,
      addresses,
    });
  } catch (error) {
    next(error);
  }
};

const createAddress = async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const userId = req.user.id;
    const { isDefault, ...addressData } = req.body;

    // Check if address already exists for this user
    const existingAddress = await Address.findOne({
      user: userId,
      ...addressData,
    }).session(session);

    if (existingAddress) {
      throw new CustomError.BadRequestError("This address already exists");
    }

    // User can't have more than 5 addresses
    const addressCount = await Address.countDocuments({ user: userId }).session(session);
    if (addressCount >= 5) {
      throw new CustomError.BadRequestError("You can't have more than 5 addresses");
    }

    // If setting as default, unset any existing default
    if (isDefault) {
      await Address.updateMany(
        { user: userId, isDefault: true },
        { $set: { isDefault: false } },
        { session }
      );
    }

    const address = await Address.create(
      [
        {
          user: userId,
          isDefault,
          ...addressData,
        },
      ],
      { session }
    );

    await session.commitTransaction();

    res.status(StatusCodes.CREATED).json({
      success: true,
      address: address[0],
    });
  } catch (error) {
    await session.abortTransaction();
    next(error);
  } finally {
    session.endSession();
  }
};

const updateAddress = async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const userId = req.user.id;
    const { id: addressId } = req.params;
    const { isDefault, ...updateData } = req.body;

    if (!mongoose.Types.ObjectId.isValid(addressId)) {
      throw new CustomError.BadRequestError("Invalid address ID");
    }

    const address = await Address.findOne({
      _id: addressId,
      user: userId,
    }).session(session);

    if (!address) {
      throw new CustomError.NotFoundError("Address not found");
    }

    // If setting as default, unset any existing default
    if (isDefault) {
      await Address.updateMany(
        { user: userId, isDefault: true },
        { $set: { isDefault: false } },
        { session }
      );
    }

    Object.assign(address, updateData);
    if (isDefault !== undefined) {
      address.isDefault = isDefault;
    }

    await address.save({ session });
    await session.commitTransaction();

    res.status(StatusCodes.OK).json({
      success: true,
      address,
    });
  } catch (error) {
    await session.abortTransaction();
    next(error);
  } finally {
    session.endSession();
  }
};

const deleteAddress = async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const userId = req.user.id;
    const { id: addressId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(addressId)) {
      throw new CustomError.BadRequestError("Invalid address ID");
    }

    const address = await Address.findOneAndDelete({
      _id: addressId,
      user: userId,
    }).session(session);

    if (!address) {
      throw new CustomError.NotFoundError("Address not found");
    }

    // If deleting the default address, set a new default if any exist
    if (address.isDefault) {
      const newDefault = await Address.findOne({ user: userId })
        .sort({ createdAt: -1 })
        .session(session);

      if (newDefault) {
        newDefault.isDefault = true;
        await newDefault.save({ session });
      }
    }

    await session.commitTransaction();

    res.status(StatusCodes.OK).json({
      success: true,
      message: "Address deleted successfully",
    });
  } catch (error) {
    await session.abortTransaction();
    next(error);
  } finally {
    session.endSession();
  }
};

const setDefaultAddress = async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const userId = req.user.id;
    const { id: addressId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(addressId)) {
      throw new CustomError.BadRequestError("Invalid address ID");
    }

    // Unset any existing default address
    await Address.updateMany(
      { user: userId, isDefault: true },
      { $set: { isDefault: false } },
      { session }
    );

    // Set the new default address
    const address = await Address.findOneAndUpdate(
      { _id: addressId, user: userId },
      { $set: { isDefault: true } },
      { new: true, session }
    );

    if (!address) {
      throw new CustomError.NotFoundError("Address not found");
    }

    await session.commitTransaction();

    res.status(StatusCodes.OK).json({
      success: true,
      address,
    });
  } catch (error) {
    await session.abortTransaction();
    next(error);
  } finally {
    session.endSession();
  }
};

module.exports = {
  getAllAddresses,
  createAddress,
  updateAddress,
  deleteAddress,
  setDefaultAddress,
};
