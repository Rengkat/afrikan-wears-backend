const CustomApiError = require("../middleware/error-handler");
class NotFound extends CustomApiError {
  constructor(message) {
    super(message);
  }
}
module.exports = NotFound;
