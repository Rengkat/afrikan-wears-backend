const CustomApiError = require("../errors/custom-error");

class UnauthorizedError extends CustomApiError {}
module.exports = UnauthorizedError;
