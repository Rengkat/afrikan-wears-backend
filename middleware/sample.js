const authenticateUser = async (req, res, next) => {
  try {
    const { accessToken, refreshToken } = req.signedCookies;
    if (accessToken) {
      const payload = isTokenVerified(accessToken);
      req.user = payload.accessToken;
      return next();
    }

    if (refreshToken) {
      const payload = isTokenVerified(refreshToken);

      const existingRefreshToken = await Token.findOne({
        user: payload.accessToken.id,
        refreshToken: payload.refreshToken,
      });

      if (!existingRefreshToken || !existingRefreshToken.isValid) {
        throw new CustomError.UnauthenticatedError(
          "Authentication invalid - Refresh token invalid or expired"
        );
      }

      // Re-attach new access and refresh tokens (rotate refresh token for better security)
      // You should generate a NEW refresh token here for better security practices
      const newRefreshTokenString = crypto.randomBytes(40).toString("hex");
      existingRefreshToken.refreshToken = newRefreshTokenString;
      await existingRefreshToken.save();

      attachTokenToResponse({
        res,
        userPayload: payload.accessToken,
        refreshToken: newRefreshTokenString,
      });

      req.user = payload.accessToken;
      return next();
    }
  } catch (error) {
    if (error.name === "JsonWebTokenError" || error.name === "TokenExpiredError") {
      const options = {
        httpOnly: true,
        expires: new Date(Date.now()),
        secure: process.env.NODE_ENV === "production",
      };
      res.cookie("accessToken", "logout", {
        ...options,
      });
      res.cookie("refreshToken", "logout", {
        ...options,
      });
      return next(
        new CustomError.UnauthenticatedError("Authentication invalid - Please log in again")
      );
    }
    next(error);
  }
};
