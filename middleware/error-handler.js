const { StatusCodes } = require("http-status-codes");
const errorHandlerMiddleware = (err, req, res, nex) => {
  //default error structure
  const customError = {
    // these will be coming from other side or the default
    statusCode: err.statusCode || StatusCodes.INTERNAL_SERVER_ERROR,
    message: err.message || "Something went wrong, try again later",
  };
  //mongoose validation error
  //mongoose duplicate error
  //mongoose cast error (invalid _d format)
  return res.status(customError.statusCode).json({ message: customError.message, success: false });
};
module.exports = errorHandlerMiddleware;
