const sendEmail = require("./sendMail");

const sendResetPasswordEmail = async ({ email, origin, verificationToken }) => {
  const link = `${origin}/auth/verify-email?verificationToken=${verificationToken}&email=${email}`;
  const html = ``;
  sendEmail({ to: email, html, subject: "Reset Password" });
};
module.exports = sendResetPasswordEmail;
