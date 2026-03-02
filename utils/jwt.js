const jwt = require("jsonwebtoken");

const createJWT = ({ payload }) => {
  const token = jwt.sign(payload, process.env.JWT_SECRET);
  return token;
};

const isTokenVerified = (token) => jwt.verify(token, process.env.JWT_SECRET);
const attachTokenToResponse = ({ res, userPayload, refreshToken }) => {
  const accessTokenJWT = createJWT({
    payload: { accessToken: userPayload },
    expiresIn: process.env.JWT_ACCESS_LIFETIME || "15m",
  });

  const refreshTokenJWT = createJWT({
    payload: { accessToken: userPayload, refreshToken },
    expiresIn: process.env.JWT_REFRESH_LIFETIME || "7d",
  });

  const isProduction = process.env.NODE_ENV === "production";

  const cookieDefaults = {
    httpOnly: true,
    secure: isProduction,
    signed: true,
    sameSite: isProduction ? "none" : "lax",
    path: "/",
  };

  res.cookie("accessToken", accessTokenJWT, {
    ...cookieDefaults,
    maxAge: 1000 * 60 * 15,
  });

  res.cookie("refreshToken", refreshTokenJWT, {
    ...cookieDefaults,
    maxAge: 1000 * 60 * 60 * 24 * 7,
  });
};

module.exports = { attachTokenToResponse, isTokenVerified };
