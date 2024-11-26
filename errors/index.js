const UnauthenticatedError = require("./authentication-error");
const UnauthorizedError = require("./authorization-error");
const BadRequestError = require("./bad-request");
const CustomApiError = require("./custom-error");
const NotFoundError = require("./not-found");

module.exports = {
  UnauthenticatedError,
  UnauthorizedError,
  NotFoundError,
  BadRequestError,
  CustomApiError,
};
