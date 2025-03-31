const Category = require("../models/categoryModel");
const { StatusCodes } = require("http-status-codes");
const CustomError = require("../errors");

const createCategory = async (req, res, next) => {
  try {
    const { name, description } = req.body;

    if (!name) {
      throw new CustomError.BadRequestError("Name and image are required");
    }

    const existingCategory = await Category.findOne({ name });
    if (existingCategory) {
      throw new CustomError.BadRequestError("Category name already exists");
    }

    const category = await Category.create({
      name,
      description,
    });

    res.status(StatusCodes.CREATED).json({
      success: true,
      category,
    });
  } catch (error) {
    next(error);
  }
};

const getAllCategories = async (req, res, next) => {
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

    const categories = await Category.find(query).sort(sortKey).lean();

    res.status(StatusCodes.OK).json({
      success: true,
      count: categories.length,
      categories,
      filters: {
        name: name || null,
        sort: sort || "name (default)",
      },
    });
  } catch (error) {
    next(error);
  }
};

const getSingleCategory = async (req, res, next) => {
  const { id } = req.params;

  const category = await Category.findById(id);

  if (!category) {
    throw new CustomError.NotFoundError(`No category found with id: ${id}`);
  }

  res.status(StatusCodes.OK).json({
    success: true,
    category,
  });
};

const updateCategory = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, description } = req.body;

    const category = await Category.findById(id);
    if (!category) {
      throw new CustomError.NotFoundError(`No category found with id: ${id}`);
    }

    // Check if new name conflicts

    const nameExists = await Category.findOne({ name });
    if (nameExists) {
      throw new CustomError.BadRequestError("Category name already exists");
    }

    category.name = name || category.name;
    category.description = description || category.description;

    await category.save();

    res.status(StatusCodes.OK).json({
      success: true,
      category,
    });
  } catch (error) {
    next(error);
  }
};

const deleteCategory = async (req, res, next) => {
  try {
    const { id } = req.params;

    // Check if category has products
    const productsCount = await Product.countDocuments({ category: id });
    if (productsCount > 0) {
      throw new CustomError.BadRequestError("Cannot delete category with associated products");
    }

    const category = await Category.findByIdAndDelete(id);
    if (!category) {
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
  createCategory,
  getAllCategories,
  getSingleCategory,
  updateCategory,
  deleteCategory,
};
