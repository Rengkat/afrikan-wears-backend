const clearAuthCookies = (res) => {
  const isProduction = process.env.NODE_ENV === "production";
  const opts = {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? "none" : "lax",
    path: "/",
  };
  res.cookie("accessToken", "", { ...opts, maxAge: 0 });
  res.cookie("refreshToken", "", { ...opts, maxAge: 0 });
};
module.exports = clearAuthCookies;
