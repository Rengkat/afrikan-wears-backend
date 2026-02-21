const clearAuthCookies = (res) => {
  const opts = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
    path: "/",
  };
  res.cookie("accessToken", "", { ...opts, maxAge: 0 });
  res.cookie("refreshToken", "", { ...opts, maxAge: 0 });
};
module.exports = clearAuthCookies;
