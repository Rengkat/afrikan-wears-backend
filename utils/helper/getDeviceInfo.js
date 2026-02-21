const getDeviceInfo = (req) => ({
  ip: req.ip,
  userAgent: req.headers["user-agent"],
  deviceId: req.headers["x-device-id"] || crypto.randomBytes(16).toString("hex"),
});
module.exports = getDeviceInfo;
