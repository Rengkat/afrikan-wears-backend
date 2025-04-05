const Stylist = require("../models/stylistModel");
const { StatusCodes } = require("http-status-codes");
const CustomError = require("../errors");

const addStylist = async (req, res, next) => {
  try {
    const { name, description } = req.body;

    if (!name) {
      throw new CustomError.BadRequestError("Name and image are required");
    }

    const existingStylist = await Stylist.findOne({ name });
    if (existingCategory) {
      throw new CustomError.BadRequestError("Category name already exists");
    }

    const stylist = await Stylist.create({
      name,
      description,
    });

    res.status(StatusCodes.CREATED).json({
      success: true,
      stylist,
    });
  } catch (error) {
    next(error);
  }
};

const getAllStylists = async (req, res, next) => {
  try {
    const { name, sort } = req.query;
    const query = {};

    if (name) {
      query.name = {
        $regex: name,
        $options: "i",
      };
    }

    const sortOptions = {
      name: "name",
      newest: "-createdAt",
      oldest: "createdAt",
    };
    const sortKey = sortOptions[sort] || "name";

    const stylists = await Stylist.find(query).sort(sortKey).lean();

    res.status(StatusCodes.OK).json({
      success: true,
      count: categories.length,
      stylists,
      filters: {
        name: name || null,
        sort: sort || "name (default)",
      },
    });
  } catch (error) {
    next(error);
  }
};

const getSingleStylist = async (req, res, next) => {
  const { id } = req.params;

  const stylist = await Stylist.findById(id);

  if (!stylist) {
    throw new CustomError.NotFoundError(`No category found with id: ${id}`);
  }

  res.status(StatusCodes.OK).json({
    success: true,
    stylist,
  });
};

const updateStylist = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, description } = req.body;

    const stylist = await Stylist.findById(id);
    if (!stylist) {
      throw new CustomError.NotFoundError(`No category found with id: ${id}`);
    }

    // Check if new name conflicts

    const nameExists = await Stylist.findOne({ name });
    if (nameExists) {
      throw new CustomError.BadRequestError("Category name already exists");
    }

    stylist.name = name || stylist.name;
    stylist.description = description || stylist.description;

    await stylist.save();

    res.status(StatusCodes.OK).json({
      success: true,
      stylist,
    });
  } catch (error) {
    next(error);
  }
};

const deleteStylist = async (req, res, next) => {
  try {
    const { id } = req.params;

    // Check if Stylist has products
    const productsCount = await Product.countDocuments({ stylist: id });
    if (productsCount > 0) {
      throw new CustomError.BadRequestError("Cannot delete category with associated products");
    }

    const stylist = await Stylist.findByIdAndDelete(id);
    if (!stylist) {
      throw new CustomError.NotFoundError(`No category found with id: ${id}`);
    }

    res.status(StatusCodes.OK).json({
      success: true,
      message: "Category deleted successfully",
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  addStylist,
  getAllStylists,
  getSingleStylist,
  updateStylist,
  deleteStylist,
};
