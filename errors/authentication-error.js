const CustomApiError = require("../middleware/error-handler");
class UnauthenticatedError extends CustomApiError {
  constructor(message) {
    super(message);
  }
}
module.exports = UnauthenticatedError;
