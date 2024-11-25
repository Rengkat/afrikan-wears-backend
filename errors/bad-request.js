const CustomApiError = require("../middleware/error-handler");
class BadRequestError extends CustomApiError {
  constructor(message) {
    super(message);
  }
}
module.exports = BadRequestError;
