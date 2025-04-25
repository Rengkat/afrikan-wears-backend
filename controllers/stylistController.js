const Stylist = require("../models/stylistModel");
const User = require("../models/userModel");
const { StatusCodes } = require("http-status-codes");
const { getFromCache, setInCache, clearCache } = require("../utils/redisClient");

const CustomError = require("../errors");
const mongoose = require("mongoose");
const addStylist = async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { name, description, owner, location } = req.body;

    if (!name || !owner || !mongoose.Types.ObjectId.isValid(owner)) {
      throw new CustomError.BadRequestError("Provide valid name and owner ID");
    }

    // Check if stylist exists (case-insensitive)
    const existingStylist = await Stylist.findOne({
      name: { $regex: new RegExp(`^${name}$`, "i") },
    }).session(session);

    if (existingStylist) {
      throw new CustomError.BadRequestError("Stylist name already exists");
    }

    // Create stylist
    const stylist = await Stylist.create(
      [
        {
          name,
          description,
          owner,
          location,
        },
      ],
      { session }
    );

    // Update user role
    const user = await User.findById(owner).session(session);
    if (!user) {
      throw new CustomError.NotFoundError("User not found");
    }

    user.role = "stylist";
    user.company = stylist[0]._id;
    await user.save({ session });

    await session.commitTransaction();
    //clear stylist cache as a new stylist is added
    await clearCache("stylist:*");
    res.status(StatusCodes.CREATED).json({
      success: true,
      stylist: stylist[0],
    });
  } catch (error) {
    await session.abortTransaction();
    next(error);
  } finally {
    session.endSession();
  }
};
const getAllStylists = async (req, res, next) => {
  try {
    const { name, page = 1, limit = 10 } = req.query;
    const cacheKey = `stylist:${name || ""}:${page}:${limit}`;
    //get from cache first
    const cachedData = await getFromCache(cacheKey);
    if (cachedData) {
      return res.status(StatusCodes.OK).json({
        success: true,
        fromCache: true,
        ...cachedData,
      });
    }
    const query = {};

    if (name) {
      query.name = { $regex: name, $options: "i" };
    }
    const skip = (page - 1) * limit;
    const [stylists, total] = await Promise.all([
      Stylist.find(query).skip(skip).limit(limit).lean(),
      Stylist.countDocuments(query),
    ]);
    const responseData = {
      count: stylists.length,
      total,
      page: Number(page),
      pages: Math.ceil(total / limit),
      stylists,
    };
    //Cache the response for 1 hour
    await setInCache(cacheKey, responseData);
    res.status(StatusCodes.OK).json({
      success: true,
      fromCache: false,
      ...responseData,
    });
  } catch (error) {
    next(error);
  }
};
const getSingleStylist = async (req, res, next) => {
  try {
    const { id } = req.params;

    const cacheKey = `stylist:${id}`;
    //get from cache first
    const cachedStylist = await getFromCache(cacheKey);
    if (cacheKey) {
      return res.status(StatusCodes.OK).json({
        success: true,
        fromCache: true,
        stylist: cachedStylist,
      });
    }
    const stylist = await Stylist.findById(id).lean();

    if (!stylist) {
      throw new CustomError.NotFoundError(`No stylist found with id: ${id}`);
    }
    //add to cache
    await setInCache(cacheKey, stylist.toOject());
    res.status(StatusCodes.OK).json({
      success: true,
      stylist,
    });
  } catch (error) {
    next(error);
  }
};
const updateStylist = async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { id } = req.params;
    const { name, description, location } = req.body;

    const stylist = await Stylist.findById(id).session(session);
    if (!stylist) {
      throw new CustomError.NotFoundError(`No stylist found with id: ${id}`);
    }

    // Case-insensitive name conflict check (excluding current stylist)
    if (name) {
      const nameExists = await Stylist.findOne({
        name: { $regex: new RegExp(`^${name}$`, "i") },
        _id: { $ne: id },
      }).session(session);

      if (nameExists) {
        throw new CustomError.BadRequestError("Stylist name already exists");
      }
      stylist.name = name;
    }

    if (description) stylist.description = description;
    if (location) stylist.location = location;

    await stylist.save({ session });
    await session.commitTransaction();
    // clear both the specific stylist cache and the stylist cache
    await Promise.all([clearCache(`stylist:${id}`), clearCache(`stylist:*`)]);
    res.status(StatusCodes.OK).json({
      success: true,
      stylist,
      message: "Updated successfully",
    });
  } catch (error) {
    await session.abortTransaction();
    next(error);
  } finally {
    session.endSession();
  }
};
const deleteStylist = async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { id } = req.params;

    // Check if Stylist has products
    const productsCount = await Product.countDocuments({ stylist: id }).session(session);
    if (productsCount > 0) {
      throw new CustomError.BadRequestError("Cannot delete stylist with associated products");
    }

    // Check if any User still references this Stylist
    const usersCount = await User.countDocuments({ company: id }).session(session);
    if (usersCount > 0) {
      throw new CustomError.BadRequestError("Cannot delete stylist with associated users");
    }

    const stylist = await Stylist.findByIdAndDelete(id).session(session);
    if (!stylist) {
      throw new CustomError.NotFoundError(`No stylist found with id: ${id}`);
    }

    await session.commitTransaction();
    // clear both the specific stylist cache and the stylist cache
    await Promise.all([clearCache(`stylist${id}`), clearCache(`stylist:*`)]);

    res.status(StatusCodes.OK).json({
      success: true,
      message: "Stylist deleted successfully",
    });
  } catch (error) {
    await session.abortTransaction();
    next(error);
  } finally {
    session.endSession();
  }
};

module.exports = {
  addStylist,
  getAllStylists,
  getSingleStylist,
  updateStylist,
  deleteStylist,
};
