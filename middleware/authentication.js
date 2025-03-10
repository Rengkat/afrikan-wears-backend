const { isTokenVerified, attachTokenToResponse } = require("../utils");

const authenticateUser = async (req, res, next) => {
  let refreshToken;
  let accessToken;
  if (!accessToken && req.signedCookies.refreshToken) {
    refreshToken = req.signedCookies.refreshToken;
  }
  if (!accessToken && !refreshToken) {
    throw new CustomError.UnauthenticatedError("Authentication invalid - No token provided");
  }
  if (accessToken) {
    const payload = isTokenVerified(accessToken);
    req.user = payload.accessToken;
    return next();
  }
  const payload = isTokenVerified(refreshToken);

  const existingRefreshToken = await Token.findOne({
    user: payload.accessToken.id,
    refreshToken: payload.refreshToken,
  });
  if (!existingRefreshToken || !existingRefreshToken?.isValid) {
    throw new CustomError.UnauthenticatedError("Authentication invalid");
  }
  attachTokenToResponse({
    res,
    userPayload: payload.accessToken,
    refreshToken: existingRefreshToken.refreshToken,
  });
  req.user = payload.accessToken;
};
