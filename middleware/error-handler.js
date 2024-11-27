const { StatusCodes } = require("http-status-codes");
const errorHandlerMiddleware = (err, req, res, nex) => {
  //default error structure
  const customError = {
    // these will be coming from other side or the default
    statusCode: err.statusCode || StatusCodes.INTERNAL_SERVER_ERROR,
    message: err.message || "Something went wrong, try again later",
  };
  //mongoose validation error
  if (err.name === "ValidationError") {
    customError.message = Object.values(err.errors)
      .map((item) => item.message)
      .join(", ");
  }
  customError.statusCode = StatusCodes.BAD_REQUEST;
  //mongoose duplicate error
  if (err.code && err.code === 11000) {
    customError.message = `Duplicate value entered for ${Object.keys(
      err.keyValue
    )} field, please choose another value.`;
    customError.statusCode = StatusCodes.BAD_REQUEST;
  }
  //mongoose cast error (invalid _id format)
  if (err.name === "CastError") {
    customError.message = `Invalid ${err.path}: ${err.value}.`;
    customError.statusCode = StatusCodes.NOT_FOUND;
  }

  return res.status(customError.statusCode).json({ message: customError.message, success: false });
};
module.exports = errorHandlerMiddleware;
